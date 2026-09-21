/** Rectangles and points, in captured-image pixels unless stated otherwise. */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

export function right(r: Rect): number {
  return r.x + r.width;
}

export function bottom(r: Rect): number {
  return r.y + r.height;
}

export function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function area(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

export function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(right(a), right(b)) - x;
  const h = Math.min(bottom(a), bottom(b)) - y;
  return w > 0 && h > 0 ? { x, y, width: w, height: h } : null;
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y };
}

/**
 * Intersection over the area of the smaller rectangle.
 *
 * Not IoU: a tight control sitting inside a wide text line should score high,
 * which is exactly the case the OCR/UIA merge has to recognise.
 */
export function overlapRatio(a: Rect, b: Rect): number {
  const shared = intersection(a, b);
  if (shared === null) return 0;
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 ? area(shared) / smaller : 0;
}
