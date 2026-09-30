import type {
  MonolithicLinkSpringOptions3D,
} from "../monolithic-link-spring3d.js";
import {
  planMonolithicLinkWebGpuCapacity3D,
  type MonolithicLinkWebGpuCapacityPlan3D,
} from "./monolithic-link-capacity.js";
import {
  createMonolithicLinkBenchmarkTopology3D,
  type MonolithicLinkBenchmarkProfile3D,
} from "./monolithic-link-benchmark.js";
import {
  createMonolithicLinkWebGpuComputeFromTopology3D,
  type MonolithicLinkWebGpuSnapshot3D,
} from "./monolithic-link-compute.js";
import {
  createMonolithicLinkWebGpuShape3D,
  type MonolithicLinkWebGpuShapeSnapshot3D,
} from "./monolithic-link-shape.js";
import type {
  WebGpuDeviceLike,
} from "./octahedral-compute.js";

export type MonolithicLinkBenchmarkStatus3D =
  | "PASS"
  | "CAPACITY_BLOCKED"
  | "RUNTIME_FAILED";

export type MonolithicLinkBenchmarkTimingSource3D =
  | "host-wall-after-queue-sync"
  | "host-wall-submit-only";

export interface MonolithicLinkBenchmarkStageStats3D {
  readonly samples: number;
  readonly minMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly meanMs: number;
}

export interface MonolithicLinkBenchmarkRunOptions3D {
  readonly linkCount: number;
  readonly topologyProfile: MonolithicLinkBenchmarkProfile3D;
  readonly seed?: number;
  readonly aspectRatio: number;
  readonly detailCapacity: number;
  readonly warmupIterations?: number;
  readonly sampleCount?: number;
  readonly physics: Omit<MonolithicLinkSpringOptions3D, "aspectRatio">;
  readonly now?: () => number;
}

export interface MonolithicLinkBenchmarkCoreResult3D {
  readonly status: MonolithicLinkBenchmarkStatus3D;
  readonly timingSource: MonolithicLinkBenchmarkTimingSource3D;
  readonly queueSyncSupported: boolean;
  readonly topologyProfile: MonolithicLinkBenchmarkProfile3D;
  readonly seed: number;
  readonly linkCount: number;
  readonly octahedronCount: number;
  readonly requestedDetailCapacity: number;
  readonly effectiveDetailCapacity: number;
  readonly topologyInputBytes: number | null;
  readonly warmupIterations: number;
  readonly sampleCount: number;
  readonly capacity: MonolithicLinkWebGpuCapacityPlan3D;
  readonly initialization: Readonly<{
    topologyGenerationMs: number | null;
    computeCreationMs: number | null;
    shapeCreationMs: number | null;
    totalMs: number | null;
  }>;
  readonly stages: Readonly<{
    physics: MonolithicLinkBenchmarkStageStats3D | null;
    shape: MonolithicLinkBenchmarkStageStats3D | null;
    totalIteration: MonolithicLinkBenchmarkStageStats3D | null;
  }>;
  readonly computeSnapshot: MonolithicLinkWebGpuSnapshot3D | null;
  readonly shapeSnapshot: MonolithicLinkWebGpuShapeSnapshot3D | null;
  readonly blockReason: string | null;
  readonly error: string | null;
}

const IDENTITY_VIEW_PROJECTION = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

function requirePositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error(
      `invalid monolithic benchmark ${name}: ${String(value)}`,
    );
  }
  return resolved;
}

function requireNonNegativeInteger(
  value: number,
  name: string,
): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `invalid monolithic benchmark ${name}: ${String(value)}`,
    );
  }
  return value;
}

function clockOf(
  candidate: (() => number) | undefined,
): () => number {
  if (candidate !== undefined) return candidate;
  const performanceNow = globalThis.performance?.now?.bind(
    globalThis.performance,
  );
  return performanceNow ?? (() => Date.now());
}

function elapsed(
  start: number,
  finish: number,
): number {
  const value = finish - start;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `invalid monolithic benchmark clock delta: ${String(value)}`,
    );
  }
  return value;
}

