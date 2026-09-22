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
import { buildQuestions, buildState, interpret, UnreadableDecisionError } from "./questions.js";
import { stripFiller } from "../parsing/utterance.js";

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
  /** Most steps before giving up. */
  readonly maxSteps?: number;
  /**
   * Confidence below which a targeted action is not taken.
   *
   * Applies only to clicks and presses: those land somewhere, and the wrong
   * somewhere is not undone by the next step.
   */
  readonly minConfidence?: number;
  /** Consecutive ineffective actions before the run is judged stuck. */
  readonly maxNoops?: number;
  /** Pause after an action, letting the screen settle before it is read again. */
  readonly settleMs?: number;
}

const DEFAULTS = {
  maxSteps: 25,
  minConfidence: 0.4,
  maxNoops: 2,
  settleMs: 600,
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
  readonly #maxNoops: number;
  readonly #settleMs: number;

  constructor(
    perception: IPerceptionPipeline,
    decisions: IDecisionProvider,
    actions: ActionRunner,
    clock: IClock,
    options: ScreenLoopOptions = {},
  ) {
    this.#perception = perception;
    this.#decisions = decisions;
    this.#actions = actions;
    this.#clock = clock;
    this.#logger = options.logger;
    this.#maxSteps = options.maxSteps ?? DEFAULTS.maxSteps;
    this.#minConfidence = options.minConfidence ?? DEFAULTS.minConfidence;
    this.#maxNoops = options.maxNoops ?? DEFAULTS.maxNoops;
    this.#settleMs = options.settleMs ?? DEFAULTS.settleMs;
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

    for (let step = 1; step <= this.#maxSteps; step++) {
      if (signal.aborted) {
        return this.#stop("cancelled", history, "the speaker moved on");
      }

      const observation = await this.#perception.observe(signal);

      let decision;
      try {
        const answers = await this.#decisions.decide(
          {
            state: buildState(command.text, observation, history),
            questions: buildQuestions(observation),
          },
          signal,
        );
        decision = interpret(answers, observation);
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
        confidence: decision.confidence,
        items: observation.items.length,
      });

      if (decision.terminal) {
        return decision.kind === "done"
          ? this.#stop("achieved", history, "the screen shows the goal reached")
          : this.#stop("nothing-helps", history, "nothing on screen helped with the goal");
      }

      // Only actions that commit to a target are gated. A scroll or a wait
      // chosen on a coin flip costs nothing; a click on the wrong thing does.
      const targeted = decision.action.kind === "click_item" || decision.action.kind === "press_offscreen";
      if (targeted && decision.confidence < this.#minConfidence) {
        return this.#stop(
          "low-confidence",
          history,
          `not confident enough to act (${decision.confidence.toFixed(2)} below ${this.#minConfidence})`,
        );
      }

      const report = await this.#actions.run(decision.action, { goal: command.text, observation }, signal);
      history.push(report.description);
      this.#logger?.debug("acted", { did: report.description, effective: report.effective });

      // A repeat of the previous action means the screen did not respond to
      // it, which is as stuck as an outright refusal.
      const repeated = history.length > 1 && history.at(-2) === report.description;
      consecutiveNoops = report.effective && !repeated ? 0 : consecutiveNoops + 1;

      if (consecutiveNoops >= this.#maxNoops) {
        return this.#stop("stalled", history, "the last actions changed nothing");
      }

      await this.#clock.sleep(milliseconds(this.#settleMs), signal);
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
