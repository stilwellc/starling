/**
 * HuntModule — the hunt lane on the board (PROPOSAL §4.4), as a STRIP.
 *
 * Curated targets stay pinned above book-driven discovery, but the board is
 * the priced product: the strip carries the watch state (targets · live hits)
 * and renders only PRICED hunt hits as cards — a priced hunt hit is a real
 * deal and earns full card grammar with the hunted stamp. The noBook facts
 * live on /hunt, one tap away, so sixty watched listings never bury the board.
 */
import Link from 'next/link';
import type { HuntDeal, HuntPricedDeal, HuntSection } from '@/scripts/types';
import { DealCard } from './DealCard';

const STRIP_MAX_CARDS = 3;

/** One hunt hit at full grammar — shared with /hunt for priced hits. */
export function HuntPricedCard({
  deal,
  density = 'grid',
}: {
  deal: HuntPricedDeal;
  density?: 'hero' | 'grid' | 'row';
}) {
  return <DealCard deal={deal} huntLabel={deal.huntLabel} density={density} />;
}

export function isPricedHunt(d: HuntDeal): d is HuntPricedDeal {
  return !d.noBook;
}

/** The pinned strip at the top of the mixed board. */
export function HuntModule({ hunt }: { hunt: HuntSection }) {
  if (hunt.targets.length === 0) return null;
  const priced = hunt.deals.filter(isPricedHunt);
  const noBookCount = hunt.deals.length - priced.length;

  return (
    <section className="hunt-module" aria-label="The hunt — curated targets">
      <div className="hunt-module-head">
        <div>
          <span className="kicker">The hunt · curated targets, polled every run</span>
          <p className="hunt-module-sub">
            {priced.length > 0 ? (
              <>
                <b>{priced.length}</b> priced {priced.length === 1 ? 'hit' : 'hits'} across{' '}
                {hunt.targets.length} watched targets
                {noBookCount > 0 ? <> · {noBookCount} more live as facts-only</> : null}
              </>
            ) : hunt.deals.length > 0 ? (
              <>
                {hunt.targets.length} targets on watch · <b>{hunt.deals.length}</b> live{' '}
                {hunt.deals.length === 1 ? 'hit' : 'hits'}, none priced by the book yet
              </>
            ) : (
              <>{hunt.targets.length} targets on watch — nothing live right now</>
            )}
          </p>
        </div>
        <Link href="/hunt/" className="hunt-module-link">
          All targets →
        </Link>
      </div>
      {priced.length > 0 && (
        <div className="grid">
          {priced.slice(0, STRIP_MAX_CARDS).map((d) => (
            <HuntPricedCard key={d.id} deal={d} />
          ))}
        </div>
      )}
    </section>
  );
}
