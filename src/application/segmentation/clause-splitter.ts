/**
 * Cutting a growing transcript into clauses.
 *
 * Continuous speech chains requests together: "open chrome and then open
 * youtube and play ride it" is three instructions in one breath. Connectors
 * mark where one ends and the next begins, and they do it for free, so the
 * decision model is never asked a question a string comparison can answer.
 *
 * The distinction that matters is between a clause that is finished and one
 * that is still growing. A clause with another clause behind it is finished by
 * construction: the speaker has moved on. Only the last one is in doubt, and
 * that is the only place judgement is needed.
 */

import { normalize } from "../parsing/utterance.js";

/**
 * Words that separate one spoken instruction from the next.
 *
 * Ordered longest first so "and then" is consumed whole rather than leaving a
 * stray "then" at the head of the next clause.
 */
const CONNECTORS = [
  "and then also",
  "and after that",
  "and then",
  "after that",
  "and also",
  "then also",
  "next also",
  "then",
  "next",
  "also",
  "and",
] as const;

export interface Clause {
  /** The clause text, with its leading connector removed. */
  readonly text: string;
  /**
   * Whether the speaker has moved past this clause.
   *
   * True for every clause but the last: something follows it, so it is
   * finished whatever the speaker does next. The last clause is still growing
   * until the transcript is final.
   */
  readonly settled: boolean;
}

/**
 * Split a transcript into clauses.
 *
 * `isFinal` marks the last clause settled too: the utterance is over, so
 * nothing more will be appended to it.
 */
export function splitClauses(transcript: string, isFinal: boolean): readonly Clause[] {
  const normalized = normalize(transcript);
  if (normalized.length === 0) return [];

  const pieces: string[] = [];
  let remaining = normalized;

  // Walk forward, cutting at the earliest connector each time. Scanning from
  // the front keeps the clauses in spoken order, which is the order they must
  // be dispatched in.
  for (;;) {
    const cut = earliestConnector(remaining);
    if (cut === null) {
      pieces.push(remaining.trim());
      break;
    }

    const head = remaining.slice(0, cut.at).trim();
    if (head.length > 0) pieces.push(head);
    remaining = remaining.slice(cut.at + cut.length + 1).trim();

    if (remaining.length === 0) break;
  }

  const kept = pieces.filter((piece) => piece.length > 0);

  return kept.map((text, index) => ({
    text,
    settled: isFinal || index < kept.length - 1,
  }));
}

/** Position and length of the first connector appearing as whole words. */
function earliestConnector(text: string): { readonly at: number; readonly length: number } | null {
  let best: { at: number; length: number } | null = null;

  for (const connector of CONNECTORS) {
    const needle = ` ${connector} `;
    const at = text.indexOf(needle);
    if (at < 0) continue;

    // Earliest wins; on a tie the longest connector, so "and then" beats "and".
    if (best === null || at < best.at || (at === best.at && connector.length > best.length)) {
      best = { at, length: connector.length };
    }
  }

  return best;
}

/**
 * What a transcript adds beyond what has already been dispatched.
 *
 * Speech engines revise earlier words as more audio arrives, so each update
 * replaces the previous one rather than extending it. Anything already acted
 * on has to be subtracted before the rest is considered, or the same
 * instruction is dispatched on every update.
 */
export function unconsumed(clauses: readonly Clause[], consumed: number): readonly Clause[] {
  return clauses.slice(consumed);
}
