import {
  type Point3D,
  type VisualLinkNetwork,
  type VisualPosition3D,
} from "../src/index.js";
import {
  Physics3DError,
  buildPhysicalModel3D,
  computePhysicalForces3D,
  stepPhysics3D,
} from "../src/physics3d.js";

type SpringProbe = Readonly<{
  linkKey: string;
  role: "start" | "end";
  sourceKey: string;
  targetKey: string;
}>;

type PhysicalModelProbe = Readonly<{
  keys: readonly string[];
  springs: readonly SpringProbe[];
}>;

type ForceProbe = Readonly<{ key: string; vector: Point3D }>;
type ForceResultProbe = Readonly<{
  forces: readonly ForceProbe[];
  evaluations: Readonly<{ springs: number; chargePairs: number }>;
}>;
type VelocityProbe = Readonly<{ key: string; vector: Point3D }>;
type StateProbe = Readonly<{
  positions: readonly VisualPosition3D[];
  velocities: readonly VelocityProbe[];
}>;

type PhysicsErrorCode =
  | "invalid-option"
  | "missing-velocity"
  | "extra-velocity"
  | "duplicate-velocity"
  | "non-finite-velocity";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V2d: ${message}`);
}

function approx(actual: number, expected: number, message: string, epsilon = 1e-9): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} != ${expected}`);
}

function point(x: number, y: number, z: number): Point3D {
  return { x, y, z };
}

function position(key: string, x: number, y: number, z: number): VisualPosition3D {
  return { key, point: point(x, y, z) };
}

function velocity(key: string, x: number, y: number, z: number): VelocityProbe {
  return { key, vector: point(x, y, z) };
}

function norm(value: Point3D): number {
  return Math.hypot(value.x, value.y, value.z);
}

function model(network: VisualLinkNetwork): PhysicalModelProbe {
  return buildPhysicalModel3D(network) as PhysicalModelProbe;
}

function forceByKey(result: ForceResultProbe, key: string): Point3D {
  const force = result.forces.find((entry: ForceProbe) => entry.key === key);
  assert(force !== undefined, `missing force for ${key}`);
  return force.vector;
}

function expectPhysicsCode(effect: () => unknown, code: PhysicsErrorCode, message: string): void {
  try {
    effect();
  } catch (error) {
    assert(error instanceof Physics3DError, `${message}: wrong error type`);
    const coded = error as { readonly code?: unknown };
    assert(coded.code === code, `${message}: ${String(coded.code)} !== ${code}`);
    return;
  }
  throw new Error(`@mts/visual V2d: ${message}: expected rejection`);
}

function expectReject(effect: () => unknown, message: string): void {
  try {
    effect();
  } catch {
    return;
  }
  throw new Error(`@mts/visual V2d: ${message}: expected rejection`);
}

const topologyNetwork: VisualLinkNetwork = {
  links: [
    { key: "R", startKey: "R", endKey: "R", label: "root-looking presentation only" },
    { key: "A", startKey: "R", endKey: "B" },
    { key: "B", startKey: "A", endKey: "R" },
    { key: "C", startKey: "C", endKey: "B", tags: ["self-start"] },
  ],
};
const physical = model(topologyNetwork);
assert(JSON.stringify(physical.keys) === JSON.stringify(["A", "B", "C", "R"]), "one physical point per normalized VisualKey");
assert(
  JSON.stringify(physical.springs) === JSON.stringify([
    { linkKey: "A", role: "start", sourceKey: "R", targetKey: "A" },
    { linkKey: "A", role: "end", sourceKey: "A", targetKey: "B" },
    { linkKey: "B", role: "start", sourceKey: "A", targetKey: "B" },
    { linkKey: "B", role: "end", sourceKey: "B", targetKey: "R" },
    { linkKey: "C", role: "end", sourceKey: "C", targetKey: "B" },
  ]),
  "non-self START/END arcs map one-for-one to role-preserving springs",
);
assert(physical.springs.every((spring: SpringProbe) => spring.sourceKey !== spring.targetKey), "self arcs never create self-force springs");

const reorderedPhysical = model({ links: [...topologyNetwork.links].reverse() });
assert(JSON.stringify(reorderedPhysical) === JSON.stringify(physical), "network input order does not change physical topology");
const relabeledPhysical = model({
  links: topologyNetwork.links.map((link) => ({ ...link, label: `label:${link.key}`, tags: ["debug"] })),
});
assert(JSON.stringify(relabeledPhysical) === JSON.stringify(physical), "metadata does not change physical topology");

