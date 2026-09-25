'use client';

/**
 * Feedback.tsx — "Not it" / "Block seller" on a Hunt card, plus the page-level
 * "N hidden by you" control. The page is statically rendered, so hiding is a
 * client-side overlay: every card <article> carries data-card-key / data-seller,
 * and a tiny store here marks matching articles `data-hx-hidden` (CSS hides
 * them). With JS off nothing is hidden. Hidden keys persist in localStorage
 * ('starling-hidden') until the next hunt run drops the listing from the page
 * (then the key is pruned — the engine has taken over).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

type Entry =
  | { t: 'card'; key: string; huntId: string; listingId: string; at: number }
  | { t: 'seller'; seller: string; at: number };

const LS_KEY = 'starling-hidden';
const REVEAL_CLASS = 'hx-reveal-hidden';

const entryId = (e: Entry) => (e.t === 'card' ? `card:${e.key}` : `seller:${e.seller}`);

// ── the store ──────────────────────────────────────────────────────────────

let entries = new Map<string, Entry>();
let reveal = false;
let hiddenCount = 0;
let version = 0;
let loaded = false;
const listeners = new Set<() => void>();

function readLs(): Entry[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e): e is Entry =>
        !!e &&
        ((e.t === 'card' && typeof e.key === 'string' && typeof e.huntId === 'string' && typeof e.listingId === 'string') ||
          (e.t === 'seller' && typeof e.seller === 'string')),
    );
  } catch {
    return [];
  }
}

function writeLs() {
  try {
    if (entries.size === 0) window.localStorage.removeItem(LS_KEY);
    else window.localStorage.setItem(LS_KEY, JSON.stringify([...entries.values()]));
  } catch {
    /* private mode / blocked storage — hiding still works for this page view */
  }
}

function articles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('article[data-card-key]'));
}

/** Mark hidden articles + fully-hidden sections, then notify subscribers. */
function apply() {
  let n = 0;
  for (const a of articles()) {
    const key = a.dataset.cardKey ?? '';
    const seller = a.dataset.seller;
    const hidden = entries.has(`card:${key}`) || (!!seller && entries.has(`seller:${seller}`));
    if (hidden) {
      a.setAttribute('data-hx-hidden', '');
      n++;
    } else a.removeAttribute('data-hx-hidden');
  }
  document.querySelectorAll<HTMLElement>('.hx-group-sec').forEach((sec) => {
    const arts = sec.querySelectorAll('article[data-card-key]');
    const shown = sec.querySelectorAll('article[data-card-key]:not([data-hx-hidden])');
    if (arts.length > 0 && shown.length === 0) sec.setAttribute('data-hx-all-hidden', '');
    else sec.removeAttribute('data-hx-all-hidden');
  });
  if (n === 0) reveal = false;
  document.documentElement.classList.toggle(REVEAL_CLASS, reveal);
  hiddenCount = n;
  version++;
  listeners.forEach((l) => l());
}

/** Load once per page: read storage, prune keys the latest run no longer shows. */
function init() {
  if (loaded) return;
  loaded = true;
  const arts = articles();
  const keys = new Set(arts.map((a) => a.dataset.cardKey));
  const sellers = new Set(arts.map((a) => a.dataset.seller).filter(Boolean));
  let pruned = false;
  for (const e of readLs()) {
    // no cards on the page (empty / failed run) → keep everything, prune nothing
    const live = arts.length === 0 || (e.t === 'card' ? keys.has(e.key) : sellers.has(e.seller));
    if (live) entries.set(entryId(e), e);
    else pruned = true;
  }
  if (pruned) writeLs();
  apply();
}

function hide(e: Entry) {
  entries.set(entryId(e), e);
  writeLs();
  apply();
}

function unhide(id: string) {
  entries.delete(id);
  writeLs();
  apply();
}

