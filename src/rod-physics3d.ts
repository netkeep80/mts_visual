import {
  normalizeVisualLinkNetwork,
  type VisualKey,
  type VisualLinkNetwork,
} from "./index.js";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const EPSILON = 1e-12;

export interface IndexedRodTopology3D {
  readonly linkCount: number;
  readonly startIndices: Uint32Array;
  readonly endIndices: Uint32Array;
}

export interface VisualRodPhysicalModel3D extends IndexedRodTopology3D {
  readonly keys: readonly VisualKey[];
}

export interface RodPhysics3DState {
  readonly centers: Float32Array;
  readonly velocities: Float32Array;
}

export interface InitialRodPhysics3DOptions {
  readonly radius?: number;
}

export interface RodPhysics3DOptions {
  readonly restLength?: number;
  readonly axialStiffness?: number;
  readonly bendingStiffness?: number;
  readonly damping?: number;
  readonly timeStep?: number;
  readonly maxVelocity?: number;
  readonly maxStep?: number;
  readonly coordinateBound?: number;
}

export interface RodPhysics3DEvaluations {
  readonly rods: number;
  readonly attachments: number;
  readonly bends: number;
  readonly selfAttachments: number;
  readonly pairwise: 0;
}

export interface RodPhysicalForceResult3D {
  readonly forces: Float32Array;
  readonly evaluations: RodPhysics3DEvaluations;
}

export type RodPhysics3DErrorCode =
  | "invalid-topology-length"
  | "invalid-topology-index"
  | "invalid-state-length"
  | "non-finite-state"
  | "invalid-option"
  | "non-finite-force";

export class RodPhysics3DError extends Error {
  readonly code: RodPhysics3DErrorCode;
  readonly detail: string;

  constructor(code: RodPhysics3DErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "RodPhysics3DError";
    this.code = code;
    this.detail = detail;
  }
}

interface ResolvedRodPhysics3DOptions {
  readonly restLength: number;
  readonly axialStiffness: number;
  readonly bendingStiffness: number;
  readonly damping: number;
  readonly timeStep: number;
  readonly maxVelocity: number;
  readonly maxStep: number;
  readonly coordinateBound: number;
}

const DEFAULTS: ResolvedRodPhysics3DOptions = Object.freeze({
  restLength: 2,
  axialStiffness: 0.055,
  bendingStiffness: 0.02,
  damping: 0.86,
  timeStep: 0.2,
  maxVelocity: 1.5,
  maxStep: 0.25,
  coordinateBound: 50,
});

function resolvedOptions(options: RodPhysics3DOptions): ResolvedRodPhysics3DOptions {
  const value = { ...DEFAULTS, ...options };
  const invalid = (name: keyof ResolvedRodPhysics3DOptions, condition: boolean): void => {
    const current = value[name];
    if (!Number.isFinite(current) || condition) throw new RodPhysics3DError("invalid-option", String(name));
  };
  invalid("restLength", value.restLength <= 0);
  invalid("axialStiffness", value.axialStiffness < 0);
  invalid("bendingStiffness", value.bendingStiffness < 0);
  invalid("damping", value.damping < 0 || value.damping > 1);
  invalid("timeStep", value.timeStep <= 0);
  invalid("maxVelocity", value.maxVelocity <= 0);
  invalid("maxStep", value.maxStep <= 0);
  invalid("coordinateBound", value.coordinateBound <= 0);
  return value;
}

function exactVectorLength(topology: IndexedRodTopology3D): number {
  return topology.linkCount * 3;
}

function validateState(topology: IndexedRodTopology3D, state: RodPhysics3DState): void {
  const expected = exactVectorLength(topology);
  if (state.centers.length !== expected || state.velocities.length !== expected) {
    throw new RodPhysics3DError("invalid-state-length", `${state.centers.length}/${state.velocities.length} != ${expected}`);
  }
  for (let index = 0; index < expected; index += 1) {
    if (!Number.isFinite(state.centers[index]!) || !Number.isFinite(state.velocities[index]!)) {
      throw new RodPhysics3DError("non-finite-state", String(index));
    }
  }
}

function validateOutput(topology: IndexedRodTopology3D, values: Float32Array, detail: string): void {
  const expected = exactVectorLength(topology);
  if (values.length !== expected) throw new RodPhysics3DError("invalid-state-length", `${detail}:${values.length} != ${expected}`);
}

export function createIndexedRodTopology3D(
  startIndices: ArrayLike<number>,
  endIndices: ArrayLike<number>,
): IndexedRodTopology3D {
  if (startIndices.length !== endIndices.length) {
    throw new RodPhysics3DError("invalid-topology-length", `${startIndices.length} != ${endIndices.length}`);
  }
  const linkCount = startIndices.length;
  const starts = new Uint32Array(linkCount);
  const ends = new Uint32Array(linkCount);
  for (let index = 0; index < linkCount; index += 1) {
    const start = startIndices[index]!;
    const end = endIndices[index]!;
    if (!Number.isInteger(start) || start < 0 || start >= linkCount) {
      throw new RodPhysics3DError("invalid-topology-index", `start[${index}]=${start}`);
    }
    if (!Number.isInteger(end) || end < 0 || end >= linkCount) {
      throw new RodPhysics3DError("invalid-topology-index", `end[${index}]=${end}`);
    }
    starts[index] = start;
    ends[index] = end;
  }
  return Object.freeze({ linkCount, startIndices: starts, endIndices: ends });
}