const linkOfLinks = model({
  links: [
    { key: "L", startKey: "L", endKey: "L" },
    { key: "U", startKey: "U", endKey: "U" },
    { key: "X", startKey: "L", endKey: "U" },
  ],
});
assert(
  JSON.stringify(linkOfLinks.springs) === JSON.stringify([
    { linkKey: "X", role: "start", sourceKey: "L", targetKey: "X" },
    { linkKey: "X", role: "end", sourceKey: "X", targetKey: "U" },
  ]),
  "link-of-links uses represented Link centers without a special node layer",
);

const chargeModel = model({
  links: [
    { key: "A", startKey: "A", endKey: "A" },
    { key: "B", startKey: "B", endKey: "B" },
  ],
});
const pairPositions = [position("A", -1, 0, 0), position("B", 1, 0, 0)];
const chargeResult = computePhysicalForces3D(chargeModel, pairPositions, {
  charge: 1,
  springStiffness: 0,
  minimumDistance: 0.1,
  softening: 0.1,
}) as ForceResultProbe;
const chargeA = forceByKey(chargeResult, "A");
const chargeB = forceByKey(chargeResult, "B");
assert(chargeA.x < 0 && chargeB.x > 0, "same-sign GREEN centers repel");
approx(chargeA.x + chargeB.x, 0, "pairwise charge force is symmetric");
approx(chargeA.y + chargeB.y, 0, "pairwise charge y force is symmetric");
approx(chargeA.z + chargeB.z, 0, "pairwise charge z force is symmetric");
assert(chargeResult.evaluations.chargePairs === 1, "one pairwise charge evaluation");

const noCharge = computePhysicalForces3D(chargeModel, pairPositions, {
  charge: 0,
  springStiffness: 0,
}) as ForceResultProbe;
approx(norm(forceByKey(noCharge, "A")), 0, "charge=0 disables charge force");
const charge2 = computePhysicalForces3D(chargeModel, pairPositions, {
  charge: 2,
  springStiffness: 0,
  minimumDistance: 0.1,
  softening: 0.1,
}) as ForceResultProbe;
assert(norm(forceByKey(charge2, "A")) > norm(chargeA), "larger global charge increases repulsion magnitude");

const springModel = model({
  links: [
    { key: "A", startKey: "A", endKey: "B" },
    { key: "B", startKey: "B", endKey: "B" },
  ],
});
function springForce(distance: number, stiffness: number): ForceResultProbe {
  return computePhysicalForces3D(
    springModel,
    [position("A", 0, 0, 0), position("B", distance, 0, 0)],
    { charge: 0, restLength: 2, springStiffness: stiffness },
  ) as ForceResultProbe;
}
assert(forceByKey(springForce(4, 1), "A").x > 0, "stretched spring attracts");
assert(forceByKey(springForce(1, 1), "A").x < 0, "compressed spring repels");
approx(norm(forceByKey(springForce(2, 1), "A")), 0, "spring at restLength has zero force");
approx(norm(forceByKey(springForce(4, 0), "A")), 0, "springStiffness=0 disables spring force");
assert(
  norm(forceByKey(springForce(4, 1), "A")) > norm(forceByKey(springForce(4, 0.5), "A")),
  "larger springStiffness increases fixed-extension force",
);

const coincidentPositions = [position("A", 0, 0, 0), position("B", 0, 0, 0)];
const coincidentFirst = computePhysicalForces3D(chargeModel, coincidentPositions, {
  charge: 1,
  springStiffness: 0,
}) as ForceResultProbe;
const coincidentSecond = computePhysicalForces3D(chargeModel, coincidentPositions, {
  charge: 1,
  springStiffness: 0,
}) as ForceResultProbe;
assert(JSON.stringify(coincidentFirst) === JSON.stringify(coincidentSecond), "coincident separation direction is deterministic");
const coincidentA = forceByKey(coincidentFirst, "A");
const coincidentB = forceByKey(coincidentFirst, "B");
assert(Number.isFinite(norm(coincidentA)) && norm(coincidentA) > 0, "coincident charge force is finite and nonzero");
approx(coincidentA.x + coincidentB.x, 0, "coincident forces oppose on x");
approx(coincidentA.y + coincidentB.y, 0, "coincident forces oppose on y");
approx(coincidentA.z + coincidentB.z, 0, "coincident forces oppose on z");

