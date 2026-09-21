/**
 * Turning OCR text and accessibility controls into one list of things to click.
 *
 * The two sources see different worlds and overlap messily. OCR reads anything
 * drawn as text, including labels nothing can click. UI Automation knows real
 * controls, including icon-only buttons that carry no text at all, but its
 * coverage varies by application. Neither alone is enough.
 *
 * So both are collected and reconciled here: where a control sits on the text
 * that names it, the two become one item carrying both facts. The decision
 * model then sees a single numbered list, and each entry says where it came
 * from, which is what lets it tell a real button from a line of prose.
 *
 * Everything in this file is pure. It is the part of perception worth testing
 * exhaustively, and it should never need a screen to do it.
 */

import type { OcrLine } from "../../core/ports/perception.js";
import { bottom, overlapRatio, right, type Rect } from "../../core/types/geometry.js";
import type { UiItem, UiRole } from "../../core/types/observation.js";
import type { ElementHandle } from "../../core/types/observation.js";
import { confidence, type Confidence } from "../../core/types/scalars.js";

/** Overlap, against the smaller box, at which a control and a text line are the same thing. */
const MIN_BOX_OVERLAP = 0.5;

/** Share of words two labels must have in common to count as the same thing. */
const MIN_WORD_OVERLAP = 0.5;

/** A control from the accessibility tree, as the merge needs it. */
export interface ControlInput {
  readonly label: string;
  readonly bounds: Rect;
  readonly role: UiRole;
  readonly handle: ElementHandle;
}

/**
 * Join lines that continue the block above them.
 *
 * OCR returns visual lines, so a wrapped sentence arrives in pieces and a
 * paragraph becomes a dozen options competing for the same vote. Lines that
 * share a left edge, sit close together and have similar height are one thing
 * as far as clicking is concerned.
 */
export function mergeTextLines(lines: readonly OcrLine[]): readonly OcrLine[] {
  const sorted = [...lines].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);

  interface Block {
    text: string;
    confidence: Confidence;
    bounds: Rect;
    lastHeight: number;
  }
  const blocks: Block[] = [];

  for (const line of sorted) {
    const height = line.bounds.height;
    let best: { gap: number; block: Block } | null = null;

    for (const block of blocks) {
      const gap = line.bounds.y - bottom(block.bounds);
      const alignedLeft = Math.abs(line.bounds.x - block.bounds.x) < 0.6 * block.lastHeight;
      const closeEnough = gap > -0.2 * block.lastHeight && gap < 0.8 * block.lastHeight;
      const similarHeight = height / Math.max(block.lastHeight, 1) > 0.7 && height / Math.max(block.lastHeight, 1) < 1.4;

      if (alignedLeft && closeEnough && similarHeight && (best === null || gap < best.gap)) {
        best = { gap, block };
      }
    }

    if (best === null) {
      blocks.push({ text: line.text, confidence: line.confidence, bounds: line.bounds, lastHeight: height });
      continue;
    }

    const block = best.block;
    const x = Math.min(block.bounds.x, line.bounds.x);
    const farRight = Math.max(right(block.bounds), right(line.bounds));
    block.text = `${block.text} ${line.text}`;
    block.confidence = confidence(Math.min(block.confidence, line.confidence));
    block.bounds = { x, y: block.bounds.y, width: farRight - x, height: bottom(line.bounds) - block.bounds.y };
    block.lastHeight = height;
  }

  return blocks.map((block) => ({ text: block.text, confidence: block.confidence, bounds: block.bounds }));
}

/** One label contains the other, or they share half their words. */
export function textsMatch(a: string, b: string): boolean {
  const left = a.toLowerCase().split(/\s+/).filter(Boolean);
  const rightWords = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (left.length === 0 || rightWords.length === 0) return false;

  const joinedLeft = left.join(" ");
  const joinedRight = rightWords.join(" ");
  if (joinedLeft.includes(joinedRight) || joinedRight.includes(joinedLeft)) return true;

  const shared = new Set(left).size === 0 ? 0 : left.filter((word) => rightWords.includes(word)).length;
  return shared / Math.min(new Set(left).size, new Set(rightWords).size) >= MIN_WORD_OVERLAP;
}

