/**
 * Shared by the /api/v1/* Pages Functions. Every endpoint reads the SAME
 * deployed file the Hunt page was built from (/data/starling/hunt/dashboard.json),
 * so the page and the API always report the same run id. Staleness is computed
 * at request time. Read-only; no secrets exist in this runtime.
 */
import type { DashboardPayload } from '../../../scripts/hunt-engine/dashboard';

export interface Env { ASSETS: { fetch: (req: Request | string) => Promise<Response> } }
export interface Ctx { request: Request; env: Env }

export const DASHBOARD_PATH = '/data/starling/hunt/dashboard.json';

export async function loadDashboard(ctx: Ctx): Promise<DashboardPayload | null> {
  const url = new URL(DASHBOARD_PATH, ctx.request.url);
  const res = await ctx.env.ASSETS.fetch(new Request(url.toString()));
  if (!res.ok) return null;
  try {
    const d = (await res.json()) as DashboardPayload;
    return d && d.schemaVersion === 1 ? d : null;
  } catch {
    return null;
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 1), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    },
  });
}

export const notPublished = () =>
  json({ schemaVersion: 1, error: 'not-published', message: 'The hunt engine has not published a run yet.' }, 503);
