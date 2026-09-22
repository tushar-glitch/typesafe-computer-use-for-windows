/**
 * The screen loop: perceive, decide, act, repeat.
 *
 * The last link in the handler chain, and the slowest by a wide margin.
 * Measured on this machine a step costs about 1.2 seconds, against 44
 * milliseconds for a deep link, which is the whole reason everything cheaper
 * is tried first.
 *
 * It must always stop. An agent that clicks forever on a page it cannot
 * understand is worse than one that gives up, so there are five independent
 * ways out and every one of them is tested.
 */

import type { ICommandHandler } from "../../core/ports/handling.js";
import type { IDecisionProvider } from "../../core/ports/decision.js";
import type { IPerceptionPipeline } from "../../core/ports/perception.js";
import type { IClock, ILogger } from "../../core/ports/platform.js";
import type { CommandOutcome, SpokenCommand } from "../../core/types/command.js";
import { cancelled, completed, failed } from "../../core/types/command.js";
import { milliseconds } from "../../core/types/scalars.js";
import type { ActionRunner } from "./action-runner.js";
import { buildQuestions, buildState, interpret, UnreadableDecisionError, type LoopContext } from "./questions.js";
import type { SessionLedger } from "../session/session-ledger.js";
import { AppCatalog, SiteCatalog } from "../catalog/catalogs.js";
import { stripFiller } from "../parsing/utterance.js";

/** The readable part of a URL, for a referent a person would recognise. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Why a run ended. Reported to the speaker, so each reads as a sentence. */
export type StopReason =
  | "achieved"
  | "nothing-helps"
  | "low-confidence"
  | "stalled"
  | "step-limit"
  | "cancelled"
  | "failed";

export interface ScreenLoopOptions {
  readonly logger?: ILogger;
  readonly apps?: AppCatalog;
  readonly sites?: SiteCatalog;
  /** Most steps before giving up. */
  readonly maxSteps?: number;
  /**
   * Confidence below which no action is taken at all.
   *
   * Read against the KIND answer: does the model know what sort of thing to do
   * here? Below this it does not, and acting anyway produces the behaviour
   * this was written for, a run that pressed escape three times at 0.2
   * confidence because nothing was stopping it.
   */
  readonly minConfidence?: number;
  /**
   * Floor for the answer that names a target, when there is one.
   *
   * Much lower than minConfidence, and deliberately so. A goal can admit many
   * equally good targets: asked to play ANY song, the model spreads its mass
   * across twenty videos that would all satisfy the goal, and reports low
   * confidence because it is genuinely undecided between them, not because it
   * is lost. Requiring the same bar there refuses a task that is going fine.
   * This floor still catches the case where nothing looks right at all.
   */
  readonly minTargetConfidence?: number;
  /** Consecutive ineffective actions before the run is judged stuck. */
  readonly maxNoops?: number;
  /**
   * Consecutive uncertain glances before the run gives up.
   *
   * One uncertain look is not a reason to abandon a task. A page mid-render
   * offers half its controls, and the honest answer at that moment is low
   * confidence; a second later it is obvious. A person would look again, so
   * the loop does too.
   */
  readonly maxUnsure?: number;
  /**
   * Repeated identical uncertain answers that count as corroboration.
   *
   * A model can be right and under-confident. On a results page, clicking a
   * video led the alternatives by about two to one and still reported 0.3,
   * because scrolling and stopping were each defensible too. Giving up there
   * abandons a task that was going correctly.
   *
   * Looking again is not a free retry of the same question: the screen is
   * observed afresh each time, so an answer that survives several looks has
   * survived several independent observations. When the screen is genuinely
   * unsettled the answer moves instead, and the count resets, which is exactly
   * the case that should keep waiting.
   */
  readonly corroboratingLooks?: number;
  /** Pause after an action, letting the screen settle before it is read again. */
  readonly settleMs?: number;
  /**
   * Pause after navigating or launching.
   *
   * Longer than an ordinary settle: a click repaints, but a page load or an
   * application start takes seconds, and reading too early sees a blank frame.
   */
  readonly navigationSettleMs?: number;
}

/**
 * How far ahead the chosen option must be for repetition to count as evidence.
 *
 * Against the runner-up, not in absolute terms: the question is whether the
 * model prefers this action, not whether it is sure of it.
 */
const LEAD_RATIO = 1.5;

const DEFAULTS = {
  maxSteps: 25,
  minConfidence: 0.4,
  maxNoops: 2,
  minTargetConfidence: 0.15,
  maxUnsure: 3,
  corroboratingLooks: 2,
  settleMs: 600,
  navigationSettleMs: 1800,
} as const;

export class ScreenLoopHandler implements ICommandHandler {
  readonly name = "screen-loop";

