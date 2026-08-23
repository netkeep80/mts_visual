import {
  normalizeVisualLinkNetwork,
  type VisualKey,
  type VisualLinkNetwork,
} from "./index.js";

// Pure presentation geometry adapted from:
// netkeep80/anum_parser@48b5909d19490d9b27904bfc087ee0e86868fbd8/src/geometry3d.js
// No parser, renderer, physics, or MTS semantic authority is carried here.

const EPSILON = 1e-12;
const TANGENT_LENGTH = 0.35;
const LOOP_RADIUS = 0.8;

export interface Point3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface VisualPosition3D {
  readonly key: VisualKey;
  readonly point: Point3D;
}

export type VisualGeometry3DErrorCode =
  | "missing-position"
  | "extra-position"
  | "duplicate-position"
  | "non-finite-position";

export class VisualGeometry3DError extends Error {
  readonly code: VisualGeometry3DErrorCode;
  readonly key: VisualKey;

  constructor(code: VisualGeometry3DErrorCode, key: VisualKey) {
    super(`${code} for ${key}`);
    this.name = "VisualGeometry3DError";
    this.code = code;
    this.key = key;
  }
}

export type VisualArcRole3D = "start" | "end";
export type VisualArcOrientation3D = "outer-to-green" | "green-to-outer";
export type VisualCenterlineKind3D = "quadratic" | "cubic";

export interface CenterlineInput3D {
  readonly kind?: VisualCenterlineKind3D;
  readonly controlPoints: readonly Point3D[];
}

export interface VisualCenterline3D extends CenterlineInput3D {
  readonly kind: VisualCenterlineKind3D;
  readonly role: VisualArcRole3D;
  readonly semanticOrientation: VisualArcOrientation3D;
  readonly greenOutwardTangent: Point3D;
  readonly loop: boolean;
}

export interface VisualLinkGeometry3D {
  readonly key: VisualKey;
  readonly startKey: VisualKey;
  readonly endKey: VisualKey;
  readonly center: Point3D;
  readonly start: VisualCenterline3D;
  readonly end: VisualCenterline3D;
}

export interface VisualGeometry3D {
  readonly positions: readonly VisualPosition3D[];
  readonly links: readonly VisualLinkGeometry3D[];
}

const X_AXIS: Point3D = Object.freeze({ x: 1, y: 0, z: 0 });
const Y_AXIS: Point3D = Object.freeze({ x: 0, y: 1, z: 0 });
const Z_AXIS: Point3D = Object.freeze({ x: 0, y: 0, z: 1 });
const AXES: readonly Point3D[] = Object.freeze([X_AXIS, Y_AXIS, Z_AXIS]);

function point(x: number, y: number, z: number): Point3D {
  return Object.freeze({ x, y, z });
}

function clonePoint(value: Point3D): Point3D {
  return point(value.x, value.y, value.z);
}

function add(left: Point3D, right: Point3D): Point3D {
  return point(left.x + right.x, left.y + right.y, left.z + right.z);
}

function subtract(left: Point3D, right: Point3D): Point3D {
  return point(left.x - right.x, left.y - right.y, left.z - right.z);
}

function scale(value: Point3D, factor: number): Point3D {
  return point(value.x * factor, value.y * factor, value.z * factor);
}

export function dotVec3(left: Point3D, right: Point3D): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: Point3D, right: Point3D): Point3D {
  return point(
    left.y * right.z - left.z * right.y,
    left.z * right.x - left.x * right.z,
    left.x * right.y - left.y * right.x,
  );
}

function normalize(value: Point3D): Point3D | undefined {
  const length = Math.hypot(value.x, value.y, value.z);
  if (!Number.isFinite(length) || length <= EPSILON) return undefined;
  return scale(value, 1 / length);
}

