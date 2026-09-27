import {
  OCTAHEDRAL_DIAMETER,
  OCTAHEDRAL_EDGE_REST_LENGTH,
  OCTAHEDRAL_MODULE_HEIGHT,
  OctahedralLink3DError,
  accumulateOctahedralSpringForces3D,
  addOctahedralCenterForce3D,
  buildOctahedralLinkTopology3D,
  computeOctahedralGeometricCenter3D,
  computeOctahedralSpringForces3D,
  getOctahedralLinkTemplate3D,
  projectOctahedralHinges3D,
  resolveOctahedralAspectRatio,
  transferOctahedralHingeForces3D,
  type OctahedralLinkTemplate3D,
} from "../src/octahedral-link3d.js";
import type { VisualLinkNetwork } from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual M5/P1: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function approx(actual: number, expected: number, message: string, epsilon = 1e-6): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} != ${expected}`);
}

function vertex(template: OctahedralLinkTemplate3D, positions: Float32Array, index: number) {
  const offset = index * 3;
  return {
    x: positions[offset]!,
    y: positions[offset + 1]!,
    z: positions[offset + 2]!,
  };
}

function distance(
  template: OctahedralLinkTemplate3D,
  positions: Float32Array,
  left: number,
  right: number,
): number {
  const a = vertex(template, positions, left);
  const b = vertex(template, positions, right);
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function sumVector(values: Float32Array): readonly [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let offset = 0; offset < values.length; offset += 3) {
    x += values[offset]!;
    y += values[offset + 1]!;
    z += values[offset + 2]!;
  }
  return [x, y, z];
}

const minimumRatio = 2 * Math.SQRT2;
const minimumResolution = resolveOctahedralAspectRatio(minimumRatio);
same(minimumResolution.pairCount, 1, "minimum legal ratio resolves one octahedron pair");
same(minimumResolution.octahedronCount, 2, "minimum template has two octahedra");
approx(minimumResolution.resolvedAspectRatio, minimumRatio, "exact legal ratio is preserved");

const clampedResolution = resolveOctahedralAspectRatio(0.01);
same(clampedResolution.pairCount, 1, "short requested ratio resolves to minimum legal pair count");
same(clampedResolution.octahedronCount % 2, 0, "resolved octahedron count is always even");

const pairTwoRatio = 3 * Math.SQRT2;
const pairTwoResolution = resolveOctahedralAspectRatio(pairTwoRatio);
same(pairTwoResolution.pairCount, 2, "second legal ratio resolves two pairs");
same(pairTwoResolution.octahedronCount, 4, "second legal ratio has four octahedra");

const minimum = getOctahedralLinkTemplate3D(minimumRatio);
same(minimum.pairCount, 1, "template retains pair count");
same(minimum.octahedronCount, 2, "template retains even octahedron count");
same(minimum.vertexCount, 11, "two-octahedron template has exact vertex count");
same(minimum.edgeCount, 27, "two-octahedron template has exact unique spring count");
same(minimum.surfaceTriangleCount, 18, "surface omits shared internal triangles");
approx(minimum.restLength / minimum.diameter, minimum.aspectRatio, "aspect ratio derives from normalized geometry");
approx(minimum.diameter, OCTAHEDRAL_DIAMETER, "normalized diameter is fixed");
same(minimum.edgeRestLength, OCTAHEDRAL_EDGE_REST_LENGTH, "normalized spring rest length is one");

const pairTwo = getOctahedralLinkTemplate3D(pairTwoRatio);
same(pairTwo.vertexCount, 17, "four-octahedron template vertex count");
same(pairTwo.edgeCount, 45, "four-octahedron template edge count");
same(pairTwo.surfaceTriangleCount, 30, "four-octahedron surface triangle count");
same(pairTwo.surfaceTriangleCount, 6 * pairTwo.octahedronCount + 6, "surface triangle formula");

for (let edge = 0; edge < pairTwo.edgeCount; edge += 1) {
  approx(
    distance(pairTwo, pairTwo.restPositions, pairTwo.edgeA[edge]!, pairTwo.edgeB[edge]!),
    1,
    `rest spring ${edge} is unit length`,
    2e-6,
  );
}

const center = computeOctahedralGeometricCenter3D(pairTwo, pairTwo.restPositions);
approx(center[0], 0, "central triangle centroid x");
approx(center[1], 0, "central triangle centroid y");
approx(center[2], 0, "central triangle centroid z");

const start = vertex(pairTwo, pairTwo.restPositions, pairTwo.startApex);
const end = vertex(pairTwo, pairTwo.restPositions, pairTwo.endApex);
approx(start.x, 0, "START apex on axis x");
approx(start.y, 0, "START apex on axis y");
approx(end.x, 0, "END apex on axis x");
approx(end.y, 0, "END apex on axis y");
approx(start.z, -end.z, "template is longitudinally symmetric");
approx(end.z - start.z, pairTwo.restLength, "apex-to-apex rest length");
approx(
  pairTwo.restLength,
  (pairTwo.octahedronCount + 2) * OCTAHEDRAL_MODULE_HEIGHT,
  "rest length is module-height stack",
);
same(pairTwo.gradientT[pairTwo.startApex]!, 0, "START gradient coordinate is exact zero");
same(pairTwo.gradientT[pairTwo.endApex]!, 1, "END gradient coordinate is exact one");
for (const index of pairTwo.centerTriangle) {
  approx(pairTwo.gradientT[index]!, 0.5, "central triangle gradient coordinate is half");
}

const sameCached = getOctahedralLinkTemplate3D(pairTwoRatio + 0.01);
assert(sameCached === pairTwo, "ratios resolving to same pair count share exact cached template object");

const edgeKeys = new Set<string>();
for (let edge = 0; edge < pairTwo.edgeCount; edge += 1) {
  const a = pairTwo.edgeA[edge]!;
  const b = pairTwo.edgeB[edge]!;
  const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
  assert(!edgeKeys.has(key), `spring edge ${key} occurs only once`);
  edgeKeys.add(key);
}
same(edgeKeys.size, pairTwo.edgeCount, "all spring edges unique");

const batchedEdges = new Set<number>();
for (const [batchIndex, batch] of pairTwo.edgeBatches.entries()) {
  const vertices = new Set<number>();
  for (const edge of batch) {
    assert(!batchedEdges.has(edge), `edge ${edge} belongs to one GPU batch only`);
    batchedEdges.add(edge);
    const a = pairTwo.edgeA[edge]!;
    const b = pairTwo.edgeB[edge]!;
    assert(!vertices.has(a), `batch ${batchIndex} has no repeated vertex ${a}`);
    assert(!vertices.has(b), `batch ${batchIndex} has no repeated vertex ${b}`);
    vertices.add(a);
    vertices.add(b);
  }
}
same(batchedEdges.size, pairTwo.edgeCount, "edge batches cover every spring exactly once");

for (let index = 0; index < pairTwo.surfaceTriangles.length; index += 3) {
  const a = pairTwo.surfaceTriangles[index]!;
  const b = pairTwo.surfaceTriangles[index + 1]!;
  const c = pairTwo.surfaceTriangles[index + 2]!;
  for (const [left, right] of [[a, b], [b, c], [c, a]] as const) {
    const key = `${Math.min(left, right)}:${Math.max(left, right)}`;
    assert(edgeKeys.has(key), `surface triangle uses physical spring edge ${key}`);
  }
}

const restForces = computeOctahedralSpringForces3D(pairTwo, pairTwo.restPositions, 10);
same(restForces.evaluations.edgeEvaluations, pairTwo.edgeCount, "spring kernel evaluates every edge once");
same(restForces.evaluations.pairwiseSemanticLinkEvaluations, 0, "spring kernel has no Link all-pairs path");
same(restForces.evaluations.explicitBendEvaluations, 0, "spring kernel has no explicit bend path");
for (const value of restForces.forces) approx(value, 0, "regular rest template has zero force", 2e-5);

const stretchedPositions = pairTwo.restPositions.slice();
const stretchedEndZ = pairTwo.endApex * 3 + 2;
stretchedPositions[stretchedEndZ] = stretchedPositions[stretchedEndZ]! + 0.2;
const stretchedForces = computeOctahedralSpringForces3D(pairTwo, stretchedPositions, 4);
const stretchedNorm = Math.hypot(...stretchedForces.forces);
assert(stretchedNorm > 0, "stretching END tetra apex creates spring force");
const stretchedTotal = sumVector(stretchedForces.forces);
approx(stretchedTotal[0], 0, "internal spring force conserves x");
approx(stretchedTotal[1], 0, "internal spring force conserves y");
approx(stretchedTotal[2], 0, "internal spring force conserves z");

const centerForces = new Float32Array(pairTwo.vertexCount * 3);
addOctahedralCenterForce3D(pairTwo, centerForces, 0, 3, -6, 9);
for (const centerVertex of pairTwo.centerTriangle) {
  const offset = centerVertex * 3;
  approx(centerForces[offset]!, 1, "center x force is divided by three");
  approx(centerForces[offset + 1]!, -2, "center y force is divided by three");
  approx(centerForces[offset + 2]!, 3, "center z force is divided by three");
}
const centerTotal = sumVector(centerForces);
approx(centerTotal[0], 3, "virtual center preserves total x force");
approx(centerTotal[1], -6, "virtual center preserves total y force");
approx(centerTotal[2], 9, "virtual center preserves total z force");

const selfNetwork: VisualLinkNetwork = {
  links: [{ key: "R", startKey: "R", endKey: "R" }],
};
const selfTopology = buildOctahedralLinkTopology3D(selfNetwork);
same(selfTopology.linkCount, 1, "self network has one physical Link instance");
same(selfTopology.startIndices[0]!, 0, "self START targets own geometric center");
same(selfTopology.endIndices[0]!, 0, "self END targets own geometric center");

const selfPositions = pairTwo.restPositions.slice();
same(projectOctahedralHinges3D(selfTopology, pairTwo, selfPositions), 2, "double self-Link projects two hinges");
const selfCenter = computeOctahedralGeometricCenter3D(pairTwo, selfPositions);
const selfStart = vertex(pairTwo, selfPositions, pairTwo.startApex);
const selfEnd = vertex(pairTwo, selfPositions, pairTwo.endApex);
approx(selfStart.x, selfCenter[0], "self START apex attaches to geometric center x");
approx(selfStart.y, selfCenter[1], "self START apex attaches to geometric center y");
approx(selfStart.z, selfCenter[2], "self START apex attaches to geometric center z");
approx(selfEnd.x, selfCenter[0], "self END apex attaches to geometric center x");
approx(selfEnd.y, selfCenter[1], "self END apex attaches to geometric center y");
approx(selfEnd.z, selfCenter[2], "self END apex attaches to geometric center z");
assert(selfPositions.every(Number.isFinite), "double self-Link projection remains finite");

let nonApexRadius = 0;
for (let index = 0; index < pairTwo.vertexCount; index += 1) {
  if (index === pairTwo.startApex || index === pairTwo.endApex) continue;
  const p = vertex(pairTwo, selfPositions, index);
  nonApexRadius = Math.max(nonApexRadius, Math.hypot(p.x - selfCenter[0], p.y - selfCenter[1], p.z - selfCenter[2]));
}
assert(nonApexRadius > 0.5, "double self-Link does not collapse all material vertices to its center");

const selfForces = new Float32Array(pairTwo.vertexCount * 3);
let offset = pairTwo.startApex * 3;
selfForces[offset] = 3;
selfForces[offset + 1] = 6;
selfForces[offset + 2] = 9;
offset = pairTwo.endApex * 3;
selfForces[offset] = -6;
selfForces[offset + 1] = 3;
selfForces[offset + 2] = 12;
const forceBeforeTransfer = sumVector(selfForces);
same(transferOctahedralHingeForces3D(selfTopology, pairTwo, selfForces), 2, "double self-Link transfers two hinge reactions");
const forceAfterTransfer = sumVector(selfForces);
approx(forceAfterTransfer[0], forceBeforeTransfer[0], "self hinge transfer conserves x force");
approx(forceAfterTransfer[1], forceBeforeTransfer[1], "self hinge transfer conserves y force");
approx(forceAfterTransfer[2], forceBeforeTransfer[2], "self hinge transfer conserves z force");
offset = pairTwo.startApex * 3;
approx(selfForces[offset]!, 0, "START apex reaction is consumed by hinge");
offset = pairTwo.endApex * 3;
approx(selfForces[offset]!, 0, "END apex reaction is consumed by hinge");

const topologyNetwork: VisualLinkNetwork = {
  links: [
    { key: "B", startKey: "A", endKey: "B" },
    { key: "A", startKey: "A", endKey: "B" },
  ],
};
const topology = buildOctahedralLinkTopology3D(topologyNetwork);
assert(JSON.stringify(topology.keys) === JSON.stringify(["A", "B"]), "topology uses normalized VisualKey order");
assert(JSON.stringify([...topology.startIndices]) === JSON.stringify([0, 0]), "START indices preserve incidence");
assert(JSON.stringify([...topology.endIndices]) === JSON.stringify([1, 1]), "END indices preserve incidence");

const linkCount = 1_000;
const packedPositions = new Float32Array(linkCount * minimum.vertexCount * 3);
const packedForces = new Float32Array(packedPositions.length);
for (let link = 0; link < linkCount; link += 1) {
  packedPositions.set(minimum.restPositions, link * minimum.vertexCount * 3);
}
let evaluations = 0;
for (let link = 0; link < linkCount; link += 1) {
  evaluations += accumulateOctahedralSpringForces3D(
    minimum,
    packedPositions,
    packedForces,
    1,
    link,
  ).edgeEvaluations;
}
same(evaluations, linkCount * minimum.edgeCount, "packed 1000-Link spring work is exactly N*E");
assert(packedForces.every((value) => Math.abs(value) <= 2e-5), "packed regular templates remain at spring rest");

const longTemplate = getOctahedralLinkTemplate3D(Math.SQRT2 * (500 + 1));
same(longTemplate.octahedronCount, 1_000, "large cached template resolves 1000 octahedra");
same(longTemplate.edgeCount, 9 * (longTemplate.octahedronCount + 1), "edge count grows linearly with octahedron count");
same(longTemplate.surfaceTriangleCount, 6 * longTemplate.octahedronCount + 6, "surface grows linearly with octahedron count");

for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  try {
    resolveOctahedralAspectRatio(invalid);
    throw new Error(`invalid aspect ratio ${String(invalid)} should reject`);
  } catch (error) {
    assert(error instanceof OctahedralLink3DError, "invalid aspect ratio uses octahedral error boundary");
    same(error.code, "invalid-aspect-ratio", "invalid aspect ratio error code");
  }
}

for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
  try {
    computeOctahedralSpringForces3D(minimum, minimum.restPositions, invalid);
    throw new Error(`invalid stiffness ${String(invalid)} should reject`);
  } catch (error) {
    assert(error instanceof OctahedralLink3DError, "invalid stiffness uses octahedral error boundary");
    same(error.code, "invalid-stiffness", "invalid stiffness error code");
  }
}