/**
 * Reading order: rows first, then left to right within a row.
 *
 * Rows are banded by the median item height rather than exact tops, because
 * items on the same visual line rarely share a pixel coordinate.
 */
export function readingOrder(items: readonly { readonly bounds: Rect }[]): readonly number[] {
  const heights = items.map((item) => item.bounds.height).sort((a, b) => a - b);
  const rowHeight = Math.max(1, heights[Math.floor(heights.length / 2)] ?? 1);

  return items
    .map((item, index) => ({ index, item }))
    .sort((a, b) => {
      const rowA = Math.round((a.item.bounds.y + a.item.bounds.height / 2) / rowHeight);
      const rowB = Math.round((b.item.bounds.y + b.item.bounds.height / 2) / rowHeight);
      return rowA - rowB || a.item.bounds.x - b.item.bounds.x;
    })
    .map((entry) => entry.index);
}

/**
 * Which items survive the option ceiling.
 *
 * The provider accepts at most 255 options, and a busy screen produces more.
 * The faintest OCR-only text goes first: a control the application declared is
 * never dropped for a line of prose, because prose is rarely the target and a
 * control usually is.
 */
export function keptByBudget(items: readonly UiItem[], budget: number): readonly number[] {
  if (items.length <= budget) return items.map((_, index) => index);

  const ranked = items
    .map((item, index) => ({ index, fromTree: item.source !== "ocr", confidence: item.textConfidence }))
    .sort((a, b) => Number(a.fromTree) - Number(b.fromTree) || a.confidence - b.confidence);

  const dropped = new Set(ranked.slice(0, items.length - budget).map((entry) => entry.index));
  return items.map((_, index) => index).filter((index) => !dropped.has(index));
}

/**
 * The merged, numbered list the decision model sees.
 *
 * A control that sits on the text naming it replaces both with one entry, so
 * the model is never offered the same thing twice under different numbers.
 * Indices are assigned last, after the budget cut and the reordering, because
 * they only have to be stable within a single observation.
 */
export function mergeSources(
  textBlocks: readonly OcrLine[],
  controls: readonly ControlInput[],
  budget: number,
): readonly UiItem[] {
  const claimed = new Set<number>();
  const merged: UiItem[] = [];

  for (const control of controls) {
    let bestIndex: number | null = null;
    let bestOverlap = MIN_BOX_OVERLAP;

    for (const [index, block] of textBlocks.entries()) {
      if (claimed.has(index)) continue;

      const overlap = overlapRatio(control.bounds, block.bounds);
      if (overlap >= bestOverlap && textsMatch(control.label, block.text)) {
        bestIndex = index;
        bestOverlap = overlap;
      }
    }

    if (bestIndex === null) {
      merged.push({
        index: 0,
        text: control.label,
        bounds: control.bounds,
        source: "uia",
        role: control.role,
        textConfidence: confidence(1),
        element: control.handle,
      });
      continue;
    }

    const block = textBlocks[bestIndex];
    claimed.add(bestIndex);
    merged.push({
      index: 0,
      // Whichever label says more. OCR sometimes reads a longer visible caption
      // than the accessibility name, and sometimes far less.
      text: (block !== undefined && block.text.length > control.label.length) ? block.text : control.label,
      bounds: block?.bounds ?? control.bounds,
      source: "uia+ocr",
      role: control.role,
      textConfidence: block?.confidence ?? confidence(1),
      element: control.handle,
    });
  }

  for (const [index, block] of textBlocks.entries()) {
    if (claimed.has(index)) continue;
    merged.push({
      index: 0,
      text: block.text,
      bounds: block.bounds,
      source: "ocr",
      role: null,
      textConfidence: block.confidence,
      element: null,
    });
  }

  const kept = keptByBudget(merged, budget).map((index) => merged[index]).filter((item): item is UiItem => item !== undefined);

  return readingOrder(kept)
    .map((position) => kept[position])
    .filter((item): item is UiItem => item !== undefined)
    .map((item, index) => ({ ...item, index }));
}
