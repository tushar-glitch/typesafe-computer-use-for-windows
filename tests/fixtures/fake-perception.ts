import type { IPerceptionPipeline } from "../../src/core/ports/perception.js";
import type {
  ElementHandle,
  Observation,
  OffscreenControl,
  UiItem,
  UiRole,
} from "../../src/core/types/observation.js";
import { confidence, milliseconds } from "../../src/core/types/scalars.js";

export function item(
  index: number,
  text: string,
  overrides: Partial<UiItem> = {},
): UiItem {
  return {
    index,
    text,
    bounds: { x: 100, y: 100 + index * 30, width: 200, height: 24 },
    source: "uia",
    role: "button",
    textConfidence: confidence(1),
    element: `e${index}` as ElementHandle,
    ...overrides,
  };
}

export function offscreenControl(index: number, label: string, role: UiRole = "menu"): OffscreenControl {
  return { index, label, role, element: `o${index}` as ElementHandle };
}

export function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    capturedAt: milliseconds(0),
    image: {
      data: Uint8Array.from([0]),
      format: "png",
      size: { width: 1000, height: 800 },
      origin: { x: 0, y: 0 },
    },
    displayScale: 1,
    foreground: { processId: 1, processName: "chrome", title: "YouTube", bounds: { x: 0, y: 0, width: 1000, height: 800 } },
    items: [],
    offscreen: [],
    focusedField: null,
    browserUrl: null,
    ...overrides,
  };
}

/** Serves a fixed observation, or a different one per step. */
export class FakePerception implements IPerceptionPipeline {
  observations = 0;

  readonly #frames: readonly Observation[];

  constructor(frames: Observation | readonly Observation[]) {
    this.#frames = Array.isArray(frames) ? frames : [frames as Observation];
  }

   
  async observe(): Promise<Observation> {
    const frame = this.#frames[Math.min(this.observations, this.#frames.length - 1)];
    this.observations++;
    if (frame === undefined) throw new Error("fake perception has no frames");
    return frame;
  }
}
