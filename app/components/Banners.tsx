/**
 * Banners — the deliberate non-happy states (PROPOSAL §4.2): a stale-data notice
 * when the board artifact is older than two cron periods, and a first-class empty
 * state ("book is live, no qualifying deals right now"). No skeleton-forever.
 */
import { shortDate } from '@/app/lib/display';

export function StaleBanner({ builtAt }: { builtAt: string }) {
  return (
    <div className="banner" role="status">
      This board hasn&apos;t refreshed on schedule — last built {shortDate(builtAt)}. Prices and
      depths below may be behind the market.
    </div>
  );
}

export function EmptyBoard({
  title = 'The book is live — no qualifying deals right now.',
  children,
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-board">
      <span className="pulse" aria-hidden="true" />
      <h2>{title}</h2>
      <p>
        {children ??
          "Starling only surfaces a listing when its identity pins to an exact corpus key and it sits deep under book value. When one appears, it shows up here with its evidence and risk grade — never a manufactured number."}
      </p>
    </div>
  );
}
