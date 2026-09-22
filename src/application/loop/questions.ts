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
import type { SessionSnapshot } from "../../core/types/session.js";
import type { AppCatalog, SiteCatalog } from "../catalog/catalogs.js";
import { afterPrefix, asDomain, stripFiller } from "../parsing/utterance.js";

/**
 * The action set.
 *
 * Launching an application and opening a website are in here, alongside
 * clicking and typing, and that placement is the whole design. They began as a
 * router that ran before the loop and returned a verdict, which meant the goal
 * died the moment one of them fired: "play a song on youtube" navigated to a
 * results page, reported success, and never clicked anything, because nothing
 * was left to carry the goal forward.
 *
 * Worse, a router has to commit on keywords. "Open chat gpt on a browser"
 * matched the word "browser" against the application catalogue and launched
 * Chrome, while chatgpt.com sat unconsidered in the site catalogue. Offered as
 * options in one question, the model weighs them against each other instead.
 *
 * Multi-step requests then need no planning at all. Each step asks only what
 * makes most progress now, and the sequence is the plan.
 */
export const LOOP_ACTIONS = {
  launch_app:
    "Start or focus a desktop application, chosen in the app question. Use for anything that is a program "
    + "rather than a website.",
  open_url:
    "Open a website in the browser, chosen in the site question. This is the only way to reach a website: "
    + "never click the address bar or a search box to get there.",
  click_item: "Click one of the numbered items on screen, chosen in the item question.",
  type_text: "Type text into the focused text field. Only valid when a text field has focus and needs content.",
  press_enter: "Press Return to submit the focused form or field.",
  press_escape: "Press Escape to dismiss a dialog, menu, or popup.",
  scroll_down: "Scroll down to reveal more of the page.",
  scroll_up: "Scroll up to reveal what is above.",
  wait: "Do nothing this step; the screen is still loading or changing.",
  done: "The goal is already achieved on this screen.",
  none: "Nothing available helps with the goal.",
} as const;

/** Offered only when the application exposes controls it does not draw. */
const PRESS_OFFSCREEN =
  "Activate a labelled control the application exposes but does not currently show, chosen in the offscreen "
  + "question. Use when the needed control is known to exist but is scrolled out of view.";

const KIND_INSTRUCTIONS =
  "You are driving this computer one action at a time, working toward the goal. Which kind of action makes the "
  + "most progress toward it right now? The goal may take several steps: opening a website is progress, not "
  + "completion, and the goal is only done when what it asked for has actually happened. Do not repeat an "
  + "action that was just taken unless the screen changed.";

const APP_INSTRUCTIONS =
  "If starting or focusing an application is the right move, which application?";

const SITE_INSTRUCTIONS =
  "If the browser is used this step, which website should it show? Name a site when the goal calls for it, and "
  + "'stay' to continue with the page already open.";

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

/** Everything the loop needs that is not the screen. */
export interface LoopContext {
  readonly apps: AppCatalog;
  readonly sites: SiteCatalog;
  /**
   * What the session already knows.
   *
   * A task is not the first thing that has happened. "Open it again" and "ask
   * him about that" only mean anything against what came before, and a session
   * that runs for hours will be mostly follow-ups.
   */
  readonly session: SessionSnapshot;
}

/** The world as the model should see it. */
export function buildState(
  goal: string,
  observation: Observation,
  history: readonly string[],
  context: LoopContext,
): JsonObject {
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

    // What the session has already done. Without it every sentence looks like
    // the first thing ever said, and a follow-up cannot be understood as one.
    ...(context.session.recentTasks.length === 0
      ? {}
      : {
          earlier_in_this_session: context.session.recentTasks.slice(-SESSION_DEPTH).map((task) => ({
            said: task.said,
            result: task.result,
            outcome: task.summary,
          })),
        }),
    ...(context.session.referents.length === 0
      ? {}
      : { things_recently_opened: context.session.referents.map((referent) => referent.label) }),
  };
}

/** Recent tasks shown to the model. Enough for a follow-up to make sense. */
const SESSION_DEPTH = 5;

/** Option key meaning "do not navigate; carry on with the page already open". */
export const STAY_ON_PAGE = "stay";

/** Option key for an address the goal named out loud. */
export const SPOKEN_SITE = "the site named in the goal";

/**
 * The part of a goal that might be an address.
 *
 * Whatever follows a navigation verb, so "open binance dot com" is examined
 * but "search binance dot com for bitcoin" is not mistaken for a plain
 * navigation.
 */
function spokenTarget(goal: string): string {
  return afterPrefix(stripFiller(goal), ["open", "go to", "navigate to", "visit", "take me to"]) ?? goal;
}

