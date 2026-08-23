import type { VisualKey } from "./index.js";
import type { BlueprintPosition, Point2D } from "./blueprint-geometry.js";
import type { BlueprintSvgBounds } from "./blueprint-svg.js";

export interface BlueprintViewport {
  readonly scale: number;
  readonly panX: number;
  readonly panY: number;
}

export interface BlueprintScaleLimits {
  readonly minScale?: number;
  readonly maxScale?: number;
}

export interface BlueprintFitOptions extends BlueprintScaleLimits {
  readonly padding?: number;
}

export type BlueprintInteractionErrorCode =
  | "invalid-viewport"
  | "invalid-screen-size"
  | "invalid-padding"
  | "invalid-scale-limit"
  | "invalid-zoom-factor"
  | "non-finite-point"
  | "non-finite-pan"
  | "missing-position"
  | "duplicate-position";

export class BlueprintInteractionError extends Error {
  readonly code: BlueprintInteractionErrorCode;
  readonly key?: VisualKey;

  constructor(code: BlueprintInteractionErrorCode, key?: VisualKey) {
    super(key === undefined ? code : `${code}: ${key}`);
    this.name = "BlueprintInteractionError";
    this.code = code;
    if (key !== undefined) this.key = key;
  }
}

const DEFAULT_MIN_SCALE = 0.1;
const DEFAULT_MAX_SCALE = 20;

export function createBlueprintViewport(
  scale = 1,
  panX = 0,
  panY = 0,
): BlueprintViewport {
  return freezeViewport(validateViewport({ scale, panX, panY }));
}

export function fitBlueprintViewport(
  bounds: BlueprintSvgBounds,
  width: number,
  height: number,
  options: BlueprintFitOptions = {},
): BlueprintViewport {
  validateBounds(bounds);
  validatePositiveFinite(width, "invalid-screen-size");
  validatePositiveFinite(height, "invalid-screen-size");
  const padding = options.padding ?? 0;
  if (!Number.isFinite(padding) || padding < 0 || padding * 2 >= width || padding * 2 >= height) {
    throw new BlueprintInteractionError("invalid-padding");
  }
  const limits = resolveScaleLimits(options);
  const availableWidth = width - padding * 2;
  const availableHeight = height - padding * 2;
  const scale = clamp(
    Math.min(availableWidth / bounds.width, availableHeight / bounds.height),
    limits.minScale,
    limits.maxScale,
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return freezeViewport({
    scale,
    panX: width / 2 - centerX * scale,
    panY: height / 2 - centerY * scale,
  });
}

export function panBlueprintViewport(
  viewport: BlueprintViewport,
  dx: number,
  dy: number,
): BlueprintViewport {
  const current = validateViewport(viewport);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new BlueprintInteractionError("non-finite-pan");
  }
  return freezeViewport({
    scale: current.scale,
    panX: current.panX + dx,
    panY: current.panY + dy,
  });
}

export function zoomBlueprintViewport(
  viewport: BlueprintViewport,
  factor: number,
  screenAnchor: Point2D,
  limits: BlueprintScaleLimits = {},
): BlueprintViewport {
  const current = validateViewport(viewport);
  const anchor = validatePoint(screenAnchor);
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new BlueprintInteractionError("invalid-zoom-factor");
  }
  const resolvedLimits = resolveScaleLimits(limits);
  const worldAnchor = blueprintScreenToWorld(current, anchor);
  const scale = clamp(current.scale * factor, resolvedLimits.minScale, resolvedLimits.maxScale);
  return freezeViewport({
    scale,
    panX: anchor.x - worldAnchor.x * scale,
    panY: anchor.y - worldAnchor.y * scale,
  });
}

export function blueprintWorldToScreen(viewport: BlueprintViewport, point: Point2D): Point2D {
  const current = validateViewport(viewport);
  const world = validatePoint(point);
  return freezePoint({
    x: world.x * current.scale + current.panX,
    y: world.y * current.scale + current.panY,
  });
}

export function blueprintScreenToWorld(viewport: BlueprintViewport, point: Point2D): Point2D {
  const current = validateViewport(viewport);
  const screen = validatePoint(point);
  return freezePoint({
    x: (screen.x - current.panX) / current.scale,
    y: (screen.y - current.panY) / current.scale,
  });
}

export function moveBlueprintPosition(
  positions: readonly BlueprintPosition[],
  key: VisualKey,
  worldPoint: Point2D,
): readonly BlueprintPosition[] {
  const nextPoint = validatePoint(worldPoint);
  const seen = new Set<VisualKey>();
  let found = false;
  const next = positions.map((position) => {
    if (seen.has(position.key)) throw new BlueprintInteractionError("duplicate-position", position.key);
    seen.add(position.key);
    validatePoint(position.point);
    const point = position.key === key ? nextPoint : position.point;
    if (position.key === key) found = true;
    return freezePosition(position.key, point);
  });
  if (!found) throw new BlueprintInteractionError("missing-position", key);
  return Object.freeze(next);
}

function validateViewport(viewport: BlueprintViewport): BlueprintViewport {
  if (!Number.isFinite(viewport.scale) || viewport.scale <= 0
    || !Number.isFinite(viewport.panX) || !Number.isFinite(viewport.panY)) {
    throw new BlueprintInteractionError("invalid-viewport");
  }
  return viewport;
}

function validateBounds(bounds: BlueprintSvgBounds): void {
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, bounds.width, bounds.height]
    .every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0
    || bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) {
    throw new BlueprintInteractionError("invalid-screen-size");
  }
}

function resolveScaleLimits(limits: BlueprintScaleLimits): { minScale: number; maxScale: number } {
  const minScale = limits.minScale ?? DEFAULT_MIN_SCALE;
  const maxScale = limits.maxScale ?? DEFAULT_MAX_SCALE;
  if (!Number.isFinite(minScale) || !Number.isFinite(maxScale)
    || minScale <= 0 || maxScale <= 0 || minScale > maxScale) {
    throw new BlueprintInteractionError("invalid-scale-limit");
  }
  return { minScale, maxScale };
}

function validatePositiveFinite(value: number, code: BlueprintInteractionErrorCode): void {
  if (!Number.isFinite(value) || value <= 0) throw new BlueprintInteractionError(code);
}

function validatePoint(point: Point2D): Point2D {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new BlueprintInteractionError("non-finite-point");
  }
  return point;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function freezeViewport(viewport: BlueprintViewport): BlueprintViewport {
  return Object.freeze({ scale: viewport.scale, panX: viewport.panX, panY: viewport.panY });
}

function freezePoint(point: Point2D): Point2D {
  return Object.freeze({ x: point.x, y: point.y });
}

function freezePosition(key: VisualKey, point: Point2D): BlueprintPosition {
  return Object.freeze({ key, point: freezePoint(point) });
}
