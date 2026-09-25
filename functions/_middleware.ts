/**
 * PIN gate for the whole site (Collin, Sep 25 2026). Every request — pages,
 * /data/*.json, /api/v1/* — passes through here. The PIN lives in the Pages
 * secret STARLING_PIN (set by deploy.yml from the GitHub secret of the same
 * name), never in this public repo. Unset PIN = locked (fail closed).
 *
 *   browser: POST /__gate with the PIN → HttpOnly cookie (HMAC of the PIN), 30 days
 *   agents:  send the PIN in an X-Starling-Pin header
 *
 * A 4-digit PIN is a privacy gate, not strong security: wrong attempts are
 * slowed, but 10,000 combinations are guessable by a determined script.
 */
interface Env {
  STARLING_PIN?: string;
  ASSETS: { fetch: (req: Request | string) => Promise<Response> };
}
interface Ctx {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}

const COOKIE = 'starling_gate';
const MAX_AGE = 60 * 60 * 24 * 30;

async function tokenFor(pin: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('starling-gate-v1'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function cookieValue(req: Request): string | null {
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]+)`));
  return m ? m[1] : null;
}

function safeNext(v: string | null): string {
  return v && v.startsWith('/') && !v.startsWith('//') ? v : '/';
}

const NOINDEX = { 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' };

function gatePage(next: string, error: boolean, status = 200): Response {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>starling</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090a;color:#f7f8f8;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif}
main{width:min(340px,calc(100% - 40px));display:flex;flex-direction:column;gap:18px}
.logo{font-weight:800;font-size:28px;letter-spacing:-.03em}
p{margin:0;color:#8a8f98;font-size:14px}
form{display:flex;gap:8px}
input{flex:1;min-width:0;background:#111214;border:1px solid #2a2c30;border-radius:10px;color:#f7f8f8;padding:12px 14px;font:600 20px ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:.3em;text-align:center}
input:focus{outline:2px solid #e8dab6;outline-offset:1px;border-color:transparent}
button{background:#e8dab6;color:#08090a;border:0;border-radius:10px;padding:0 18px;font:700 14px -apple-system,Inter,sans-serif;cursor:pointer}
.err{color:#e0897b;font-size:13px}
</style></head><body><main>
<div class="logo">starling</div>
<p>Private. Enter the PIN to continue.</p>
<form method="post" action="/__gate">
<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="12" autofocus aria-label="PIN" required>
<input type="hidden" name="next" value="${esc(next)}">
<button type="submit">Enter</button>
</form>
${error ? '<p class="err" role="alert">That PIN is not right.</p>' : ''}
</main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...NOINDEX } });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const pin = env.STARLING_PIN?.trim();
  if (!pin) {
    return new Response('Starling is locked: the PIN gate is not configured.', { status: 503, headers: { 'content-type': 'text/plain', ...NOINDEX } });
  }
  const token = await tokenFor(pin);

  if (url.pathname === '/__gate') {
    if (request.method !== 'POST') return gatePage('/', false);
    const form = await request.formData().catch(() => null);
    const given = String(form?.get('pin') ?? '').trim();
    const next = safeNext(String(form?.get('next') ?? '/'));
    if (same(await tokenFor(given || ' '), token)) {
      return new Response(null, {
        status: 303,
        headers: {
          location: next,
          'set-cookie': `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
          ...NOINDEX,
        },
      });
    }
    await new Promise((r) => setTimeout(r, 900)); // slow down guessing
    return gatePage(next, true, 401);
  }

  const header = request.headers.get('x-starling-pin');
  const ok = (header != null && same(await tokenFor(header.trim() || ' '), token)) || same(cookieValue(request) ?? '', token);
  if (ok) {
    const res = await ctx.next();
    const out = new Response(res.body, res);
    out.headers.set('x-robots-tag', 'noindex, nofollow');
    return out;
  }

  if (url.pathname.startsWith('/api/') || url.pathname.endsWith('.json')) {
    return new Response(JSON.stringify({ error: 'locked', message: 'Starling is private. Send the PIN in an X-Starling-Pin header.' }), {
      status: 401,
      headers: { 'content-type': 'application/json', ...NOINDEX },
    });
  }
  return gatePage(safeNext(url.pathname + url.search), false, 401);
};
