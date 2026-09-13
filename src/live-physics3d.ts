import type { Point3D } from "./geometry3d.js";
import {
  normalizeVisualLinkNetwork,
  type VisualKey,
  type VisualLinkNetwork,
} from "./index.js";
import {
  Physics3DError,
  buildPhysicalModel3D,
  createInitialPhysics3DState,
  stepPhysics3D,
  type PhysicalModel3D,
  type Physics3DOptions,
  type Physics3DState,
  type VisualVelocity3D,
} from "./physics3d.js";

// Stateful presentation controller adapted from:
// netkeep80/anum_parser@48b5909d19490d9b27904bfc087ee0e86868fbd8/src/live-physics3d.js
// Root inference, depth/potential metrics, renderer/browser state, random and wall clock are excluded.

const DEFAULT_SETTLE_VELOCITY = 0.01;
const DEFAULT_SETTLE_POSITION_DELTA = 0.002;
const DEFAULT_SETTLE_WINDOW = 8;
const TOPOLOGY_SEED_OFFSET = 0.05;

export interface LivePhysics3DOptions extends Physics3DOptions {
  readonly settleVelocity?: number;
  readonly settlePositionDelta?: number;
  readonly settleWindow?: number;
}

export type LivePhysics3DErrorCode =
  | "invalid-live-option"
  | "invalid-physics-option"
  | "unknown-key"
  | "non-finite-vector"
  | "not-pinned";

export class LivePhysics3DError extends Error {
  readonly code: LivePhysics3DErrorCode;
  readonly detail: string;

  constructor(code: LivePhysics3DErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "LivePhysics3DError";
    this.code = code;
    this.detail = detail;
  }
}

export interface LivePhysics3DSnapshot {
  readonly state: Physics3DState;
  readonly tick: number;
  readonly awake: boolean;
  readonly stableTicks: number;
  readonly pinnedKeys: readonly VisualKey[];
  readonly maxVelocity: number;
  readonly maxPositionDelta: number;
  readonly stepped: boolean;
}

interface ResolvedLivePhysics3DOptions extends Physics3DOptions {
  readonly settleVelocity: number;
  readonly settlePositionDelta: number;
  readonly settleWindow: number;
}

export interface LivePhysics3DController {
  readonly model: PhysicalModel3D;
}

interface MutableLivePhysics3DController {
  model: PhysicalModel3D;
  state: Physics3DState;
  options: ResolvedLivePhysics3DOptions;
  readonly pinned: Map<VisualKey, Point3D>;
  awake: boolean;
  stableTicks: number;
  tick: number;
  maxVelocity: number;
  maxPositionDelta: number;
}

function point(value: Point3D): Point3D {
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
}

function zero(): Point3D {
  return Object.freeze({ x: 0, y: 0, z: 0 });
}

function finite(value: Point3D): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function norm(value: Point3D): number {
  return Math.hypot(value.x, value.y, value.z);
}

function cloneState(state: Physics3DState): Physics3DState {
  return Object.freeze({
    positions: Object.freeze(state.positions.map((entry) => Object.freeze({ key: entry.key, point: point(entry.point) }))),
    velocities: Object.freeze(state.velocities.map((entry) => Object.freeze({ key: entry.key, vector: point(entry.vector) }))),
  });
}

function resolvedOptions(options: LivePhysics3DOptions): ResolvedLivePhysics3DOptions {
  const settleVelocity = options.settleVelocity ?? DEFAULT_SETTLE_VELOCITY;
  const settlePositionDelta = options.settlePositionDelta ?? DEFAULT_SETTLE_POSITION_DELTA;
  const settleWindow = options.settleWindow ?? DEFAULT_SETTLE_WINDOW;
  if (!Number.isFinite(settleVelocity) || settleVelocity < 0) {
    throw new LivePhysics3DError("invalid-live-option", "settleVelocity");
  }
  if (!Number.isFinite(settlePositionDelta) || settlePositionDelta < 0) {
    throw new LivePhysics3DError("invalid-live-option", "settlePositionDelta");
  }
  if (!Number.isInteger(settleWindow) || settleWindow <= 0) {
    throw new LivePhysics3DError("invalid-live-option", "settleWindow");
  }
  return Object.freeze({ ...options, settleVelocity, settlePositionDelta, settleWindow });
}

