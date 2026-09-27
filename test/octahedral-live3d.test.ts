import {
  computeOctahedralGeometricCenter3D,
  createOctahedralLivePhysics3D,
  transitionOctahedralLivePhysics3DNetwork,
  type OctahedralLivePhysics3D,
} from "../src/index.js";
import type { VisualLinkNetwork } from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual M5/P2: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function approx(actual: number, expected: number, message: string, epsilon = 1e-6): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} != ${expected}`);
}

function packedVertexOffset(controller: OctahedralLivePhysics3D, link: number, vertex: number): number {
  return (link * controller.template.vertexCount + vertex) * 3;
}

function centerVelocity(controller: OctahedralLivePhysics3D, link: number): readonly [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const vertex of controller.template.centerTriangle) {
    const offset = packedVertexOffset(controller, link, vertex);
    x += controller.velocities[offset]!;
    y += controller.velocities[offset + 1]!;
    z += controller.velocities[offset + 2]!;
  }
  return [x / 3, y / 3, z / 3];
}

function apexPosition(controller: OctahedralLivePhysics3D, link: number, vertex: number): readonly [number, number, number] {
  const offset = packedVertexOffset(controller, link, vertex);
  return [
    controller.positions[offset]!,
    controller.positions[offset + 1]!,
    controller.positions[offset + 2]!,
  ];
}

function maxPositionDelta(left: Float32Array, right: Float32Array): number {
  same(left.length, right.length, "delta arrays same length");
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(left[index]! - right[index]!));
  }
  return maximum;
}

const ratio = 2 * Math.SQRT2;
const selfNetwork: VisualLinkNetwork = {
  links: [{ key: "R", startKey: "R", endKey: "R" }],
};

const self = createOctahedralLivePhysics3D(selfNetwork, {
  aspectRatio: ratio,
  stiffness: 1,
  simulationSpeed: 1,
});
same(self.topology.linkCount, 1, "one semantic Link creates one packed Link instance");
same(
  self.positions.length,
  self.template.vertexCount * 3,
  "packed positions cover every physical vertex exactly",
);
same(self.velocities.length, self.positions.length, "packed velocities match positions");
assert(self.positions.every(Number.isFinite), "initial double-self positions are finite");
assert(self.velocities.every(Number.isFinite), "initial double-self velocities are finite");

const initialCenter = computeOctahedralGeometricCenter3D(self.template, self.positions, 0);
for (const apex of [self.template.startApex, self.template.endApex]) {
  const position = apexPosition(self, 0, apex);
  approx(position[0], initialCenter[0], "self apex x equals virtual center");
  approx(position[1], initialCenter[1], "self apex y equals virtual center");
  approx(position[2], initialCenter[2], "self apex z equals virtual center");
}

let extent = 0;
for (let vertex = 0; vertex < self.template.vertexCount; vertex += 1) {
  if (vertex === self.template.startApex || vertex === self.template.endApex) continue;
  const position = apexPosition(self, 0, vertex);
  extent = Math.max(
    extent,
    Math.hypot(
      position[0] - initialCenter[0],
      position[1] - initialCenter[1],
      position[2] - initialCenter[2],
    ),
  );
}
assert(extent > 0.5, "double-self initial state remains materially non-collapsed");

const paused = createOctahedralLivePhysics3D(selfNetwork, {
  aspectRatio: ratio,
  stiffness: 1,
  simulationSpeed: 0,
});
const pausedBefore = paused.positions.slice();
const pausedStats = paused.step();
same(maxPositionDelta(paused.positions, pausedBefore), 0, "simulationSpeed=0 pauses internal integration");
same(pausedStats.springEdgeEvaluations, paused.template.edgeCount, "paused tick still evaluates local springs");
same(pausedStats.hingeTransfers, 2, "paused tick keeps hinge force transfer");
same(pausedStats.hingeProjections, 2, "paused tick keeps positional hinge projection");
same(pausedStats.integratedVertices, 0, "paused tick reports zero actually integrated vertices");

const zeroStiffness = createOctahedralLivePhysics3D(selfNetwork, {
  aspectRatio: ratio,
  stiffness: 0,
  simulationSpeed: 1,
});
const zeroBefore = zeroStiffness.positions.slice();
zeroStiffness.step();
same(maxPositionDelta(zeroStiffness.positions, zeroBefore), 0, "stiffness=0 produces no free internal motion");

const moving = createOctahedralLivePhysics3D(selfNetwork, {
  aspectRatio: ratio,
  stiffness: 1,
  simulationSpeed: 1,
});
const movingBefore = moving.positions.slice();
const positionsIdentity = moving.positions;
const velocitiesIdentity = moving.velocities;
const movingStats = moving.step();
assert(maxPositionDelta(moving.positions, movingBefore) > 0, "projected self-Link deforms under spring forces");
assert(moving.positions.every(Number.isFinite), "moving self-Link positions remain finite");
assert(moving.velocities.every(Number.isFinite), "moving self-Link velocities remain finite");
assert(moving.positions === positionsIdentity, "ordinary tick reuses packed position buffer");
assert(moving.velocities === velocitiesIdentity, "ordinary tick reuses packed velocity buffer");
same(movingStats.springEdgeEvaluations, moving.template.edgeCount, "tick evaluates every spring once");
same(movingStats.hingeTransfers, 2, "tick transfers two hinge reactions");
same(movingStats.hingeProjections, 2, "tick projects two hinge positions");
same(movingStats.integratedVertices, moving.template.vertexCount - 2, "apex vertices are not independently integrated");
same(movingStats.pairwiseSemanticLinkEvaluations, 0, "tick has no semantic all-pairs path");

const movingCenter = computeOctahedralGeometricCenter3D(moving.template, moving.positions, 0);
const movingCenterVelocity = centerVelocity(moving, 0);
for (const apex of [moving.template.startApex, moving.template.endApex]) {
  const position = apexPosition(moving, 0, apex);
  const offset = packedVertexOffset(moving, 0, apex);
  approx(position[0], movingCenter[0], "post-step self apex x equals virtual center");
  approx(position[1], movingCenter[1], "post-step self apex y equals virtual center");
  approx(position[2], movingCenter[2], "post-step self apex z equals virtual center");
  approx(moving.velocities[offset]!, movingCenterVelocity[0], "apex vx follows virtual center");
  approx(moving.velocities[offset + 1]!, movingCenterVelocity[1], "apex vy follows virtual center");
  approx(moving.velocities[offset + 2]!, movingCenterVelocity[2], "apex vz follows virtual center");
}

const slow = createOctahedralLivePhysics3D(selfNetwork, {
  aspectRatio: ratio,
  stiffness: 1,
  simulationSpeed: 0.5,
});
const fast = createOctahedralLivePhysics3D(selfNetwork, {
  aspectRatio: ratio,
  stiffness: 1,
  simulationSpeed: 2,
});
const slowBefore = slow.positions.slice();
const fastBefore = fast.positions.slice();
slow.step();
fast.step();
assert(
  maxPositionDelta(fast.positions, fastBefore) > maxPositionDelta(slow.positions, slowBefore),
  "larger simulationSpeed advances farther from the same initial state",
);

const network: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "B" },
    { key: "B", startKey: "A", endKey: "B" },
  ],
};
const live = createOctahedralLivePhysics3D(network, {
  aspectRatio: ratio,
  stiffness: 0.75,
  simulationSpeed: 1,
});
same(live.topology.linkCount, 2, "two-Link topology packed");
const stats = live.step();
same(stats.springEdgeEvaluations, 2 * live.template.edgeCount, "spring work is N*E");
same(stats.hingeTransfers, 4, "hinge transfers are exactly 2N");
same(stats.hingeProjections, 4, "hinge projections are exactly 2N");
same(stats.integratedVertices, 2 * (live.template.vertexCount - 2), "integrated vertices are N*(V-2)");

for (let link = 0; link < live.topology.linkCount; link += 1) {
  const startTarget = live.topology.startIndices[link]!;
  const endTarget = live.topology.endIndices[link]!;
  const startCenter = computeOctahedralGeometricCenter3D(live.template, live.positions, startTarget);
  const endCenter = computeOctahedralGeometricCenter3D(live.template, live.positions, endTarget);
  const startApex = apexPosition(live, link, live.template.startApex);
  const endApex = apexPosition(live, link, live.template.endApex);
  for (let axis = 0; axis < 3; axis += 1) {
    approx(startApex[axis]!, startCenter[axis]!, `Link ${link} START hinge axis ${axis}`);
    approx(endApex[axis]!, endCenter[axis]!, `Link ${link} END hinge axis ${axis}`);
  }
}

const retainedAIndex = live.topology.keys.indexOf("A");
assert(retainedAIndex >= 0, "A exists before transition");
const retainedPositionOffset = retainedAIndex * live.template.vertexCount * 3;
const retainedAState = live.positions.slice(
  retainedPositionOffset,
  retainedPositionOffset + live.template.vertexCount * 3,
);
const nextNetwork: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "C" },
    { key: "C", startKey: "A", endKey: "C" },
  ],
};
transitionOctahedralLivePhysics3DNetwork(live, nextNetwork);
assert(JSON.stringify(live.topology.keys) === JSON.stringify(["A", "C"]), "transition replaces current key-space");
same(live.positions.length, 2 * live.template.vertexCount * 3, "transition resizes packed state exactly");
assert(live.positions.every(Number.isFinite), "transition positions finite");
assert(live.velocities.every(Number.isFinite), "transition velocities finite");

const nextAIndex = live.topology.keys.indexOf("A");
assert(nextAIndex >= 0, "A retained after transition");
const nextAOffset = nextAIndex * live.template.vertexCount * 3;
let retainedInteriorMatches = true;
for (let vertex = 0; vertex < live.template.vertexCount; vertex += 1) {
  if (vertex === live.template.startApex || vertex === live.template.endApex) continue;
  for (let axis = 0; axis < 3; axis += 1) {
    const before = retainedAState[vertex * 3 + axis]!;
    const after = live.positions[nextAOffset + vertex * 3 + axis]!;
    if (Math.abs(before - after) > 1e-6) retainedInteriorMatches = false;
  }
}
assert(retainedInteriorMatches, "retained Link preserves all non-apex material positions across transition");

live.setSimulationSpeed(0);
same(live.simulationSpeed, 0, "simulation speed can be changed without rebuilding state");
live.setStiffness(2);
same(live.stiffness, 2, "edge stiffness can be changed without rebuilding topology");
