import {
  buildRodPhysicalModel3D,
  computeRodPhysicalForces3D,
  createIndexedRodTopology3D,
  createInitialRodPhysics3DState,
  stepRodPhysics3D,
  RodPhysics3DError,
  type IndexedRodTopology3D,
  type RodPhysics3DState,
} from "../src/rod-physics3d.js";
import type { VisualLinkNetwork } from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual M5/P1: ${message}`);
}

function same(actual: number, expected: number, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${actual} !== ${expected}`);
}

function approx(actual: number, expected: number, message: string, epsilon = 1e-5): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} != ${expected}`);
}

function offset(index: number): number {
  return index * 3;
}

function setCenter(state: RodPhysics3DState, index: number, x: number, y: number, z: number): void {
  const base = offset(index);
  state.centers[base] = x;
  state.centers[base + 1] = y;
  state.centers[base + 2] = z;
}

function force(result: ReturnType<typeof computeRodPhysicalForces3D>, index: number) {
  const base = offset(index);
  return {
    x: result.forces[base]!,
    y: result.forces[base + 1]!,
    z: result.forces[base + 2]!,
  };
}

const network: VisualLinkNetwork = {
  links: [
    { key: "R", startKey: "R", endKey: "R" },
    { key: "A", startKey: "R", endKey: "B" },
    { key: "B", startKey: "A", endKey: "R" },
    { key: "C", startKey: "C", endKey: "B" },
  ],
};

const visualModel = buildRodPhysicalModel3D(network);
same(visualModel.linkCount, 4, "one rod per normalized Link");
assert(JSON.stringify(visualModel.keys) === JSON.stringify(["A", "B", "C", "R"]), "stable VisualKey order");
assert(
  JSON.stringify([...visualModel.startIndices]) === JSON.stringify([3, 0, 2, 3]),
  "START references become dense Link indices",
);
assert(
  JSON.stringify([...visualModel.endIndices]) === JSON.stringify([1, 3, 1, 3]),
  "END references become dense Link indices",
);
assert(visualModel.startIndices instanceof Uint32Array, "START topology is Uint32Array");
assert(visualModel.endIndices instanceof Uint32Array, "END topology is Uint32Array");

const sourceStarts = new Uint32Array([0, 0, 2]);
const sourceEnds = new Uint32Array([0, 2, 2]);
const topology = createIndexedRodTopology3D(sourceStarts, sourceEnds);
sourceStarts[1] = 1;
sourceEnds[1] = 1;
same(topology.startIndices[1]!, 0, "indexed topology detaches START storage");
same(topology.endIndices[1]!, 2, "indexed topology detaches END storage");

const stretched = createInitialRodPhysics3DState(topology, { radius: 1 });
setCenter(stretched, 0, -3, 0, 0);
setCenter(stretched, 1, 0, 0, 0);
setCenter(stretched, 2, 3, 0, 0);
const stretchedResult = computeRodPhysicalForces3D(topology, stretched, {
  restLength: 4,
  axialStiffness: 1,
  bendingStiffness: 0,
});
assert(force(stretchedResult, 0).x > 0, "stretched rod pulls START attachment inward");
approx(force(stretchedResult, 1).x, 0, "symmetric stretched rod leaves own center balanced");
assert(force(stretchedResult, 2).x < 0, "stretched rod pulls END attachment inward");
same(stretchedResult.evaluations.rods, 3, "one rod evaluation per Link");
same(stretchedResult.evaluations.attachments, 6, "two attachment evaluations per Link");
same(stretchedResult.evaluations.bends, 3, "one bend evaluation per Link");
same(stretchedResult.evaluations.pairwise, 0, "rod physics has no all-pairs force path");

const compressed = createInitialRodPhysics3DState(topology, { radius: 1 });
setCenter(compressed, 0, -1, 0, 0);
setCenter(compressed, 1, 0, 0, 0);
setCenter(compressed, 2, 1, 0, 0);
const compressedResult = computeRodPhysicalForces3D(topology, compressed, {
  restLength: 4,
  axialStiffness: 1,
  bendingStiffness: 0,
});
assert(force(compressedResult, 0).x < 0, "compressed rod pushes START attachment outward");
assert(force(compressedResult, 2).x > 0, "compressed rod pushes END attachment outward");

const bent = createInitialRodPhysics3DState(topology, { radius: 1 });
setCenter(bent, 0, -2, 0, 0);
setCenter(bent, 1, 0, 1, 0);
setCenter(bent, 2, 2, 0, 0);
const bentResult = computeRodPhysicalForces3D(topology, bent, {
  axialStiffness: 0,
  bendingStiffness: 1,
});
assert(force(bentResult, 0).y > 0, "bending reaction acts on START hinge");
assert(force(bentResult, 1).y < 0, "bending force straightens rod center");
assert(force(bentResult, 2).y > 0, "bending reaction acts on END hinge");
approx(
  force(bentResult, 0).y + force(bentResult, 1).y + force(bentResult, 2).y,
  0,
  "local bending forces conserve translation",
);

const doubleSelf = createIndexedRodTopology3D(new Uint32Array([0]), new Uint32Array([0]));
const doubleSelfState = createInitialRodPhysics3DState(doubleSelf);
const selfResult = computeRodPhysicalForces3D(doubleSelf, doubleSelfState, {
  restLength: 2,
  axialStiffness: 1,
  bendingStiffness: 1,
});
same(selfResult.evaluations.selfAttachments, 2, "double self-Link retains both self attachments");
same(selfResult.evaluations.pairwise, 0, "double self-Link needs no global interaction");
approx(force(selfResult, 0).x, 0, "double self-Link has no translational x self-force");
approx(force(selfResult, 0).y, 0, "double self-Link has no translational y self-force");
approx(force(selfResult, 0).z, 0, "double self-Link has no translational z self-force");
const steppedSelf = stepRodPhysics3D(doubleSelf, doubleSelfState, {
  restLength: 2,
  axialStiffness: 1,
  bendingStiffness: 1,
});
assert([...steppedSelf.centers, ...steppedSelf.velocities].every(Number.isFinite), "double self-Link step stays finite");

const n = 100_000;
const starts = new Uint32Array(n);
const ends = new Uint32Array(n);
for (let index = 0; index < n; index += 1) {
  starts[index] = (index + n - 1) % n;
  ends[index] = (index + 1) % n;
}
const largeTopology: IndexedRodTopology3D = createIndexedRodTopology3D(starts, ends);
const largeState = createInitialRodPhysics3DState(largeTopology, { radius: 3 });
const largeResult = computeRodPhysicalForces3D(largeTopology, largeState, {
  axialStiffness: 0,
  bendingStiffness: 0,
});
same(largeResult.evaluations.rods, n, "100k topology performs exactly N rod evaluations");
same(largeResult.evaluations.attachments, 2 * n, "100k topology performs exactly 2N attachment evaluations");
same(largeResult.evaluations.bends, n, "100k topology performs exactly N bend evaluations");
same(largeResult.evaluations.pairwise, 0, "100k topology performs zero pairwise evaluations");

try {
  createIndexedRodTopology3D(new Uint32Array([1]), new Uint32Array([0]));
  throw new Error("invalid topology index should reject");
} catch (error) {
  assert(error instanceof RodPhysics3DError, "invalid topology uses rod error boundary");
  assert(error.code === "invalid-topology-index", "invalid topology error code");
}
