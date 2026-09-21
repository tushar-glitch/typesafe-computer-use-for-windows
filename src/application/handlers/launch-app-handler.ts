/**
 * "open chrome", "launch notepad", "start task manager".
 *
 * First link of the fast path. Starting or focusing an application is an
 * operating system call: it completes in a few hundred milliseconds, while
 * hunting the same icon on screen would cost several perception steps.
 */

import type { ICommandHandler } from "../../core/ports/handling.js";
import type { IAppLauncher } from "../../core/ports/execution.js";
import type { ILogger } from "../../core/ports/platform.js";
import type { CommandOutcome, SpokenCommand } from "../../core/types/command.js";
import { completed, failed, unhandled } from "../../core/types/command.js";
import { AppCatalog, type AppEntry } from "../catalog/catalogs.js";
import { afterPrefix, stripFiller } from "../parsing/utterance.js";

/**
 * Verbs that mean "put this application in front of me".
 *
 * "open" is shared with navigation, which is why this handler declines
 * anything the catalog does not name: "open youtube" must fall through to the
 * site handler rather than be attempted as an executable.
 */
const LAUNCH_VERBS = ["open", "launch", "start", "run", "switch to", "go to"] as const;

export interface LaunchAppHandlerOptions {
  readonly logger?: ILogger;
}

export class LaunchAppHandler implements ICommandHandler {
  readonly name = "launch-app";

  readonly #launcher: IAppLauncher;
  readonly #apps: AppCatalog;
  readonly #logger: ILogger | undefined;

  constructor(launcher: IAppLauncher, apps: AppCatalog = new AppCatalog(), options: LaunchAppHandlerOptions = {}) {
    this.#launcher = launcher;
    this.#apps = apps;
    this.#logger = options.logger;
  }

  canHandle(command: SpokenCommand): boolean {
    return this.#target(command.text) !== null;
  }

  async execute(command: SpokenCommand, signal: AbortSignal): Promise<CommandOutcome> {
    const app = this.#target(command.text);
    if (app === null) {
      return unhandled(`no known application named in ${JSON.stringify(command.text)}`);
    }

    // Focus what is already running before starting another copy: someone
    // saying "open chrome" with Chrome already open wants the window they have.
    const activated = await this.#launcher.activate(app.processName, signal);
    if (activated) {
      this.#logger?.debug("activated a running application", { app: app.appId });
      return completed(`brought ${app.appId} to the front`);
    }

    const started = await this.#launcher.launch(app.appId, signal);
    return started ? completed(`started ${app.appId}`) : failed(`could not start ${app.appId}`);
  }

  /**
   * The application this utterance names, or null.
   *
   * Shared by `canHandle` and `execute` so the two can never disagree about
   * whether the command belongs here.
   */
  #target(text: string): AppEntry | null {
    const remainder = afterPrefix(stripFiller(text), [...LAUNCH_VERBS]);
    if (remainder === null) return null;

    // Exact first, so "open calculator" resolves cleanly; then a word search,
    // so "open the task manager please" still lands.
    return this.#apps.resolve(remainder) ?? this.#apps.find(remainder);
  }
}
