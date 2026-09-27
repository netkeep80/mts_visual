import {
  computeOctahedralGeometricCenter3D,
  createOctahedralLivePhysics3D,
  transitionOctahedralLivePhysics3DNetwork,
  type OctahedralLivePhysics3D,
} from "../src/index.js";
import type { VisualLinkNetwork } from "../src/index.js";
import {
  computeOctahedralSeedCenter3D,
  getOctahedralSeedGrid3D,
} from "../src/octahedral-layout3d.js";

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

function initialSpringStrains(controller: OctahedralLivePhysics3D): number[] {
  const values: number[] = [];
  for (let edge = 0; edge < controller.template.edgeCount; edge += 1) {
    const a = controller.template.edgeA[edge]!;
    const b = controller.template.edgeB[edge]!;
    const aOffset = packedVertexOffset(controller, 0, a);
    const bOffset = packedVertexOffset(controller, 0, b);
    const length = Math.hypot(
      controller.positions[bOffset]! - controller.positions[aOffset]!,
      controller.positions[bOffset + 1]! - controller.positions[aOffset + 1]!,
      controller.positions[bOffset + 2]! - controller.positions[aOffset + 2]!,
    );
    values.push(Math.abs(length - controller.template.edgeRestLength));
  }
  values.sort((left, right) => left - right);
  return values;
}

function p95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)]!;
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

let maxRingCenterDistance = 0;
for (let level = 0; level <= self.template.octahedronCount; level += 1) {
  const first = level * 3;
  const centroid = centroidOfVertices(self, 0, [first, first + 1, first + 2]);
  maxRingCenterDistance = Math.max(
    maxRingCenterDistance,
    Math.hypot(
      centroid[0] - initialCenter[0],
      centroid[1] - initialCenter[1],
      centroid[2] - initialCenter[2],
    ),
  );
}
assert(
  maxRingCenterDistance > self.template.restLength / (8 * Math.PI),
  "double-self seed has nonzero longitudinal centerline extent instead of a collapsed center plane",
);

const baselineSelf = createOctahedralLivePhysics3D(selfNetwork, {
  aspectRatio: Math.SQRT2 * (20 / 2 + 1),
  stiffness: 1,
  simulationSpeed: 0,
});
same(baselineSelf.template.octahedronCount, 20, "self-loop strain gate uses the accepted 20-octahedron baseline");
const baselineStrains = initialSpringStrains(baselineSelf);
assert(
  p95(baselineStrains) <= 0.25,
  `20-octahedron self-loop seed p95 strain is bounded: ${p95(baselineStrains)}`,
);
assert(
  (baselineStrains.at(-1) ?? 0) <= 0.25,
  `20-octahedron self-loop seed max strain is bounded: ${baselineStrains.at(-1) ?? 0}`,
);

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


function geometricCenter(
  controller: OctahedralLivePhysics3D,
  link: number,
): readonly [number, number, number] {
  return computeOctahedralGeometricCenter3D(controller.template, controller.positions, link);
}

function span(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function centroidOfVertices(
  controller: OctahedralLivePhysics3D,
  link: number,
  vertices: readonly number[],
): readonly [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const vertex of vertices) {
    const offset = packedVertexOffset(controller, link, vertex);
    x += controller.positions[offset]!;
    y += controller.positions[offset + 1]!;
    z += controller.positions[offset + 2]!;
  }
  return [x / vertices.length, y / vertices.length, z / vertices.length];
}

function normalizedDirection(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): readonly [number, number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  assert(length > 1e-9, "direction fixture must have nonzero length");
  return [dx / length, dy / length, dz / length];
}

const rootPairNetwork: VisualLinkNetwork = {
  links: [
    { key: "R", startKey: "R", endKey: "R" },
    { key: "O", startKey: "O", endKey: "R" },
  ],
};
const rootPair = createOctahedralLivePhysics3D(rootPairNetwork, {
  aspectRatio: Math.SQRT2 * (100 / 2 + 1),
  stiffness: 5,
  simulationSpeed: 4,
});
same(rootPair.template.octahedronCount, 100, "R+O separation witness uses 100 octahedra");
const rootIndex = rootPair.topology.keys.indexOf("R");
const openIndex = rootPair.topology.keys.indexOf("O");
assert(rootIndex >= 0 && openIndex >= 0, "R+O separation witness resolves canonical keys");

function rootOpenDistance(): number {
  const r = geometricCenter(rootPair, rootIndex);
  const o = geometricCenter(rootPair, openIndex);
  return Math.hypot(o[0] - r[0], o[1] - r[1], o[2] - r[2]);
}

const halfRestLength = rootPair.template.restLength / 2;
const rootOpenSamples = new Map<number, number>();
rootOpenSamples.set(0, rootOpenDistance());
let rootOpenMaxDistance = rootOpenSamples.get(0)!;
for (let step = 1; step <= 1200; step += 1) {
  rootPair.step();
  const distance = rootOpenDistance();
  rootOpenMaxDistance = Math.max(rootOpenMaxDistance, distance);
  if (step === 1 || step === 30 || step === 300 || step === 1200) {
    rootOpenSamples.set(step, distance);
  }
}
const rootOpenDiagnostic = [0, 1, 30, 300, 1200]
  .map((step) => {
    const distance = rootOpenSamples.get(step)!;
    return `${step}:${distance.toFixed(6)}(${(distance / halfRestLength).toFixed(4)}L)`;
  })
  .join(" ");
