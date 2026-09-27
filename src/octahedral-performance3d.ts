import {
  getOctahedralLinkTemplate3D,
  type OctahedralLinkTemplate3D,
} from "./octahedral-link3d.js";

const FLOAT32_BYTES = 4;
const UINT32_BYTES = 4;
const XYZ_COMPONENTS = 3;
const RGBA_COMPONENTS = 4;
const INSTANCE_TEXEL_COMPONENTS = 2;

export const OCTAHEDRAL_PERFORMANCE_LADDER_LINK_COUNTS = Object.freeze([
  100,
  1_000,
  10_000,
  100_000,
  1_000_000,
] as const);

export interface OctahedralPerformanceEstimate3D {
  readonly linkCount: number;
  readonly requestedAspectRatio: number;
  readonly resolvedAspectRatio: number;
  readonly pairCount: number;
  readonly octahedronCount: number;

  readonly verticesPerLink: number;
  readonly edgesPerLink: number;
  readonly surfaceTrianglesPerLink: number;
  readonly totalPhysicalVertices: number;

  readonly springEdgeEvaluationsPerTick: number;
  readonly hingeTransfersPerTick: number;
  readonly hingeProjectionsPerTick: number;
  readonly integratedVerticesPerTick: number;
  readonly pairwiseSemanticLinkEvaluations: 0;

  readonly cpuPositionsBytes: number;
  readonly cpuVelocitiesBytes: number;
  readonly cpuForcesBytes: number;
  readonly cpuTopologyBytes: number;
  readonly cpuDynamicBytes: number;

  readonly positionTextureWidth: number;
  readonly positionTextureHeight: number;
  readonly positionTextureCapacityVertices: number;
  readonly gpuPositionTextureBytes: number;
  readonly gpuInstanceAddressBytes: number;
  readonly gpuDynamicBytes: number;

  readonly cpuTextureStagingBytesPerFrame: number;
  readonly gpuTextureUploadBytesPerFrame: number;
}

export interface OctahedralUploadBandwidthProjection3D {
  readonly framesPerSecond: number;
  readonly cpuTextureStagingBytesPerSecond: number;
  readonly gpuTextureUploadBytesPerSecond: number;
}

function requireLinkCount(linkCount: number): number {
  if (!Number.isSafeInteger(linkCount) || linkCount < 0) {
    throw new Error(`invalid octahedral performance linkCount: ${String(linkCount)}`);
  }
  return linkCount;
}

function requireFramesPerSecond(framesPerSecond: number): number {
  if (!Number.isFinite(framesPerSecond) || framesPerSecond < 0) {
    throw new Error(`invalid octahedral performance framesPerSecond: ${String(framesPerSecond)}`);
  }
  return framesPerSecond;
}

function requireSafeCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`octahedral performance estimate overflow: ${label}=${String(value)}`);
  }
  return value;
}

function textureDimensions(requiredVertices: number): readonly [number, number, number] {
  const required = Math.max(1, requiredVertices);
  const width = Math.max(1, Math.ceil(Math.sqrt(required)));
  const height = Math.max(1, Math.ceil(required / width));
  return [width, height, width * height];
}

