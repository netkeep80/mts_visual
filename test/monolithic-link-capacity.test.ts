import {
  planMonolithicLinkWebGpuCapacity3D,
} from "../src/webgpu/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`@mts/visual #148/#153 capacity: ${message}`);
  }
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(
    Object.is(actual, expected),
    `${message}: ${String(actual)} !== ${String(expected)}`,
  );
}

const MIB = 1024 * 1024;
const storage128MiB = 128 * MIB;

function aspectForOctahedra(octahedronCount: number): number {
  assert(
    Number.isSafeInteger(octahedronCount)
      && octahedronCount >= 2
      && octahedronCount % 2 === 0,
    `invalid test octahedronCount ${octahedronCount}`,
  );
  return (octahedronCount / 2) * Math.SQRT2;
}

const ladder = [16, 32, 64, 128, 256].map((octahedronCount) =>
  planMonolithicLinkWebGpuCapacity3D(
    1_000_000,
    aspectForOctahedra(octahedronCount),
    {
      maxStorageBufferBindingSize: storage128MiB,
      maxBufferSize: 256 * MIB,
      maxComputeWorkgroupsPerDimension: 65_535,
    },
  )
);

const expectedDetailCaps = new Map([
  [16, 493_447],
  [32, 254_200],
  [64, 129_055],
  [128, 65_027],
  [256, 32_640],
]);

for (const plan of ladder) {
  same(
    plan.sectionCount,
    plan.octahedronCount + 1,
    `${plan.octahedronCount}: section count`,
  );
  same(
    plan.persistentBytesPerLink,
    148,
    `${plan.octahedronCount}: global persistent bytes/Link no longer depend on visual resolution`,
  );
  same(
    plan.detailBytesPerSlot,
    4 + plan.sectionCount * 16,
    `${plan.octahedronCount}: detail slot formula`,
  );
  same(
    plan.detailCapacity,
    expectedDetailCaps.get(plan.octahedronCount),
    `${plan.octahedronCount}: adapter-bounded detail capacity`,
  );
  same(
    plan.detailedLinkCount,
    plan.detailCapacity,
    `${plan.octahedronCount}: default detail selection fills bounded cache`,
  );
  same(
    plan.sectionFrameBytes,
    plan.detailCapacity * plan.sectionCount * 16,
    `${plan.octahedronCount}: section frames scale with detail slots, not all Links`,
  );
  same(
    plan.largestStorageBuffer.name,
    "shape.sectionFrames",
    `${plan.octahedronCount}: bounded detail cache remains largest individual binding`,
  );
  assert(
    plan.largestStorageBuffer.allocatedBytes <= storage128MiB,
    `${plan.octahedronCount}: largest storage binding is bounded to adapter limit`,
  );
  same(
    plan.limits.maximumLinksByStorageBinding,
    2_796_202,
    `${plan.octahedronCount}: semantic storage capacity is dominated by 48 B/Link force buffer`,
  );
  assert(
    plan.limits.fitsStorageBindingLimit,
    `${plan.octahedronCount}: one million semantic Links fit 128 MiB per binding after detail split`,
  );
  assert(
    plan.limits.fitsBufferSizeLimit,
    `${plan.octahedronCount}: one million Links fit 256 MiB maxBufferSize with bounded detail cache`,
  );
  assert(
    plan.limits.fitsDispatchLimit,
    `${plan.octahedronCount}: one million Links fit current 2D dispatch capacity`,
  );
  assert(
    plan.limits.fits,
    `${plan.octahedronCount}: capacity planner accepts 1M under the modeled adapter limits`,
  );
  same(
    plan.semanticInvocationsPerStep,
    3_000_000,
    `${plan.octahedronCount}: 2 physics + 1 compact shape invocation per semantic Link`,
  );
  same(
    plan.detailInvocationsPerStep,
    plan.detailCapacity,
    `${plan.octahedronCount}: expensive detail solve scales only with detail slots`,
  );
  same(
    plan.computePassesPerStep,
    4,
    `${plan.octahedronCount}: 2 physics + compact shape + bounded detail pass`,
  );
  assert(
    plan.compactPersistentGpuBytes >= 148_000_000,
    `${plan.octahedronCount}: compact persistent footprint includes 148 MB Link-dependent state`,
  );
  assert(
    plan.persistentGpuBytes < 290_000_000,
    `${plan.octahedronCount}: 1M modeled persistent buffers stay below 290 MB with bounded detail cache`,
  );
}

for (let index = 1; index < ladder.length; index += 1) {
  const previous = ladder[index - 1]!;
  const current = ladder[index]!;
  same(
    current.persistentBytesPerLink,
    previous.persistentBytesPerLink,
    "global Link state stays independent of octahedral visual resolution",
  );
  assert(
    current.detailCapacity < previous.detailCapacity,
    "higher visual detail reduces bounded detail-slot count at fixed adapter limit",
  );
}

const million128 = ladder.find((plan) => plan.octahedronCount === 128)!;
assert(
  million128.compactPersistentGpuBytes < 149_000_000,
  "1M/128-octa compact global path is below 149 MB before detail cache",
);
assert(
  million128.detailCacheBytes < 135_000_000,
  "1M/128-octa bounded detail cache is below 135 MB",
);
assert(
  million128.persistentGpuBytes < 284_000_000,
  "1M/128-octa total modeled persistent buffers are below 284 MB",
);
same(
  million128.dispatch.workgroupsY,
  1,
  "1M global semantic Links still fit one dispatch row",
);

const storage32MiB = planMonolithicLinkWebGpuCapacity3D(
  1_000_000,
  aspectForOctahedra(128),
  {
    maxStorageBufferBindingSize: 32 * MIB,
    maxBufferSize: 256 * MIB,
  },
);
assert(
  !storage32MiB.limits.fitsStorageBindingLimit,
  "32 MiB storage bindings reject 1M because compact semantic force buffer is 48 MB",
);
same(
  storage32MiB.limits.maximumLinksByStorageBinding,
  699_050,
  "32 MiB semantic capacity is explicitly reported",
);

const noLimit = planMonolithicLinkWebGpuCapacity3D(
  1_000,
  aspectForOctahedra(32),
);
same(noLimit.detailCapacity, 1_000, "without adapter limits all small Links receive detail");
same(
  noLimit.sectionFrameBytes,
  1_000 * 33 * 16,
  "small-network no-limit behavior retains full-detail compatibility",
);
same(
  noLimit.surfaceVertexInvocations,
  noLimit.surfaceVerticesPerLink * 1_000,
  "renderer work follows detailed Link count",
);

for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  try {
    planMonolithicLinkWebGpuCapacity3D(invalid, aspectForOctahedra(16));
    throw new Error(`invalid linkCount accepted: ${invalid}`);
  } catch (error) {
    assert(
      String(error).includes("invalid monolithic capacity linkCount"),
      `invalid linkCount fails closed: ${invalid}`,
    );
  }
}

console.log(
  "[v0.6 #148/#153 bounded detail capacity] "
  + ladder.map((plan) =>
    `${plan.octahedronCount}octa:1M=${(plan.persistentGpuBytes / 1_000_000_000).toFixed(3)}GB`
    + `,detail=${plan.detailCapacity}`
  ).join(" | "),
);