/** The address a goal names out loud, or null. Used to resolve the spoken-site option. */
export function spokenSiteUrl(goal: string): string | null {
  const domain = asDomain(spokenTarget(goal));
  if (domain === null) return null;
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

/** The questions for this step. A sub-question appears only when it has options. */
export function buildQuestions(goal: string, observation: Observation, context: LoopContext): LoopQuestions {
  const kindCriteria: Record<string, string> = { ...LOOP_ACTIONS };
  if (observation.offscreen.length > 0) {
    kindCriteria["press_offscreen"] = PRESS_OFFSCREEN;
  }

  const siteCriteria: Record<string, string> = {
    ...context.sites.criteria(),
    [STAY_ON_PAGE]: "Stay on the page already open in the browser; no navigation is needed.",
  };

  // An address the speaker actually said, offered alongside the catalogue.
  // Without it, "open binance dot com" has no option that means what it says,
  // and the model must pick something else or give up.
  const spoken = asDomain(spokenTarget(goal));
  if (spoken !== null) {
    siteCriteria[SPOKEN_SITE] = `The website ${spoken}, which the goal names directly.`;
  }

  const questions: Record<string, ChoiceQuestion<string>> = {
    kind: choiceQuestion(KIND_INSTRUCTIONS, kindCriteria),
    app: choiceQuestion(APP_INSTRUCTIONS, context.apps.criteria()),
    site: choiceQuestion(SITE_INSTRUCTIONS, siteCriteria),
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
  /** How sure the model is that this KIND of action is right. */
  readonly kindConfidence: Confidence;
  /** The chosen kind probability, and the runner-up, for judging decisiveness. */
  readonly kindLead: { readonly top: number; readonly runnerUp: number };
  /** How sure it is WHICH target, when the action names one. */
  readonly targetConfidence: Confidence | null;
  /** The target distribution, for the same decisiveness check as the kind. */
  readonly targetLead: { readonly top: number; readonly runnerUp: number } | null;
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
  context: LoopContext,
  goal: string,
): LoopDecision {
  const kind = asChoice(answers["kind"], "kind");

  switch (kind.choice) {
    case "launch_app": {
      const app = asChoice(answers["app"], "app");
      const entry = context.apps.byKey(app.choice);
      if (entry === null) {
        throw new UnreadableDecisionError(`app answer ${JSON.stringify(app.choice)} is not an application we know`);
      }
      return {
        action: { kind: "launch_app", appId: entry.appId },
        // Launching is reversible, so only the kind answer gates it. Being
        // unsure WHICH application still beats refusing to act at all.
        confidence: kind.confidence,
        kindConfidence: kind.confidence,
        kindLead: leadOf(kind),
        targetConfidence: null,
        targetLead: null,
        kind: kind.choice,
        terminal: false,
      };
    }

    case "open_url": {
      const site = asChoice(answers["site"], "site");

      if (site.choice === STAY_ON_PAGE) {
        // Navigation was chosen but no destination: nothing to do this step,
        // and saying so beats reloading the page the user is already on.
        return simple({ kind: "wait" }, kind);
      }

      const url = site.choice === SPOKEN_SITE ? spokenSiteUrl(goal) : (context.sites.byKey(site.choice)?.url ?? null);
      if (url === null) {
        throw new UnreadableDecisionError(`site answer ${JSON.stringify(site.choice)} names no website`);
      }

      return {
        action: { kind: "open_url", url },
        confidence: kind.confidence,
        kindConfidence: kind.confidence,
        kindLead: leadOf(kind),
        targetConfidence: null,
        targetLead: null,
        kind: kind.choice,
        terminal: false,
      };
    }
    case "click_item": {
      const item = asChoice(answers["item"], "item");
      const index = Number.parseInt(item.choice, 10);
      if (!Number.isInteger(index) || observation.items[index] === undefined) {
        throw new UnreadableDecisionError(`item answer ${JSON.stringify(item.choice)} is not an item on this screen`);
      }
      return {
        action: { kind: "click_item", itemIndex: index },
        confidence: weakest(kind.confidence, item.confidence),
        kindConfidence: kind.confidence,
        kindLead: leadOf(kind),
        targetConfidence: item.confidence,
        targetLead: leadOf(item),
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
        kindConfidence: kind.confidence,
        kindLead: leadOf(kind),
        targetConfidence: offscreen.confidence,
        targetLead: leadOf(offscreen),
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

function leadOf(answer: ChoiceAnswer<string>): { top: number; runnerUp: number } {
  const sorted = Object.values(answer.probabilities).sort((a, b) => b - a);
  return { top: sorted[0] ?? 0, runnerUp: sorted[1] ?? 0 };
}

function simple(action: AgentAction, kind: ChoiceAnswer<string>): LoopDecision {
  return {
    action,
    confidence: kind.confidence,
    kindConfidence: kind.confidence,
    kindLead: leadOf(kind),
    targetConfidence: null,
    targetLead: null,
    kind: kind.choice,
    terminal: TERMINAL.has(kind.choice),
  };
}

function asChoice(value: unknown, name: string): ChoiceAnswer<string> {
  if (typeof value !== "object" || value === null) {
    throw new UnreadableDecisionError(`the ${name} question went unanswered`);
  }

  const answer = value as { choice?: unknown; confidence?: unknown; probabilities?: unknown };
  if (typeof answer.choice !== "string" || typeof answer.confidence !== "number") {
    throw new UnreadableDecisionError(`the ${name} answer is not a choice`);
  }

  // Kept, not discarded. Confidence says how sure the model is of being right;
  // the distribution says how far ahead the winner is, and those come apart
  // whenever several different actions would each make progress.
  const probabilities =
    typeof answer.probabilities === "object" && answer.probabilities !== null
      ? (answer.probabilities as Record<string, number>)
      : {};

  return {
    choice: answer.choice,
    confidence: confidence(Math.min(1, Math.max(0, answer.confidence))),
    probabilities,
  };
}
