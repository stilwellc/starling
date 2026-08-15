/**
 * condition.ts — condition-qualifier detection.
 *
 * Ported VERBATIM from lectr (Ray repo: scripts/lib/condition.ts), which was
 * born from the deep-value board's real failure mode: a "Missing Back" SkyBox
 * Ruby comped against clean copies read 96% under floor. A listing whose title
 * carries a condition qualifier must not receive a floor built from clean comps.
 * The houses (and eBay sellers) put condition language in titles precisely
 * because it prices — title-level detection is enough.
 *
 * Keep this in sync with lectr's copy. It is the shared exclusion the §6 gate
 * runs, and the source of the conditionFlags surfaced in the risk model.
 */
const CONDITION_RE =
  /\b(damaged|incomplete|partial(?!\s+refund)|missing\b|trimmed|altered|recolou?red|restored|rebacked|creas(ed|es|ing)|torn|tear\b|taped|water damage|writing on|paper loss|as[- ]is|poor condition|heavily worn|miscut(?! error)|detached|hole punched|glue|residue|cracked|scratch(?:ed|es)?|repaired|reprint|replica|damage\b|broken)\b/i;

/** True when the title carries a value-destroying condition qualifier. */
export function hasConditionFlag(title: string | null | undefined): boolean {
  return !!title && CONDITION_RE.test(title);
}

/** The specific qualifier tokens present — surfaced as risk reasons on the card. */
export function conditionFlags(title: string | null | undefined): string[] {
  if (!title) return [];
  const out: string[] = [];
  const re = new RegExp(CONDITION_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(title)) !== null) {
    const tok = m[1].toLowerCase();
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}
