'use client';

/**
 * Live.tsx — the Hunt view's client islands. Everything time-relative runs on
 * the BROWSER clock (a page built hours ago must still tell the truth), and is
 * hydration-safe: server + first paint render a skeleton or nothing; a mounted
 * effect fills in the real value.
 */
import { useEffect, useRef, useState } from 'react';
import { effectiveState, type DashboardRun } from '@/scripts/hunt-engine/dashboard';
import { span, utcStamp } from './format';

/** Client "now", null until mounted. Ticks every `everyMs`. */
function useNow(everyMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

function Skeleton({ w = '6ch' }: { w?: string }) {
  return <span className="hx-skel" style={{ width: w }} aria-hidden="true" />;
}

/** Auction countdown: "ends in 5d 18h" / "ended". */
export function EndsIn({ endsAt }: { endsAt: string }) {
  const now = useNow(30_000);
  if (now == null) return <Skeleton w="9ch" />;
  const t = Date.parse(endsAt);
  if (!Number.isFinite(t)) return <span className="hx-dim">end time unreadable</span>;
  const diff = t - now;
  if (diff <= 0) return <span className="hx-ended">ended — result unknown here</span>;
  return <span className={diff < 3 * 3_600_000 ? 'hx-soon' : undefined}>ends in {span(diff)}</span>;
}

/** "3h ago" beside an absolute stamp. */
export function Ago({ iso }: { iso: string | null }) {
  const now = useNow(60_000);
  if (!iso) return null;
  if (now == null) return <Skeleton w="5ch" />;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = now - t;
  return <span className="hx-dim">{d >= 0 ? `${span(d)} ago` : `in ${span(d)}`}</span>;
}

/** Run freshness chip for the status bar: "current" or "STALE". */
export function FreshnessChip({ run }: { run: DashboardRun }) {
  const now = useNow(60_000);
  if (now == null) return <Skeleton w="7ch" />;
  const s = effectiveState(run, now);
  return s === 'stale' ? (
    <span className="hx-badge hx-badge-down">stale</span>
  ) : (
    <span className="hx-badge hx-badge-up">current</span>
  );
}

/** The STALE banner — renders only when the browser clock says the run is
 *  older than run.staleAfterMinutes. */
export function StaleRunBanner({ run }: { run: DashboardRun }) {
  const now = useNow(60_000);
  if (now == null) return null;
  if (effectiveState(run, now) !== 'stale') return null;
  const age = now - Date.parse(run.finishedAt);
  return (
    <div className="hx-banner hx-banner-stale" role="status">
      <strong>STALE</strong>
      <span>
        The last hunt run finished {span(age)} ago ({utcStamp(run.finishedAt)}) — older than its{' '}
        {run.staleAfterMinutes}-minute freshness window. Listings below may have sold, ended, or
        changed price since.
      </span>
    </div>
  );
}

/** Listing image with a placeholder for null OR a URL that fails to load. */
export function HuntImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // an image that errored before hydration never fires onError — check it
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  if (!src || failed) {
    return (
      <span className="hx-media-empty">
        <span>{src ? 'image failed to load' : 'no image from eBay'}</span>
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