function physicsOptions(options: ResolvedLivePhysics3DOptions): Physics3DOptions {
  const { settleVelocity: _velocity, settlePositionDelta: _delta, settleWindow: _window, ...physics } = options;
  return physics;
}

function validatePhysics(
  model: PhysicalModel3D,
  state: Physics3DState,
  options: ResolvedLivePhysics3DOptions,
): void {
  try {
    stepPhysics3D(model, state, physicsOptions(options));
  } catch (error) {
    if (error instanceof Physics3DError && error.code === "invalid-option") {
      throw new LivePhysics3DError("invalid-physics-option", error.detail);
    }
    throw error;
  }
}

function mutable(controller: LivePhysics3DController): MutableLivePhysics3DController {
  return controller as MutableLivePhysics3DController;
}

function requireKey(controller: MutableLivePhysics3DController, key: VisualKey): void {
  if (!controller.model.keys.includes(key)) throw new LivePhysics3DError("unknown-key", key);
}

function requireFinite(value: Point3D, detail: string): void {
  if (!finite(value)) throw new LivePhysics3DError("non-finite-vector", detail);
}

function replaceStateVector(
  controller: MutableLivePhysics3DController,
  key: VisualKey,
  position?: Point3D,
  velocity?: Point3D,
): void {
  controller.state = Object.freeze({
    positions: Object.freeze(controller.state.positions.map((entry) =>
      entry.key === key
        ? Object.freeze({ key, point: point(position ?? entry.point) })
        : Object.freeze({ key: entry.key, point: point(entry.point) }))),
    velocities: Object.freeze(controller.state.velocities.map((entry) =>
      entry.key === key
        ? Object.freeze({ key, vector: point(velocity ?? entry.vector) })
        : Object.freeze({ key: entry.key, vector: point(entry.vector) }))),
  });
}

function constrainPins(
  controller: MutableLivePhysics3DController,
  stepped: Physics3DState,
): Physics3DState {
  if (controller.pinned.size === 0) return stepped;
  return Object.freeze({
    positions: Object.freeze(stepped.positions.map((entry) => {
      const pinned = controller.pinned.get(entry.key);
      return Object.freeze({ key: entry.key, point: point(pinned ?? entry.point) });
    })),
    velocities: Object.freeze(stepped.velocities.map((entry) => Object.freeze({
      key: entry.key,
      vector: point(controller.pinned.has(entry.key) ? zero() : entry.vector),
    }))),
  });
}

function metrics(previous: Physics3DState, next: Physics3DState): Readonly<{
  maxVelocity: number;
  maxPositionDelta: number;
}> {
  const previousPositions = new Map(previous.positions.map((entry) => [entry.key, entry.point] as const));
  let maxVelocity = 0;
  let maxPositionDelta = 0;
  for (const entry of next.velocities) maxVelocity = Math.max(maxVelocity, norm(entry.vector));
  for (const entry of next.positions) {
    const before = previousPositions.get(entry.key)!;
    maxPositionDelta = Math.max(maxPositionDelta, Math.hypot(
      entry.point.x - before.x,
      entry.point.y - before.y,
      entry.point.z - before.z,
    ));
  }
  return Object.freeze({ maxVelocity, maxPositionDelta });
}

function samePhysicalTopology(left: PhysicalModel3D, right: PhysicalModel3D): boolean {
  if (left.keys.length !== right.keys.length || left.springs.length !== right.springs.length) return false;
  for (let index = 0; index < left.keys.length; index += 1) {
    if (left.keys[index] !== right.keys[index]) return false;
  }
  for (let index = 0; index < left.springs.length; index += 1) {
    const previous = left.springs[index]!;
    const next = right.springs[index]!;
    if (
      previous.linkKey !== next.linkKey
      || previous.role !== next.role
      || previous.sourceKey !== next.sourceKey
      || previous.targetKey !== next.targetKey
    ) return false;
  }
  return true;
}

