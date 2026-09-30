import {
  planMonolithicLinkWebGpuCapacity3D,
} from "../src/webgpu/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`@mts/visual #148 capacity: ${message}`);
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
      maxComputeWorkgroupsPerDimension: 65_535,
    },
  )
);

for (const plan of ladder) {
  same(
    plan.sectionCount,
    plan.octahedronCount + 1,
    `${plan.octahedronCount}: section count`,
  );
  same(
    plan.persistentBytesPerLink,
    164 + 16 * plan.octahedronCount,
    `${plan.octahedronCount}: persistent bytes/link formula`,
  );
  same(
    plan.sectionFrameBytes,
    1_000_000 * plan.sectionCount * 16,
    `${plan.octahedronCount}: section-frame buffer formula`,
  );
  same(
    plan.largestStorageBuffer.name,
    "shape.sectionFrames",
    `${plan.octahedronCount}: section frames are current largest binding`,
  );
  same(
    plan.limits.maximumLinksByStorageBinding,
    Math.floor(storage128MiB / (plan.sectionCount * 16)),
    `${plan.octahedronCount}: exact 128 MiB binding capacity`,
  );
  assert(
    !plan.limits.fitsStorageBindingLimit,
    `${plan.octahedronCount}: one million Links must expose current binding limit`,
  );
  assert(
    plan.limits.fitsDispatchLimit,
    `${plan.octahedronCount}: one million Links fit current 2D dispatch capacity`,
  );
  same(
    plan.semanticInvocationsPerStep,
    3_000_000,
    `${plan.octahedronCount}: physics+shape semantic invocation count`,
  );
  same(
    plan.computePassesPerStep,
    3,
    `${plan.octahedronCount}: current monolithic frame uses 2 physics + 1 shape compute pass`,
  );
}

const expectedBindingCaps = new Map([
  [16, 493_447],
  [32, 254_200],
  [64, 129_055],
  [128, 65_027],
  [256, 32_640],
]);
for (const plan of ladder) {
  same(
    plan.limits.maximumLinksByStorageBinding,
    expectedBindingCaps.get(plan.octahedronCount),
    `${plan.octahedronCount}: pinned 128 MiB capacity witness`,
  );
}

const hundredThousand64 = planMonolithicLinkWebGpuCapacity3D(
  100_000,
  aspectForOctahedra(64),
  { maxStorageBufferBindingSize: storage128MiB },
);
assert(
  hundredThousand64.limits.fits,
  "100k Links at 64 octahedra fit a 128 MiB per-storage-binding adapter",
);
assert(
  hundredThousand64.persistentGpuBytes > 100 * MIB,
  "100k/64-octa persistent GPU footprint is already above 100 MiB",
);

const hundredThousand128 = planMonolithicLinkWebGpuCapacity3D(
  100_000,
  aspectForOctahedra(128),
  { maxStorageBufferBindingSize: storage128MiB },
);
assert(
  !hundredThousand128.limits.fits,
  "100k Links at 128 octahedra exceed a 128 MiB storage binding",
);
assert(
  hundredThousand128.sectionFrameBytes > storage128MiB,
  "128-octa section-frame buffer is the concrete 100k blocker",
);

const million128 = ladder.find((plan) => plan.octahedronCount === 128)!;
assert(
  million128.persistentGpuBytes > 2_200_000_000,
  "1M/128-octa current persistent GPU buffers exceed 2.2 GB",
);
assert(
  million128.dispatch.workgroupsY === 1,
  "1M Links do not require Y spill in current 64-thread dispatch",
);

for (let index = 1; index < ladder.length; index += 1) {
  assert(
    ladder[index]!.persistentGpuBytes > ladder[index - 1]!.persistentGpuBytes,
    "persistent footprint must increase with visual octahedron count",
  );
  assert(
    ladder[index]!.limits.maximumLinksByStorageBinding!
      < ladder[index - 1]!.limits.maximumLinksByStorageBinding!,
    "binding-limited Link capacity must decrease with visual octahedron count",
  );
}

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
  "[v0.6 #148 monolithic capacity] "
  + ladder.map((plan) =>
    `${plan.octahedronCount}octa:1M=${(plan.persistentGpuBytes / 1_000_000_000).toFixed(3)}GB`
    + `,max@128MiB=${plan.limits.maximumLinksByStorageBinding}`
  ).join(" | "),
);
