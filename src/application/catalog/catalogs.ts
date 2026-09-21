/**
 * What the agent can reach without looking at the screen.
 *
 * Both catalogs are small and explicit on purpose. A named entry is a promise:
 * saying it produces one deterministic outcome in milliseconds. Anything
 * absent falls through to the screen loop, which is slower but open-ended.
 * Guessing an executable name or a URL from speech would trade that
 * predictability for the occasional wrong window or wrong website.
 */

import { normalize } from "../parsing/utterance.js";

export interface AppEntry {
  /** Passed to the shell. A bare name resolves through the App Paths registry. */
  readonly appId: string;
  /** Process name used to check whether it is already running, without the extension. */
  readonly processName: string;
  readonly aliases: readonly string[];
}

export interface SiteEntry {
  readonly url: string;
  /**
   * Search URL with `{query}` where the terms go, or null when the site has no
   * usable search endpoint.
   *
   * This is the single most valuable thing in this file. Jumping straight to a
   * results page replaces click-the-box, type, press-enter, wait — four screen
   * steps and several seconds — with one navigation.
   */
  readonly searchTemplate: string | null;
  readonly aliases: readonly string[];
}

const DEFAULT_APPS: readonly AppEntry[] = [
  { appId: "chrome", processName: "chrome", aliases: ["chrome", "google chrome", "the browser", "browser"] },
  { appId: "msedge", processName: "msedge", aliases: ["edge", "microsoft edge"] },
  { appId: "firefox", processName: "firefox", aliases: ["firefox"] },
  { appId: "explorer", processName: "explorer", aliases: ["explorer", "file explorer", "files", "my computer"] },
  { appId: "notepad", processName: "notepad", aliases: ["notepad", "note pad"] },
  { appId: "calc", processName: "CalculatorApp", aliases: ["calculator", "calc"] },
  { appId: "mspaint", processName: "mspaint", aliases: ["paint", "ms paint"] },
  { appId: "taskmgr", processName: "Taskmgr", aliases: ["task manager", "taskmanager"] },
  { appId: "code", processName: "Code", aliases: ["vs code", "vscode", "visual studio code", "code"] },
  { appId: "spotify", processName: "Spotify", aliases: ["spotify"] },
  { appId: "wt", processName: "WindowsTerminal", aliases: ["terminal", "windows terminal"] },
];

const DEFAULT_SITES: readonly SiteEntry[] = [
  {
    url: "https://www.youtube.com/",
    searchTemplate: "https://www.youtube.com/results?search_query={query}",
    aliases: ["youtube", "you tube", "yt"],
  },
  {
    url: "https://www.google.com/",
    searchTemplate: "https://www.google.com/search?q={query}",
    aliases: ["google"],
  },
  {
    url: "https://www.amazon.com/",
    searchTemplate: "https://www.amazon.com/s?k={query}",
    aliases: ["amazon"],
  },
  {
    url: "https://github.com/",
    searchTemplate: "https://github.com/search?q={query}",
    aliases: ["github", "git hub"],
  },
  {
    url: "https://en.wikipedia.org/",
    searchTemplate: "https://en.wikipedia.org/w/index.php?search={query}",
    aliases: ["wikipedia", "wiki"],
  },
  {
    url: "https://mail.google.com/",
    searchTemplate: "https://mail.google.com/mail/u/0/#search/{query}",
    aliases: ["gmail", "my email", "email", "mail"],
  },
  { url: "https://calendar.google.com/", searchTemplate: null, aliases: ["calendar", "google calendar"] },
  { url: "https://x.com/", searchTemplate: "https://x.com/search?q={query}", aliases: ["twitter", "x"] },
  { url: "https://www.linkedin.com/", searchTemplate: null, aliases: ["linkedin"] },
  { url: "https://chatgpt.com/", searchTemplate: null, aliases: ["chatgpt", "chat gpt"] },
];

/** Index of alias to entry, with the longest aliases matched first. */
class AliasIndex<TEntry> {
  readonly #byAlias = new Map<string, TEntry>();
  readonly #ordered: string[];

  constructor(entries: readonly TEntry[], aliasesOf: (entry: TEntry) => readonly string[]) {
    for (const entry of entries) {
      for (const alias of aliasesOf(entry)) {
        this.#byAlias.set(normalize(alias), entry);
      }
    }
    // Longest first so "google calendar" wins over "google".
    this.#ordered = [...this.#byAlias.keys()].sort((a, b) => b.length - a.length);
  }

  exact(name: string): TEntry | null {
    return this.#byAlias.get(normalize(name)) ?? null;
  }

  /**
   * The longest alias appearing as whole words anywhere in the text.
   *
   * Word-bounded deliberately: a substring match would resolve "xylophone" to
   * the site aliased "x".
   */
  within(text: string): TEntry | null {
    const haystack = ` ${normalize(text)} `;
    for (const alias of this.#ordered) {
      if (haystack.includes(` ${alias} `)) {
        return this.#byAlias.get(alias) ?? null;
      }
    }
    return null;
  }
}

export class AppCatalog {
  readonly #index: AliasIndex<AppEntry>;

  constructor(entries: readonly AppEntry[] = DEFAULT_APPS) {
    this.#index = new AliasIndex(entries, (entry) => entry.aliases);
  }

  resolve(name: string): AppEntry | null {
    return this.#index.exact(name);
  }

  find(text: string): AppEntry | null {
    return this.#index.within(text);
  }
}

export class SiteCatalog {
  readonly #index: AliasIndex<SiteEntry>;

  constructor(entries: readonly SiteEntry[] = DEFAULT_SITES) {
    this.#index = new AliasIndex(entries, (entry) => entry.aliases);
  }

  resolve(name: string): SiteEntry | null {
    return this.#index.exact(name);
  }

  find(text: string): SiteEntry | null {
    return this.#index.within(text);
  }

  /** A results URL for `query` on `site`, or null when the site has no search. */
  searchUrl(site: SiteEntry, query: string): string | null {
    if (site.searchTemplate === null) return null;
    const trimmed = query.trim();
    if (trimmed.length === 0) return null;
    return site.searchTemplate.replace("{query}", encodeURIComponent(trimmed));
  }
}
