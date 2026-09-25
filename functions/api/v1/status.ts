import { statusResponse } from '../../../scripts/hunt-engine/dashboard';
import { json, loadDashboard, notPublished, type Ctx } from './_shared';

export const onRequestGet = async (ctx: Ctx): Promise<Response> => {
  const d = await loadDashboard(ctx);
  return d ? json(statusResponse(d, Date.now())) : notPublished();
};
