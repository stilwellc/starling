/**
 * ledger.ts — alert dedupe. An alert is keyed provider:itemId:huntId:vN, and N
 * only advances on a MATERIAL change:
 *   first-under            first observed at or below cap
 *   crossed-under          was over (or unknown) and is now at or below cap
 *   price-drop             still under, all-in fell ≥ max($25, 5%) below the last alerted all-in
 *   authenticity-evidence  still under, new authenticity evidence appeared in the title
 * Timestamps, punctuation, and re-seeing the same listing change nothing.
 * Pending alerts expire when their listing stops being an under in a hunt that
 * this run searched completely (an unsearched hunt never expires anything).
 */
import { authenticityEvidence } from './evaluate';
import type { AlertLedger, AlertRecord, LedgerEntry, Observation } from './types';

export const PRICE_DROP_MIN_USD = 25;
export const PRICE_DROP_MIN_PCT = 0.05;

export function emptyLedger(): AlertLedger { return { schemaVersion: 1, tracks: {}, alerts: {} }; }

export const trackKey = (huntId: string, itemId: string) => `${huntId}|${itemId}`;
export const alertKeyOf = (itemId: string, huntId: string, version: number) => `ebay:${itemId}:${huntId}:v${version}`;

export function recordOf(o: Observation, alertKey: string, firstSeenAt: string, lastSeenAt: string): AlertRecord {
  const { listing: l, evaluation: e } = o;
  return {
    alertKey,
    huntId: e.huntId,
    listingId: l.itemId,
    title: l.title,
    url: l.url,
    imageUrl: l.imageUrl,
    buyingMode: l.buyingMode,
    endsAt: l.endsAt,
    price: l.price,
    shipping: l.shipping,
    allIn: e.allIn,
    maxAllIn: e.maxAllIn,
    underBy: e.underBy,
    underPct: e.underPct,
    currency: 'USD',
    confidence: e.confidence,
    risk: e.risk,
    riskReasons: e.riskReasons,
    reasons: e.reasons,
    flags: e.flags,
    firstSeenAt,
    lastSeenAt,
  };
}

export interface LedgerUpdate {
  created: LedgerEntry[];
  expired: string[];
}

/**
 * Fold one run's retained observations (rejects excluded) into the ledger.
 * `completeHunts` = hunts this run searched completely; only those may expire alerts.
 */
export function updateLedger(
  ledger: AlertLedger,
  observations: Observation[],
  completeHunts: Set<string>,
  runId: string,
  now: string,
): LedgerUpdate {
  const created: LedgerEntry[] = [];
  const underNow = new Set<string>();

  for (const o of observations) {
    const e = o.evaluation;
    if (e.classification === 'reject') continue;
    const key = trackKey(e.huntId, o.listing.itemId);
    const prev = ledger.tracks[key];
    const evidence = authenticityEvidence(o.listing.title);
    const firstSeenAt = prev?.firstSeenAt ?? now;
    let trigger: LedgerEntry['trigger'] | null = null;

    if (e.classification === 'under' && e.allIn !== null) {
      underNow.add(key);
      if (!prev || prev.alertedAllIn === null) trigger = 'first-under';
      else if (prev.lastClassification !== 'under') trigger = 'crossed-under';
      else {
        const drop = prev.alertedAllIn - e.allIn;
        if (drop >= Math.max(PRICE_DROP_MIN_USD, prev.alertedAllIn * PRICE_DROP_MIN_PCT)) trigger = 'price-drop';
        else if (evidence.some((x) => !prev.evidence.includes(x))) trigger = 'authenticity-evidence';
      }
    }

    const version = trigger ? (prev?.version ?? 0) + 1 : prev?.version ?? 0;
    ledger.tracks[key] = {
      version,
      lastClassification: e.classification,
      lastAllIn: e.allIn,
      alertedAllIn: trigger ? e.allIn : prev?.alertedAllIn ?? null,
      evidence: [...new Set([...(prev?.evidence ?? []), ...evidence])],
      firstSeenAt,
      lastSeenAt: now,
    };

    if (trigger) {
      // a newer material version supersedes any still-pending older one
      for (const a of Object.values(ledger.alerts)) {
        if (a.huntId === e.huntId && a.listingId === o.listing.itemId && a.state === 'pending') a.state = 'expired';
      }
      const alertKey = alertKeyOf(o.listing.itemId, e.huntId, version);
      const entry: LedgerEntry = {
        alertKey,
        huntId: e.huntId,
        listingId: o.listing.itemId,
        version,
        trigger,
        state: 'pending',
        allInAtAlert: e.allIn!,
        firstSeenAt,
        lastSeenAt: now,
        createdRunId: runId,
        deliveries: [],
        record: recordOf(o, alertKey, firstSeenAt, now),
      };
      ledger.alerts[alertKey] = entry;
      created.push(entry);
    } else {
      // refresh the live packet of the current version's alert, if any
      const cur = ledger.alerts[alertKeyOf(o.listing.itemId, e.huntId, version)];
      if (cur && cur.state === 'pending') {
        cur.lastSeenAt = now;
        cur.record = recordOf(o, cur.alertKey, cur.firstSeenAt, now);
      }
    }
  }

  const expired: string[] = [];
  for (const a of Object.values(ledger.alerts)) {
    if (a.state !== 'pending') continue;
    if (!completeHunts.has(a.huntId)) continue;
    if (!underNow.has(trackKey(a.huntId, a.listingId))) { a.state = 'expired'; expired.push(a.alertKey); }
  }
  return { created, expired };
}
