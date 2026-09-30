import {
  buildPhysicalModel3D,
  computePhysicalForces3D,
  stepPhysics3D,
  type Physics3DState,
  type VisualLinkNetwork,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`classic3d-separation: ${message}`);
}

const network: VisualLinkNetwork = {
  links: [
    { key: "R", startKey: "R", endKey: "R" },
    { key: "O", startKey: "O", endKey: "R" },
    { key: "C", startKey: "R", endKey: "C" },
  ],
};
const model = buildPhysicalModel3D(network);
const state: Physics3DState = {
  positions: [
    { key: "C", point: { x: 1, y: 0.001, z: 0 } },
    { key: "O", point: { x: 1, y: 0, z: 0 } },
    { key: "R", point: { x: 0, y: 0, z: 0 } },
  ],
  velocities: [
    { key: "C", vector: { x: 0, y: 0, z: 0 } },
    { key: "O", vector: { x: 0, y: 0, z: 0 } },
    { key: "R", vector: { x: 0, y: 0, z: 0 } },
  ],
};

function force(key: string, charge: number) {
  return computePhysicalForces3D(model, state.positions, {
    charge,
    springStiffness: 0.055,
    restLength: 2,
  }).forces.find((entry) => entry.key === key)!.vector;
}

const oNoCharge = force("O", 0);
const cNoCharge = force("C", 0);
const oCharged = force("O", 1);
const cCharged = force("C", 1);

// Direction from C toward O: the charge contribution must increase relative
// acceleration along this separation axis rather than allowing the two centers
// to become visually coincident.
const separationAxis = { x: 0, y: -1, z: 0 };
const relativeAlong = (left: typeof oCharged, right: typeof cCharged) =>
  (left.x - right.x) * separationAxis.x
  + (left.y - right.y) * separationAxis.y
  + (left.z - right.z) * separationAxis.z;

assert(
  relativeAlong(oCharged, cCharged) > relativeAlong(oNoCharge, cNoCharge) + 1,
  "charge must add a strong separating relative force between nearby Link centers",
);

const common = {
  springStiffness: 0.055,
  restLength: 2,
  damping: 0.86,
  timeStep: 0.2,
};
const noChargeStep = stepPhysics3D(model, state, { ...common, charge: 0 });
const chargedStep = stepPhysics3D(model, state, { ...common, charge: 1 });

function distance(snapshot: Physics3DState, left: string, right: string): number {
  const a = snapshot.positions.find((entry) => entry.key === left)!.point;
  const b = snapshot.positions.find((entry) => entry.key === right)!.point;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

assert(
  distance(chargedStep, "O", "C") > distance(noChargeStep, "O", "C"),
  "one deterministic Classic step with charge must separate the nearby centers more than charge=0",
);

const evaluations = computePhysicalForces3D(model, state.positions, { charge: 1 }).evaluations;
assert(evaluations.springs === 2, "root/O/C fixture has two incidence springs");
assert(evaluations.chargePairs === 3, "three centers evaluate exactly three all-pairs charge interactions");
