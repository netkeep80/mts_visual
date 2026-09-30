export const MONOLITHIC_WEBGPU_BENCHMARK_SCHEMA_ID =
  "mts-visual/mechanical-webgpu-benchmark";
export const MONOLITHIC_WEBGPU_BENCHMARK_SCHEMA_VERSION = "1.0.0";
export const MONOLITHIC_WEBGPU_BENCHMARK_TIMING_SOURCE =
  "host-wall-after-queue-sync";

export type MonolithicLinkBenchmarkDetailProfile3D =
  | "semantic"
  | "detail-256"
  | "detail-1024"
  | "detail-4096"
  | "full-detail";

export interface MonolithicLinkBenchmarkStatistics3D {
  readonly sampleCount: number;
  readonly minMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly meanMs: number;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `invalid monolithic benchmark ${label}: ${String(value)}`,
    );
  }
  return value;
}

export function aspectRatioForMonolithicBenchmarkOctahedra3D(
  octahedronCount: number,
): number {
  requirePositiveInteger(octahedronCount, "octahedronCount");
  if (octahedronCount < 2 || octahedronCount % 2 !== 0) {
    throw new Error(
      `invalid monolithic benchmark octahedronCount: ${octahedronCount}`,
    );
  }
  return (octahedronCount / 2) * Math.SQRT2;
}

export function detailCapacityForMonolithicBenchmark3D(
  profile: MonolithicLinkBenchmarkDetailProfile3D,
  linkCountValue: number,
): number {
  const linkCount = requirePositiveInteger(
    linkCountValue,
    "linkCount",
  );
  switch (profile) {
    case "semantic":
      return 0;
    case "detail-256":
      return Math.min(256, linkCount);
    case "detail-1024":
      return Math.min(1024, linkCount);
    case "detail-4096":
      return Math.min(4096, linkCount);
    case "full-detail":
      return linkCount;
    default: {
      const unreachable: never = profile;
      throw new Error(
        `unsupported monolithic benchmark detail profile: ${String(unreachable)}`,
      );
    }
  }
}

function quantileNearestRank(
  sorted: readonly number[],
  percentile: number,
): number {
  const index = Math.max(
    0,
    Math.min(
      sorted.length - 1,
      Math.ceil(percentile * sorted.length) - 1,
    ),
  );
  return sorted[index]!;
}

export function summarizeMonolithicLinkBenchmarkSamples3D(
  samples: readonly number[],
): MonolithicLinkBenchmarkStatistics3D {
  if (samples.length === 0) {
    throw new Error("monolithic benchmark statistics require samples");
  }
  const sorted = samples.map((sample, index) => {
    if (!Number.isFinite(sample) || sample < 0) {
      throw new Error(
        `invalid monolithic benchmark sample[${index}]: ${String(sample)}`,
      );
    }
    return sample;
  }).sort((left, right) => left - right);

  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
  const mean =
    sorted.reduce((sum, value) => sum + value, 0)
    / sorted.length;

  return Object.freeze({
    sampleCount: sorted.length,
    minMs: sorted[0]!,
    medianMs: median,
    p95Ms: quantileNearestRank(sorted, 0.95),
    maxMs: sorted[sorted.length - 1]!,
    meanMs: mean,
  });
}
