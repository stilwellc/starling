/**
 * RiskChip — the A/B/C/D grade, and (the no-black-box rule) its reasons.
 * `showReasons` renders the full explanation; compact mode is just the chip.
 */
import type { RiskResult } from '@/scripts/types';
import { riskLabel } from '@/app/lib/display';

export function RiskChip({ risk, showReasons = false }: { risk: RiskResult; showReasons?: boolean }) {
  return (
    <div className="risk">
      <span
        className={`risk-chip risk-${risk.grade.toLowerCase()}`}
        title={`Risk grade ${risk.grade} — ${riskLabel(risk.grade)}`}
      >
        <span className="risk-grade">{risk.grade}</span>
        <span className="risk-label">{riskLabel(risk.grade)}</span>
      </span>
      {showReasons && risk.reasons.length > 0 && (
        <ul className="risk-reasons">
          {risk.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
