import {
  type Point3D,
  type VisualLinkNetwork,
  type VisualPosition3D,
} from "../src/index.js";
import {
  buildPhysicalModel3D,
  stepPhysics3D,
  type Physics3DState,
  type VisualVelocity3D,
} from "../src/physics3d.js";
import {
  LivePhysics3DError,
  createLivePhysics3D,
  isLivePhysics3DPinned,
  movePinnedLivePhysics3D,
  pinLivePhysics3D,
  releaseLivePhysics3D,
  setLivePhysics3DOptions,
  sleepLivePhysics3D,
  snapshotLivePhysics3D,
  stepLivePhysics3D,
  transitionLivePhysics3DNetwork,
  wakeLivePhysics3D,
  type LivePhysics3DController,
} from "../src/live-physics3d.js";

type LiveErrorCode =
  | "invalid-live-option"
  | "invalid-physics-option"
  | "unknown-key"
  | "non-finite-vector"
  | "not-pinned";

type SnapshotProbe = Readonly<{
  state: Physics3DState;
  tick: number;
  awake: boolean;
  stableTicks: number;
  pinnedKeys: readonly string[];
  maxVelocity: number;
  maxPositionDelta: number;
  stepped?: boolean;
}>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V2e: ${message}`);
}

function same(actual: unknown, expected: unknown, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function deepSame(actual: unknown, expected: unknown, message: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  assert(left === right, `${message}: ${left} !== ${right}`);
}

function point(x: number, y: number, z: number): Point3D {
  return { x, y, z };
}

function position(key: string, x: number, y: number, z: number): VisualPosition3D {
  return { key, point: point(x, y, z) };
}

function velocity(key: string, x: number, y: number, z: number): VisualVelocity3D {
  return { key, vector: point(x, y, z) };
}

function state(
  positions: readonly VisualPosition3D[],
  velocities: readonly VisualVelocity3D[],
): Physics3DState {
  return { positions, velocities };
}

function snapshot(controller: LivePhysics3DController): SnapshotProbe {
  return snapshotLivePhysics3D(controller) as SnapshotProbe;
}

function positionOf(value: SnapshotProbe | Physics3DState, key: string): Point3D {
  const source = "state" in value ? value.state.positions : value.positions;
  const entry = source.find((candidate: VisualPosition3D) => candidate.key === key);
  assert(entry !== undefined, `missing position ${key}`);
  return entry.point;
}

function velocityOf(value: SnapshotProbe | Physics3DState, key: string): Point3D {
  const source = "state" in value ? value.state.velocities : value.velocities;
  const entry = source.find((candidate: VisualVelocity3D) => candidate.key === key);
  assert(entry !== undefined, `missing velocity ${key}`);
  return entry.vector;
}

function norm(value: Point3D): number {
  return Math.hypot(value.x, value.y, value.z);
}

function expectLiveCode(effect: () => unknown, code: LiveErrorCode, message: string): void {
  try {
    effect();
  } catch (error) {
    assert(error instanceof LivePhysics3DError, `${message}: wrong error type`);
    const coded = error as { readonly code?: unknown };
    same(coded.code, code, `${message}: wrong error code`);
    return;
  }
  throw new Error(`@mts/visual V2e: ${message}: expected rejection`);
}

const pairNetwork: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "A" },
    { key: "B", startKey: "B", endKey: "B" },
  ],
};
const pairState = state(
  [position("A", -1, 0, 0), position("B", 1, 0, 0)],
  [velocity("A", 0, 0, 0), velocity("B", 0, 0, 0)],
);
const pairOptions = {
  charge: 1.5,
  springStiffness: 0,
  damping: 0.9,
  timeStep: 0.2,
  maxVelocity: 1,
  maxStep: 0.2,
  coordinateBound: 5,
  settleVelocity: 0,
  settlePositionDelta: 0,
  settleWindow: 100,
};

const pairBefore = JSON.stringify(pairState);
const livePair = createLivePhysics3D(pairNetwork, pairState, pairOptions);
const offlinePair = stepPhysics3D(buildPhysicalModel3D(pairNetwork), pairState, pairOptions);
const firstLive = stepLivePhysics3D(livePair) as SnapshotProbe;
same(firstLive.stepped, true, "awake controller performs a physical tick");
same(firstLive.tick, 1, "first live tick increments tick once");
deepSame(firstLive.state, offlinePair, "one unpinned live tick equals accepted V2d stepPhysics3D exactly");
deepSame(pairState, JSON.parse(pairBefore), "create/step do not mutate caller initial state");
deepSame(firstLive.pinnedKeys, [], "no implicit pins exist by default");

const deterministicA = createLivePhysics3D(pairNetwork, pairState, pairOptions);
const deterministicB = createLivePhysics3D(pairNetwork, pairState, pairOptions);
for (let index = 0; index < 12; index += 1) {
  deepSame(
    stepLivePhysics3D(deterministicA),
    stepLivePhysics3D(deterministicB),
    `deterministic live sequence tick ${index}`,
  );
}

const sleeping = createLivePhysics3D(pairNetwork, pairState, pairOptions);
sleepLivePhysics3D(sleeping);
const sleepingBefore = snapshot(sleeping);
const sleepingStep = stepLivePhysics3D(sleeping) as SnapshotProbe;
same(sleepingStep.stepped, false, "sleeping controller does not step");
same(sleepingStep.tick, sleepingBefore.tick, "sleeping step does not advance tick");
deepSame(sleepingStep.state, sleepingBefore.state, "sleeping step does not change state");
wakeLivePhysics3D(sleeping);
same(snapshot(sleeping).awake, true, "wake marks non-empty controller awake");
same(snapshot(sleeping).stableTicks, 0, "wake clears stable window");
same((stepLivePhysics3D(sleeping) as SnapshotProbe).stepped, true, "wake resumes stepping");

const stableNetwork: VisualLinkNetwork = {
  links: [{ key: "S", startKey: "S", endKey: "S" }],
};
const stableState = state([position("S", 0, 0, 0)], [velocity("S", 0, 0, 0)]);
const stable = createLivePhysics3D(stableNetwork, stableState, {
  charge: 0,
  springStiffness: 0,
  damping: 1,
  settleVelocity: 0,
  settlePositionDelta: 0,
  settleWindow: 2,
});
const stableOne = stepLivePhysics3D(stable) as SnapshotProbe;
same(stableOne.awake, true, "first stable tick does not sleep before settleWindow");
same(stableOne.stableTicks, 1, "first stable tick increments stability");
const stableTwo = stepLivePhysics3D(stable) as SnapshotProbe;
same(stableTwo.stableTicks, 2, "second stable tick reaches exact settleWindow");
same(stableTwo.awake, false, "controller automatically sleeps at settleWindow");

const optionController = createLivePhysics3D(pairNetwork, pairState, { ...pairOptions, charge: 0 });
sleepLivePhysics3D(optionController);
const optionBefore = snapshot(optionController);
setLivePhysics3DOptions(optionController, { charge: 3, springStiffness: 0 });
const optionAfter = snapshot(optionController);
same(optionAfter.awake, true, "valid option update wakes controller");
deepSame(optionAfter.state, optionBefore.state, "option update does not reset positions or velocities");
const updatedStep = stepLivePhysics3D(optionController) as SnapshotProbe;
const expectedUpdated = stepPhysics3D(buildPhysicalModel3D(pairNetwork), optionBefore.state, {
  ...pairOptions,
  charge: 3,
  springStiffness: 0,
});
deepSame(updatedStep.state, expectedUpdated, "updated charge feeds the next accepted V2d tick");

const springNetwork: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "B" },
    { key: "B", startKey: "B", endKey: "B" },
  ],
};
const springState = state(
  [position("A", 0, 0, 0), position("B", 4, 0, 0)],
  [velocity("A", 0, 0, 0), velocity("B", 0, 0, 0)],
);
const springLive = createLivePhysics3D(springNetwork, springState, {
  charge: 0,
  springStiffness: 0,
  restLength: 2,
  damping: 1,
  settleVelocity: 0,
  settlePositionDelta: 0,
  settleWindow: 100,
});
setLivePhysics3DOptions(springLive, { springStiffness: 1 });
const springStep = stepLivePhysics3D(springLive) as SnapshotProbe;
assert(positionOf(springStep, "A").x > 0, "updated springStiffness affects subsequent motion");

const dragNetwork: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "A" },
    { key: "B", startKey: "B", endKey: "B" },
  ],
};
const dragState = state(
  [position("A", 0, 0, 0), position("B", 1, 0, 0)],
  [velocity("A", 0, 0, 0), velocity("B", 0, 0, 0)],
);
const drag = createLivePhysics3D(dragNetwork, dragState, {
  charge: 2,
  springStiffness: 0,
  damping: 1,
  timeStep: 0.2,
  settleVelocity: 0,
  settlePositionDelta: 0,
  settleWindow: 100,
});
pinLivePhysics3D(drag, "A", point(0, 0, 0));
same(isLivePhysics3DPinned(drag, "A"), true, "pin marks key explicitly pinned");
const pinnedStep = stepLivePhysics3D(drag) as SnapshotProbe;
deepSame(positionOf(pinnedStep, "A"), point(0, 0, 0), "pinned key remains at exact requested position");
deepSame(velocityOf(pinnedStep, "A"), point(0, 0, 0), "pinned key velocity remains zero");
assert(positionOf(pinnedStep, "B").x > 1, "free neighbor still reacts to pinned charged point");

sleepLivePhysics3D(drag);
movePinnedLivePhysics3D(drag, "A", point(2, 1, -1));
const movedPin = snapshot(drag);
same(movedPin.awake, true, "moving a pin wakes entire simulation");
deepSame(positionOf(movedPin, "A"), point(2, 1, -1), "movePinned sets exact presentation position");
deepSame(velocityOf(movedPin, "A"), point(0, 0, 0), "movePinned zeros velocity");
releaseLivePhysics3D(drag, "A", point(-0.5, 0.25, 0));
same(isLivePhysics3DPinned(drag, "A"), false, "release removes explicit pin");
const released = snapshot(drag);
deepSame(velocityOf(released, "A"), point(-0.5, 0.25, 0), "release velocity becomes current physical input");
const expectedReleased = stepPhysics3D(buildPhysicalModel3D(dragNetwork), released.state, {
  charge: 2,
  springStiffness: 0,
  damping: 1,
  timeStep: 0.2,
});
deepSame((stepLivePhysics3D(drag) as SnapshotProbe).state, expectedReleased, "released node returns exactly to V2d physics");

const multiplePins = createLivePhysics3D(dragNetwork, dragState, {
  charge: 5,
  springStiffness: 0,
  settleVelocity: 0,
  settlePositionDelta: 0,
  settleWindow: 100,
});
pinLivePhysics3D(multiplePins, "A", point(-2, 1, 0));
pinLivePhysics3D(multiplePins, "B", point(2, -1, 0));
const twoPinned = stepLivePhysics3D(multiplePins) as SnapshotProbe;
deepSame(positionOf(twoPinned, "A"), point(-2, 1, 0), "first independent pin remains exact");
deepSame(positionOf(twoPinned, "B"), point(2, -1, 0), "second independent pin remains exact");
deepSame(twoPinned.pinnedKeys, ["A", "B"], "snapshot exposes deterministic pinned-key order");

const rootLookingNetwork: VisualLinkNetwork = {
  links: [
    { key: "R", startKey: "R", endKey: "R", label: "∞", tags: ["root"] },
    { key: "A", startKey: "A", endKey: "A" },
  ],
};
const rootLookingState = state(
  [position("A", 1, 0, 0), position("R", 0, 0, 0)],
  [velocity("A", 0, 0, 0), velocity("R", 0, 0, 0)],
);
const rootLooking = createLivePhysics3D(rootLookingNetwork, rootLookingState, {
  charge: 1,
  springStiffness: 0,
  damping: 1,
  timeStep: 0.1,
  settleVelocity: 0,
  settlePositionDelta: 0,
  settleWindow: 100,
});
same(isLivePhysics3DPinned(rootLooking, "R"), false, "R/∞/root metadata never creates implicit presentation pin");
const rootStep = stepLivePhysics3D(rootLooking) as SnapshotProbe;
assert(positionOf(rootStep, "R").x < 0, "root-looking presentation key moves under ordinary physics");

const frozen = snapshot(rootLooking);
assert(Object.isFrozen(frozen), "snapshot object is immutable");
assert(Object.isFrozen(frozen.state), "snapshot state is immutable");
assert(Object.isFrozen(frozen.state.positions), "snapshot positions list is immutable");
assert(Object.isFrozen(frozen.state.velocities), "snapshot velocities list is immutable");
assert(Object.isFrozen(frozen.pinnedKeys), "snapshot pinned-key list is immutable");
const frozenBefore = JSON.stringify(frozen);
stepLivePhysics3D(rootLooking);
deepSame(frozen, JSON.parse(frozenBefore), "later ticks cannot mutate an earlier snapshot alias");

const disturbed = createLivePhysics3D(pairNetwork, state(
  [position("A", -1, 0, 0), position("B", 1, 0, 0)],
  [velocity("A", 1000, -500, 250), velocity("B", -1000, 500, -250)],
), {
  charge: 10,
  springStiffness: 0,
  damping: 0.95,
  timeStep: 0.2,
  maxVelocity: 0.5,
  maxStep: 0.1,
  coordinateBound: 3,
  settleVelocity: 0,
  settlePositionDelta: 0,
  settleWindow: 1000,
});
for (let index = 0; index < 80; index += 1) {
  const current = stepLivePhysics3D(disturbed) as SnapshotProbe;
  for (const entry of current.state.positions) {
    assert(Number.isFinite(norm(entry.point)), `disturbed position ${entry.key} finite`);
    assert(Math.max(Math.abs(entry.point.x), Math.abs(entry.point.y), Math.abs(entry.point.z)) <= 3 + 1e-9, `disturbed position ${entry.key} bounded`);
  }
  for (const entry of current.state.velocities) {
    assert(Number.isFinite(norm(entry.vector)), `disturbed velocity ${entry.key} finite`);
    assert(norm(entry.vector) <= 0.5 + 1e-9, `disturbed velocity ${entry.key} bounded`);
  }
}

expectLiveCode(() => pinLivePhysics3D(livePair, "UNKNOWN", point(0, 0, 0)), "unknown-key", "unknown pin key");
expectLiveCode(() => pinLivePhysics3D(livePair, "A", point(Number.NaN, 0, 0)), "non-finite-vector", "non-finite pin");
expectLiveCode(() => movePinnedLivePhysics3D(livePair, "A", point(0, 0, 0)), "not-pinned", "move unpinned key");
expectLiveCode(() => releaseLivePhysics3D(livePair, "A"), "not-pinned", "release unpinned key");
pinLivePhysics3D(livePair, "A", point(0, 0, 0));
expectLiveCode(() => movePinnedLivePhysics3D(livePair, "A", point(0, Number.POSITIVE_INFINITY, 0)), "non-finite-vector", "non-finite move");
expectLiveCode(() => releaseLivePhysics3D(livePair, "A", point(0, 0, Number.NaN)), "non-finite-vector", "non-finite release velocity");

for (const invalid of [
  { settleVelocity: -1 },
  { settleVelocity: Number.NaN },
  { settlePositionDelta: -1 },
  { settlePositionDelta: Number.POSITIVE_INFINITY },
  { settleWindow: 0 },
  { settleWindow: 1.5 },
]) {
  expectLiveCode(
    () => createLivePhysics3D(pairNetwork, pairState, invalid),
    "invalid-live-option",
    `invalid live option ${JSON.stringify(invalid)}`,
  );
}
expectLiveCode(
  () => setLivePhysics3DOptions(optionController, { charge: -1 }),
  "invalid-physics-option",
  "invalid V2d option patch fails immediately",
);

// M4 U1: whole-network topology transition is real physics state, not a visibility mask.
const transitionBaseNetwork: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "A" },
    { key: "B", startKey: "B", endKey: "B" },
  ],
};
const transitionNextNetwork: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "A" },
    { key: "B", startKey: "B", endKey: "B" },
    { key: "C", startKey: "A", endKey: "B" },
  ],
};
const transitionState = state(
  [position("A", -2, 1, 0), position("B", 2, -1, 0)],
  [velocity("A", 0.2, -0.1, 0.05), velocity("B", -0.3, 0.15, -0.05)],
);
const transitionOptions = {
  charge: 1.25,
  springStiffness: 0.4,
  restLength: 1.2,
  damping: 0.83,
  timeStep: 0.15,
  maxVelocity: 1.2,
  maxStep: 0.18,
  coordinateBound: 8,
  settleVelocity: 0,
  settlePositionDelta: 0,
  settleWindow: 100,
};
const transitionController = createLivePhysics3D(transitionBaseNetwork, transitionState, transitionOptions);
pinLivePhysics3D(transitionController, "A", point(-2.5, 1.25, 0.5));
const transitionBefore = snapshot(transitionController);
const transitioned = transitionLivePhysics3DNetwork(transitionController, transitionNextNetwork) as SnapshotProbe;
deepSame(positionOf(transitioned, "A"), positionOf(transitionBefore, "A"), "transition preserves retained A position exactly");
deepSame(positionOf(transitioned, "B"), positionOf(transitionBefore, "B"), "transition preserves retained B position exactly");
deepSame(velocityOf(transitioned, "A"), velocityOf(transitionBefore, "A"), "transition preserves retained A velocity exactly");
deepSame(velocityOf(transitioned, "B"), velocityOf(transitionBefore, "B"), "transition preserves retained B velocity exactly");
deepSame(velocityOf(transitioned, "C"), point(0, 0, 0), "new topology key starts with exactly zero velocity");
assert(Number.isFinite(norm(positionOf(transitioned, "C"))), "new topology key receives finite seed");
const transitionMidpoint = point(
  (positionOf(transitioned, "A").x + positionOf(transitioned, "B").x) / 2,
  (positionOf(transitioned, "A").y + positionOf(transitioned, "B").y) / 2,
  (positionOf(transitioned, "A").z + positionOf(transitioned, "B").z) / 2,
);
assert(
  Math.hypot(
    positionOf(transitioned, "C").x - transitionMidpoint.x,
    positionOf(transitioned, "C").y - transitionMidpoint.y,
    positionOf(transitioned, "C").z - transitionMidpoint.z,
  ) < 1,
  "new topology key is seeded locally around resolved endpoints",
);
deepSame(transitionController.model, buildPhysicalModel3D(transitionNextNetwork), "physical model equals next network exactly");
deepSame(transitioned.pinnedKeys, ["A"], "retained pin survives topology transition");
same(transitioned.tick, transitionBefore.tick, "network transition does not increment physics tick");
same(transitioned.stepped, false, "network transition snapshot is not a physics step");
same(transitioned.awake, true, "real topology transition wakes non-empty controller");
same(transitioned.stableTicks, 0, "real topology transition resets settle window");
same(transitioned.maxVelocity, 0, "real topology transition resets velocity metric");
same(transitioned.maxPositionDelta, 0, "real topology transition resets movement metric");

pinLivePhysics3D(transitionController, "C", positionOf(transitioned, "C"));
const removed = transitionLivePhysics3DNetwork(transitionController, transitionBaseNetwork) as SnapshotProbe;
deepSame(transitionController.model, buildPhysicalModel3D(transitionBaseNetwork), "remove transition rebuilds exact base model");
assert(!removed.state.positions.some((entry) => entry.key === "C"), "removed key disappears from positions");
assert(!removed.state.velocities.some((entry) => entry.key === "C"), "removed key disappears from velocities");
assert(!transitionController.model.keys.includes("C"), "removed key disappears from model keys");
assert(
  !transitionController.model.springs.some((spring) => spring.linkKey === "C" || spring.sourceKey === "C" || spring.targetKey === "C"),
  "removed key cannot remain in stale springs",
);
deepSame(removed.pinnedKeys, ["A"], "removed pin disappears while retained pin survives");

const optionTransition = createLivePhysics3D(transitionBaseNetwork, transitionState, transitionOptions);
const optionTransitioned = transitionLivePhysics3DNetwork(optionTransition, transitionNextNetwork) as SnapshotProbe;
const optionExpected = stepPhysics3D(buildPhysicalModel3D(transitionNextNetwork), optionTransitioned.state, transitionOptions);
deepSame(
  (stepLivePhysics3D(optionTransition) as SnapshotProbe).state,
  optionExpected,
  "existing resolved physics options govern first tick after transition",
);

const wakeBaseNetwork: VisualLinkNetwork = {
  links: [{ key: "S", startKey: "S", endKey: "S" }],
};
const wakeNextNetwork: VisualLinkNetwork = {
  links: [
    { key: "S", startKey: "S", endKey: "S" },
    { key: "T", startKey: "T", endKey: "T" },
  ],
};
const wakeController = createLivePhysics3D(
  wakeBaseNetwork,
  state([position("S", 0, 0, 0)], [velocity("S", 0, 0, 0)]),
  { charge: 0, springStiffness: 0, damping: 1, settleVelocity: 0, settlePositionDelta: 0, settleWindow: 1 },
);
const settledWake = stepLivePhysics3D(wakeController) as SnapshotProbe;
same(settledWake.awake, false, "wake fixture reaches sleep before transition");
same(settledWake.stableTicks, 1, "wake fixture retains settled counter before transition");
const wokeByTopology = transitionLivePhysics3DNetwork(wakeController, wakeNextNetwork) as SnapshotProbe;
same(wokeByTopology.awake, true, "real key-set transition wakes settled controller");
same(wokeByTopology.stableTicks, 0, "real key-set transition resets settled counter");

const noOpController = createLivePhysics3D(pairNetwork, pairState, {
  charge: 0,
  springStiffness: 0,
  damping: 1,
  settleVelocity: 0,
  settlePositionDelta: 0,
  settleWindow: 1,
});
const noOpSettled = stepLivePhysics3D(noOpController) as SnapshotProbe;
same(noOpSettled.awake, false, "metadata-only fixture is asleep before equivalent transition");
const equivalentPhysicalNetwork: VisualLinkNetwork = {
  links: [
    { key: "B", startKey: "B", endKey: "B", label: "display B", tags: ["debug"] },
    { key: "A", startKey: "A", endKey: "A", label: "display A", tags: ["selected"] },
  ],
};
const noOpTransition = transitionLivePhysics3DNetwork(noOpController, equivalentPhysicalNetwork) as SnapshotProbe;
deepSame(noOpTransition.state, noOpSettled.state, "equivalent physical topology preserves state");
same(noOpTransition.awake, noOpSettled.awake, "metadata/input-order-only transition does not wake physics");
same(noOpTransition.stableTicks, noOpSettled.stableTicks, "equivalent topology preserves settled counter");
same(noOpTransition.tick, noOpSettled.tick, "equivalent topology preserves tick");
same(noOpTransition.maxVelocity, noOpSettled.maxVelocity, "equivalent topology preserves velocity metric");
same(noOpTransition.maxPositionDelta, noOpSettled.maxPositionDelta, "equivalent topology preserves movement metric");

const chainNext: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "A" },
    { key: "B", startKey: "B", endKey: "B" },
    { key: "C", startKey: "A", endKey: "B" },
    { key: "D", startKey: "C", endKey: "A" },
  ],
};
const chainReordered: VisualLinkNetwork = { links: [...chainNext.links].reverse() };
const chainA = createLivePhysics3D(transitionBaseNetwork, transitionState, transitionOptions);
const chainB = createLivePhysics3D(transitionBaseNetwork, transitionState, transitionOptions);
const chainSnapshotA = transitionLivePhysics3DNetwork(chainA, chainNext) as SnapshotProbe;
const chainSnapshotB = transitionLivePhysics3DNetwork(chainB, chainReordered) as SnapshotProbe;
deepSame(chainSnapshotA, chainSnapshotB, "batch links-of-links transition is input-order independent");
deepSame(chainA.model, chainB.model, "batch links-of-links physical model is input-order independent");
assert(Number.isFinite(norm(positionOf(chainSnapshotA, "C"))), "first added link-of-links position is finite");
assert(Number.isFinite(norm(positionOf(chainSnapshotA, "D"))), "dependent added link position is finite");
const chainDMidpoint = point(
  (positionOf(chainSnapshotA, "C").x + positionOf(chainSnapshotA, "A").x) / 2,
  (positionOf(chainSnapshotA, "C").y + positionOf(chainSnapshotA, "A").y) / 2,
  (positionOf(chainSnapshotA, "C").z + positionOf(chainSnapshotA, "A").z) / 2,
);
assert(
  Math.hypot(
    positionOf(chainSnapshotA, "D").x - chainDMidpoint.x,
    positionOf(chainSnapshotA, "D").y - chainDMidpoint.y,
    positionOf(chainSnapshotA, "D").z - chainDMidpoint.z,
  ) < 1,
  "dependent added link is seeded locally after its endpoint resolves",
);

const cycleNext: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "A" },
    { key: "C", startKey: "D", endKey: "A" },
    { key: "D", startKey: "C", endKey: "A" },
  ],
};
const cycleReordered: VisualLinkNetwork = { links: [...cycleNext.links].reverse() };
const cycleState = state([position("A", 4, 0, 0)], [velocity("A", 0.1, 0, 0)]);
const cycleA = createLivePhysics3D({ links: [{ key: "A", startKey: "A", endKey: "A" }] }, cycleState, transitionOptions);
const cycleB = createLivePhysics3D({ links: [{ key: "A", startKey: "A", endKey: "A" }] }, cycleState, transitionOptions);
const cycleSnapshotA = transitionLivePhysics3DNetwork(cycleA, cycleNext) as SnapshotProbe;
const cycleSnapshotB = transitionLivePhysics3DNetwork(cycleB, cycleReordered) as SnapshotProbe;
deepSame(cycleSnapshotA, cycleSnapshotB, "recursive cycle fallback is deterministic and input-order independent");
assert(Number.isFinite(norm(positionOf(cycleSnapshotA, "C"))), "recursive cycle C fallback is finite");
assert(Number.isFinite(norm(positionOf(cycleSnapshotA, "D"))), "recursive cycle D fallback is finite");

const selfNext: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "A" },
    { key: "S", startKey: "S", endKey: "S" },
  ],
};
const selfA = createLivePhysics3D({ links: [{ key: "A", startKey: "A", endKey: "A" }] }, cycleState, transitionOptions);
const selfB = createLivePhysics3D({ links: [{ key: "A", startKey: "A", endKey: "A" }] }, cycleState, transitionOptions);
const selfSnapshotA = transitionLivePhysics3DNetwork(selfA, selfNext) as SnapshotProbe;
const selfSnapshotB = transitionLivePhysics3DNetwork(selfB, { links: [...selfNext.links].reverse() }) as SnapshotProbe;
deepSame(selfSnapshotA, selfSnapshotB, "new self-link fallback is deterministic");
assert(Number.isFinite(norm(positionOf(selfSnapshotA, "S"))), "new self-link fallback is finite");

const causalOptions = {
  charge: 0,
  springStiffness: 1,
  restLength: 0.5,
  damping: 1,
  timeStep: 0.1,
  maxVelocity: 10,
  maxStep: 1,
  coordinateBound: 20,
  settleVelocity: 0,
  settlePositionDelta: 0,
  settleWindow: 100,
};
const causalState = state(
  [position("A", -3, 0, 0), position("B", 3, 0, 0)],
  [velocity("A", 0, 0, 0), velocity("B", 0, 0, 0)],
);
const causal = createLivePhysics3D(transitionBaseNetwork, causalState, causalOptions);
assert(!causal.model.keys.includes("C"), "future key is absent from physical model before transition");
assert(!snapshot(causal).state.positions.some((entry) => entry.key === "C"), "future key is absent from physics state before transition");
const causalExpectedBefore = stepPhysics3D(buildPhysicalModel3D(transitionBaseNetwork), causalState, causalOptions);
const causalBefore = stepLivePhysics3D(causal) as SnapshotProbe;
deepSame(causalBefore.state, causalExpectedBefore, "future topology cannot affect force evaluation before it exists");
const causalTransition = transitionLivePhysics3DNetwork(causal, transitionNextNetwork) as SnapshotProbe;
assert(causal.model.keys.includes("C"), "new key enters physical model only at transition");
assert(causal.model.springs.some((spring) => spring.linkKey === "C"), "new springs enter physical model only at transition");
const causalAfter = stepLivePhysics3D(causal) as SnapshotProbe;
assert(
  JSON.stringify(positionOf(causalAfter, "A")) !== JSON.stringify(positionOf(causalTransition, "A")),
  "retained A reacts only after new topology physically exists",
);
assert(
  JSON.stringify(positionOf(causalAfter, "B")) !== JSON.stringify(positionOf(causalTransition, "B")),
  "retained B reacts only after new topology physically exists",
);

const atomic = createLivePhysics3D(transitionBaseNetwork, transitionState, transitionOptions);
pinLivePhysics3D(atomic, "A", point(-7, 2, 1));
sleepLivePhysics3D(atomic);
const atomicModel = atomic.model;
const atomicBefore = snapshot(atomic);
let atomicThrew = false;
try {
  transitionLivePhysics3DNetwork(atomic, {
    links: [
      { key: "A", startKey: "A", endKey: "A" },
      { key: "B", startKey: "B", endKey: "MISSING" },
    ],
  });
} catch {
  atomicThrew = true;
}
same(atomicThrew, true, "invalid next network rejects transition");
same(atomic.model, atomicModel, "failed transition preserves previous model identity");
deepSame(snapshot(atomic), atomicBefore, "failed transition is atomic across state pins and lifecycle");