export function buildRodPhysicalModel3D(network: VisualLinkNetwork): VisualRodPhysicalModel3D {
  const normalized = normalizeVisualLinkNetwork(network);
  const keys = Object.freeze(normalized.links.map((link) => link.key));
  const byKey = new Map(keys.map((key, index) => [key, index] as const));
  const starts = new Uint32Array(keys.length);
  const ends = new Uint32Array(keys.length);
  for (let index = 0; index < normalized.links.length; index += 1) {
    const link = normalized.links[index]!;
    starts[index] = byKey.get(link.startKey)!;
    ends[index] = byKey.get(link.endKey)!;
  }
  return Object.freeze({ linkCount: keys.length, keys, startIndices: starts, endIndices: ends });
}

export function createInitialRodPhysics3DState(
  topology: IndexedRodTopology3D,
  options: InitialRodPhysics3DOptions = {},
): RodPhysics3DState {
  const radius = options.radius ?? 3;
  if (!Number.isFinite(radius) || radius <= 0) throw new RodPhysics3DError("invalid-option", "radius");
  const centers = new Float32Array(exactVectorLength(topology));
  const velocities = new Float32Array(centers.length);
  if (topology.linkCount === 1) return { centers, velocities };
  for (let index = 0; index < topology.linkCount; index += 1) {
    const z = 1 - (2 * (index + 0.5)) / topology.linkCount;
    const radial = Math.sqrt(Math.max(0, 1 - z * z));
    const angle = GOLDEN_ANGLE * index;
    const offset = index * 3;
    centers[offset] = radius * radial * Math.cos(angle);
    centers[offset + 1] = radius * radial * Math.sin(angle);
    centers[offset + 2] = radius * z;
  }
  return { centers, velocities };
}

function addForce(forces: Float32Array, index: number, x: number, y: number, z: number): void {
  const offset = index * 3;
  forces[offset] = forces[offset]! + x;
  forces[offset + 1] = forces[offset + 1]! + y;
  forces[offset + 2] = forces[offset + 2]! + z;
}

function deterministicDirection(seed: number): readonly [number, number, number] {
  let hash = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  const x = ((hash & 1023) / 511.5) - 1;
  const y = (((hash >>> 10) & 1023) / 511.5) - 1;
  const z = (((hash >>> 20) & 1023) / 511.5) - 1;
  const length = Math.hypot(x, y, z);
  return length > EPSILON ? [x / length, y / length, z / length] : [1, 0, 0];
}

function axialConstraint(
  centers: Float32Array,
  forces: Float32Array,
  left: number,
  right: number,
  restLength: number,
  stiffness: number,
  seed: number,
): void {
  if (left === right || stiffness === 0) return;
  const leftOffset = left * 3;
  const rightOffset = right * 3;
  const dx = centers[rightOffset]! - centers[leftOffset]!;
  const dy = centers[rightOffset + 1]! - centers[leftOffset + 1]!;
  const dz = centers[rightOffset + 2]! - centers[leftOffset + 2]!;
  const distance = Math.hypot(dx, dy, dz);
  let ux: number;
  let uy: number;
  let uz: number;
  if (distance > EPSILON) {
    const inverse = 1 / distance;
    ux = dx * inverse;
    uy = dy * inverse;
    uz = dz * inverse;
  } else {
    [ux, uy, uz] = deterministicDirection(seed);
  }
  const magnitude = stiffness * (distance - restLength);
  const fx = ux * magnitude;
  const fy = uy * magnitude;
  const fz = uz * magnitude;
  addForce(forces, left, fx, fy, fz);
  addForce(forces, right, -fx, -fy, -fz);
}

function bendConstraint(
  centers: Float32Array,
  forces: Float32Array,
  start: number,
  center: number,
  end: number,
  stiffness: number,
): void {
  if (stiffness === 0 || start === center || end === center) return;
  const startOffset = start * 3;
  const centerOffset = center * 3;
  const endOffset = end * 3;
  const bx = centers[startOffset]! - 2 * centers[centerOffset]! + centers[endOffset]!;
  const by = centers[startOffset + 1]! - 2 * centers[centerOffset + 1]! + centers[endOffset + 1]!;
  const bz = centers[startOffset + 2]! - 2 * centers[centerOffset + 2]! + centers[endOffset + 2]!;
  const fx = stiffness * bx;
  const fy = stiffness * by;
  const fz = stiffness * bz;
  addForce(forces, start, -fx, -fy, -fz);
  addForce(forces, center, 2 * fx, 2 * fy, 2 * fz);
  addForce(forces, end, -fx, -fy, -fz);
}