function summarize(
  values: readonly number[],
): MonolithicLinkBenchmarkStageStats3D {
  if (values.length === 0) {
    throw new Error("cannot summarize empty monolithic benchmark sample set");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const medianIndex = Math.floor((sorted.length - 1) / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[medianIndex]!
      : (
        sorted[medianIndex]!
        + sorted[medianIndex + 1]!
      ) / 2;
  const p95Index = Math.max(
    0,
    Math.ceil(sorted.length * 0.95) - 1,
  );
  const mean = values.reduce(
    (sum, value) => sum + value,
    0,
  ) / values.length;

  return Object.freeze({
    samples: values.length,
    minMs: sorted[0]!,
    medianMs: median,
    p95Ms: sorted[p95Index]!,
    maxMs: sorted[sorted.length - 1]!,
    meanMs: mean,
  });
}

async function queueSync(
  device: WebGpuDeviceLike,
): Promise<boolean> {
  const sync = device.queue.onSubmittedWorkDone;
  if (typeof sync !== "function") return false;
  await sync.call(device.queue);
  return true;
}

async function timedSubmission(
  device: WebGpuDeviceLike,
  now: () => number,
  submit: () => void,
): Promise<Readonly<{
  milliseconds: number;
  queueSyncUsed: boolean;
}>> {
  const start = now();
  submit();
  const queueSyncUsed = await queueSync(device);
  const finish = now();
  return Object.freeze({
    milliseconds: elapsed(start, finish),
    queueSyncUsed,
  });
}

function adapterLimits(
  device: WebGpuDeviceLike,
): Readonly<{
  maxStorageBufferBindingSize?: number;
  maxBufferSize?: number;
  maxComputeWorkgroupsPerDimension?: number;
}> {
  return Object.freeze({
    ...(device.limits?.maxStorageBufferBindingSize === undefined
      ? {}
      : {
        maxStorageBufferBindingSize:
          device.limits.maxStorageBufferBindingSize,
      }),
    ...(device.limits?.maxBufferSize === undefined
      ? {}
      : { maxBufferSize: device.limits.maxBufferSize }),
    ...(device.limits?.maxComputeWorkgroupsPerDimension === undefined
      ? {}
      : {
        maxComputeWorkgroupsPerDimension:
          device.limits.maxComputeWorkgroupsPerDimension,
      }),
  });
}

function capacityBlockReason(
  plan: MonolithicLinkWebGpuCapacityPlan3D,
): string | null {
  if (!plan.limits.fitsStorageBindingLimit) {
    return "maxStorageBufferBindingSize";
  }
  if (!plan.limits.fitsBufferSizeLimit) {
    return "maxBufferSize";
  }
  if (!plan.limits.fitsDispatchLimit) {
    return "maxComputeWorkgroupsPerDimension";
  }
  return null;
}

function frozenBase(
  options: MonolithicLinkBenchmarkRunOptions3D,
  seed: number,
  warmupIterations: number,
  sampleCount: number,
  capacity: MonolithicLinkWebGpuCapacityPlan3D,
  queueSyncSupported: boolean,
): Pick<
  MonolithicLinkBenchmarkCoreResult3D,
  | "timingSource"
  | "queueSyncSupported"
  | "topologyProfile"
  | "seed"
  | "linkCount"
  | "octahedronCount"
  | "requestedDetailCapacity"
  | "effectiveDetailCapacity"
  | "warmupIterations"
  | "sampleCount"
  | "capacity"
> {
  return Object.freeze({
    timingSource: queueSyncSupported
      ? "host-wall-after-queue-sync"
      : "host-wall-submit-only",
    queueSyncSupported,
    topologyProfile: options.topologyProfile,
    seed,
    linkCount: options.linkCount,
    octahedronCount: capacity.octahedronCount,
    requestedDetailCapacity: options.detailCapacity,
    effectiveDetailCapacity: capacity.detailCapacity,
    warmupIterations,
    sampleCount,
    capacity,
  });
}

/**
 * Execute real production monolithic compute + shape work for benchmark
 * topology. Capacity planning is only a preflight; PASS is returned only after
 * actual buffers/pipelines are created and timed iterations complete.
 *
 * These are synchronized host wall-clock timings when the queue exposes
 * onSubmittedWorkDone(). They are deliberately not labeled exact GPU pass
 * durations; timestamp-query instrumentation is a separate layer.
 */
export async function runMonolithicLinkWebGpuBenchmark3D(
  device: WebGpuDeviceLike,
  options: MonolithicLinkBenchmarkRunOptions3D,
): Promise<MonolithicLinkBenchmarkCoreResult3D> {
  requireNonNegativeInteger(options.linkCount, "linkCount");
  requireNonNegativeInteger(options.detailCapacity, "detailCapacity");
  const warmupIterations = requirePositiveInteger(
    options.warmupIterations,
    5,
    "warmupIterations",
  );
  const sampleCount = requirePositiveInteger(
    options.sampleCount,
    options.linkCount >= 1_000_000 ? 5 : 20,
    "sampleCount",
  );
  const seed = (options.seed ?? 0x4d545356) >>> 0;
  const now = clockOf(options.now);
  const queueSyncSupported =
    typeof device.queue.onSubmittedWorkDone === "function";

  const capacity = planMonolithicLinkWebGpuCapacity3D(
    options.linkCount,
    options.aspectRatio,
    adapterLimits(device),
    { detailCapacity: options.detailCapacity },
  );
  const base = frozenBase(
    options,
    seed,
    warmupIterations,
    sampleCount,
    capacity,
    queueSyncSupported,
  );
  const blockReason = capacityBlockReason(capacity);
  if (blockReason !== null) {
    return Object.freeze({
      status: "CAPACITY_BLOCKED",
      ...base,
      topologyInputBytes: null,
      initialization: Object.freeze({
        topologyGenerationMs: null,
        computeCreationMs: null,
        shapeCreationMs: null,
        totalMs: null,
      }),
      stages: Object.freeze({
        physics: null,
        shape: null,
        totalIteration: null,
      }),
      computeSnapshot: null,
      shapeSnapshot: null,
      blockReason,
      error: null,
    });
  }

  let compute:
    | Awaited<ReturnType<typeof createMonolithicLinkWebGpuComputeFromTopology3D>>
    | null = null;
  let shape:
    | Awaited<ReturnType<typeof createMonolithicLinkWebGpuShape3D>>
    | null = null;

  const initStart = now();
  let topologyGenerationMs: number | null = null;
  let computeCreationMs: number | null = null;
  let shapeCreationMs: number | null = null;
  let topologyInputBytes: number | null = null;

  try {
    const topologyStart = now();
    const topology = createMonolithicLinkBenchmarkTopology3D({
      linkCount: options.linkCount,
      profile: options.topologyProfile,
      seed,
    });
    topologyGenerationMs = elapsed(topologyStart, now());
    topologyInputBytes = topology.inputTopologyBytes;

    const computeStart = now();
    compute = await createMonolithicLinkWebGpuComputeFromTopology3D(
      device,
      topology,
      {
        aspectRatio: options.aspectRatio,
        ...options.physics,
      },
    );
    await queueSync(device);
    computeCreationMs = elapsed(computeStart, now());

    const shapeStart = now();
    shape = await createMonolithicLinkWebGpuShape3D(
      device,
      compute,
      options.aspectRatio,
      {
        detailCapacity: capacity.detailCapacity,
      },
    );
    if (
      capacity.detailCapacity > 0
      && options.linkCount > capacity.detailCapacity
    ) {
      shape.setGpuDetailSelectionView({
        viewProjection: IDENTITY_VIEW_PROJECTION,
        selectedLink: null,
        frustumMargin: 0.18,
      });
    }
    shape.update();
    await queueSync(device);
    shapeCreationMs = elapsed(shapeStart, now());

    for (let warmup = 0; warmup < warmupIterations; warmup += 1) {
      compute.step();
      shape.update();
      await queueSync(device);
    }

    const physicsSamples: number[] = [];
    const shapeSamples: number[] = [];
    const totalSamples: number[] = [];
    let synchronizedEveryMeasuredStage = queueSyncSupported;

    for (let sample = 0; sample < sampleCount; sample += 1) {
      const iterationStart = now();

      const physics = await timedSubmission(
        device,
        now,
        () => { compute!.step(); },
      );
      synchronizedEveryMeasuredStage =
        synchronizedEveryMeasuredStage && physics.queueSyncUsed;
      physicsSamples.push(physics.milliseconds);

      const shapeTiming = await timedSubmission(
        device,
        now,
        () => { shape!.update(); },
      );
      synchronizedEveryMeasuredStage =
        synchronizedEveryMeasuredStage && shapeTiming.queueSyncUsed;
      shapeSamples.push(shapeTiming.milliseconds);

      totalSamples.push(elapsed(iterationStart, now()));
    }

    const computeSnapshot = compute.snapshot();
    const shapeSnapshot = shape.snapshot();
    const totalMs = elapsed(initStart, now());

    return Object.freeze({
      status: "PASS",
      ...base,
      timingSource: synchronizedEveryMeasuredStage
        ? "host-wall-after-queue-sync"
        : "host-wall-submit-only",
      queueSyncSupported: synchronizedEveryMeasuredStage,
      topologyInputBytes,
      initialization: Object.freeze({
        topologyGenerationMs,
        computeCreationMs,
        shapeCreationMs,
        totalMs,
      }),
      stages: Object.freeze({
        physics: summarize(physicsSamples),
        shape: summarize(shapeSamples),
        totalIteration: summarize(totalSamples),
      }),
      computeSnapshot,
      shapeSnapshot,
      blockReason: null,
      error: null,
    });
  } catch (error) {
    return Object.freeze({
      status: "RUNTIME_FAILED",
      ...base,
      topologyInputBytes,
      initialization: Object.freeze({
        topologyGenerationMs,
        computeCreationMs,
        shapeCreationMs,
        totalMs: elapsed(initStart, now()),
      }),
      stages: Object.freeze({
        physics: null,
        shape: null,
        totalIteration: null,
      }),
      computeSnapshot: compute?.snapshot() ?? null,
      shapeSnapshot: shape?.snapshot() ?? null,
      blockReason: null,
      error:
        error instanceof Error
          ? error.stack ?? error.message
          : String(error),
    });
  } finally {
    try { shape?.destroy(); } catch {}
    try { compute?.destroy(); } catch {}
  }
}