function estimateWithTemplate(
  linkCount: number,
  requestedAspectRatio: number,
  template: OctahedralLinkTemplate3D,
): OctahedralPerformanceEstimate3D {
  const totalPhysicalVertices = requireSafeCount(
    linkCount * template.vertexCount,
    "totalPhysicalVertices",
  );
  const springEdgeEvaluationsPerTick = requireSafeCount(
    linkCount * template.edgeCount,
    "springEdgeEvaluationsPerTick",
  );
  const hingeTransfersPerTick = requireSafeCount(linkCount * 2, "hingeTransfersPerTick");
  const hingeProjectionsPerTick = requireSafeCount(linkCount * 2, "hingeProjectionsPerTick");
  const integratedVerticesPerTick = requireSafeCount(
    linkCount * template.vertexCount,
    "integratedVerticesPerTick",
  );

  const cpuPositionsBytes = requireSafeCount(
    totalPhysicalVertices * XYZ_COMPONENTS * FLOAT32_BYTES,
    "cpuPositionsBytes",
  );
  const cpuVelocitiesBytes = cpuPositionsBytes;
  const cpuForcesBytes = cpuPositionsBytes;
  const cpuTopologyBytes = requireSafeCount(
    linkCount * 2 * UINT32_BYTES,
    "cpuTopologyBytes",
  );
  const cpuDynamicBytes = requireSafeCount(
    cpuPositionsBytes + cpuVelocitiesBytes + cpuForcesBytes + cpuTopologyBytes,
    "cpuDynamicBytes",
  );

  const [
    positionTextureWidth,
    positionTextureHeight,
    positionTextureCapacityVertices,
  ] = textureDimensions(totalPhysicalVertices);

  const gpuPositionTextureBytes = requireSafeCount(
    positionTextureCapacityVertices * RGBA_COMPONENTS * FLOAT32_BYTES,
    "gpuPositionTextureBytes",
  );
  const gpuInstanceAddressBytes = requireSafeCount(
    linkCount * INSTANCE_TEXEL_COMPONENTS * FLOAT32_BYTES,
    "gpuInstanceAddressBytes",
  );
  const gpuDynamicBytes = requireSafeCount(
    gpuPositionTextureBytes + gpuInstanceAddressBytes,
    "gpuDynamicBytes",
  );

  const cpuTextureStagingBytesPerFrame = requireSafeCount(
    totalPhysicalVertices * RGBA_COMPONENTS * FLOAT32_BYTES,
    "cpuTextureStagingBytesPerFrame",
  );

  return Object.freeze({
    linkCount,
    requestedAspectRatio,
    resolvedAspectRatio: template.aspectRatio,
    pairCount: template.pairCount,
    octahedronCount: template.octahedronCount,

    verticesPerLink: template.vertexCount,
    edgesPerLink: template.edgeCount,
    surfaceTrianglesPerLink: template.surfaceTriangleCount,
    totalPhysicalVertices,

    springEdgeEvaluationsPerTick,
    hingeTransfersPerTick,
    hingeProjectionsPerTick,
    integratedVerticesPerTick,
    pairwiseSemanticLinkEvaluations: 0 as const,

    cpuPositionsBytes,
    cpuVelocitiesBytes,
    cpuForcesBytes,
    cpuTopologyBytes,
    cpuDynamicBytes,

    positionTextureWidth,
    positionTextureHeight,
    positionTextureCapacityVertices,
    gpuPositionTextureBytes,
    gpuInstanceAddressBytes,
    gpuDynamicBytes,

    cpuTextureStagingBytesPerFrame,
    gpuTextureUploadBytesPerFrame: gpuPositionTextureBytes,
  });
}

export function estimateOctahedralPerformance3D(
  linkCount: number,
  aspectRatio: number,
): OctahedralPerformanceEstimate3D {
  const safeLinkCount = requireLinkCount(linkCount);
  const template = getOctahedralLinkTemplate3D(aspectRatio);
  return estimateWithTemplate(safeLinkCount, aspectRatio, template);
}

export function createOctahedralPerformanceLadder3D(
  aspectRatio: number,
  linkCounts: readonly number[] = OCTAHEDRAL_PERFORMANCE_LADDER_LINK_COUNTS,
): readonly OctahedralPerformanceEstimate3D[] {
  const template = getOctahedralLinkTemplate3D(aspectRatio);
  return Object.freeze(linkCounts.map((linkCount) => (
    estimateWithTemplate(requireLinkCount(linkCount), aspectRatio, template)
  )));
}

export function projectOctahedralUploadBandwidth3D(
  estimate: OctahedralPerformanceEstimate3D,
  framesPerSecond: number,
): OctahedralUploadBandwidthProjection3D {
  const fps = requireFramesPerSecond(framesPerSecond);
  const cpuTextureStagingBytesPerSecond = estimate.cpuTextureStagingBytesPerFrame * fps;
  const gpuTextureUploadBytesPerSecond = estimate.gpuTextureUploadBytesPerFrame * fps;

  if (
    !Number.isFinite(cpuTextureStagingBytesPerSecond)
    || !Number.isFinite(gpuTextureUploadBytesPerSecond)
    || cpuTextureStagingBytesPerSecond > Number.MAX_SAFE_INTEGER
    || gpuTextureUploadBytesPerSecond > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("octahedral performance bandwidth projection overflow");
  }

  return Object.freeze({
    framesPerSecond: fps,
    cpuTextureStagingBytesPerSecond,
    gpuTextureUploadBytesPerSecond,
  });
}
