/**
 * POST /api/v1/feedback — your "Not it" / "Block seller" / "Undo".
 * PIN-gated by functions/_middleware.ts like everything else. Each choice is
 * one small R2 object (bucket starling-data, prefix hunt/feedback/), read by
 * the next hunt run (hourly), which drops the listing and expires its alert.
 * R2 is reached over the Cloudflare REST API with the Pages secrets
 * STARLING_R2_TOKEN + CLOUDFLARE_ACCOUNT_ID (pushed by deploy.yml).
 */
import { json } from './_shared';

interface Env { STARLING_R2_TOKEN?: string; CLOUDFLARE_ACCOUNT_ID?: string; STARLING_R2_BUCKET?: string }
interface Ctx { request: Request; env: Env }

const ID = /^[A-Za-z0-9|_.:-]{1,120}$/;
const HUNT = /^[a-z0-9][a-z0-9-]{0,80}$/;
const SELLER = /^[A-Za-z0-9_.*-]{1,80}$/;
const itemKey = (id: string) => id.replace(/[^A-Za-z0-9_.-]+/g, '_');
const sellerKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');

async function r2(env: Env, method: 'PUT' | 'DELETE', key: string, body?: string): Promise<boolean> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${env.STARLING_R2_BUCKET || 'starling-data'}/objects/${encodeURIComponent(key)}`;
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${env.STARLING_R2_TOKEN}`, 'Content-Type': 'application/json' }, body });
  return res.ok || (method === 'DELETE' && res.status === 404);
}

export const onRequestPost = async (ctx: Ctx): Promise<Response> => {
  const { env, request } = ctx;
  if (!env.STARLING_R2_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return json({ ok: false, error: 'feedback storage is not configured' }, 503);
  let b: any;
  try { b = await request.json(); } catch { return json({ ok: false, error: 'body must be JSON' }, 400); }
  const at = new Date().toISOString();
  const action = b?.action;
  if (action === 'dismiss') {
    if (!HUNT.test(b.huntId ?? '') || !ID.test(b.listingId ?? '')) return json({ ok: false, error: 'huntId and listingId required' }, 400);
    const seller = typeof b.seller === 'string' && SELLER.test(b.seller) ? b.seller : null;
    const ok = await r2(env, 'PUT', `hunt/feedback/dismiss/${b.huntId}__${itemKey(b.listingId)}.json`, JSON.stringify({ huntId: b.huntId, listingId: b.listingId, seller, at }));
    return ok ? json({ ok: true }) : json({ ok: false, error: 'could not save' }, 502);
  }
  if (action === 'block-seller') {
    if (!SELLER.test(b.seller ?? '')) return json({ ok: false, error: 'seller required' }, 400);
    const ok = await r2(env, 'PUT', `hunt/feedback/seller/${sellerKey(b.seller)}.json`, JSON.stringify({ seller: b.seller, at }));
    return ok ? json({ ok: true }) : json({ ok: false, error: 'could not save' }, 502);
  }
  if (action === 'undo') {
    const jobs: Promise<boolean>[] = [];
    if (HUNT.test(b.huntId ?? '') && ID.test(b.listingId ?? '')) jobs.push(r2(env, 'DELETE', `hunt/feedback/dismiss/${b.huntId}__${itemKey(b.listingId)}.json`));
    if (SELLER.test(b.seller ?? '')) jobs.push(r2(env, 'DELETE', `hunt/feedback/seller/${sellerKey(b.seller)}.json`));
    if (!jobs.length) return json({ ok: false, error: 'nothing to undo' }, 400);
    const res = await Promise.all(jobs);
    return res.every(Boolean) ? json({ ok: true }) : json({ ok: false, error: 'could not undo' }, 502);
  }
  return json({ ok: false, error: 'action must be dismiss, block-seller or undo' }, 400);
};
