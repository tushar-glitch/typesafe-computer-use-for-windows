/**
 * What the decision model is asked on each step, and how its answer becomes an
 * action.
 *
 * The decomposition is the important part. One fused question ("what should I
 * do?") over every item and every action performs far worse than several
 * narrow ones, so the step asks separately: what kind of action, which item,
 * and which hidden control. Each question then has a small, coherent set of
 * options, and the item list cannot drown out the action choice.
 *
 * Two rules govern the option sets, both learned from measurement rather than
 * assumed:
 *
 * - Options must be mutually exclusive. Jev breaks a tie between two options
 *   meaning the same thing arbitrarily and reports near-certainty, so
 *   duplicates do not surface as doubt; they surface as a loop that behaves
 *   differently on identical screens.
 * - Every question needs a way out. Asked which of several items serves a goal
 *   none of them serve, the model must still name one. Offered "nothing here
 *   helps", it says so, and the run can stop cleanly.
 */

import {
  choiceQuestion,
  type ChoiceAnswer,
  type ChoiceQuestion,
  type QuestionSet,
} from "../../core/ports/decision.js";
import type { AgentAction } from "../../core/types/action.js";
import type { JsonObject, JsonValue } from "../../core/types/json.js";
import { center } from "../../core/types/geometry.js";
import type { Observation, UiItem } from "../../core/types/observation.js";
import { confidence, weakest, type Confidence } from "../../core/types/scalars.js";

/**
 * The action set available inside the screen loop.
 *
 * Launching applications and opening URLs are absent deliberately: those are
 * the fast path, decided before the loop is ever entered. What remains is
 * everything that requires looking at the screen.
 */
export const LOOP_ACTIONS = {
  click_item: "Click one of the numbered items on screen, chosen in the item question.",
  type_text: "Type text into the focused text field. Only valid when a text field has focus and needs content.",
  press_enter: "Press Return to submit the focused form or field.",
  press_escape: "Press Escape to dismiss a dialog, menu, or popup.",
  scroll_down: "Scroll down to reveal more of the page.",
  scroll_up: "Scroll up to reveal what is above.",
  wait: "Do nothing this step; the screen is still loading or changing.",
  done: "The goal is already achieved on this screen.",
  none: "Nothing on this screen helps with the goal.",
} as const;

/** Offered only when the application exposes controls it does not draw. */
const PRESS_OFFSCREEN =
  "Activate a labelled control the application exposes but does not currently show, chosen in the offscreen "
  + "question. Use when the needed control is known to exist but is scrolled out of view.";

const KIND_INSTRUCTIONS =
  "You are driving this computer one action at a time. Which kind of action makes the most progress toward the "
  + "goal right now? Do not repeat an action that was just taken unless the screen changed.";

const ITEM_INSTRUCTIONS =
  "If clicking an on-screen item is the right move, which item? Items marked with a role are real controls the "
  + "application declared; items without one are text read from the screen.";

const OFFSCREEN_INSTRUCTIONS =
  "If activating a control that is not visible is the right move, which control? These are real controls of the "
  + "application, reachable without the mouse, but nothing on screen points at them.";

/** How many recent actions the model is shown. Enough to notice a repeat. */
const HISTORY_DEPTH = 8;

/** Kinds that end the run rather than changing the screen. */
const TERMINAL: ReadonlySet<string> = new Set(["done", "none"]);

export interface LoopQuestions extends QuestionSet {
  readonly kind: ChoiceQuestion<string>;
}

/** A coarse position, so the model can tell two identically labelled items apart. */
export function describeRegion(item: UiItem, observation: Observation): string {
  const { origin, size } = observation.image;
  const middle = center(item.bounds);

  const column = ["left", "centre", "right"][Math.min(2, Math.floor((3 * (middle.x - origin.x)) / Math.max(1, size.width)))];
  const row = ["top", "middle", "bottom"][Math.min(2, Math.floor((3 * (middle.y - origin.y)) / Math.max(1, size.height)))];

  return `${row ?? "middle"}-${column ?? "centre"}`;
}

/** The world as the model should see it. */
export function buildState(goal: string, observation: Observation, history: readonly string[]): JsonObject {
  const items: JsonValue[] = observation.items.map((item) => ({
    i: item.index,
    text: item.text,
    where: describeRegion(item, observation),
    ...(item.role === null ? {} : { role: item.role }),
  }));

  const field = observation.focusedField;

  return {
    goal,
    foreground_app: observation.foreground.processName,
    window_title: observation.foreground.title,
    browser_url: observation.browserUrl,
    focused_field:
      field === null
        ? null
        : {
            role: field.role,
            label: field.label,
            placeholder: field.placeholder,
            current_value: field.value.slice(0, 200),
            editable: field.isEditable,
          },
    previous_actions: history.slice(-HISTORY_DEPTH),
    screen_items_in_reading_order: items,
    ...(observation.offscreen.length === 0
      ? {}
      : {
          offscreen_controls: observation.offscreen.map((control) => ({
            k: control.index,
            role: control.role,
            label: control.label,
          })),
        }),
  };
}