  readonly #perception: IPerceptionPipeline;
  readonly #decisions: IDecisionProvider;
  readonly #actions: ActionRunner;
  readonly #clock: IClock;
  readonly #logger: ILogger | undefined;
  readonly #maxSteps: number;
  readonly #minConfidence: number;
  readonly #minTargetConfidence: number;
  readonly #maxNoops: number;
  readonly #maxUnsure: number;
  readonly #corroboratingLooks: number;
  readonly #settleMs: number;
  readonly #navigationSettleMs: number;
  readonly #apps: AppCatalog;
  readonly #sites: SiteCatalog;
  readonly #session: SessionLedger;

  constructor(
    perception: IPerceptionPipeline,
    decisions: IDecisionProvider,
    actions: ActionRunner,
    clock: IClock,
    session: SessionLedger,
    options: ScreenLoopOptions = {},
  ) {
    this.#session = session;
    this.#apps = options.apps ?? new AppCatalog();
    this.#sites = options.sites ?? new SiteCatalog();
    this.#perception = perception;
    this.#decisions = decisions;
    this.#actions = actions;
    this.#clock = clock;
    this.#logger = options.logger;
    this.#maxSteps = options.maxSteps ?? DEFAULTS.maxSteps;
    this.#minConfidence = options.minConfidence ?? DEFAULTS.minConfidence;
    this.#minTargetConfidence = options.minTargetConfidence ?? DEFAULTS.minTargetConfidence;
    this.#maxNoops = options.maxNoops ?? DEFAULTS.maxNoops;
    this.#maxUnsure = options.maxUnsure ?? DEFAULTS.maxUnsure;
    this.#corroboratingLooks = options.corroboratingLooks ?? DEFAULTS.corroboratingLooks;
    this.#settleMs = options.settleMs ?? DEFAULTS.settleMs;
    this.#navigationSettleMs = options.navigationSettleMs ?? DEFAULTS.navigationSettleMs;
  }

  /**
   * The fallback: it claims anything nothing cheaper wanted, except nothing.
   *
   * A command that is only filler carries no goal, so there is nothing for the
   * loop to make progress towards. It would perceive, ask, act on whatever
   * scored least badly, and stall two steps later. Observed with a stray
   * "then" left over from continuous speech, which cost 2.3 seconds to fail.
   */
  canHandle(command: SpokenCommand): boolean {
    return stripFiller(command.text).length > 0;
  }

  async execute(command: SpokenCommand, signal: AbortSignal): Promise<CommandOutcome> {
    try {
      return await this.#run(command, signal);
    } catch (error: unknown) {
      // Abandoning a step mid-flight is how barge-in works, and it surfaces as
      // whatever the in-flight request threw: a cancelled OCR call, a cancelled
      // decision. That is not a failure, and reporting it as one tells the
      // speaker their command broke when in fact they replaced it.
      if (signal.aborted) {
        return this.#stop("cancelled", [], "the speaker moved on");
      }
      throw error;
    }
  }

  async #run(command: SpokenCommand, signal: AbortSignal): Promise<CommandOutcome> {
    const history: string[] = [];
    let consecutiveNoops = 0;
    let consecutiveUnsure = 0;
    let agreements = 0;
    let lastUnsureAction = "";

    for (let step = 1; step <= this.#maxSteps; step++) {
      if (signal.aborted) {
        return this.#stop("cancelled", history, "the speaker moved on");
      }

      const observation = await this.#perception.observe(signal);

      // The session tracks where things stand, so a later sentence can be
      // understood against it rather than in isolation.
      this.#session.observeWorld(observation);

      const context: LoopContext = {
        apps: this.#apps,
        sites: this.#sites,
        session: this.#session.snapshot(),
      };

      let decision;
      try {
        const answers = await this.#decisions.decide(
          {
            state: buildState(command.text, observation, history, context),
            questions: buildQuestions(command.text, observation, context),
          },
          signal,
        );
        decision = interpret(answers, observation, context, command.text);
      } catch (error: unknown) {
        if (error instanceof UnreadableDecisionError) {
          // The model answered with something that does not describe this
          // screen. Retrying would most likely produce it again.
          this.#logger?.warn("decision could not be read", { error: error.message });
          return this.#stop("failed", history, error.message);
        }
        throw error;
      }