function transitionState(
  controller: MutableLivePhysics3DController,
  network: VisualLinkNetwork,
  model: PhysicalModel3D,
): Physics3DState {
  const fallback = createInitialPhysics3DState(network);
  const fallbackPositions = new Map(fallback.positions.map((entry) => [entry.key, entry.point] as const));
  const previousPositions = new Map(controller.state.positions.map((entry) => [entry.key, entry.point] as const));
  const previousVelocities = new Map(controller.state.velocities.map((entry) => [entry.key, entry.vector] as const));
  const positions = new Map<VisualKey, Point3D>();
  const unresolved = new Set<VisualKey>();

  for (const key of model.keys) {
    const retained = previousPositions.get(key);
    if (retained === undefined) unresolved.add(key);
    else positions.set(key, point(retained));
  }

  let progress = true;
  while (progress && unresolved.size > 0) {
    progress = false;
    for (const link of network.links) {
      if (!unresolved.has(link.key)) continue;
      const start = positions.get(link.startKey);
      const end = positions.get(link.endKey);
      if (start === undefined || end === undefined) continue;
      const fallbackPoint = fallbackPositions.get(link.key)!;
      positions.set(link.key, point({
        x: (start.x + end.x) / 2 + fallbackPoint.x * TOPOLOGY_SEED_OFFSET,
        y: (start.y + end.y) / 2 + fallbackPoint.y * TOPOLOGY_SEED_OFFSET,
        z: (start.z + end.z) / 2 + fallbackPoint.z * TOPOLOGY_SEED_OFFSET,
      }));
      unresolved.delete(link.key);
      progress = true;
    }
  }

  for (const key of unresolved) positions.set(key, point(fallbackPositions.get(key)!));

  return cloneState({
    positions: model.keys.map((key) => ({ key, point: positions.get(key)! })),
    velocities: model.keys.map((key) => ({
      key,
      vector: previousVelocities.has(key) ? previousVelocities.get(key)! : zero(),
    })),
  });
}

function retainedPins(
  controller: MutableLivePhysics3DController,
  model: PhysicalModel3D,
): Map<VisualKey, Point3D> {
  const pins = new Map<VisualKey, Point3D>();
  for (const key of model.keys) {
    const pinned = controller.pinned.get(key);
    if (pinned !== undefined) pins.set(key, point(pinned));
  }
  return pins;
}

function snapshot(controller: MutableLivePhysics3DController, stepped: boolean): LivePhysics3DSnapshot {
  return Object.freeze({
    state: cloneState(controller.state),
    tick: controller.tick,
    awake: controller.awake,
    stableTicks: controller.stableTicks,
    pinnedKeys: Object.freeze(controller.model.keys.filter((key) => controller.pinned.has(key))),
    maxVelocity: controller.maxVelocity,
    maxPositionDelta: controller.maxPositionDelta,
    stepped,
  });
}

export function createLivePhysics3D(
  network: VisualLinkNetwork,
  initialState: Physics3DState,
  options: LivePhysics3DOptions = {},
): LivePhysics3DController {
  const model = buildPhysicalModel3D(network);
  const resolved = resolvedOptions(options);
  validatePhysics(model, initialState, resolved);
  return {
    model,
    state: cloneState(initialState),
    options: resolved,
    pinned: new Map(),
    awake: model.keys.length > 0,
    stableTicks: 0,
    tick: 0,
    maxVelocity: 0,
    maxPositionDelta: 0,
  } as MutableLivePhysics3DController;
}