/** The questions for this screen. Item and offscreen appear only when they have options. */
export function buildQuestions(observation: Observation): LoopQuestions {
  const kindCriteria: Record<string, string> = { ...LOOP_ACTIONS };
  if (observation.offscreen.length > 0) {
    kindCriteria["press_offscreen"] = PRESS_OFFSCREEN;
  }

  const questions: Record<string, ChoiceQuestion<string>> = {
    kind: choiceQuestion(KIND_INSTRUCTIONS, kindCriteria),
  };

  if (observation.items.length > 0) {
    const itemCriteria: Record<string, string> = {};
    for (const item of observation.items) {
      const role = item.role === null ? "" : `${item.role} `;
      itemCriteria[String(item.index)] = `${role}${JSON.stringify(item.text)} (${describeRegion(item, observation)})`;
    }
    questions["item"] = choiceQuestion(ITEM_INSTRUCTIONS, itemCriteria);
  }

  if (observation.offscreen.length > 0) {
    const offscreenCriteria: Record<string, string> = {};
    for (const control of observation.offscreen) {
      offscreenCriteria[String(control.index)] = `${control.role} ${JSON.stringify(control.label)} (not visible)`;
    }
    questions["offscreen"] = choiceQuestion(OFFSCREEN_INSTRUCTIONS, offscreenCriteria);
  }

  return questions as unknown as LoopQuestions;
}

export interface LoopDecision {
  readonly action: AgentAction;
  /**
   * Confidence the run should be gated on.
   *
   * For an action that commits to a target, the weaker of the two answers that
   * chose it: being sure a click is right means nothing if the item is a
   * coin flip. For everything else, the kind answer alone, because the next
   * step can undo a scroll or a wait.
   */
  readonly confidence: Confidence;
  readonly kind: string;
  readonly terminal: boolean;
}

export class UnreadableDecisionError extends Error {}

/**
 * Turn the model's answers into an action.
 *
 * Answers are validated against the observation rather than trusted: an index
 * outside the list, or a click with no item answer, means acting somewhere
 * unintended, which is the one failure that cannot be undone by the next step.
 */
export function interpret(
  answers: Readonly<Record<string, unknown>>,
  observation: Observation,
): LoopDecision {
  const kind = asChoice(answers["kind"], "kind");

  switch (kind.choice) {
    case "click_item": {
      const item = asChoice(answers["item"], "item");
      const index = Number.parseInt(item.choice, 10);
      if (!Number.isInteger(index) || observation.items[index] === undefined) {
        throw new UnreadableDecisionError(`item answer ${JSON.stringify(item.choice)} is not an item on this screen`);
      }
      return {
        action: { kind: "click_item", itemIndex: index },
        confidence: weakest(kind.confidence, item.confidence),
        kind: kind.choice,
        terminal: false,
      };
    }

    case "press_offscreen": {
      const offscreen = asChoice(answers["offscreen"], "offscreen");
      const index = Number.parseInt(offscreen.choice, 10);
      if (!Number.isInteger(index) || observation.offscreen[index] === undefined) {
        throw new UnreadableDecisionError(
          `offscreen answer ${JSON.stringify(offscreen.choice)} is not a control on this screen`,
        );
      }
      return {
        action: { kind: "press_offscreen", controlIndex: index },
        confidence: weakest(kind.confidence, offscreen.confidence),
        kind: kind.choice,
        terminal: false,
      };
    }

    case "type_text":
      return simple({ kind: "type_text" }, kind);
    case "press_enter":
      return simple({ kind: "press_key", key: "enter" }, kind);
    case "press_escape":
      return simple({ kind: "press_key", key: "escape" }, kind);
    case "scroll_down":
      return simple({ kind: "scroll", direction: "down", lines: 10 }, kind);
    case "scroll_up":
      return simple({ kind: "scroll", direction: "up", lines: 10 }, kind);
    case "wait":
      return simple({ kind: "wait" }, kind);
    case "done":
      return simple({ kind: "done" }, kind);
    case "none":
      return simple({ kind: "none" }, kind);

    default:
      throw new UnreadableDecisionError(`unknown action kind ${JSON.stringify(kind.choice)}`);
  }
}

function simple(action: AgentAction, kind: ChoiceAnswer<string>): LoopDecision {
  return {
    action,
    confidence: kind.confidence,
    kind: kind.choice,
    terminal: TERMINAL.has(kind.choice),
  };
}

function asChoice(value: unknown, name: string): ChoiceAnswer<string> {
  if (typeof value !== "object" || value === null) {
    throw new UnreadableDecisionError(`the ${name} question went unanswered`);
  }

  const answer = value as { choice?: unknown; confidence?: unknown };
  if (typeof answer.choice !== "string" || typeof answer.confidence !== "number") {
    throw new UnreadableDecisionError(`the ${name} answer is not a choice`);
  }

  return {
    choice: answer.choice,
    confidence: confidence(Math.min(1, Math.max(0, answer.confidence))),
    probabilities: {},
  };
}