function stableOrthogonal(direction: Point3D): Point3D {
  const unit = normalize(direction) ?? X_AXIS;
  let basis = X_AXIS;
  let alignment = Math.abs(dotVec3(unit, basis));
  for (const candidate of AXES.slice(1)) {
    const next = Math.abs(dotVec3(unit, candidate));
    if (next < alignment) {
      basis = candidate;
      alignment = next;
    }
  }
  return normalize(cross(unit, basis))
    ?? normalize(cross(unit, Z_AXIS))
    ?? Y_AXIS;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function quadraticPoint(p0: Point3D, p1: Point3D, p2: Point3D, t: number): Point3D {
  const u = clamp01(t);
  if (u === 0) return clonePoint(p0);
  if (u === 1) return clonePoint(p2);
  const v = 1 - u;
  return add(add(scale(p0, v * v), scale(p1, 2 * v * u)), scale(p2, u * u));
}

function cubicPoint(p0: Point3D, p1: Point3D, p2: Point3D, p3: Point3D, t: number): Point3D {
  const u = clamp01(t);
  if (u === 0) return clonePoint(p0);
  if (u === 1) return clonePoint(p3);
  const v = 1 - u;
  return add(
    add(scale(p0, v ** 3), scale(p1, 3 * v * v * u)),
    add(scale(p2, 3 * v * u * u), scale(p3, u ** 3)),
  );
}

function resolvedKind(centerline: CenterlineInput3D): VisualCenterlineKind3D {
  if (centerline.kind === "quadratic" || centerline.kind === "cubic") return centerline.kind;
  if (centerline.controlPoints.length === 3) return "quadratic";
  if (centerline.controlPoints.length === 4) return "cubic";
  throw new Error(`Unknown 3D centerline with ${centerline.controlPoints.length} control points`);
}

export function centerlinePoint3D(centerline: CenterlineInput3D, t: number): Point3D {
  const points = centerline.controlPoints;
  if (resolvedKind(centerline) === "quadratic") {
    if (points.length !== 3) throw new Error("Quadratic 3D centerline requires 3 control points");
    return quadraticPoint(points[0]!, points[1]!, points[2]!, t);
  }
  if (points.length !== 4) throw new Error("Cubic 3D centerline requires 4 control points");
  return cubicPoint(points[0]!, points[1]!, points[2]!, points[3]!, t);
}

export function sampleCenterline3D(centerline: CenterlineInput3D, segments = 16): readonly Point3D[] {
  const count = Number.isFinite(segments) ? Math.max(1, Math.floor(segments)) : 16;
  return Object.freeze(Array.from({ length: count + 1 }, (_, index) =>
    centerlinePoint3D(centerline, index / count)));
}

function makeCenterline(
  kind: VisualCenterlineKind3D,
  controlPoints: readonly Point3D[],
  role: VisualArcRole3D,
  greenOutwardTangent: Point3D,
  loop: boolean,
): VisualCenterline3D {
  return Object.freeze({
    kind,
    role,
    semanticOrientation: role === "start" ? "outer-to-green" : "green-to-outer",
    greenOutwardTangent: clonePoint(greenOutwardTangent),
    loop,
    controlPoints: Object.freeze(controlPoints.map(clonePoint)),
  });
}

function pairedArcs(center: Point3D, startPole: Point3D, endPole: Point3D) {
  const startVector = subtract(startPole, center);
  const endVector = subtract(endPole, center);
  const startUnit = normalize(startVector);
  const endUnit = normalize(endVector);

  let startOutward = normalize(subtract(startUnit ?? point(0, 0, 0), endUnit ?? point(0, 0, 0)));
  if (startOutward === undefined) {
    const fallback = startUnit ?? scale(endUnit ?? X_AXIS, -1);
    startOutward = stableOrthogonal(fallback);
  }
  if (startUnit !== undefined && dotVec3(startOutward, startVector) < 0) {
    startOutward = scale(startOutward, -1);
  }
  const endOutward = scale(startOutward, -1);

  return {
    start: makeCenterline(
      "quadratic",
      [startPole, add(center, scale(startOutward, TANGENT_LENGTH)), center],
      "start",
      startOutward,
      false,
    ),
    end: makeCenterline(
      "quadratic",
      [center, add(center, scale(endOutward, TANGENT_LENGTH)), endPole],
      "end",
      endOutward,
      false,
    ),
  } as const;
}

function loopCenterline(
  center: Point3D,
  greenOutward: Point3D,
  role: VisualArcRole3D,
  planeNormal: Point3D,
  handedness: 1 | -1,
): VisualCenterline3D {
  const green = normalize(greenOutward) ?? X_AXIS;
  let normal = normalize(planeNormal) ?? stableOrthogonal(green);
  normal = normalize(subtract(normal, scale(green, dotVec3(normal, green)))) ?? stableOrthogonal(green);
  const side = normalize(cross(normal, green)) ?? stableOrthogonal(green);
  const otherRay = normalize(add(
    scale(green, -0.35),
    scale(side, handedness * Math.sqrt(1 - 0.35 ** 2)),
  )) ?? side;

  const first = role === "start" ? otherRay : green;
  const second = role === "start" ? green : otherRay;
  return makeCenterline(
    "cubic",
    [center, add(center, scale(first, LOOP_RADIUS)), add(center, scale(second, LOOP_RADIUS)), center],
    role,
    green,
    true,
  );
}

function singleSelfArcs(
  center: Point3D,
  companionPole: Point3D,
  selfRole: VisualArcRole3D,
) {
  const companionOutward = normalize(subtract(companionPole, center)) ?? X_AXIS;
  const selfOutward = scale(companionOutward, -1);
  const baseNormal = stableOrthogonal(companionOutward);
  const planeNormal = selfRole === "start" ? baseNormal : scale(baseNormal, -1);
  const selfLoop = loopCenterline(
    center,
    selfOutward,
    selfRole,
    planeNormal,
    selfRole === "start" ? 1 : -1,
  );
  const companionControl = add(center, scale(companionOutward, TANGENT_LENGTH));
  const companion = selfRole === "start"
    ? makeCenterline("quadratic", [center, companionControl, companionPole], "end", companionOutward, false)
    : makeCenterline("quadratic", [companionPole, companionControl, center], "start", companionOutward, false);

  return selfRole === "start"
    ? { start: selfLoop, end: companion } as const
    : { start: companion, end: selfLoop } as const;
}

function doubleSelfArcs(center: Point3D) {
  const startOutward = point(-1, 0, 0);
  const endOutward = point(1, 0, 0);
  return {
    start: loopCenterline(center, startOutward, "start", Z_AXIS, 1),
    end: loopCenterline(center, endOutward, "end", scale(Z_AXIS, -1), 1),
  } as const;
}

function semanticArcs(
  center: Point3D,
  startPole: Point3D,
  endPole: Point3D,
  startSelf: boolean,
  endSelf: boolean,
) {
  if (startSelf && endSelf) return doubleSelfArcs(center);
  if (startSelf) return singleSelfArcs(center, endPole, "start");
  if (endSelf) return singleSelfArcs(center, startPole, "end");
  return pairedArcs(center, startPole, endPole);
}

function finite(value: Point3D): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

export function buildVisualGeometry3D(
  network: VisualLinkNetwork,
  positions: readonly VisualPosition3D[],
): VisualGeometry3D {
  const normalized = normalizeVisualLinkNetwork(network);
  const keys = new Set(normalized.links.map((link) => link.key));
  const byKey = new Map<VisualKey, Point3D>();

  for (const entry of positions) {
    if (byKey.has(entry.key)) throw new VisualGeometry3DError("duplicate-position", entry.key);
    if (!finite(entry.point)) throw new VisualGeometry3DError("non-finite-position", entry.key);
    if (!keys.has(entry.key)) throw new VisualGeometry3DError("extra-position", entry.key);
    byKey.set(entry.key, clonePoint(entry.point));
  }

  for (const link of normalized.links) {
    if (!byKey.has(link.key)) throw new VisualGeometry3DError("missing-position", link.key);
  }

  const normalizedPositions = Object.freeze([...byKey.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => Object.freeze({ key, point: clonePoint(value) })));

  const links = Object.freeze(normalized.links.map((link): VisualLinkGeometry3D => {
    const center = byKey.get(link.key)!;
    const startPole = byKey.get(link.startKey)!;
    const endPole = byKey.get(link.endKey)!;
    const arcs = semanticArcs(
      center,
      startPole,
      endPole,
      link.startKey === link.key,
      link.endKey === link.key,
    );
    return Object.freeze({
      key: link.key,
      startKey: link.startKey,
      endKey: link.endKey,
      center: clonePoint(center),
      start: arcs.start,
      end: arcs.end,
    });
  }));

  return Object.freeze({ positions: normalizedPositions, links });
}
