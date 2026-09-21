/**
 * "play ride it on youtube", "search amazon for headphones", "look up RLHF".
 *
 * The most valuable link in the chain. Jumping straight to a results page
 * replaces the whole click-the-box, type, press-enter, wait-for-results
 * sequence with a single navigation, turning four slow perception steps into
 * one instant one. It is what makes a spoken request land before the sentence
 * finishes.
 *
 * It stops at the results page. Choosing among results is a judgement about
 * what is on screen, which is the perception loop's job, not a URL template's.
 */

import type { ICommandHandler } from "../../core/ports/handling.js";
import type { IAppLauncher } from "../../core/ports/execution.js";
import type { ILogger } from "../../core/ports/platform.js";
import type { CommandOutcome, SpokenCommand } from "../../core/types/command.js";
import { completed, failed, unhandled } from "../../core/types/command.js";
import { SiteCatalog, type SiteEntry } from "../catalog/catalogs.js";
import { afterNamingClause, afterPrefix, splitOnTarget, stripFiller } from "../parsing/utterance.js";

/**
 * Search verbs, each with the site assumed when the speaker names none.
 *
 * The default carries real meaning: "play something" is a request for media
 * and belongs on YouTube, while "look something up" is a question and belongs
 * on a search engine. Getting this wrong sends people to the wrong place, so
 * the mapping is explicit rather than a single global fallback.
 */
const SEARCH_VERBS: readonly (readonly [verb: string, defaultSite: string])[] = [
  ["play", "youtube"],
  ["search for", "google"],
  ["search", "google"],
  ["look up", "google"],
  ["look for", "google"],
  ["find me", "google"],
  ["find", "google"],
  ["google", "google"],
];

interface Search {
  readonly site: SiteEntry;
  readonly query: string;
}

export interface DeepLinkSearchHandlerOptions {
  readonly logger?: ILogger;
}

export class DeepLinkSearchHandler implements ICommandHandler {
  readonly name = "deep-link-search";

  readonly #launcher: IAppLauncher;
  readonly #sites: SiteCatalog;
  readonly #logger: ILogger | undefined;

  constructor(
    launcher: IAppLauncher,
    sites: SiteCatalog = new SiteCatalog(),
    options: DeepLinkSearchHandlerOptions = {},
  ) {
    this.#launcher = launcher;
    this.#sites = sites;
    this.#logger = options.logger;
  }

  canHandle(command: SpokenCommand): boolean {
    return this.#search(command.text) !== null;
  }

  async execute(command: SpokenCommand, signal: AbortSignal): Promise<CommandOutcome> {
    const search = this.#search(command.text);
    if (search === null) {
      return unhandled(`no searchable request in ${JSON.stringify(command.text)}`);
    }

    const url = this.#sites.searchUrl(search.site, search.query);
    if (url === null) {
      return unhandled(`${search.site.url} has no search endpoint`);
    }

    this.#logger?.debug("deep linking to a results page", { url });
    const opened = await this.#launcher.openUrl(url, signal);
    return opened
      ? completed(`searched for ${JSON.stringify(search.query)} on ${search.site.url}`)
      : failed(`could not open ${url}`);
  }

  #search(text: string): Search | null {
    const cleaned = stripFiller(text);

    for (const [verb, defaultSite] of SEARCH_VERBS) {
      const remainder = afterPrefix(cleaned, [verb]);
      if (remainder === null) continue;

      // "<query> on <site>" when the speaker named a destination.
      const { subject: rawSubject, target } = splitOnTarget(remainder);
      // "my favourite song which is Ride It" carries one useful token; search
      // the name rather than the description around it.
      const subject = afterNamingClause(rawSubject) ?? rawSubject;

      if (target !== null) {
        const named = this.#sites.resolve(target) ?? this.#sites.find(target);
        if (named !== null && named.searchTemplate !== null) {
          return { site: named, query: subject };
        }
      }

      // "search amazon for headphones": the site comes before the terms.
      const leading = this.#leadingSite(remainder);
      if (leading !== null) return leading;

      const fallback = this.#sites.resolve(defaultSite);
      if (fallback !== null && fallback.searchTemplate !== null) {
        // No destination named, so the remainder is the query.
        return { site: fallback, query: afterNamingClause(remainder) ?? remainder };
      }
    }

    return null;
  }

  /** Handles "<site> for <terms>", where the destination leads. */
  #leadingSite(remainder: string): Search | null {
    const forAt = remainder.indexOf(" for ");
    if (forAt <= 0) return null;

    const head = remainder.slice(0, forAt).trim();
    const query = remainder.slice(forAt + 5).trim();
    if (query.length === 0) return null;

    const site = this.#sites.resolve(head);
    return site !== null && site.searchTemplate !== null ? { site, query } : null;
  }
}