function computeForcesIntoResolved(
  topology: IndexedRodTopology3D,
  state: RodPhysics3DState,
  forces: Float32Array,
  options: ResolvedRodPhysics3DOptions,
): RodPhysics3DEvaluations {
  validateState(topology, state);
  validateOutput(topology, forces, "forces");
  forces.fill(0);
  const halfRestLength = options.restLength / 2;
  let selfAttachments = 0;
  for (let rod = 0; rod < topology.linkCount; rod += 1) {
    const start = topology.startIndices[rod]!;
    const end = topology.endIndices[rod]!;
    if (start === rod) selfAttachments += 1;
    if (end === rod) selfAttachments += 1;
    axialConstraint(state.centers, forces, start, rod, halfRestLength, options.axialStiffness, rod * 2 + 1);
    axialConstraint(state.centers, forces, rod, end, halfRestLength, options.axialStiffness, rod * 2 + 2);
    bendConstraint(state.centers, forces, start, rod, end, options.bendingStiffness);
  }
  for (let index = 0; index < forces.length; index += 1) {
    if (!Number.isFinite(forces[index]!)) throw new RodPhysics3DError("non-finite-force", String(index));
  }
  return Object.freeze({
    rods: topology.linkCount,
    attachments: topology.linkCount * 2,
    bends: topology.linkCount,
    selfAttachments,
    pairwise: 0 as const,
  });
}

export function computeRodPhysicalForces3DInto(
  topology: IndexedRodTopology3D,
  state: RodPhysics3DState,
  forces: Float32Array,
  options: RodPhysics3DOptions = {},
): RodPhysics3DEvaluations {
  return computeForcesIntoResolved(topology, state, forces, resolvedOptions(options));
}

export function computeRodPhysicalForces3D(
  topology: IndexedRodTopology3D,
  state: RodPhysics3DState,
  options: RodPhysics3DOptions = {},
): RodPhysicalForceResult3D {
  const forces = new Float32Array(exactVectorLength(topology));
  const evaluations = computeForcesIntoResolved(topology, state, forces, resolvedOptions(options));
  return { forces, evaluations };
}

function clampMagnitude3(x: number, y: number, z: number, maximum: number): readonly [number, number, number] {
  const length = Math.hypot(x, y, z);
  if (length <= maximum || length <= EPSILON) return [x, y, z];
  const scale = maximum / length;
  return [x * scale, y * scale, z * scale];
}

function clamp(value: number, bound: number): number {
  return Math.max(-bound, Math.min(bound, value));
}

export function stepRodPhysics3DInto(
  topology: IndexedRodTopology3D,
  state: RodPhysics3DState,
  nextState: RodPhysics3DState,
  scratchForces: Float32Array,
  options: RodPhysics3DOptions = {},
): RodPhysics3DEvaluations {
  const resolved = resolvedOptions(options);
  validateState(topology, state);
  validateState(topology, nextState);
  validateOutput(topology, scratchForces, "scratchForces");
  const evaluations = computeForcesIntoResolved(topology, state, scratchForces, resolved);
  for (let index = 0; index < topology.linkCount; index += 1) {
    const offset = index * 3;
    let vx = (state.velocities[offset]! + scratchForces[offset]! * resolved.timeStep) * resolved.damping;
    let vy = (state.velocities[offset + 1]! + scratchForces[offset + 1]! * resolved.timeStep) * resolved.damping;
    let vz = (state.velocities[offset + 2]! + scratchForces[offset + 2]! * resolved.timeStep) * resolved.damping;
    [vx, vy, vz] = clampMagnitude3(vx, vy, vz, resolved.maxVelocity);
    let dx = vx * resolved.timeStep;
    let dy = vy * resolved.timeStep;
    let dz = vz * resolved.timeStep;
    const unclamped = Math.hypot(dx, dy, dz);
    [dx, dy, dz] = clampMagnitude3(dx, dy, dz, resolved.maxStep);
    if (Math.hypot(dx, dy, dz) + EPSILON < unclamped) {
      vx = dx / resolved.timeStep;
      vy = dy / resolved.timeStep;
      vz = dz / resolved.timeStep;
    }
    nextState.centers[offset] = clamp(state.centers[offset]! + dx, resolved.coordinateBound);
    nextState.centers[offset + 1] = clamp(state.centers[offset + 1]! + dy, resolved.coordinateBound);
    nextState.centers[offset + 2] = clamp(state.centers[offset + 2]! + dz, resolved.coordinateBound);
    nextState.velocities[offset] = vx;
    nextState.velocities[offset + 1] = vy;
    nextState.velocities[offset + 2] = vz;
  }
  return evaluations;
}

export function stepRodPhysics3D(
  topology: IndexedRodTopology3D,
  state: RodPhysics3DState,
  options: RodPhysics3DOptions = {},
): RodPhysics3DState {
  const nextState: RodPhysics3DState = {
    centers: new Float32Array(exactVectorLength(topology)),
    velocities: new Float32Array(exactVectorLength(topology)),
  };
  const scratchForces = new Float32Array(exactVectorLength(topology));
  stepRodPhysics3DInto(topology, state, nextState, scratchForces, options);
  return nextState;
}
