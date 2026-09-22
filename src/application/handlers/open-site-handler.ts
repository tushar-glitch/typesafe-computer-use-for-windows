/**
 * "open youtube", "go to github", "take me to example.com".
 *
 * Navigation without touching the screen. The alternative, which the macOS
 * original is forced into, is to focus the browser, click the address bar, type
 * and press enter: four steps and several seconds for something the shell does
 * in one call.
 */

import type { ICommandHandler } from "../../core/ports/handling.js";
import type { IAppLauncher } from "../../core/ports/execution.js";
import type { ILogger } from "../../core/ports/platform.js";
import type { CommandOutcome, SpokenCommand } from "../../core/types/command.js";
import { completed, failed, unhandled } from "../../core/types/command.js";
import { SiteCatalog } from "../catalog/catalogs.js";
import { afterPrefix, asDomain, stripFiller } from "../parsing/utterance.js";

const NAVIGATE_VERBS = [
  "open",
  "go to",
  "navigate to",
  "visit",
  "take me to",
  "show me",
  "bring up",
  "pull up",
] as const;

export interface OpenSiteHandlerOptions {
  readonly logger?: ILogger;
}

export class OpenSiteHandler implements ICommandHandler {
  readonly name = "open-site";

  readonly #launcher: IAppLauncher;
  readonly #sites: SiteCatalog;
  readonly #logger: ILogger | undefined;

  constructor(launcher: IAppLauncher, sites: SiteCatalog = new SiteCatalog(), options: OpenSiteHandlerOptions = {}) {
    this.#launcher = launcher;
    this.#sites = sites;
    this.#logger = options.logger;
  }

  canHandle(command: SpokenCommand): boolean {
    return this.#url(command.text) !== null;
  }

  async execute(command: SpokenCommand, signal: AbortSignal): Promise<CommandOutcome> {
    const url = this.#url(command.text);
    if (url === null) {
      return unhandled(`no website named in ${JSON.stringify(command.text)}`);
    }

    this.#logger?.debug("opening a site", { url });
    const opened = await this.#launcher.openUrl(url, signal);
    return opened ? completed(`opened ${url}`) : failed(`could not open ${url}`);
  }

  #url(text: string): string | null {
    const remainder = afterPrefix(stripFiller(text), [...NAVIGATE_VERBS]);
    if (remainder === null) return null;

    const named = this.#sites.resolve(remainder) ?? this.#sites.find(remainder);
    if (named !== null) return named.url;

    // A spoken address, as a last resort. `asDomain` writes out spoken
    // punctuation first, so "binance dot com" is recognised, and is strict
    // after that: guessing wrong navigates somewhere nobody asked for.
    const domain = asDomain(remainder);
    if (domain !== null) {
      return domain.startsWith("http") ? domain : `https://${domain}`;
    }

    return null;
  }
}