      this.#logger?.debug("step", {
        step,
        kind: decision.kind,
        kindConfidence: decision.kindConfidence,
        kindLead: decision.kindLead,
        targetConfidence: decision.targetConfidence,
        items: observation.items.length,
      });

      if (decision.terminal) {
        return decision.kind === "done"
          ? this.#stop("achieved", history, "the screen shows the goal reached")
          : this.#stop("nothing-helps", history, "nothing on screen helped with the goal");
      }

      // Two different questions, two different bars. Whether to act at all is
      // the kind answer, and it must be confident whatever the action is: an
      // escape pressed on a coin flip is not free, it burns a step and muddles
      // the next one. Which target to act on is the second answer, and it is
      // allowed to be much less certain, because a goal that admits many equally
      // good targets produces a spread rather than a winner.
      const unsureKind = decision.kindConfidence < this.#minConfidence;
      const unsureTarget =
        decision.targetConfidence !== null && decision.targetConfidence < this.#minTargetConfidence;

      if (unsureKind || unsureTarget) {
        // An answer that survives repeated looks at a freshly observed screen
        // is corroborated, however hesitant each individual look was.
        const fingerprint = JSON.stringify(decision.action);
        agreements = fingerprint === lastUnsureAction ? agreements + 1 : 0;
        lastUnsureAction = fingerprint;

        // Repetition alone is not evidence: a loop flailing between options
        // repeats too. The answer must also lead the alternatives, which is
        // what separates "torn between two good options" from "no idea".
        // Measured live: clicking a video led two to one at 0.3 confidence and
        // was correct; a stuck escape at 0.2 led nothing.
        const leads = (lead: { top: number; runnerUp: number } | null): boolean =>
          lead === null || lead.top >= LEAD_RATIO * lead.runnerUp;

        // Both answers must lead. A confident "click something" over a flat
        // list of candidates is not corroborated by repeating it; it just
        // clicks whichever item happened to come first.
        const decisive = leads(decision.kindLead) && leads(decision.targetLead);

        if (agreements >= this.#corroboratingLooks && decisive) {
          this.#logger?.info("acting on a judgement that held across repeated looks", {
            action: decision.kind,
            looks: agreements + 1,
            kindConfidence: decision.kindConfidence,
            lead: decision.kindLead,
          });
        } else {
          consecutiveUnsure++;

          if (consecutiveUnsure >= this.#maxUnsure) {
          return this.#stop(
            "low-confidence",
            history,
              `not confident enough to act after ${consecutiveUnsure} looks `
                + `(${unsureKind ? "what to do" : "which target"}: `
                + `${(unsureKind ? decision.kindConfidence : (decision.targetConfidence ?? 0)).toFixed(2)})`,
            );
          }

          // Look again rather than abandon. A page part way through rendering
          // offers half its controls, and low confidence is the honest answer
          // at that instant; a moment later the same screen is obvious.
          this.#logger?.debug("unsure; looking again", {
            reason: unsureKind ? "what to do" : "which target",
            kindConfidence: decision.kindConfidence,
            targetConfidence: decision.targetConfidence,
            attempt: consecutiveUnsure,
          });
          await this.#clock.sleep(milliseconds(this.#navigationSettleMs), signal);
          continue;
        }
      } else {
        consecutiveUnsure = 0;
        agreements = 0;
        lastUnsureAction = "";
      }

      const report = await this.#actions.run(decision.action, { goal: command.text, observation }, signal);
      history.push(report.description);

      // Note anything a later sentence might point back to. "Open it again"
      // and "ask him about that" are only answerable against things that
      // actually happened, and in a session running for hours most of what is
      // said will be a follow-up to something earlier.
      if (report.effective) {
        if (decision.action.kind === "launch_app") {
          this.#session.remember("app", decision.action.appId, decision.action.appId);
        } else if (decision.action.kind === "open_url") {
          this.#session.remember("website", decision.action.url, hostOf(decision.action.url));
        }
      }
      this.#logger?.debug("acted", { did: report.description, effective: report.effective });

      // A repeat of the previous action means the screen did not respond to
      // it, which is as stuck as an outright refusal.
      const repeated = history.length > 1 && history.at(-2) === report.description;
      consecutiveNoops = report.effective && !repeated ? 0 : consecutiveNoops + 1;

      if (consecutiveNoops >= this.#maxNoops) {
        return this.#stop("stalled", history, "the last actions changed nothing");
      }

      // Navigating and launching take far longer to land than a click, and
      // reading too early sees a blank or half-drawn window.
      const navigated = decision.action.kind === "open_url" || decision.action.kind === "launch_app";
      await this.#clock.sleep(
        milliseconds(navigated ? this.#navigationSettleMs : this.#settleMs),
        signal,
      );
    }

    return this.#stop("step-limit", history, `gave up after ${this.#maxSteps} steps`);
  }

  #stop(reason: StopReason, history: readonly string[], detail: string): CommandOutcome {
    const summary = `${detail} (${history.length} ${history.length === 1 ? "action" : "actions"})`;
    this.#logger?.info("screen loop stopped", { reason, steps: history.length });

    switch (reason) {
      case "achieved":
        return completed(summary);
      case "cancelled":
        return cancelled(summary);
      case "nothing-helps":
      case "low-confidence":
      case "stalled":
      case "step-limit":
      case "failed":
        return failed(summary);
    }
  }
}
