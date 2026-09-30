import {
  getOctahedralLinkTemplate3D,
} from "../octahedral-link3d.js";
import {
  computeOctahedralWebGpuDispatch2D,
} from "./octahedral-compute.js";
import {
  buildOctahedralWireframeIndices3D,
} from "./octahedral-renderer.js";

const DEFAULT_MAX_WORKGROUPS_PER_DIMENSION = 65_535;
const WORKGROUP_SIZE = 64;
const COMPUTE_GLOBAL_BYTES = 48;
const SHAPE_GLOBAL_BYTES = 32;
const RENDER_UNIFORM_BYTES = 128;
const END_CONE_VERTEX_COUNT = 48;
const HOVERED_CENTER_VERTEX_COUNT = 480;

export interface MonolithicLinkWebGpuCapacityLimits3D {
  readonly maxStorageBufferBindingSize?: number;
  readonly maxBufferSize?: number;
  readonly maxComputeWorkgroupsPerDimension?: number;
}

export interface MonolithicLinkWebGpuCapacityBuffer3D {
  readonly name: string;
  readonly allocatedBytes: number;
  readonly logicalBytes: number;
  readonly storageBinding: boolean;
}

export interface MonolithicLinkWebGpuCapacityPlan3D {
  readonly linkCount: number;
  readonly octahedronCount: number;
  readonly sectionCount: number;
  readonly persistentGpuBytes: number;
  readonly persistentBytesPerLink: number;
  readonly fixedBytes: number;
  readonly buffers: readonly MonolithicLinkWebGpuCapacityBuffer3D[];
  readonly largestStorageBuffer: MonolithicLinkWebGpuCapacityBuffer3D;
  readonly sectionFrameBytes: number;
  readonly surfaceVerticesPerLink: number;
  readonly wireframeVerticesPerLink: number;
  readonly endConeVerticesPerLink: number;
  readonly hoveredCenterVertices: number;
  readonly surfaceVertexInvocations: number;
  readonly wireframeVertexInvocations: number;
  readonly endConeVertexInvocations: number;
  readonly computePassesPerStep: 3;
  readonly semanticInvocationsPerStep: number;
  readonly dispatch: Readonly<{
    workgroupsX: number;
    workgroupsY: number;
    coveredInvocationsPerPass: number;
    maximumLinksByDispatch: number;
  }>;
  readonly limits: Readonly<{
    maxStorageBufferBindingSize: number | null;
    maxBufferSize: number | null;
    maxComputeWorkgroupsPerDimension: number;
    maximumLinksByStorageBinding: number | null;
    maximumLinksByBufferSize: number | null;
    maximumSupportedLinkCount: number;
    fitsStorageBindingLimit: boolean;
    fitsBufferSizeLimit: boolean;
    fitsDispatchLimit: boolean;
    fits: boolean;
  }>;
}

function requireLinkCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid monolithic capacity linkCount: ${String(value)}`);
  }
  return value;
}

function requireOptionalLimit(
  value: number | undefined,
  name: string,
): number | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`invalid monolithic capacity ${name}: ${String(value)}`);
  }
  return value;
}

function requireWorkgroupLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_WORKGROUPS_PER_DIMENSION;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `invalid monolithic capacity maxComputeWorkgroupsPerDimension: ${String(value)}`,
    );
  }
  return Math.min(value, DEFAULT_MAX_WORKGROUPS_PER_DIMENSION);
}

function safeMultiply(left: number, right: number, label: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`monolithic capacity overflow: ${label}`);
  }
  return result;
}

function safeAdd(values: readonly number[], label: string): number {
  let result = 0;
  for (const value of values) {
    result += value;
    if (!Number.isSafeInteger(result)) {
      throw new Error(`monolithic capacity overflow: ${label}`);
    }
  }
  return result;
}

function allocatedBytes(logicalBytes: number): number {
  return Math.max(4, logicalBytes);
}

function buffer(
  name: string,
  logicalBytes: number,
  storageBinding: boolean,
): MonolithicLinkWebGpuCapacityBuffer3D {
  return Object.freeze({
    name,
    logicalBytes,
    allocatedBytes: allocatedBytes(logicalBytes),
    storageBinding,
  });
}

function maximumByPerLinkBuffer(
  limit: number | null,
  sectionCount: number,
  staticStorageBuffers: readonly MonolithicLinkWebGpuCapacityBuffer3D[],
): number | null {
  if (limit === null) return null;
  if (staticStorageBuffers.some((candidate) => candidate.allocatedBytes > limit)) {
    return 0;
  }
  return Math.floor(limit / (sectionCount * 16));
}

/**
 * Deterministic capacity model for the current monolithic Mechanical 3D path.
 *
 * It mirrors the exact persistent GPU buffers allocated by:
 * - createMonolithicLinkWebGpuCompute3D
 * - createMonolithicLinkWebGpuShape3D
 * - createMonolithicLinkWebGpuZeroCopyRenderer3D
 *
 * It intentionally excludes swap-chain/depth textures, driver overhead and the
 * host-side VisualLinkNetwork/string objects because those are environment/UI
 * concerns rather than persistent monolithic Link buffers.
 */
export function planMonolithicLinkWebGpuCapacity3D(
  linkCountValue: number,
  aspectRatio: number,
  adapterLimits: MonolithicLinkWebGpuCapacityLimits3D = {},
): MonolithicLinkWebGpuCapacityPlan3D {
  const linkCount = requireLinkCount(linkCountValue);
  const template = getOctahedralLinkTemplate3D(aspectRatio);
  const octahedronCount = template.octahedronCount;
  const sectionCount = octahedronCount + 1;
  const wireframe = buildOctahedralWireframeIndices3D(
    template.surfaceTriangles,
  );

  const vectorBytes = safeMultiply(linkCount, 16, "semantic vec4");
  const linkForceBytes = safeMultiply(linkCount, 48, "three force vec4");
  const computeTopologyBytes = safeAdd([
    safeMultiply(linkCount, 20, "compute topology"),
    4,
  ], "compute topology");
  const shapeSectionFrameBytes = safeMultiply(
    safeMultiply(linkCount, sectionCount, "section frames count"),
    16,
    "section frames bytes",
  );
  const linkTopologyBytes = safeMultiply(linkCount, 8, "two-index topology");

  const buffers = Object.freeze([
    buffer("compute.centers", vectorBytes, true),
    buffer("compute.velocities", vectorBytes, true),
    buffer("compute.linkForces", linkForceBytes, true),
    buffer("compute.topology", computeTopologyBytes, true),
    buffer("compute.globals", COMPUTE_GLOBAL_BYTES, false),

    buffer("shape.parameters", vectorBytes, true),
    buffer("shape.gauge", vectorBytes, true),
    buffer("shape.sectionFrames", shapeSectionFrameBytes, true),
    buffer("shape.topology", linkTopologyBytes, true),
    buffer("shape.globals", SHAPE_GLOBAL_BYTES, false),

    buffer("renderer.topology", linkTopologyBytes, true),
    buffer(
      "renderer.surfaceIndices",
      template.surfaceTriangles.byteLength,
      true,
    ),
    buffer(
      "renderer.wireframeIndices",
      wireframe.byteLength,
      true,
    ),
    buffer("renderer.gradient", template.gradientT.byteLength, true),
    buffer("renderer.uniforms", RENDER_UNIFORM_BYTES, false),
  ]);

  const persistentGpuBytes = safeAdd(
    buffers.map((candidate) => candidate.allocatedBytes),
    "persistent GPU bytes",
  );

  const perLinkLogicalBytes =
    16 + 16 + 48 + 20
    + 16 + 16 + sectionCount * 16 + 8
    + 8;
  const fixedBytes =
    COMPUTE_GLOBAL_BYTES
    + 4
    + SHAPE_GLOBAL_BYTES
    + template.surfaceTriangles.byteLength
    + wireframe.byteLength
    + template.gradientT.byteLength
    + RENDER_UNIFORM_BYTES;

  const storageBuffers = buffers.filter((candidate) => candidate.storageBinding);
  const largestStorageBuffer = storageBuffers.reduce((largest, candidate) =>
    candidate.allocatedBytes > largest.allocatedBytes ? candidate : largest
  );

  const maxStorageBufferBindingSize = requireOptionalLimit(
    adapterLimits.maxStorageBufferBindingSize,
    "maxStorageBufferBindingSize",
  );
  const maxBufferSize = requireOptionalLimit(
    adapterLimits.maxBufferSize,
    "maxBufferSize",
  );
  const maxComputeWorkgroupsPerDimension = requireWorkgroupLimit(
    adapterLimits.maxComputeWorkgroupsPerDimension,
  );

  const fixedBuffers = buffers.filter((candidate) =>
    candidate.name === "compute.globals"
    || candidate.name === "shape.globals"
    || candidate.name === "renderer.surfaceIndices"
    || candidate.name === "renderer.wireframeIndices"
    || candidate.name === "renderer.gradient"
    || candidate.name === "renderer.uniforms"
  );
  const fixedStorageBuffers = fixedBuffers.filter(
    (candidate) => candidate.storageBinding,
  );

  const maximumLinksByStorageBinding = maximumByPerLinkBuffer(
    maxStorageBufferBindingSize,
    sectionCount,
    fixedStorageBuffers,
  );
  const maximumLinksByBufferSize = maximumByPerLinkBuffer(
    maxBufferSize,
    sectionCount,
    fixedBuffers,
  );
  const maximumLinksByDispatch = safeMultiply(
    safeMultiply(
      maxComputeWorkgroupsPerDimension,
      maxComputeWorkgroupsPerDimension,
      "dispatch workgroup square",
    ),
    WORKGROUP_SIZE,
    "dispatch invocation capacity",
  );

  const dispatch = computeOctahedralWebGpuDispatch2D(
    linkCount,
    maxComputeWorkgroupsPerDimension,
  );

  const maximumSupportedLinkCount = Math.min(
    maximumLinksByStorageBinding ?? Number.MAX_SAFE_INTEGER,
    maximumLinksByBufferSize ?? Number.MAX_SAFE_INTEGER,
    maximumLinksByDispatch,
  );

  const fitsStorageBindingLimit =
    maxStorageBufferBindingSize === null
    || storageBuffers.every(
      (candidate) => candidate.allocatedBytes <= maxStorageBufferBindingSize,
    );
  const fitsBufferSizeLimit =
    maxBufferSize === null
    || buffers.every((candidate) => candidate.allocatedBytes <= maxBufferSize);
  const fitsDispatchLimit = linkCount <= maximumLinksByDispatch;

  return Object.freeze({
    linkCount,
    octahedronCount,
    sectionCount,
    persistentGpuBytes,
    persistentBytesPerLink: perLinkLogicalBytes,
    fixedBytes,
    buffers,
    largestStorageBuffer,
    sectionFrameBytes: shapeSectionFrameBytes,
    surfaceVerticesPerLink: template.surfaceTriangles.length,
    wireframeVerticesPerLink: wireframe.length,
    endConeVerticesPerLink: END_CONE_VERTEX_COUNT,
    hoveredCenterVertices: HOVERED_CENTER_VERTEX_COUNT,
    surfaceVertexInvocations: safeMultiply(
      template.surfaceTriangles.length,
      linkCount,
      "surface vertex invocations",
    ),
    wireframeVertexInvocations: safeMultiply(
      wireframe.length,
      linkCount,
      "wireframe vertex invocations",
    ),
    endConeVertexInvocations: safeMultiply(
      END_CONE_VERTEX_COUNT,
      linkCount,
      "END cone vertex invocations",
    ),
    computePassesPerStep: 3 as const,
    semanticInvocationsPerStep: safeMultiply(
      linkCount,
      3,
      "semantic compute invocations",
    ),
    dispatch: Object.freeze({
      workgroupsX: dispatch.workgroupsX,
      workgroupsY: dispatch.workgroupsY,
      coveredInvocationsPerPass: dispatch.coveredInvocations,
      maximumLinksByDispatch,
    }),
    limits: Object.freeze({
      maxStorageBufferBindingSize,
      maxBufferSize,
      maxComputeWorkgroupsPerDimension,
      maximumLinksByStorageBinding,
      maximumLinksByBufferSize,
      maximumSupportedLinkCount,
      fitsStorageBindingLimit,
      fitsBufferSizeLimit,
      fitsDispatchLimit,
      fits:
        fitsStorageBindingLimit
        && fitsBufferSizeLimit
        && fitsDispatchLimit,
    }),
  });
}
