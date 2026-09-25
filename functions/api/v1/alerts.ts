import { alertsResponse } from '../../../scripts/hunt-engine/dashboard';
import { json, loadDashboard, notPublished, type Ctx } from './_shared';

/** GET /api/v1/alerts?state=pending|delivered|expired|all&cursor=…&limit=1..200 */
export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const d = await loadDashboard(ctx);
  if (!d) return notPublished();
  const q = new URL(ctx.request.url).searchParams;
  return json(alertsResponse(d, Date.now(), { state: q.get('state'), cursor: q.get('cursor'), limit: q.get('limit') ? Number(q.get('limit')) : null }));
};