console.log(
  `[M5/P2 R+O self-separation] halfLength=${halfRestLength.toFixed(6)} ${rootOpenDiagnostic} max=${rootOpenMaxDistance.toFixed(6)}(${(rootOpenMaxDistance / halfRestLength).toFixed(4)}L)`,
);
assert(
  rootOpenMaxDistance > rootOpenSamples.get(0)!,
  `R+O compressed non-self half must create some center separation: initial=${rootOpenSamples.get(0)} max=${rootOpenMaxDistance}`,
);

const planarNetwork: VisualLinkNetwork = {
  links: Array.from({ length: 4 }, (_, index) => ({
    key: `P${index}`,
    startKey: `P${index}`,
    endKey: `P${index}`,
  })),
};
const planar = createOctahedralLivePhysics3D(planarNetwork, {
  aspectRatio: ratio,
  stiffness: 1,
  simulationSpeed: 0,
});
const p0 = geometricCenter(planar, 0);
const p1 = geometricCenter(planar, 1);
const p2 = geometricCenter(planar, 2);
const ab = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]] as const;
const ac = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]] as const;
const cross = [
  ab[1] * ac[2] - ab[2] * ac[1],
  ab[2] * ac[0] - ab[0] * ac[2],
  ab[0] * ac[1] - ab[1] * ac[0],
] as const;
assert(Math.hypot(...cross) > 1e-6, "four-Link seed centers are not collinear");

const largeCount = 333;
const largeNetwork: VisualLinkNetwork = {
  links: Array.from({ length: largeCount }, (_, index) => ({
    key: `L${index}`,
    startKey: `L${(index * 17 + 3) % largeCount}`,
    endKey: `L${(index * 31 + 7) % largeCount}`,
  })),
};
const large = createOctahedralLivePhysics3D(largeNetwork, {
  aspectRatio: ratio,
  stiffness: 1,
  simulationSpeed: 0,
});
const centers = Array.from(
  { length: largeCount },
  (_, index) => geometricCenter(large, index),
);
const xs = centers.map((center) => center[0]);
const ys = centers.map((center) => center[1]);
const zs = centers.map((center) => center[2]);
assert(span(xs) > 0, "333-Link seed has nonzero X span");
assert(span(ys) > 0, "333-Link seed has nonzero Y span");
assert(span(zs) > 0, "333-Link seed has nonzero Z span");

const grid = getOctahedralSeedGrid3D(large.template, largeCount);
same(grid.side, 7, "333-Link seed resolves to seven-wide cube");
same(grid.depth, 7, "333-Link seed resolves to seven-deep cube");
assert(
  span(xs) <= (grid.side - 1) * grid.spacing + 1e-5,
  "X extent is bounded by cubic-grid side rather than Link count",
);
assert(
  span(ys) <= (grid.side - 1) * grid.spacing + 1e-5,
  "Y extent is bounded by cubic-grid side rather than Link count",
);
assert(
  span(zs) <= (grid.depth - 1) * grid.spacing + 1e-5,
  "Z extent is bounded by cubic-grid depth rather than Link count",
);
assert(
  Math.max(span(xs), span(ys), span(zs)) < (largeCount - 1) * grid.spacing * 0.1,
  "333-Link seed explicitly rejects the former O(N) one-dimensional extent",
);

for (let index = 0; index < largeCount; index += 1) {
  const expected = computeOctahedralSeedCenter3D(large.template, index, largeCount);
  const actual = centers[index]!;
  approx(actual[0], expected[0], `seed center ${index} x survives hinge projection`, 2e-6);
  approx(actual[1], expected[1], `seed center ${index} y survives hinge projection`, 2e-6);
  approx(actual[2], expected[2], `seed center ${index} z survives hinge projection`, 2e-6);
}

const orientationNetwork: VisualLinkNetwork = {
  links: [
    { key: "OA", startKey: "OA", endKey: "OB" },
    { key: "OB", startKey: "OC", endKey: "OD" },
    { key: "OC", startKey: "OA", endKey: "OC" },
    { key: "OD", startKey: "OD", endKey: "OD" },
  ],
};
const oriented = createOctahedralLivePhysics3D(orientationNetwork, {
  aspectRatio: ratio,
  stiffness: 1,
  simulationSpeed: 0,
});
const orientedLink = 1;
const startTarget = oriented.topology.startIndices[orientedLink]!;
const endTarget = oriented.topology.endIndices[orientedLink]!;
const desired = normalizedDirection(
  computeOctahedralSeedCenter3D(oriented.template, startTarget, oriented.topology.linkCount),
  computeOctahedralSeedCenter3D(oriented.template, endTarget, oriented.topology.linkCount),
);
const startRing = centroidOfVertices(oriented, orientedLink, [0, 1, 2]);
const lastLevel = oriented.template.octahedronCount * 3;
const endRing = centroidOfVertices(oriented, orientedLink, [
  lastLevel,
  lastLevel + 1,
  lastLevel + 2,
]);
const actualAxis = normalizedDirection(startRing, endRing);
const axisDot = desired[0] * actualAxis[0]
  + desired[1] * actualAxis[1]
  + desired[2] * actualAxis[2];
assert(axisDot > 0.99999, "non-self mast initial longitudinal axis follows START-target -> END-target seed direction");
