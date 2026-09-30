import {
  MONOLITHIC_WEBGPU_BENCHMARK_SCHEMA_ID,
  MONOLITHIC_WEBGPU_BENCHMARK_SCHEMA_VERSION,
  MONOLITHIC_WEBGPU_BENCHMARK_TIMING_SOURCE,
  aspectRatioForMonolithicBenchmarkOctahedra3D,
  detailCapacityForMonolithicBenchmark3D,
  summarizeMonolithicLinkBenchmarkSamples3D,
} from "../src/webgpu/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`@mts/visual benchmark-evidence: ${message}`);
  }
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(
    Object.is(actual, expected),
    `${message}: ${String(actual)} !== ${String(expected)}`,
  );
}

same(
  MONOLITHIC_WEBGPU_BENCHMARK_SCHEMA_ID,
  "mts-visual/mechanical-webgpu-benchmark",
  "schema id",
);
same(
  MONOLITHIC_WEBGPU_BENCHMARK_SCHEMA_VERSION,
  "1.0.0",
  "schema version",
);
same(
  MONOLITHIC_WEBGPU_BENCHMARK_TIMING_SOURCE,
  "host-wall-after-queue-sync",
  "timing source",
);

same(
  aspectRatioForMonolithicBenchmarkOctahedra3D(16),
  8 * Math.SQRT2,
  "16-octa aspect ratio",
);
same(
  aspectRatioForMonolithicBenchmarkOctahedra3D(128),
  64 * Math.SQRT2,
  "128-octa aspect ratio",
);

same(detailCapacityForMonolithicBenchmark3D("semantic", 1000), 0, "semantic detail");
same(detailCapacityForMonolithicBenchmark3D("detail-256", 100), 100, "detail-256 clamps");
same(detailCapacityForMonolithicBenchmark3D("detail-1024", 5000), 1024, "detail-1024");
same(detailCapacityForMonolithicBenchmark3D("detail-4096", 1_000_000), 4096, "detail-4096");
same(detailCapacityForMonolithicBenchmark3D("full-detail", 1234), 1234, "full detail");

const odd = summarizeMonolithicLinkBenchmarkSamples3D([5, 1, 9, 3, 7]);
same(odd.sampleCount, 5, "odd sample count");
same(odd.minMs, 1, "odd min");
same(odd.medianMs, 5, "odd median");
same(odd.p95Ms, 9, "odd p95 nearest rank");
same(odd.maxMs, 9, "odd max");
same(odd.meanMs, 5, "odd mean");

const even = summarizeMonolithicLinkBenchmarkSamples3D([1, 2, 3, 100]);
same(even.medianMs, 2.5, "even median");
same(even.p95Ms, 100, "even p95");
same(even.meanMs, 26.5, "even mean");

for (const invalid of [
  () => aspectRatioForMonolithicBenchmarkOctahedra3D(15),
  () => detailCapacityForMonolithicBenchmark3D("detail-256", 0),
  () => summarizeMonolithicLinkBenchmarkSamples3D([]),
  () => summarizeMonolithicLinkBenchmarkSamples3D([1, Number.NaN]),
  () => summarizeMonolithicLinkBenchmarkSamples3D([-1]),
]) {
  try {
    invalid();
    throw new Error("invalid benchmark contract input unexpectedly succeeded");
  } catch (error) {
    assert(
      String(error).includes("monolithic benchmark"),
      "invalid benchmark contract input fails closed",
    );
  }
}

console.log("[v0.6 #161 benchmark evidence contract] PASS");
