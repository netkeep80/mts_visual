import {
  OCTAHEDRAL_PERFORMANCE_LADDER_LINK_COUNTS,
  createOctahedralPerformanceLadder3D,
  estimateOctahedralPerformance3D,
  projectOctahedralUploadBandwidth3D,
} from "../src/octahedral-performance3d.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual M5/P4a: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

const minimumRatio = Math.SQRT2;
const million = estimateOctahedralPerformance3D(1_000_000, minimumRatio);

same(million.linkCount, 1_000_000, "million witness preserves Link count");
same(million.pairCount, 1, "minimum ratio uses one octahedron pair");
same(million.octahedronCount, 2, "minimum ratio uses two octahedra");
same(million.verticesPerLink, 9, "minimum capless template has 9 physical vertices");
same(million.edgesPerLink, 21, "minimum capless template has 21 spring edges");
same(million.surfaceTrianglesPerLink, 14, "minimum capless template has 14 external triangles");

same(million.totalPhysicalVertices, 9_000_000, "million Links contain 9 million physical vertices");
same(million.springEdgeEvaluationsPerTick, 21_000_000, "million tick evaluates exactly 21 million springs");
same(million.hingeTransfersPerTick, 2_000_000, "million tick transfers exactly 2N hinges");
same(million.hingeProjectionsPerTick, 2_000_000, "million tick projects exactly 2N hinges");
same(million.integratedVerticesPerTick, 9_000_000, "million tick integrates every material vertex");
same(million.pairwiseSemanticLinkEvaluations, 0, "million witness has no semantic all-pairs work");

same(million.cpuPositionsBytes, 108_000_000, "million positions bytes");
same(million.cpuVelocitiesBytes, 108_000_000, "million velocities bytes");
same(million.cpuForcesBytes, 108_000_000, "million forces bytes");
same(million.cpuTopologyBytes, 8_000_000, "million Uint32 START/END topology bytes");
same(million.cpuDynamicBytes, 332_000_000, "million current CPU numeric dynamic bytes");

same(million.positionTextureWidth, 3000, "million position texture width matches exact square packing");
same(million.positionTextureHeight, 3000, "million position texture height matches exact square packing");
same(million.positionTextureCapacityVertices, 9_000_000, "million texture capacity is exact");
same(million.gpuPositionTextureBytes, 144_000_000, "million RGBA32F position texture bytes");
same(million.gpuInstanceAddressBytes, 8_000_000, "million vec2 instance-address bytes");
same(million.gpuDynamicBytes, 152_000_000, "million current GPU dynamic bytes");
same(million.cpuTextureStagingBytesPerFrame, 144_000_000, "million CPU staging writes per rendered frame");
same(million.gpuTextureUploadBytesPerFrame, 144_000_000, "million full DataTexture upload bytes per rendered frame");

const sixty = projectOctahedralUploadBandwidth3D(million, 60);
same(sixty.framesPerSecond, 60, "bandwidth witness retains requested FPS");
same(
  sixty.cpuTextureStagingBytesPerSecond,
  8_640_000_000,
  "60-Hz CPU staging projection",
);
same(
  sixty.gpuTextureUploadBytesPerSecond,
  8_640_000_000,
  "60-Hz GPU upload projection",
);

const fractional = projectOctahedralUploadBandwidth3D(million, 59.94);
same(fractional.framesPerSecond, 59.94, "bandwidth witness accepts fractional display rates");
assert(
  fractional.gpuTextureUploadBytesPerSecond > 0
    && fractional.gpuTextureUploadBytesPerSecond < sixty.gpuTextureUploadBytesPerSecond,
  "fractional-rate projection remains finite arithmetic",
);

const ladder = createOctahedralPerformanceLadder3D(minimumRatio);
same(
  JSON.stringify(ladder.map((row) => row.linkCount)),
  JSON.stringify([...OCTAHEDRAL_PERFORMANCE_LADDER_LINK_COUNTS]),
  "default ladder is exactly 100/1k/10k/100k/1M",
);
same(ladder.length, 5, "performance ladder has five deterministic rungs");

for (let index = 0; index < ladder.length; index += 1) {
  const row = ladder[index]!;
  same(row.springEdgeEvaluationsPerTick, row.linkCount * 21, `rung ${index} spring work is N*E`);
  same(row.hingeTransfersPerTick, row.linkCount * 2, `rung ${index} hinge transfers are 2N`);
  same(row.hingeProjectionsPerTick, row.linkCount * 2, `rung ${index} hinge projections are 2N`);
  same(row.integratedVerticesPerTick, row.linkCount * 9, `rung ${index} integrated vertices are N*V`);
  same(row.cpuDynamicBytes, row.linkCount * 332, `rung ${index} CPU numeric bytes are exactly linear`);
  same(row.pairwiseSemanticLinkEvaluations, 0, `rung ${index} has no pairwise work`);

  if (index > 0) {
    const previous = ladder[index - 1]!;
    assert(row.linkCount > previous.linkCount, `rung ${index} Link count increases`);
    assert(row.gpuPositionTextureBytes > previous.gpuPositionTextureBytes, `rung ${index} texture bytes increase`);
  }
}

const longerRatio = Math.SQRT2 * 9;
const longer = estimateOctahedralPerformance3D(10_000, longerRatio);
same(longer.pairCount, 9, "estimator derives non-minimum cached template");
same(longer.octahedronCount, 18, "longer aspect ratio keeps even octahedron count");
same(longer.verticesPerLink, 57, "18-octahedron capless template vertex count");
same(longer.edgesPerLink, 165, "18-octahedron template edge count");
same(longer.springEdgeEvaluationsPerTick, 1_650_000, "longer template cost follows exact N*E");

const empty = estimateOctahedralPerformance3D(0, minimumRatio);
same(empty.totalPhysicalVertices, 0, "empty witness allocates no physical vertices conceptually");
same(empty.cpuDynamicBytes, 0, "empty witness has zero CPU dynamic bytes");
same(empty.positionTextureWidth, 1, "P3 empty texture still has minimum width one");
same(empty.positionTextureHeight, 1, "P3 empty texture still has minimum height one");
same(empty.gpuPositionTextureBytes, 16, "P3 empty texture storage is one RGBA32F texel");
same(empty.gpuInstanceAddressBytes, 0, "empty witness has no instance-address bytes");

for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  try {
    estimateOctahedralPerformance3D(invalid, minimumRatio);
    throw new Error(`invalid link count ${String(invalid)} should reject`);
  } catch (error) {
    assert(error instanceof Error && /linkCount/.test(error.message), "invalid link count fails at estimator boundary");
  }
}

for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
  try {
    projectOctahedralUploadBandwidth3D(million, invalid);
    throw new Error(`invalid fps ${String(invalid)} should reject`);
  } catch (error) {
    assert(error instanceof Error && /framesPerSecond/.test(error.message), "invalid FPS fails at bandwidth boundary");
  }
}
