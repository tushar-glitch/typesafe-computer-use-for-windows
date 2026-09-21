/**
 * Turning what someone said into something matchable.
 *
 * Spoken input is not typed input. It arrives with filler, politeness and no
 * punctuation, and it arrives incomplete because the segmenter acts before the
 * sentence ends. Everything here is deterministic and free: it runs on every
 * partial transcript, many times a second, so nothing in this file may call a
 * model or touch the network.
 */

/** Openers people put in front of a request. Stripped before matching. */
const POLITENESS = [
  "hey",
  "hi",
  "ok",
  "okay",
  "so",
  "now",
  "um",
  "uh",
  "please",
  "could you",
  "can you",
  "would you",
  "will you",
  "i want you to",
  "i need you to",
  "i would like you to",
  "let us",
  "lets",
  "go ahead and",
  // Connectors. Continuous speech chains requests together, so every clause
  // after the first arrives with one of these attached and would otherwise
  // fail to match any verb.
  "and then",
  "after that",
  "and also",
  "then",
  "and",
  "also",
  "next",
] as const;

/** Words that add nothing once the verb is known. */
const TRAILING_FILLER = ["please", "for me", "now", "thanks", "thank you"] as const;

/**
 * Lowercase, collapse whitespace, drop terminal punctuation.
 *
 * Speech engines punctuate inconsistently between partial and final
 * transcripts, so punctuation cannot be relied on and is removed rather than
 * interpreted.
 */
export function normalize(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[,!?;:]+/g, " ")
      // Only sentence-ending dots. A dot between characters is load-bearing:
      // stripping it turns "example.com" into two words and the address is lost.
      .replace(/\.+(?=\s|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Remove leading politeness and trailing filler. Idempotent. */
export function stripFiller(text: string): string {
  let result = normalize(text);

  let changed = true;
  while (changed) {
    changed = false;
    for (const opener of POLITENESS) {
      if (result === opener) return "";
      if (result.startsWith(`${opener} `)) {
        result = result.slice(opener.length + 1);
        changed = true;
      }
    }
  }

  changed = true;
  while (changed) {
    changed = false;
    for (const tail of TRAILING_FILLER) {
      if (result.endsWith(` ${tail}`)) {
        result = result.slice(0, -(tail.length + 1));
        changed = true;
      }
    }
  }

  return result.trim();
}

/**
 * Strip whichever of `prefixes` the text opens with, returning the remainder.
 *
 * Longest match wins, so "go to" is not mistaken for "go". Null when none
 * match, and null when a prefix matches but leaves nothing behind: "open" on
 * its own names no target.
 */
export function afterPrefix(text: string, prefixes: readonly string[]): string | null {
  const normalized = normalize(text);
  const ordered = [...prefixes].sort((a, b) => b.length - a.length);

  for (const prefix of ordered) {
    if (normalized.startsWith(`${prefix} `)) {
      const remainder = normalized.slice(prefix.length + 1).trim();
      if (remainder.length > 0) return remainder;
    }
  }

  return null;
}

/**
 * Split "<something> on <target>" into its parts.
 *
 * Used for "play X on youtube" and "search for Y on amazon". The separator is
 * matched from the right: a query can legitimately contain " on ", as in
 * "play hold on on youtube", and the last occurrence is the one that names the
 * destination.
 */
export function splitOnTarget(text: string, separators: readonly string[] = ["on", "in"]): {
  readonly subject: string;
  readonly target: string | null;
} {
  const normalized = normalize(text);

  let bestAt = -1;
  let best: { subject: string; target: string } | null = null;

  for (const separator of separators) {
    const needle = ` ${separator} `;
    const at = normalized.lastIndexOf(needle);
    if (at <= 0 || at <= bestAt) continue;

    const subject = normalized.slice(0, at).trim();
    const target = normalized.slice(at + needle.length).trim();
    if (subject.length === 0 || target.length === 0) continue;

    bestAt = at;
    best = { subject, target };
  }

  return best ?? { subject: normalized, target: null };
}

/**
 * Whether the text looks like a bare domain a person would say or type.
 *
 * Deliberately narrow. It must not fire on ordinary speech, because a false
 * positive navigates the browser somewhere the speaker never asked for.
 */
export function looksLikeDomain(text: string): boolean {
  // Not `normalize`: that strips the dots, which are the whole signal here.
  // Whitespace is removed because speech engines render "example dot com" and
  // dictated URLs with spaces around the separators.
  const candidate = text.toLowerCase().replace(/\s+/g, "").replace(/[,!?;:]+$/, "").replace(/\.$/, "");
  return /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?$/.test(candidate);
}

/**
 * The name at the end of a naming clause, if there is one.
 *
 * Speech wraps the thing being named in description: "play my favourite song
 * which is Ride It" carries one useful token and five of preamble. Searching
 * the whole phrase returns nothing useful, so the tail after the naming
 * marker is taken instead.
 *
 * A narrow, deterministic heuristic covering the common spoken forms. General
 * extraction of what someone means is a judgement, and belongs to the decision
 * model rather than to a regular expression.
 */
const NAMING_MARKERS = [" which is ", " that is ", " thats ", " called ", " named ", " titled "] as const;

export function afterNamingClause(text: string): string | null {
  const normalized = normalize(text);

  let bestAt = -1;
  let name: string | null = null;

  for (const marker of NAMING_MARKERS) {
    const at = normalized.lastIndexOf(marker);
    if (at <= 0 || at <= bestAt) continue;

    const tail = normalized.slice(at + marker.length).trim();
    if (tail.length === 0) continue;

    bestAt = at;
    name = tail;
  }

  return name;
}
