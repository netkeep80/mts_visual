import {
  normalizeVisualLinkNetwork,
  type VisualKey,
  type VisualLink,
  type VisualLinkNetwork,
} from "./index.js";

// Presentation-only geometry adapted from ideas in konard/links-visuals.
// Exact donor snapshot retained for auditability:
// repository: konard/links-visuals
// commit: f377441533e4f10fa94aaa07138b684df88234b1
// license: Unlicense
// references: animated-blueprint.html, js/path.mjs, js/ik-pure.mjs, js/blueprint-link.mjs

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface CubicBezierSegment {
  readonly p0: Point2D;
  readonly p1: Point2D;
  readonly p2: Point2D;
  readonly p3: Point2D;
}

export interface BlueprintPosition {
  readonly key: VisualKey;
  readonly point: Point2D;
}

export interface BlueprintLinkGeometry {
  readonly key: VisualKey;
  readonly startKey: VisualKey;
  readonly endKey: VisualKey;
  readonly center: Point2D;
  readonly startAnchor: Point2D;
  readonly endAnchor: Point2D;
  readonly segments: readonly CubicBezierSegment[];
}

export interface BlueprintGeometry {
  readonly positions: readonly BlueprintPosition[];
  readonly links: readonly BlueprintLinkGeometry[];
}

export interface BlueprintOptions {
  readonly spacing?: number;
  readonly loopRadius?: number;
}

export type BlueprintGeometryErrorCode =
  | "invalid-option"
  | "duplicate-position"
  | "unknown-position"
  | "missing-position"
  | "non-finite-position";

export class BlueprintGeometryError extends Error {
  readonly code: BlueprintGeometryErrorCode;
  readonly key?: VisualKey;

  constructor(code: BlueprintGeometryErrorCode, key?: VisualKey) {
    super(key === undefined ? code : `${code}: ${key}`);
    this.name = "BlueprintGeometryError";
    this.code = code;
    if (key !== undefined) this.key = key;
  }
}

const DEFAULT_SPACING = 96;
const DEFAULT_LOOP_RADIUS = 34;
const EPSILON = 1e-9;

export function createBlueprintInitialPositions(
  network: VisualLinkNetwork,
  options: BlueprintOptions = {},
): readonly BlueprintPosition[] {
  const normalized = normalizeVisualLinkNetwork(network);
  const spacing = positiveOption(options.spacing, DEFAULT_SPACING);
  return Object.freeze(normalized.links.map((link, index) => {
    const cell = squareSpiralCell(index);
    return freezePosition(link.key, { x: cell.x * spacing, y: cell.y * spacing });
  }));
}

export function buildBlueprintGeometry(
  network: VisualLinkNetwork,
  positions?: readonly BlueprintPosition[],
  options: BlueprintOptions = {},
): BlueprintGeometry {
  const normalized = normalizeVisualLinkNetwork(network);
  const spacing = positiveOption(options.spacing, DEFAULT_SPACING);
  const loopRadius = positiveOption(options.loopRadius, DEFAULT_LOOP_RADIUS);
  const resolved = resolvePositions(normalized, positions, spacing);
  const byKey = new Map(resolved.map(({ key, point }) => [key, point] as const));

  const links = normalized.links.map((link) => buildLinkGeometry(link, byKey, loopRadius));
  const geometry = Object.freeze({
    positions: resolved,
    links: Object.freeze(links),
  });
  if (!blueprintGeometryIsFinite(geometry)) throw new BlueprintGeometryError("non-finite-position");
  return geometry;
}

export function blueprintCubicDerivativeAtStart(segment: CubicBezierSegment): Point2D {
  return scale(subtract(segment.p1, segment.p0), 3);
}

export function blueprintCubicDerivativeAtEnd(segment: CubicBezierSegment): Point2D {
  return scale(subtract(segment.p3, segment.p2), 3);
}

export function blueprintSegmentsAreC1(
  segments: readonly CubicBezierSegment[],
  epsilon = EPSILON,
): boolean {
  if (!Number.isFinite(epsilon) || epsilon < 0) return false;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (!joinIsC1(segments[index]!, segments[index + 1]!, epsilon)) return false;
  }
  if (segments.length > 1 && pointsNear(segments[0]!.p0, segments.at(-1)!.p3, epsilon)) {
    if (!joinIsC1(segments.at(-1)!, segments[0]!, epsilon)) return false;
  }
  return true;
}

export function blueprintGeometryIsFinite(geometry: BlueprintGeometry): boolean {
  return geometry.positions.every(({ point }) => pointIsFinite(point))
    && geometry.links.every((link) => [link.center, link.startAnchor, link.endAnchor,
      ...link.segments.flatMap((segment) => [segment.p0, segment.p1, segment.p2, segment.p3])]
      .every(pointIsFinite));
}

function buildLinkGeometry(
  link: VisualLink,
  positions: ReadonlyMap<VisualKey, Point2D>,
  loopRadius: number,
): BlueprintLinkGeometry {
  const center = requirePoint(positions, link.key);
  const start = requirePoint(positions, link.startKey);
  const end = requirePoint(positions, link.endKey);
  const startAtCenter = pointsNear(start, center, EPSILON);
  const endAtCenter = pointsNear(end, center, EPSILON);

  let segments: readonly CubicBezierSegment[];
  if (startAtCenter && endAtCenter) {
    segments = buildClosedLoop(center, loopRadius, link.key);
  } else {
    const waypoints: Point2D[] = [];
    if (startAtCenter) {
      waypoints.push(center, detour(center, end, loopRadius, link.key, 1), center);
    } else {
      waypoints.push(start, center);
    }
    if (endAtCenter) {
      waypoints.push(detour(center, start, loopRadius, link.key, -1), center);
    } else {
      waypoints.push(end);
    }
    segments = cubicSegments(waypoints);
  }

  return Object.freeze({
    key: link.key,
    startKey: link.startKey,
    endKey: link.endKey,
    center: freezePoint(center),
    startAnchor: freezePoint(start),
    endAnchor: freezePoint(end),
    segments: Object.freeze([...segments]),
  });
}

