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
const DETAIL_SELECTION_CONTROL_BYTES = 96;
const RENDER_UNIFORM_BYTES = 128;
const END_CONE_VERTEX_COUNT = 48;
const HOVERED_CENTER_VERTEX_COUNT = 480;

export interface MonolithicLinkWebGpuCapacityLimits3D {
  readonly maxStorageBufferBindingSize?: number;
  readonly maxBufferSize?: number;
  readonly maxComputeWorkgroupsPerDimension?: number;
}

export interface MonolithicLinkWebGpuCapacityOptions3D {
  readonly detailCapacity?: number;
  readonly includeRenderer?: boolean;
}

export interface MonolithicLinkWebGpuCapacityBuffer3D {
  readonly name: string;
  readonly allocatedBytes: number;
  readonly logicalBytes: number;
  readonly storageBinding: boolean;
}

export interface MonolithicLinkWebGpuCapacityPlan3D {
  readonly linkCount: number;
  readonly detailedLinkCount: number;
  readonly detailCapacity: number;
  readonly octahedronCount: number;
  readonly sectionCount: number;
  readonly persistentGpuBytes: number;
  readonly compactPersistentGpuBytes: number;
  readonly detailCacheBytes: number;
  readonly persistentBytesPerLink: number;
  readonly detailBytesPerSlot: number;
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
  readonly computePassesPerStep: number;
  readonly semanticInvocationsPerStep: number;
  readonly selectorInvocationsPerStep: number;
  readonly selectorCandidateVisitsPerStep: number;
  readonly detailInvocationsPerStep: number;
  readonly dispatch: Readonly<{
    workgroupsX: number;
    workgroupsY: number;
    coveredInvocationsPerPass: number;
    maximumLinksByDispatch: number;
  }>;
  readonly detailDispatch: Readonly<{
    workgroupsX: number;
    workgroupsY: number;
    coveredInvocationsPerPass: number;
  }>;
  readonly limits: Readonly<{
    maxStorageBufferBindingSize: number | null;
    maxBufferSize: number | null;
    maxComputeWorkgroupsPerDimension: number;
    maximumDetailedLinksByBinding: number | null;
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

function maximumSemanticLinksForLimit(
  limit: number | null,
  fixedBuffers: readonly MonolithicLinkWebGpuCapacityBuffer3D[],
): number | null {
  if (limit === null) return null;
  if (fixedBuffers.some((candidate) => candidate.allocatedBytes > limit)) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(
      Math.floor(limit / 16),
      Math.floor(limit / 48),
      Math.floor(Math.max(0, limit - 4) / 20),
      Math.floor(limit / 8),
    ),
  );
}

function boundedDetailCapacity(
  linkCount: number,
  sectionCount: number,
  storageLimit: number | null,
  bufferLimit: number | null,
): {
  readonly capacity: number;
  readonly maximumByBinding: number | null;
} {
  const finiteLimits = [storageLimit, bufferLimit].filter(
    (value): value is number => value !== null,
  );
  if (finiteLimits.length === 0) {
    return Object.freeze({
      capacity: linkCount,
      maximumByBinding: null,
    });
  }
  const limit = Math.min(...finiteLimits);
  const maximumByBinding = Math.floor(limit / (sectionCount * 16));
  return Object.freeze({
    capacity: Math.min(linkCount, maximumByBinding),
    maximumByBinding,
  });
}

/**
 * Deterministic capacity model for the current monolithic Mechanical 3D path.
 *
 * Global semantic/shape state is O(LinkCount). Detailed section frames are a
 * separately bounded presentation cache whose capacity is limited by adapter
 * storage/buffer limits instead of total Link count.
 *
 * Excludes swap-chain/depth textures, driver overhead and host-side
 * VisualLinkNetwork/string objects.
 */
export function planMonolithicLinkWebGpuCapacity3D(
  linkCountValue: number,
  aspectRatio: number,
  adapterLimits: MonolithicLinkWebGpuCapacityLimits3D = {},
  options: MonolithicLinkWebGpuCapacityOptions3D = {},
): MonolithicLinkWebGpuCapacityPlan3D {
  const linkCount = requireLinkCount(linkCountValue);
  const requestedDetailCapacity =
    options.detailCapacity === undefined
      ? linkCount
      : requireLinkCount(options.detailCapacity);
  const includeRenderer = options.includeRenderer !== false;
  if (requestedDetailCapacity > linkCount) {
    throw new Error(
      `invalid monolithic capacity detailCapacity: ${requestedDetailCapacity} > ${linkCount}`,
    );
  }
  const template = getOctahedralLinkTemplate3D(aspectRatio);
  const octahedronCount = template.octahedronCount;
  const sectionCount = octahedronCount + 1;
  const wireframe = buildOctahedralWireframeIndices3D(
    template.surfaceTriangles,
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

  const detail = boundedDetailCapacity(
    requestedDetailCapacity,
    sectionCount,
    maxStorageBufferBindingSize,
    maxBufferSize,
  );
  const detailCapacity = detail.capacity;
  const detailedLinkCount = detailCapacity;

  const vectorBytes = safeMultiply(linkCount, 16, "semantic vec4");
  const linkForceBytes = safeMultiply(linkCount, 48, "three force vec4");
  const computeTopologyBytes = safeAdd([
    safeMultiply(linkCount, 20, "compute topology"),
    4,
  ], "compute topology");
  const linkTopologyBytes = safeMultiply(linkCount, 8, "two-index topology");
  const detailIndexBytes = safeMultiply(
    detailCapacity,
    4,
    "detail index cache",
  );
  const sectionFrameBytes = safeMultiply(
    safeMultiply(detailCapacity, sectionCount, "detail section count"),
    16,
    "detail section frame bytes",
  );

  const buffers = Object.freeze([
    buffer("compute.centers", vectorBytes, true),
    buffer("compute.velocities", vectorBytes, true),
    buffer("compute.linkForces", linkForceBytes, true),
    buffer("compute.topology", computeTopologyBytes, true),
    buffer("compute.globals", COMPUTE_GLOBAL_BYTES, false),

    buffer("shape.parameters", vectorBytes, true),
    buffer("shape.gauge", vectorBytes, true),
    buffer("shape.detailIndices", detailIndexBytes, true),
    buffer("shape.sectionFrames", sectionFrameBytes, true),
    buffer("shape.topology", linkTopologyBytes, true),
    buffer("shape.globals", SHAPE_GLOBAL_BYTES, false),
    buffer(
      "shape.detailSelection",
      DETAIL_SELECTION_CONTROL_BYTES,
      false,
    ),

    ...(includeRenderer
      ? [
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
        ]
      : []),
  ]);

  const detailNames = new Set([
    "shape.detailIndices",
    "shape.sectionFrames",
  ]);
  const detailCacheBytes = safeAdd(
    buffers
      .filter((candidate) => detailNames.has(candidate.name))
      .map((candidate) => candidate.allocatedBytes),
    "detail cache bytes",
  );
  const compactPersistentGpuBytes = safeAdd(
    buffers
      .filter((candidate) => !detailNames.has(candidate.name))
      .map((candidate) => candidate.allocatedBytes),
    "compact persistent GPU bytes",
  );
  const persistentGpuBytes = safeAdd(
    [compactPersistentGpuBytes, detailCacheBytes],
    "persistent GPU bytes",
  );

  const fixedBytes =
    COMPUTE_GLOBAL_BYTES
    + 4
    + SHAPE_GLOBAL_BYTES
    + DETAIL_SELECTION_CONTROL_BYTES
    + (
      includeRenderer
        ? template.surfaceTriangles.byteLength
          + wireframe.byteLength
          + template.gradientT.byteLength
          + RENDER_UNIFORM_BYTES
        : 0
    );
  const persistentBytesPerLink = includeRenderer ? 148 : 140;
  const detailBytesPerSlot = 4 + sectionCount * 16;

  const storageBuffers = buffers.filter((candidate) => candidate.storageBinding);
  const largestStorageBuffer = storageBuffers.reduce((largest, candidate) =>
    candidate.allocatedBytes > largest.allocatedBytes ? candidate : largest
  );

  const fixedBuffers = buffers.filter((candidate) =>
    candidate.name === "compute.globals"
    || candidate.name === "shape.globals"
    || candidate.name === "shape.detailSelection"
    || candidate.name === "renderer.surfaceIndices"
    || candidate.name === "renderer.wireframeIndices"
    || candidate.name === "renderer.gradient"
    || candidate.name === "renderer.uniforms"
  );
  const fixedStorageBuffers = fixedBuffers.filter(
    (candidate) => candidate.storageBinding,
  );

  const maximumLinksByStorageBinding = maximumSemanticLinksForLimit(
    maxStorageBufferBindingSize,
    fixedStorageBuffers,
  );
  const maximumLinksByBufferSize = maximumSemanticLinksForLimit(
    maxBufferSize,
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
  const detailDispatch = computeOctahedralWebGpuDispatch2D(
    detailedLinkCount,
    maxComputeWorkgroupsPerDimension,
  );
  const gpuSelectorActive =
    linkCount > detailedLinkCount
    && detailedLinkCount > 0;

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
    detailedLinkCount,
    detailCapacity,
    octahedronCount,
    sectionCount,
    persistentGpuBytes,
    compactPersistentGpuBytes,
    detailCacheBytes,
    persistentBytesPerLink,
    detailBytesPerSlot,
    fixedBytes,
    buffers,
    largestStorageBuffer,
    sectionFrameBytes,
    surfaceVerticesPerLink: template.surfaceTriangles.length,
    wireframeVerticesPerLink: wireframe.length,
    endConeVerticesPerLink: END_CONE_VERTEX_COUNT,
    hoveredCenterVertices: HOVERED_CENTER_VERTEX_COUNT,
    surfaceVertexInvocations: safeMultiply(
      template.surfaceTriangles.length,
      detailedLinkCount,
      "surface vertex invocations",
    ),
    wireframeVertexInvocations: safeMultiply(
      wireframe.length,
      detailedLinkCount,
      "wireframe vertex invocations",
    ),
    endConeVertexInvocations: safeMultiply(
      END_CONE_VERTEX_COUNT,
      detailedLinkCount,
      "END cone vertex invocations",
    ),
    computePassesPerStep:
      linkCount === 0
        ? 0
        : 3
          + (gpuSelectorActive ? 1 : 0)
          + (detailedLinkCount > 0 ? 1 : 0),
    semanticInvocationsPerStep: safeMultiply(
      linkCount,
      3,
      "semantic compute invocations",
    ),
    selectorInvocationsPerStep:
      gpuSelectorActive ? detailedLinkCount : 0,
    selectorCandidateVisitsPerStep:
      gpuSelectorActive ? linkCount : 0,
    detailInvocationsPerStep: detailedLinkCount,
    dispatch: Object.freeze({
      workgroupsX: dispatch.workgroupsX,
      workgroupsY: dispatch.workgroupsY,
      coveredInvocationsPerPass: dispatch.coveredInvocations,
      maximumLinksByDispatch,
    }),
    detailDispatch: Object.freeze({
      workgroupsX: detailDispatch.workgroupsX,
      workgroupsY: detailDispatch.workgroupsY,
      coveredInvocationsPerPass: detailDispatch.coveredInvocations,
    }),
    limits: Object.freeze({
      maxStorageBufferBindingSize,
      maxBufferSize,
      maxComputeWorkgroupsPerDimension,
      maximumDetailedLinksByBinding: detail.maximumByBinding,
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
