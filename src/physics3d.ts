import {
  normalizeVisualLinkNetwork,
  type VisualKey,
  type VisualLinkNetwork,
} from "./index.js";
import type { Point3D, VisualPosition3D } from "./geometry3d.js";

// Pure presentation physics adapted from:
// netkeep80/anum_parser@48b5909d19490d9b27904bfc087ee0e86868fbd8/src/physics3d.js
// Parser DTOs, root pinning, depth force, live state, and renderer concerns are excluded.

const EPSILON = 1e-12;

export interface PhysicalSpring3D {
  readonly linkKey: VisualKey;
  readonly role: "start" | "end";
  readonly sourceKey: VisualKey;
  readonly targetKey: VisualKey;
}

export interface PhysicalModel3D {
  readonly keys: readonly VisualKey[];
  readonly springs: readonly PhysicalSpring3D[];
}

export interface VisualVelocity3D {
  readonly key: VisualKey;
  readonly vector: Point3D;
}

export interface Physics3DState {
  readonly positions: readonly VisualPosition3D[];
  readonly velocities: readonly VisualVelocity3D[];
}

export interface Physics3DOptions {
  readonly restLength?: number;
  readonly springStiffness?: number;
  readonly charge?: number;
  readonly softening?: number;
  readonly minimumDistance?: number;
  readonly damping?: number;
  readonly timeStep?: number;
  readonly maxVelocity?: number;
  readonly maxStep?: number;
  readonly coordinateBound?: number;
}

export type Physics3DErrorCode =
  | "invalid-option"
  | "missing-position"
  | "extra-position"
  | "duplicate-position"
  | "non-finite-position"
  | "missing-velocity"
  | "extra-velocity"
  | "duplicate-velocity"
  | "non-finite-velocity";

export class Physics3DError extends Error {
  readonly code: Physics3DErrorCode;
  readonly detail: string;

  constructor(code: Physics3DErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "Physics3DError";
    this.code = code;
    this.detail = detail;
  }
}

export interface PhysicalForce3D {
  readonly key: VisualKey;
  readonly vector: Point3D;
}

export interface PhysicalForceResult3D {
  readonly forces: readonly PhysicalForce3D[];
  readonly evaluations: Readonly<{ springs: number; chargePairs: number }>;
}

interface NormalizedPhysics3DOptions {
  readonly restLength: number;
  readonly springStiffness: number;
  readonly charge: number;
  readonly softening: number;
  readonly minimumDistance: number;
  readonly damping: number;
  readonly timeStep: number;
  readonly maxVelocity: number;
  readonly maxStep: number;
  readonly coordinateBound: number;
}

const DEFAULTS: NormalizedPhysics3DOptions = Object.freeze({
  restLength: 2,
  springStiffness: 0.055,
  charge: 1,
  softening: 0.35,
  minimumDistance: 0.2,
  damping: 0.86,
  timeStep: 0.2,
  maxVelocity: 1.5,
  maxStep: 0.25,
  coordinateBound: 50,
});

function point(x: number, y: number, z: number): Point3D {
  return Object.freeze({ x, y, z });
}