function resolvePositions(
  network: VisualLinkNetwork,
  requested: readonly BlueprintPosition[] | undefined,
  spacing: number,
): readonly BlueprintPosition[] {
  if (requested === undefined) return createBlueprintInitialPositions(network, { spacing });

  const expected = new Set(network.links.map((link) => link.key));
  const map = new Map<VisualKey, Point2D>();
  for (const position of requested) {
    if (!expected.has(position.key)) throw new BlueprintGeometryError("unknown-position", position.key);
    if (map.has(position.key)) throw new BlueprintGeometryError("duplicate-position", position.key);
    if (!pointIsFinite(position.point)) throw new BlueprintGeometryError("non-finite-position", position.key);
    map.set(position.key, freezePoint(position.point));
  }
  for (const link of network.links) {
    if (!map.has(link.key)) throw new BlueprintGeometryError("missing-position", link.key);
  }
  return Object.freeze(network.links.map((link) => freezePosition(link.key, map.get(link.key)!)));
}

function buildClosedLoop(center: Point2D, radius: number, key: VisualKey): readonly CubicBezierSegment[] {
  const angle = stableAngle(key);
  const axis = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -axis.y, y: axis.x };
  const opposite = add(center, scale(axis, radius * 2));
  return Object.freeze([
    freezeSegment(center, add(center, scale(normal, radius)), add(opposite, scale(normal, radius)), opposite),
    freezeSegment(opposite, add(opposite, scale(normal, -radius)), add(center, scale(normal, -radius)), center),
  ]);
}

function detour(
  center: Point2D,
  toward: Point2D,
  radius: number,
  key: VisualKey,
  side: 1 | -1,
): Point2D {
  const direction = subtract(toward, center);
  const length = Math.hypot(direction.x, direction.y);
  if (length <= EPSILON) {
    const angle = stableAngle(key) + side * Math.PI / 2;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  }
  const normal = { x: -direction.y / length, y: direction.x / length };
  return add(center, scale(normal, radius * side));
}

function cubicSegments(points: readonly Point2D[]): readonly CubicBezierSegment[] {
  if (points.length < 2) return Object.freeze([]);
  const tangents = points.map((point, index) => {
    if (index === 0) return subtract(points[1]!, point);
    if (index === points.length - 1) return subtract(point, points[index - 1]!);
    return scale(subtract(points[index + 1]!, points[index - 1]!), 0.5);
  });
  return Object.freeze(points.slice(0, -1).map((point, index) => freezeSegment(
    point,
    add(point, scale(tangents[index]!, 1 / 3)),
    subtract(points[index + 1]!, scale(tangents[index + 1]!, 1 / 3)),
    points[index + 1]!,
  )));
}

function joinIsC1(left: CubicBezierSegment, right: CubicBezierSegment, epsilon: number): boolean {
  return pointsNear(left.p3, right.p0, epsilon)
    && pointsNear(blueprintCubicDerivativeAtEnd(left), blueprintCubicDerivativeAtStart(right), epsilon);
}

function positiveOption(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new BlueprintGeometryError("invalid-option");
  return value;
}

function requirePoint(positions: ReadonlyMap<VisualKey, Point2D>, key: VisualKey): Point2D {
  const point = positions.get(key);
  if (point === undefined) throw new BlueprintGeometryError("missing-position", key);
  return point;
}

function squareSpiralCell(index: number): Point2D {
  if (index <= 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  let dx = 1;
  let dy = 0;
  let segmentLength = 1;
  let segmentProgress = 0;
  let turns = 0;
  for (let step = 0; step < index; step += 1) {
    x += dx;
    y += dy;
    segmentProgress += 1;
    if (segmentProgress === segmentLength) {
      segmentProgress = 0;
      [dx, dy] = [-dy, dx];
      turns += 1;
      if (turns % 2 === 0) segmentLength += 1;
    }
  }
  return { x, y };
}

function stableAngle(key: VisualKey): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}

function freezePosition(key: VisualKey, point: Point2D): BlueprintPosition {
  return Object.freeze({ key, point: freezePoint(point) });
}

function freezeSegment(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D): CubicBezierSegment {
  return Object.freeze({ p0: freezePoint(p0), p1: freezePoint(p1), p2: freezePoint(p2), p3: freezePoint(p3) });
}

function freezePoint(point: Point2D): Point2D {
  return Object.freeze({ x: point.x, y: point.y });
}

function pointIsFinite(point: Point2D | undefined): point is Point2D {
  return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointsNear(left: Point2D, right: Point2D, epsilon: number): boolean {
  return Math.abs(left.x - right.x) <= epsilon && Math.abs(left.y - right.y) <= epsilon;
}

function add(left: Point2D, right: Point2D): Point2D {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Point2D, right: Point2D): Point2D {
  return { x: left.x - right.x, y: left.y - right.y };
}

function scale(point: Point2D, factor: number): Point2D {
  return { x: point.x * factor, y: point.y * factor };
}
