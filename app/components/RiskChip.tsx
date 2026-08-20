/**
 * RiskChip — the A/B/C/D grade, and (the no-black-box rule) its reasons.
 *
 * Three modes:
 *   expandable (default on cards) — a native <details> so the reasons are one
 *     tap away with zero client JS; the static-export contract stays intact.
 *   showReasons — reasons rendered open (hero / detail density).
 *   plain — just the chip (rows, tight spots).
 */
import type { RiskResult } from '@/scripts/types';
import { riskLabel } from '@/app/lib/display';

function ChipFace({ risk }: { risk: RiskResult }) {
  return (
    <>
      <span className="risk-grade">{risk.grade}</span>
      <span className="risk-label">{riskLabel(risk.grade)}</span>
    </>
  );
}

export function RiskChip({
  risk,
  showReasons = false,
  expandable = false,
}: {
  risk: RiskResult;
  showReasons?: boolean;
  expandable?: boolean;
}) {
  const reasons = risk.reasons ?? [];

  if (expandable && reasons.length > 0) {
    return (
      <details className="risk risk-details">
        <summary
          className={`risk-chip risk-${risk.grade.toLowerCase()}`}
          title={`Risk grade ${risk.grade} — ${riskLabel(risk.grade)}. Tap for the reasons.`}
        >
          <ChipFace risk={risk} />
          <span className="risk-why" aria-hidden="true">
            why <span className="risk-caret">▾</span>
          </span>
        </summary>
        <ul className="risk-reasons">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </details>
    );
  }

  return (
    <div className="risk">
      <span
        className={`risk-chip risk-${risk.grade.toLowerCase()}`}
        title={`Risk grade ${risk.grade} — ${riskLabel(risk.grade)}`}
      >
        <ChipFace risk={risk} />
      </span>
      {showReasons && reasons.length > 0 && (
        <ul className="risk-reasons">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The bare grade coin for row density. */
export function RiskCoin({ risk }: { risk: RiskResult }) {
  return (
    <span
      className={`risk-coin risk-${risk.grade.toLowerCase()}`}
      title={`Risk grade ${risk.grade} — ${riskLabel(risk.grade)}${
        risk.reasons?.length ? `: ${risk.reasons.join('; ')}` : ''
      }`}
    >
      <span className="risk-grade">{risk.grade}</span>
    </span>
  );
}