function setReveal(v: boolean) {
  reveal = v;
  apply();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getVersion = () => version;
const getServerVersion = () => 0;

// ── the API ────────────────────────────────────────────────────────────────

type FeedbackBody =
  | { action: 'dismiss'; huntId: string; listingId: string }
  | { action: 'block-seller'; seller: string }
  | { action: 'undo'; huntId?: string; listingId?: string; seller?: string };

async function post(body: FeedbackBody): Promise<string | null> {
  try {
    const res = await fetch('/api/v1/feedback', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data: { ok?: boolean; error?: string } | null = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON (e.g. a 404 page) */
    }
    if (res.ok && data?.ok !== false) return null;
    return data?.error ?? `HTTP ${res.status}`;
  } catch {
    return 'network error';
  }
}

// ── the card actions ───────────────────────────────────────────────────────

export function Feedback({
  cardKey,
  huntId,
  listingId,
  seller,
}: {
  cardKey: string;
  huntId: string;
  listingId: string;
  seller: string | null;
}) {
  useSyncExternalStore(subscribe, getVersion, getServerVersion);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    init();
    setMounted(true);
  }, []);

  const byCard = mounted && entries.has(`card:${cardKey}`);
  const bySeller = mounted && !!seller && entries.has(`seller:${seller}`);

  async function act(kind: 'dismiss' | 'block-seller') {
    if (busy) return;
    setErr(null);
    setBusy(true);
    const e: Entry =
      kind === 'dismiss'
        ? { t: 'card', key: cardKey, huntId, listingId, at: Date.now() }
        : { t: 'seller', seller: seller as string, at: Date.now() };
    hide(e); // optimistic
    const fail = await post(
      kind === 'dismiss' ? { action: 'dismiss', huntId, listingId } : { action: 'block-seller', seller: seller as string },
    );
    setBusy(false);
    if (fail) {
      unhide(entryId(e));
      setErr(`${kind === 'dismiss' ? 'Not saved' : 'Seller not blocked'} — ${fail}`);
    }
  }

  async function undo() {
    if (busy) return;
    setErr(null);
    setBusy(true);
    // undo the seller block first when both apply — that's what hides the card
    const body: FeedbackBody = bySeller ? { action: 'undo', seller: seller as string } : { action: 'undo', huntId, listingId };
    const id = bySeller ? `seller:${seller}` : `card:${cardKey}`;
    const fail = await post(body);
    setBusy(false);
    if (fail) setErr(`Undo not saved — ${fail}`);
    else unhide(id);
  }

  if (byCard || bySeller) {
    return (
      <div className="hx-fb hx-fb-hidden">
        <span className="hx-fb-why">{bySeller ? `seller ${seller} blocked by you` : 'marked “not it” by you'}</span>
        <button type="button" className="hx-fb-btn hx-fb-undo" onClick={undo} disabled={busy}>
          {busy ? 'Undoing…' : 'Undo'}
        </button>
        {err && (
          <span className="hx-fb-err" role="alert">
            {err}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="hx-fb">
      <button
        type="button"
        className="hx-fb-btn"
        onClick={() => act('dismiss')}
        disabled={busy}
        title="Hide this listing for this hunt — the next run drops it"
      >
        Not it
      </button>
      {seller && (
        <button
          type="button"
          className="hx-fb-btn"
          onClick={() => act('block-seller')}
          disabled={busy}
          title={`Hide every listing from ${seller}, across all hunts`}
        >
          Block seller
        </button>
      )}
      {err && (
        <span className="hx-fb-err" role="alert">
          {err}
        </span>
      )}
    </div>
  );
}

// ── the page-level control ─────────────────────────────────────────────────

export function HiddenControl() {
  useSyncExternalStore(subscribe, getVersion, getServerVersion);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    init();
    setMounted(true);
  }, []);
  if (!mounted || hiddenCount === 0) return null;
  return (
    <p className="hx-hiddenbar" role="status">
      <span>
        <b>{hiddenCount}</b> hidden by you
      </span>
      <span className="hx-dim">·</span>
      <button type="button" className="hx-fb-btn" aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
        {reveal ? 'Hide them again' : 'Show / undo'}
      </button>
    </p>
  );
}