export function transitionLivePhysics3DNetwork(
  controller: LivePhysics3DController,
  nextNetwork: VisualLinkNetwork,
): LivePhysics3DSnapshot {
  const value = mutable(controller);
  const normalized = normalizeVisualLinkNetwork(nextNetwork);
  const nextModel = buildPhysicalModel3D(normalized);
  const nextState = transitionState(value, normalized, nextModel);
  const nextPins = retainedPins(value, nextModel);
  validatePhysics(nextModel, nextState, value.options);
  const topologyChanged = !samePhysicalTopology(value.model, nextModel);

  value.model = nextModel;
  value.state = nextState;
  value.pinned.clear();
  for (const [key, pinned] of nextPins) value.pinned.set(key, pinned);
  if (topologyChanged) {
    value.awake = nextModel.keys.length > 0;
    value.stableTicks = 0;
    value.maxVelocity = 0;
    value.maxPositionDelta = 0;
  }
  return snapshot(value, false);
}

export function wakeLivePhysics3D(controller: LivePhysics3DController): boolean {
  const value = mutable(controller);
  value.awake = value.model.keys.length > 0;
  value.stableTicks = 0;
  return value.awake;
}

export function sleepLivePhysics3D(controller: LivePhysics3DController): false {
  mutable(controller).awake = false;
  return false;
}

export function setLivePhysics3DOptions(
  controller: LivePhysics3DController,
  patch: LivePhysics3DOptions,
): LivePhysics3DOptions {
  const value = mutable(controller);
  const candidate = resolvedOptions({ ...value.options, ...patch });
  validatePhysics(value.model, value.state, candidate);
  value.options = candidate;
  wakeLivePhysics3D(value);
  return candidate;
}

export function pinLivePhysics3D(
  controller: LivePhysics3DController,
  key: VisualKey,
  position: Point3D,
): void {
  const value = mutable(controller);
  requireKey(value, key);
  requireFinite(position, key);
  const pinned = point(position);
  value.pinned.set(key, pinned);
  replaceStateVector(value, key, pinned, zero());
  wakeLivePhysics3D(value);
}

export function movePinnedLivePhysics3D(
  controller: LivePhysics3DController,
  key: VisualKey,
  position: Point3D,
): void {
  const value = mutable(controller);
  requireKey(value, key);
  requireFinite(position, key);
  if (!value.pinned.has(key)) throw new LivePhysics3DError("not-pinned", key);
  const pinned = point(position);
  value.pinned.set(key, pinned);
  replaceStateVector(value, key, pinned, zero());
  wakeLivePhysics3D(value);
}

export function releaseLivePhysics3D(
  controller: LivePhysics3DController,
  key: VisualKey,
  velocity: Point3D = zero(),
): void {
  const value = mutable(controller);
  requireKey(value, key);
  requireFinite(velocity, key);
  if (!value.pinned.has(key)) throw new LivePhysics3DError("not-pinned", key);
  value.pinned.delete(key);
  replaceStateVector(value, key, undefined, velocity);
  wakeLivePhysics3D(value);
}

export function isLivePhysics3DPinned(controller: LivePhysics3DController, key: VisualKey): boolean {
  const value = mutable(controller);
  requireKey(value, key);
  return value.pinned.has(key);
}

export function stepLivePhysics3D(controller: LivePhysics3DController): LivePhysics3DSnapshot {
  const value = mutable(controller);
  if (!value.awake) return snapshot(value, false);
  const previous = value.state;
  const stepped = stepPhysics3D(value.model, previous, physicsOptions(value.options));
  value.state = constrainPins(value, stepped);
  const motion = metrics(previous, value.state);
  value.maxVelocity = motion.maxVelocity;
  value.maxPositionDelta = motion.maxPositionDelta;
  if (
    motion.maxVelocity <= value.options.settleVelocity
    && motion.maxPositionDelta <= value.options.settlePositionDelta
  ) value.stableTicks += 1;
  else value.stableTicks = 0;
  value.tick += 1;
  if (value.stableTicks >= value.options.settleWindow) value.awake = false;
  return snapshot(value, true);
}

export function snapshotLivePhysics3D(controller: LivePhysics3DController): LivePhysics3DSnapshot {
  return snapshot(mutable(controller), false);
}