function clone(value: Point3D): Point3D {
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

function norm(value: Point3D): number {
  return Math.hypot(value.x, value.y, value.z);
}

function finite(value: Point3D): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function normalize(value: Point3D): Point3D | undefined {
  const length = norm(value);
  return Number.isFinite(length) && length > EPSILON ? scale(value, 1 / length) : undefined;
}

function clampMagnitude(value: Point3D, maximum: number): Point3D {
  const length = norm(value);
  return length > maximum && length > EPSILON ? scale(value, maximum / length) : clone(value);
}

function clampCoordinate(value: Point3D, bound: number): Point3D {
  return point(
    Math.max(-bound, Math.min(bound, value.x)),
    Math.max(-bound, Math.min(bound, value.y)),
    Math.max(-bound, Math.min(bound, value.z)),
  );
}

function stableUnit(key: string): Point3D {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const x = ((hash & 1023) / 511.5) - 1;
  const y = (((hash >>> 10) & 1023) / 511.5) - 1;
  const z = (((hash >>> 20) & 1023) / 511.5) - 1;
  return normalize(point(x, y, z)) ?? point(1, 0, 0);
}

function directionBetween(
  sourceKey: VisualKey,
  targetKey: VisualKey,
  source: Point3D,
  target: Point3D,
): Readonly<{ direction: Point3D; distance: number }> {
  const delta = subtract(target, source);
  const distance = norm(delta);
  return Object.freeze({
    direction: normalize(delta) ?? stableUnit(`${sourceKey}->${targetKey}`),
    distance,
  });
}

function normalizedOptions(options: Physics3DOptions): NormalizedPhysics3DOptions {
  const value = { ...DEFAULTS, ...options };
  const invalid = (name: keyof NormalizedPhysics3DOptions, condition: boolean): void => {
    const current = value[name];
    if (!Number.isFinite(current) || condition) throw new Physics3DError("invalid-option", String(name));
  };
  invalid("restLength", value.restLength <= 0);
  invalid("springStiffness", value.springStiffness < 0);
  invalid("charge", value.charge < 0);
  invalid("softening", value.softening <= 0);
  invalid("minimumDistance", value.minimumDistance <= 0);
  invalid("damping", value.damping < 0 || value.damping > 1);
  invalid("timeStep", value.timeStep <= 0);
  invalid("maxVelocity", value.maxVelocity <= 0);
  invalid("maxStep", value.maxStep <= 0);
  invalid("coordinateBound", value.coordinateBound <= 0);
  return Object.freeze(value);
}

export function buildPhysicalModel3D(network: VisualLinkNetwork): PhysicalModel3D {
  const normalized = normalizeVisualLinkNetwork(network);
  const springs: PhysicalSpring3D[] = [];
  for (const link of normalized.links) {
    if (link.startKey !== link.key) {
      springs.push(Object.freeze({
        linkKey: link.key,
        role: "start",
        sourceKey: link.startKey,
        targetKey: link.key,
      }));
    }
    if (link.endKey !== link.key) {
      springs.push(Object.freeze({
        linkKey: link.key,
        role: "end",
        sourceKey: link.key,
        targetKey: link.endKey,
      }));
    }
  }
  return Object.freeze({
    keys: Object.freeze(normalized.links.map((link) => link.key)),
    springs: Object.freeze(springs),
  });
}

function exactVectors<T extends { readonly key: VisualKey }>(
  model: PhysicalModel3D,
  entries: readonly T[],
  select: (entry: T) => Point3D,
  kind: "position" | "velocity",
): Map<VisualKey, Point3D> {
  const allowed = new Set(model.keys);
  const result = new Map<VisualKey, Point3D>();
  for (const entry of entries) {
    const duplicateCode = kind === "position" ? "duplicate-position" : "duplicate-velocity";
    const extraCode = kind === "position" ? "extra-position" : "extra-velocity";
    const finiteCode = kind === "position" ? "non-finite-position" : "non-finite-velocity";
    if (result.has(entry.key)) throw new Physics3DError(duplicateCode, entry.key);
    if (!allowed.has(entry.key)) throw new Physics3DError(extraCode, entry.key);
    const vector = select(entry);
    if (!finite(vector)) throw new Physics3DError(finiteCode, entry.key);
    result.set(entry.key, clone(vector));
  }
  for (const key of model.keys) {
    if (!result.has(key)) {
      throw new Physics3DError(kind === "position" ? "missing-position" : "missing-velocity", key);
    }
  }
  return result;
}

function addForce(forces: Map<VisualKey, Point3D>, key: VisualKey, contribution: Point3D): void {
  forces.set(key, add(forces.get(key)!, contribution));
}

export function computePhysicalForces3D(
  model: PhysicalModel3D,
  positions: readonly VisualPosition3D[],
  options: Physics3DOptions = {},
): PhysicalForceResult3D {
  const normalized = normalizedOptions(options);
  const byKey = exactVectors(model, positions, (entry) => entry.point, "position");
  const forces = new Map(model.keys.map((key) => [key, point(0, 0, 0)] as const));
  let springEvaluations = 0;
  let chargePairs = 0;

  for (const spring of model.springs) {
    const source = byKey.get(spring.sourceKey)!;
    const target = byKey.get(spring.targetKey)!;
    const { direction, distance } = directionBetween(spring.sourceKey, spring.targetKey, source, target);
    const contribution = scale(direction, normalized.springStiffness * (distance - normalized.restLength));
    addForce(forces, spring.sourceKey, contribution);
    addForce(forces, spring.targetKey, scale(contribution, -1));
    springEvaluations += 1;
  }

  for (let left = 0; left < model.keys.length; left += 1) {
    const leftKey = model.keys[left]!;
    const leftPosition = byKey.get(leftKey)!;
    for (let right = left + 1; right < model.keys.length; right += 1) {
      const rightKey = model.keys[right]!;
      const rightPosition = byKey.get(rightKey)!;
      const raw = subtract(leftPosition, rightPosition);
      const distance = norm(raw);
      const direction = normalize(raw) ?? stableUnit(`${rightKey}|${leftKey}`);
      const guarded = Math.max(normalized.minimumDistance, distance);
      const denominator = guarded * guarded + normalized.softening * normalized.softening;
      const contribution = scale(direction, normalized.charge * normalized.charge / denominator);
      addForce(forces, leftKey, contribution);
      addForce(forces, rightKey, scale(contribution, -1));
      chargePairs += 1;
    }
  }

  return Object.freeze({
    forces: Object.freeze(model.keys.map((key) => Object.freeze({ key, vector: clone(forces.get(key)!) }))),
    evaluations: Object.freeze({ springs: springEvaluations, chargePairs }),
  });
}

export function stepPhysics3D(
  model: PhysicalModel3D,
  state: Physics3DState,
  options: Physics3DOptions = {},
): Physics3DState {
  const normalized = normalizedOptions(options);
  const positions = exactVectors(model, state.positions, (entry) => entry.point, "position");
  const velocities = exactVectors(model, state.velocities, (entry) => entry.vector, "velocity");
  const forceResult = computePhysicalForces3D(model, state.positions, normalized);
  const forces = new Map(forceResult.forces.map((entry) => [entry.key, entry.vector] as const));
  const nextPositions: VisualPosition3D[] = [];
  const nextVelocities: VisualVelocity3D[] = [];

  for (const key of model.keys) {
    let velocity = add(velocities.get(key)!, scale(forces.get(key)!, normalized.timeStep));
    velocity = clampMagnitude(scale(velocity, normalized.damping), normalized.maxVelocity);
    let displacement = scale(velocity, normalized.timeStep);
    const unclamped = norm(displacement);
    displacement = clampMagnitude(displacement, normalized.maxStep);
    if (norm(displacement) + EPSILON < unclamped) velocity = scale(displacement, 1 / normalized.timeStep);
    const next = clampCoordinate(add(positions.get(key)!, displacement), normalized.coordinateBound);
    if (!finite(next) || !finite(velocity)) throw new Physics3DError("non-finite-position", key);
    nextPositions.push(Object.freeze({ key, point: clone(next) }));
    nextVelocities.push(Object.freeze({ key, vector: clone(velocity) }));
  }

  return Object.freeze({
    positions: Object.freeze(nextPositions),
    velocities: Object.freeze(nextVelocities),
  });
}
