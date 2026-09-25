/**
 * sink.ts — optional outbound alert delivery. Unset STARLING_ALERT_WEBHOOK_URL
 * = no sink: the pending queue in /api/v1/alerts IS the notification channel
 * and the run still succeeds. When set, each pending undelivered alert is
 * POSTed as a minimal packet; a failure stays pending with the failure
 * recorded (status + short, redacted message — never headers or secrets).
 */
import type { AlertLedger } from './types';

export interface SinkResult { attempted: number; delivered: number; failed: number }

export async function deliverPending(
  ledger: AlertLedger,
  webhookUrl: string | null,
  now: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SinkResult> {
  const out: SinkResult = { attempted: 0, delivered: 0, failed: 0 };
  if (!webhookUrl) return out;
  for (const a of Object.values(ledger.alerts)) {
    if (a.state !== 'pending') continue;
    out.attempted++;
    const r = a.record;
    const packet = {
      alertKey: r.alertKey, huntId: r.huntId, title: r.title, url: r.url,
      buyingMode: r.buyingMode, endsAt: r.endsAt, allIn: r.allIn, maxAllIn: r.maxAllIn,
      underBy: r.underBy, currency: r.currency, taxExcluded: true,
    };
    try {
      const res = await fetchImpl(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packet) });
      a.deliveries.push({ at: now, ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` });
      if (res.ok) { a.state = 'delivered'; out.delivered++; } else out.failed++;
    } catch (e: any) {
      a.deliveries.push({ at: now, ok: false, status: null, error: String(e?.name ?? 'error').slice(0, 60) });
      out.failed++;
    }
  }
  return out;
}