const state: StateProbe = {
  positions: [position("A", -1, 0, 0), position("B", 1, 0, 0)],
  velocities: [velocity("A", 0, 0, 0), velocity("B", 0, 0, 0)],
};
const stateBefore = JSON.stringify(state);
const networkBefore = JSON.stringify(chargeModel);
const stepOptions = {
  charge: 25,
  springStiffness: 0,
  damping: 0.8,
  timeStep: 0.2,
  maxVelocity: 0.5,
  maxStep: 0.05,
  coordinateBound: 2,
};
const stepped = stepPhysics3D(chargeModel, state, stepOptions) as StateProbe;
const steppedAgain = stepPhysics3D(chargeModel, state, stepOptions) as StateProbe;
assert(JSON.stringify(stepped) === JSON.stringify(steppedAgain), "same state/options give deep-equal next state");
assert(JSON.stringify(state) === stateBefore, "step does not mutate caller state");
assert(JSON.stringify(chargeModel) === networkBefore, "step does not mutate physical topology");
for (const entry of stepped.positions) {
  assert(Number.isFinite(norm(entry.point)), `stepped position ${entry.key} finite`);
  assert(norm(entry.point) <= 2 + 1e-9, `stepped position ${entry.key} coordinate bounded`);
}
for (const entry of stepped.velocities) {
  assert(Number.isFinite(norm(entry.vector)), `stepped velocity ${entry.key} finite`);
  assert(norm(entry.vector) <= 0.5 + 1e-9, `stepped velocity ${entry.key} bounded`);
}

const rootLookingState: StateProbe = {
  positions: [position("A", 1, 0, 0), position("R", 0, 0, 0)],
  velocities: [velocity("A", 0, 0, 0), velocity("R", 0, 0, 0)],
};
const rootLookingModel = model({
  links: [
    { key: "R", startKey: "R", endKey: "R", label: "∞", tags: ["root"] },
    { key: "A", startKey: "A", endKey: "A" },
  ],
});
const movedRootLooking = stepPhysics3D(rootLookingModel, rootLookingState, {
  charge: 1,
  springStiffness: 0,
  damping: 1,
  timeStep: 0.1,
}) as StateProbe;
const movedR = movedRootLooking.positions.find((entry) => entry.key === "R");
assert(movedR !== undefined && movedR.point.x < 0, "presentation key/label R is not implicitly pinned as semantic root");

expectReject(
  () => computePhysicalForces3D(chargeModel, [pairPositions[0]!], {}),
  "missing position",
);
expectReject(
  () => computePhysicalForces3D(chargeModel, [...pairPositions, position("EXTRA", 0, 0, 0)], {}),
  "extra position",
);
expectReject(
  () => computePhysicalForces3D(chargeModel, [...pairPositions, position("A", 0, 0, 0)], {}),
  "duplicate position",
);
expectReject(
  () => computePhysicalForces3D(chargeModel, [pairPositions[0]!, position("B", Number.NaN, 0, 0)], {}),
  "non-finite position",
);

expectPhysicsCode(
  () => stepPhysics3D(chargeModel, { positions: pairPositions, velocities: [velocity("A", 0, 0, 0)] }, {}),
  "missing-velocity",
  "missing velocity",
);
expectPhysicsCode(
  () => stepPhysics3D(chargeModel, { positions: pairPositions, velocities: [velocity("A", 0, 0, 0), velocity("B", 0, 0, 0), velocity("EXTRA", 0, 0, 0)] }, {}),
  "extra-velocity",
  "extra velocity",
);
expectPhysicsCode(
  () => stepPhysics3D(chargeModel, { positions: pairPositions, velocities: [velocity("A", 0, 0, 0), velocity("B", 0, 0, 0), velocity("A", 0, 0, 0)] }, {}),
  "duplicate-velocity",
  "duplicate velocity",
);
expectPhysicsCode(
  () => stepPhysics3D(chargeModel, { positions: pairPositions, velocities: [velocity("A", 0, 0, 0), velocity("B", 0, Number.POSITIVE_INFINITY, 0)] }, {}),
  "non-finite-velocity",
  "non-finite velocity",
);

for (const invalid of [
  { restLength: 0 },
  { springStiffness: -1 },
  { charge: -1 },
  { softening: 0 },
  { minimumDistance: 0 },
  { damping: -0.1 },
  { damping: 1.1 },
  { timeStep: 0 },
  { maxVelocity: 0 },
  { maxStep: 0 },
  { coordinateBound: 0 },
  { charge: Number.NaN },
  { springStiffness: Number.POSITIVE_INFINITY },
]) {
  expectPhysicsCode(
    () => computePhysicalForces3D(chargeModel, pairPositions, invalid),
    "invalid-option",
    `invalid option ${JSON.stringify(invalid)}`,
  );
}
