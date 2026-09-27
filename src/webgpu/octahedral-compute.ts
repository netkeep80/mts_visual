import type { VisualLinkNetwork } from "../index.js";
import {
  buildOctahedralLinkTopology3D,
  getOctahedralLinkTemplate3D,
  type OctahedralLinkTemplate3D,
  type OctahedralLinkTopology3D,
} from "../octahedral-link3d.js";
import { resolveOctahedralSeedCenters3D } from "../octahedral-layout3d.js";
import { createOctahedralLivePhysics3D } from "../octahedral-live3d.js";

const WORKGROUP_SIZE = 64;
const DEFAULT_MAX_WORKGROUPS_PER_DIMENSION = 65_535;
const BASE_TIME_STEP = 1 / 120;
const INTERNAL_DAMPING_RATE = 0.8;

const GPU_BUFFER_USAGE = Object.freeze({
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
});

const GPU_MAP_MODE_READ = 0x0001;
const GPU_SHADER_STAGE_COMPUTE = 0x0004;

export interface WebGpuBufferLike {
  readonly size: number;
  readonly label?: string;
  destroy(): void;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
}

interface WebGpuQueueLike {
  writeBuffer(
    buffer: WebGpuBufferLike,
    bufferOffset: number,
    data: ArrayBuffer | ArrayBufferView,
    dataOffset?: number,
    size?: number,
  ): void;
  submit(commandBuffers: readonly object[]): void;
}

interface WebGpuComputePassLike {
  setPipeline(pipeline: WebGpuComputePipelineLike): void;
  setBindGroup(index: number, bindGroup: object): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

interface WebGpuCommandEncoderLike {
  beginComputePass(descriptor?: object): WebGpuComputePassLike;
  copyBufferToBuffer(
    source: WebGpuBufferLike,
    sourceOffset: number,
    destination: WebGpuBufferLike,
    destinationOffset: number,
    size: number,
  ): void;
  finish(): object;
}

interface WebGpuComputePipelineLike {
  readonly label?: string;
}

interface WebGpuCompilationMessageLike {
  readonly type?: "error" | "warning" | "info" | string;
  readonly message: string;
  readonly lineNum?: number;
  readonly linePos?: number;
}

interface WebGpuShaderModuleLike {
  getCompilationInfo?(): Promise<{
    readonly messages: readonly WebGpuCompilationMessageLike[];
  }>;
}

export interface WebGpuDeviceLike {
  readonly queue: WebGpuQueueLike;
  readonly lost?: Promise<{
    readonly reason?: string;
    readonly message?: string;
  }>;
  readonly limits?: {
    readonly maxComputeWorkgroupsPerDimension?: number;
    readonly maxStorageBufferBindingSize?: number;
    readonly maxStorageBuffersPerShaderStage?: number;
  };
  createBuffer(descriptor: {
    readonly label?: string;
    readonly size: number;
    readonly usage: number;
    readonly mappedAtCreation?: boolean;
  }): WebGpuBufferLike;
  createShaderModule(descriptor: { readonly label?: string; readonly code: string }): WebGpuShaderModuleLike;
  createBindGroupLayout(descriptor: { readonly label?: string; readonly entries: readonly object[] }): object;
  createPipelineLayout(descriptor: { readonly label?: string; readonly bindGroupLayouts: readonly object[] }): object;
  createComputePipelineAsync(descriptor: {
    readonly label?: string;
    readonly layout: object;
    readonly compute: {
      readonly module: object;
      readonly entryPoint: string;
    };
  }): Promise<WebGpuComputePipelineLike>;
  createBindGroup(descriptor: {
    readonly label?: string;
    readonly layout: object;
    readonly entries: readonly object[];
  }): object;
  createCommandEncoder(descriptor?: { readonly label?: string }): WebGpuCommandEncoderLike;
}

interface WebGpuAdapterLike {
  readonly limits?: {
    readonly maxStorageBufferBindingSize?: number;
  };
  requestDevice(descriptor?: {
    readonly requiredLimits?: Readonly<Record<string, number>>;
  }): Promise<WebGpuDeviceLike>;
}

interface WebGpuApiLike {
  requestAdapter(options?: { readonly powerPreference?: "low-power" | "high-performance" }): Promise<WebGpuAdapterLike | null>;
}

export interface OctahedralReverseIncidence3D {
  readonly incomingOffsets: Uint32Array;
  readonly incomingRefs: Uint32Array;
}

export interface OctahedralPackedWebGpuTemplate3D {
  readonly words: Uint32Array;
  readonly restBase: number;
  readonly edgeABase: number;
  readonly edgeBBase: number;
  readonly batchEdgesBase: number;
  readonly batches: readonly {
    readonly offset: number;
    readonly count: number;
  }[];
}

export interface OctahedralWebGpuDispatch2D {
  readonly workgroupsX: number;
  readonly workgroupsY: number;
  readonly coveredInvocations: number;
}

export interface OctahedralCenterDragVertex3D {
  readonly linkIndex: number;
  readonly vertexIndex: number;
}

export function collectOctahedralCenterDragVertices3D(
  topology: OctahedralLinkTopology3D,
  template: OctahedralLinkTemplate3D,
  selectedLink: number,
): readonly OctahedralCenterDragVertex3D[] {
  if (
    !Number.isSafeInteger(selectedLink)
    || selectedLink < 0
    || selectedLink >= topology.linkCount
  ) {
    throw new Error(`invalid center-drag linkIndex: ${String(selectedLink)}`);
  }

  const vertices = new Map<number, OctahedralCenterDragVertex3D>();
  const includeTriangle = (
    linkIndex: number,
    triangle: readonly [number, number, number],
  ): void => {
    for (const vertexIndex of triangle) {
      const globalVertex = linkIndex * template.vertexCount + vertexIndex;
      if (!vertices.has(globalVertex)) {
        vertices.set(globalVertex, Object.freeze({ linkIndex, vertexIndex }));
      }
    }
  };

  includeTriangle(selectedLink, template.centerTriangle);
  for (let source = 0; source < topology.linkCount; source += 1) {
    if (topology.startIndices[source] === selectedLink) {
      includeTriangle(source, template.startTriangle);
    }
    if (topology.endIndices[source] === selectedLink) {
      includeTriangle(source, template.endTriangle);
    }
  }

  return Object.freeze([...vertices.values()]);
}

export interface OctahedralWebGpuComputeOptions {
  readonly aspectRatio: number;
  readonly stiffness: number;
  readonly simulationSpeed: number;
}

export type OctahedralWebGpuVec3 = readonly [number, number, number];

export interface OctahedralWebGpuVertexOverride3D {
  readonly linkIndex: number;
  readonly vertexIndex: number;
  readonly position: OctahedralWebGpuVec3;
  readonly velocity?: OctahedralWebGpuVec3;
}

export interface OctahedralWebGpuOverrideStats3D {
  readonly vertexCount: number;
  readonly bufferWrites: number;
  readonly positionBytes: number;
  readonly velocityBytes: number;
}

export interface OctahedralWebGpuStepStats {
  readonly springBatchDispatches: number;
  readonly computePasses: number;
  readonly dynamicStateUploadBytes: 0;
}

export interface OctahedralWebGpuSnapshot3D {
  readonly status: "available" | "device-lost" | "destroyed";
  readonly deviceLostReason: string | null;
  readonly linkCount: number;
  readonly vertexCount: number;
  readonly edgeCount: number;
  readonly totalPhysicalVertices: number;
  readonly positionBytes: number;
  readonly velocityBytes: number;
  readonly forceBytes: number;
  readonly gpuDynamicXyzBytes: number;
  readonly springBatchCount: number;
  readonly stiffness: number;
  readonly simulationSpeed: number;
  readonly destroyed: boolean;
}

export interface OctahedralWebGpuCompute3D {
  readonly template: OctahedralLinkTemplate3D;
  readonly topology: OctahedralLinkTopology3D;
  readonly positionBuffer: WebGpuBufferLike;
  readonly velocityBuffer: WebGpuBufferLike;
  readonly forceBuffer: WebGpuBufferLike;
  readonly stiffness: number;
  readonly simulationSpeed: number;
  step(): OctahedralWebGpuStepStats;
  setStiffness(stiffness: number): void;
  setSimulationSpeed(simulationSpeed: number): void;
  writeVertexOverrides(
    overrides: readonly OctahedralWebGpuVertexOverride3D[],
  ): OctahedralWebGpuOverrideStats3D;
  readBackPositions(): Promise<Float32Array>;
  readBackVelocities(): Promise<Float32Array>;
  snapshot(): OctahedralWebGpuSnapshot3D;
  destroy(): void;
}

export interface OctahedralWebGpuDifferentialResult3D {
  readonly available: boolean;
  readonly passed: boolean;
  readonly steps: number;
  readonly tolerance: number;
  readonly maxPositionDelta: number | null;
  readonly maxVelocityDelta: number | null;
  readonly reason?: string;
}

function requireNonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`invalid ${name}: ${String(value)}`);
  return value;
}

function requirePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid ${name}: ${String(value)}`);
  return value;
}

export function buildOctahedralReverseIncidence3D(
  topology: OctahedralLinkTopology3D,
): OctahedralReverseIncidence3D {
  const linkCount = topology.linkCount;
  const counts = new Uint32Array(linkCount);

  for (let source = 0; source < linkCount; source += 1) {
    const startTarget = topology.startIndices[source]!;
    const endTarget = topology.endIndices[source]!;
    counts[startTarget] = counts[startTarget]! + 1;
    counts[endTarget] = counts[endTarget]! + 1;
  }

  const incomingOffsets = new Uint32Array(linkCount + 1);
  for (let link = 0; link < linkCount; link += 1) {
    incomingOffsets[link + 1] = incomingOffsets[link]! + counts[link]!;
  }

  const incomingRefs = new Uint32Array(linkCount * 2);
  const cursors = incomingOffsets.slice(0, linkCount);

  for (let source = 0; source < linkCount; source += 1) {
    const startTarget = topology.startIndices[source]!;
    incomingRefs[cursors[startTarget]!] = source * 2;
    cursors[startTarget] = cursors[startTarget]! + 1;

    const endTarget = topology.endIndices[source]!;
    incomingRefs[cursors[endTarget]!] = source * 2 + 1;
    cursors[endTarget] = cursors[endTarget]! + 1;
  }

  return Object.freeze({ incomingOffsets, incomingRefs });
}

export function packOctahedralWebGpuTemplate3D(
  template: OctahedralLinkTemplate3D,
): OctahedralPackedWebGpuTemplate3D {
  const restBase = 0;
  const edgeABase = restBase + template.restPositions.length;
  const edgeBBase = edgeABase + template.edgeA.length;
  const batchEdgesBase = edgeBBase + template.edgeB.length;
  const words = new Uint32Array(batchEdgesBase + template.edgeCount);

  const restBits = new Uint32Array(
    template.restPositions.buffer,
    template.restPositions.byteOffset,
    template.restPositions.length,
  );
  words.set(restBits, restBase);
  words.set(template.edgeA, edgeABase);
  words.set(template.edgeB, edgeBBase);

  const batches: { offset: number; count: number }[] = [];
  let cursor = 0;
  for (const batch of template.edgeBatches) {
    batches.push(Object.freeze({ offset: cursor, count: batch.length }));
    words.set(batch, batchEdgesBase + cursor);
    cursor += batch.length;
  }

  if (cursor !== template.edgeCount) {
    throw new Error(`octahedral WebGPU template batch coverage mismatch: ${cursor} != ${template.edgeCount}`);
  }

  return Object.freeze({
    words,
    restBase,
    edgeABase,
    edgeBBase,
    batchEdgesBase,
    batches: Object.freeze(batches),
  });
}

export function computeOctahedralWebGpuDispatch2D(
  invocationCount: number,
  maxWorkgroupsPerDimension = DEFAULT_MAX_WORKGROUPS_PER_DIMENSION,
): OctahedralWebGpuDispatch2D {
  if (!Number.isSafeInteger(invocationCount) || invocationCount < 0) {
    throw new Error(`invalid WebGPU invocationCount: ${String(invocationCount)}`);
  }
  const maxGroups = requirePositiveSafeInteger(maxWorkgroupsPerDimension, "maxWorkgroupsPerDimension");
  if (invocationCount === 0) {
    return Object.freeze({ workgroupsX: 0, workgroupsY: 0, coveredInvocations: 0 });
  }

  const totalWorkgroups = Math.ceil(invocationCount / WORKGROUP_SIZE);
  const workgroupsX = Math.min(totalWorkgroups, maxGroups);
  const workgroupsY = Math.ceil(totalWorkgroups / workgroupsX);
  if (workgroupsY > maxGroups) {
    throw new Error(
      `WebGPU dispatch exceeds 2D workgroup capacity: ${workgroupsX}x${workgroupsY} > ${maxGroups}`,
    );
  }

  return Object.freeze({
    workgroupsX,
    workgroupsY,
    coveredInvocations: workgroupsX * workgroupsY * WORKGROUP_SIZE,
  });
}

export const OCTAHEDRAL_WEBGPU_WGSL = /* wgsl */ `
struct Globals {
  counts: vec4<u32>,          // linkCount, vertexCount, startRingBase, endRingBase
  center_rest: vec4<u32>,     // center0, center1, center2, restBase
  bases_total: vec4<u32>,     // edgeABase, edgeBBase, batchEdgesBase, totalVertices
  seed_grid: vec4<u32>,       // reserved for seed-layout metadata
  physics: vec4<f32>,         // stiffness, dt, damping, reserved
};

@group(0) @binding(0) var<storage, read_write> positions: array<f32>;
@group(0) @binding(1) var<storage, read_write> velocities: array<f32>;
@group(0) @binding(2) var<storage, read_write> forces: array<f32>;
@group(0) @binding(3) var<storage, read> topology: array<u32>;
@group(0) @binding(4) var<storage, read> incoming_offsets: array<u32>;
@group(0) @binding(5) var<storage, read> incoming_refs: array<u32>;
@group(0) @binding(6) var<storage, read> template_words: array<u32>;
@group(0) @binding(7) var<uniform> globals: Globals;
@group(0) @binding(8) var<uniform> batch: vec4<u32>;
@group(0) @binding(9) var<storage, read> seed_centers: array<f32>;

fn linear_id(gid: vec3<u32>) -> u32 {
  // Host dispatches one X row when the workload fits. Once it spills into Y,
  // X is clamped to the WebGPU baseline slab width (65,535 workgroups).
  // This keeps 2D linearization deterministic without reading dispatch dimensions from a builtin.
  return gid.x + gid.y * ${DEFAULT_MAX_WORKGROUPS_PER_DIMENSION}u * ${WORKGROUP_SIZE}u;
}

fn vertex_scalar(link: u32, vertex: u32) -> u32 {
  return (link * globals.counts.y + vertex) * 3u;
}

fn load_xyz(buffer_kind: u32, scalar: u32) -> vec3<f32> {
  if (buffer_kind == 0u) {
    return vec3<f32>(positions[scalar], positions[scalar + 1u], positions[scalar + 2u]);
  }
  if (buffer_kind == 1u) {
    return vec3<f32>(velocities[scalar], velocities[scalar + 1u], velocities[scalar + 2u]);
  }
  return vec3<f32>(forces[scalar], forces[scalar + 1u], forces[scalar + 2u]);
}

fn store_position(scalar: u32, value: vec3<f32>) {
  positions[scalar] = value.x;
  positions[scalar + 1u] = value.y;
  positions[scalar + 2u] = value.z;
}

fn store_velocity(scalar: u32, value: vec3<f32>) {
  velocities[scalar] = value.x;
  velocities[scalar + 1u] = value.y;
  velocities[scalar + 2u] = value.z;
}

fn store_force(scalar: u32, value: vec3<f32>) {
  forces[scalar] = value.x;
  forces[scalar + 1u] = value.y;
  forces[scalar + 2u] = value.z;
}

fn rest_xyz(vertex: u32) -> vec3<f32> {
  let base = globals.center_rest.w + vertex * 3u;
  return vec3<f32>(
    bitcast<f32>(template_words[base]),
    bitcast<f32>(template_words[base + 1u]),
    bitcast<f32>(template_words[base + 2u]),
  );
}

fn center_xyz(link: u32, buffer_kind: u32) -> vec3<f32> {
  let a = load_xyz(buffer_kind, vertex_scalar(link, globals.center_rest.x));
  let b = load_xyz(buffer_kind, vertex_scalar(link, globals.center_rest.y));
  let c = load_xyz(buffer_kind, vertex_scalar(link, globals.center_rest.z));
  return (a + b + c) / 3.0;
}

fn ring_xyz(link: u32, ring_base: u32, buffer_kind: u32) -> vec3<f32> {
  let a = load_xyz(buffer_kind, vertex_scalar(link, ring_base));
  let b = load_xyz(buffer_kind, vertex_scalar(link, ring_base + 1u));
  let c = load_xyz(buffer_kind, vertex_scalar(link, ring_base + 2u));
  return (a + b + c) / 3.0;
}

fn translate_ring_position(link: u32, ring_base: u32, delta: vec3<f32>) {
  for (var corner = 0u; corner < 3u; corner = corner + 1u) {
    let scalar = vertex_scalar(link, ring_base + corner);
    store_position(scalar, load_xyz(0u, scalar) + delta);
  }
}

fn translate_ring_velocity(link: u32, ring_base: u32, delta: vec3<f32>) {
  for (var corner = 0u; corner < 3u; corner = corner + 1u) {
    let scalar = vertex_scalar(link, ring_base + corner);
    store_velocity(scalar, load_xyz(1u, scalar) + delta);
  }
}

fn seed_center(link: u32) -> vec3<f32> {
  let scalar = link * 3u;
  return vec3<f32>(
    seed_centers[scalar],
    seed_centers[scalar + 1u],
    seed_centers[scalar + 2u],
  );
}

fn fallback_axis(link: u32) -> vec3<f32> {
  let role = link % 6u;
  if (role == 0u) { return vec3<f32>(1.0, 0.0, 0.0); }
  if (role == 1u) { return vec3<f32>(0.0, 1.0, 0.0); }
  if (role == 2u) { return vec3<f32>(0.0, 0.0, 1.0); }
  if (role == 3u) { return vec3<f32>(-1.0, 0.0, 0.0); }
  if (role == 4u) { return vec3<f32>(0.0, -1.0, 0.0); }
  return vec3<f32>(0.0, 0.0, -1.0);
}

fn seed_axis(link: u32) -> vec3<f32> {
  let start_target = topology[link * 2u];
  let end_target = topology[link * 2u + 1u];
  let delta = seed_center(end_target) - seed_center(start_target);
  if (dot(delta, delta) <= 1e-24) {
    return fallback_axis(link);
  }
  return normalize(delta);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn init_main(
  @builtin(global_invocation_id) gid: vec3<u32>,
) {
  let linear = linear_id(gid);
  if (linear >= globals.bases_total.w) { return; }

  let vertex_count = globals.counts.y;
  let link = linear / vertex_count;
  let local = linear % vertex_count;
  let center = seed_center(link);
  let axis = seed_axis(link);
  var helper = vec3<f32>(0.0, 0.0, 1.0);
  if (abs(axis.z) >= 0.9) {
    helper = vec3<f32>(0.0, 1.0, 0.0);
  }
  let basis_x = normalize(cross(helper, axis));
  let basis_y = cross(axis, basis_x);

  let scalar = linear * 3u;
  let rest = rest_xyz(local);
  let half_length = abs(rest_xyz(globals.counts.w).z);
  let fraction = min(1.0, abs(rest.z) / max(half_length, 1e-12));
  let start_target_link = topology[link * 2u];
  let end_target_link = topology[link * 2u + 1u];
  let target_link = select(end_target_link, start_target_link, rest.z < 0.0);
  let target_center = seed_center(target_link);
  let self_half = target_link == link;

  var seeded: vec3<f32>;
  if (self_half) {
    // Self-incidence must begin as a finite material loop rather than a
    // longitudinally collapsed mast. The terminal triangle centroid returns
    // exactly to CENTER while the triangle itself remains a finite section.
    let side = select(1.0, -1.0, rest.z < 0.0);
    let theta = 6.283185307179586 * fraction;
    let sin_theta = sin(theta);
    let cos_theta = cos(theta);
    let loop_radius = half_length / 6.283185307179586;
    let centerline = center + side * loop_radius * (
      sin_theta * axis + (1.0 - cos_theta) * basis_x
    );
    let normal = cos_theta * basis_x - sin_theta * axis;
    seeded = centerline + normal * rest.x + basis_y * rest.y;
  } else {
    let centerline = center + (target_center - center) * fraction;
    seeded = centerline + basis_x * rest.x + basis_y * rest.y;
  }

  store_position(scalar, seeded);
  store_velocity(scalar, vec3<f32>(0.0));
  store_force(scalar, vec3<f32>(0.0));
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn clear_forces_main(
  @builtin(global_invocation_id) gid: vec3<u32>,
) {
  let linear = linear_id(gid);
  if (linear >= globals.bases_total.w) { return; }
  store_force(linear * 3u, vec3<f32>(0.0));
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn spring_batch_main(
  @builtin(global_invocation_id) gid: vec3<u32>,
) {
  let linear = linear_id(gid);
  let batch_count = batch.y;
  let total = globals.counts.x * batch_count;
  if (linear >= total || batch_count == 0u) { return; }

  let link = linear / batch_count;
  let local_batch_edge = linear % batch_count;
  let edge = template_words[globals.bases_total.z + batch.x + local_batch_edge];
  let a = template_words[globals.bases_total.x + edge];
  let b = template_words[globals.bases_total.y + edge];
  let a_scalar = vertex_scalar(link, a);
  let b_scalar = vertex_scalar(link, b);

  var delta = load_xyz(0u, b_scalar) - load_xyz(0u, a_scalar);
  let edge_length = length(delta);
  var force: vec3<f32>;

  if (edge_length <= 1e-12) {
    delta = rest_xyz(b) - rest_xyz(a);
    force = delta * (-globals.physics.x);
  } else {
    let scale = globals.physics.x * (edge_length - 1.0) / edge_length;
    force = delta * scale;
  }

  store_force(a_scalar, load_xyz(2u, a_scalar) + force);
  store_force(b_scalar, load_xyz(2u, b_scalar) - force);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn hinge_gather_main(
  @builtin(global_invocation_id) gid: vec3<u32>,
) {
  let target_link = linear_id(gid);
  if (target_link >= globals.counts.x) { return; }

  let begin = incoming_offsets[target_link];
  let end = incoming_offsets[target_link + 1u];
  var sum = vec3<f32>(0.0);

  var index = begin;
  loop {
    if (index >= end) { break; }
    let encoded = incoming_refs[index];
    let source = encoded >> 1u;
    let role = encoded & 1u;
    let ring_base = select(globals.counts.z, globals.counts.w, role == 1u);
    for (var corner = 0u; corner < 3u; corner = corner + 1u) {
      sum += load_xyz(2u, vertex_scalar(source, ring_base + corner));
    }
    index += 1u;
  }

  let share = sum / 3.0;
  let c0 = vertex_scalar(target_link, globals.center_rest.x);
  let c1 = vertex_scalar(target_link, globals.center_rest.y);
  let c2 = vertex_scalar(target_link, globals.center_rest.z);
  store_force(c0, load_xyz(2u, c0) + share);
  store_force(c1, load_xyz(2u, c1) + share);
  store_force(c2, load_xyz(2u, c2) + share);
}

fn remove_ring_translation_force(link: u32, ring_base: u32) {
  var total = vec3<f32>(0.0);
  for (var corner = 0u; corner < 3u; corner = corner + 1u) {
    total += load_xyz(2u, vertex_scalar(link, ring_base + corner));
  }
  let mean = total / 3.0;
  for (var corner = 0u; corner < 3u; corner = corner + 1u) {
    let scalar = vertex_scalar(link, ring_base + corner);
    store_force(scalar, load_xyz(2u, scalar) - mean);
  }
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn hinge_zero_main(
  @builtin(global_invocation_id) gid: vec3<u32>,
) {
  let link = linear_id(gid);
  if (link >= globals.counts.x) { return; }

  remove_ring_translation_force(link, globals.counts.z);
  remove_ring_translation_force(link, globals.counts.w);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn integrate_main(
  @builtin(global_invocation_id) gid: vec3<u32>,
) {
  let linear = linear_id(gid);
  if (linear >= globals.bases_total.w) { return; }

  let scalar = linear * 3u;
  let dt = globals.physics.y;
  let velocity = (load_xyz(1u, scalar) + load_xyz(2u, scalar) * dt) * globals.physics.z;
  store_velocity(scalar, velocity);
  store_position(scalar, load_xyz(0u, scalar) + velocity * dt);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn project_hinges_main(
  @builtin(global_invocation_id) gid: vec3<u32>,
) {
  let link = linear_id(gid);
  if (link >= globals.counts.x) { return; }

  let start_target = topology[link * 2u];
  let end_target = topology[link * 2u + 1u];

  let start_position_delta =
    center_xyz(start_target, 0u) - ring_xyz(link, globals.counts.z, 0u);
  let start_velocity_delta =
    center_xyz(start_target, 1u) - ring_xyz(link, globals.counts.z, 1u);
  translate_ring_position(link, globals.counts.z, start_position_delta);
  translate_ring_velocity(link, globals.counts.z, start_velocity_delta);

  let end_position_delta =
    center_xyz(end_target, 0u) - ring_xyz(link, globals.counts.w, 0u);
  let end_velocity_delta =
    center_xyz(end_target, 1u) - ring_xyz(link, globals.counts.w, 1u);
  translate_ring_position(link, globals.counts.w, end_position_delta);
  translate_ring_velocity(link, globals.counts.w, end_velocity_delta);
}

`;

function minimumBufferSize(byteLength: number): number {
  return Math.max(4, byteLength);
}

function createBuffer(
  device: WebGpuDeviceLike,
  label: string,
  byteLength: number,
  usage: number,
): WebGpuBufferLike {
  return device.createBuffer({
    label,
    size: minimumBufferSize(byteLength),
    usage,
  });
}

function writeWhole(device: WebGpuDeviceLike, buffer: WebGpuBufferLike, data: ArrayBufferView): void {
  if (data.byteLength > 0) device.queue.writeBuffer(buffer, 0, data);
}

function topologyWords(topology: OctahedralLinkTopology3D): Uint32Array {
  const words = new Uint32Array(topology.linkCount * 2);
  for (let link = 0; link < topology.linkCount; link += 1) {
    words[link * 2] = topology.startIndices[link]!;
    words[link * 2 + 1] = topology.endIndices[link]!;
  }
  return words;
}

function globalsData(
  topology: OctahedralLinkTopology3D,
  template: OctahedralLinkTemplate3D,
  packedTemplate: OctahedralPackedWebGpuTemplate3D,
  stiffness: number,
  simulationSpeed: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(80);
  const u32 = new Uint32Array(buffer);
  const f32 = new Float32Array(buffer);
  u32[0] = topology.linkCount;
  u32[1] = template.vertexCount;
  u32[2] = template.startTriangle[0];
  u32[3] = template.endTriangle[0];

  u32[4] = template.centerTriangle[0];
  u32[5] = template.centerTriangle[1];
  u32[6] = template.centerTriangle[2];
  u32[7] = packedTemplate.restBase;

  u32[8] = packedTemplate.edgeABase;
  u32[9] = packedTemplate.edgeBBase;
  u32[10] = packedTemplate.batchEdgesBase;
  u32[11] = topology.linkCount * template.vertexCount;

  u32[12] = 0;
  u32[13] = 0;
  u32[14] = 0;
  u32[15] = 0;

  const dt = BASE_TIME_STEP * simulationSpeed;
  f32[16] = stiffness;
  f32[17] = dt;
  f32[18] = Math.exp(-INTERNAL_DAMPING_RATE * dt);
  f32[19] = 0;

  return buffer;
}

function batchData(offset: number, count: number): Uint32Array {
  return new Uint32Array([offset, count, 0, 0]);
}

function maxWorkgroups(device: WebGpuDeviceLike): number {
  const value = device.limits?.maxComputeWorkgroupsPerDimension;
  if (value === undefined) return DEFAULT_MAX_WORKGROUPS_PER_DIMENSION;
  return Math.min(
    requirePositiveSafeInteger(value, "device.maxComputeWorkgroupsPerDimension"),
    DEFAULT_MAX_WORKGROUPS_PER_DIMENSION,
  );
}

async function assertShaderModuleCompilation(
  shaderModule: WebGpuShaderModuleLike,
  label: string,
): Promise<void> {
  if (typeof shaderModule.getCompilationInfo !== "function") return;

  const info = await shaderModule.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === "error");
  if (errors.length === 0) return;

  const details = errors.map((message) => {
    const line = message.lineNum;
    const column = message.linePos;
    const location = line === undefined
      ? ""
      : column === undefined
        ? ` line ${line}`
        : ` line ${line}:${column}`;
    return `- ${label}${location}: ${message.message}`;
  });
  throw new Error(`${label} WGSL compilation failed:\n${details.join("\n")}`);
}

function encodeDispatch(
  encoder: WebGpuCommandEncoderLike,
  pipeline: WebGpuComputePipelineLike,
  bindGroup: object,
  invocationCount: number,
  maximum: number,
): boolean {
  if (invocationCount === 0) return false;
  const dispatch = computeOctahedralWebGpuDispatch2D(invocationCount, maximum);
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(dispatch.workgroupsX, dispatch.workgroupsY, 1);
  pass.end();
  return true;
}

class OctahedralWebGpuController implements OctahedralWebGpuCompute3D {
  readonly template: OctahedralLinkTemplate3D;
  readonly topology: OctahedralLinkTopology3D;
  readonly positionBuffer: WebGpuBufferLike;
  readonly velocityBuffer: WebGpuBufferLike;
  readonly forceBuffer: WebGpuBufferLike;

  private readonly device: WebGpuDeviceLike;
  private readonly reverse: OctahedralReverseIncidence3D;
  private readonly packedTemplate: OctahedralPackedWebGpuTemplate3D;
  private readonly topologyBuffer: WebGpuBufferLike;
  private readonly incomingOffsetsBuffer: WebGpuBufferLike;
  private readonly incomingRefsBuffer: WebGpuBufferLike;
  private readonly templateBuffer: WebGpuBufferLike;
  private readonly seedCentersBuffer: WebGpuBufferLike;
  private readonly globalsBuffer: WebGpuBufferLike;
  private readonly defaultBatchBuffer: WebGpuBufferLike;
  private readonly batchBuffers: readonly WebGpuBufferLike[];
  private readonly defaultBindGroup: object;
  private readonly batchBindGroups: readonly object[];
  private readonly pipelines: Readonly<Record<string, WebGpuComputePipelineLike>>;
  private readonly maximumWorkgroups: number;
  private currentStiffness: number;
  private currentSimulationSpeed: number;
  private destroyed = false;
  private deviceLost = false;
  private deviceLostReason: string | null = null;

  constructor(args: {
    device: WebGpuDeviceLike;
    topology: OctahedralLinkTopology3D;
    template: OctahedralLinkTemplate3D;
    reverse: OctahedralReverseIncidence3D;
    packedTemplate: OctahedralPackedWebGpuTemplate3D;
    positionBuffer: WebGpuBufferLike;
    velocityBuffer: WebGpuBufferLike;
    forceBuffer: WebGpuBufferLike;
    topologyBuffer: WebGpuBufferLike;
    incomingOffsetsBuffer: WebGpuBufferLike;
    incomingRefsBuffer: WebGpuBufferLike;
    templateBuffer: WebGpuBufferLike;
    seedCentersBuffer: WebGpuBufferLike;
    globalsBuffer: WebGpuBufferLike;
    defaultBatchBuffer: WebGpuBufferLike;
    batchBuffers: readonly WebGpuBufferLike[];
    defaultBindGroup: object;
    batchBindGroups: readonly object[];
    pipelines: Readonly<Record<string, WebGpuComputePipelineLike>>;
    stiffness: number;
    simulationSpeed: number;
  }) {
    this.device = args.device;
    this.topology = args.topology;
    this.template = args.template;
    this.reverse = args.reverse;
    this.packedTemplate = args.packedTemplate;
    this.positionBuffer = args.positionBuffer;
    this.velocityBuffer = args.velocityBuffer;
    this.forceBuffer = args.forceBuffer;
    this.topologyBuffer = args.topologyBuffer;
    this.incomingOffsetsBuffer = args.incomingOffsetsBuffer;
    this.incomingRefsBuffer = args.incomingRefsBuffer;
    this.templateBuffer = args.templateBuffer;
    this.seedCentersBuffer = args.seedCentersBuffer;
    this.globalsBuffer = args.globalsBuffer;
    this.defaultBatchBuffer = args.defaultBatchBuffer;
    this.batchBuffers = args.batchBuffers;
    this.defaultBindGroup = args.defaultBindGroup;
    this.batchBindGroups = args.batchBindGroups;
    this.pipelines = args.pipelines;
    this.currentStiffness = args.stiffness;
    this.currentSimulationSpeed = args.simulationSpeed;
    this.maximumWorkgroups = maxWorkgroups(args.device);

    void args.device.lost?.then((info) => {
      if (this.destroyed) return;
      this.deviceLost = true;
      this.deviceLostReason = info.message ?? info.reason ?? "WebGPU device lost";
    }).catch((error: unknown) => {
      if (this.destroyed) return;
      this.deviceLost = true;
      this.deviceLostReason = error instanceof Error ? error.message : String(error);
    });
  }

  get stiffness(): number {
    return this.currentStiffness;
  }

  get simulationSpeed(): number {
    return this.currentSimulationSpeed;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("octahedral WebGPU controller is destroyed");
    if (this.deviceLost) {
      throw new Error(`octahedral WebGPU device lost: ${this.deviceLostReason ?? "unknown reason"}`);
    }
  }

  private updateGlobals(): void {
    const data = globalsData(
      this.topology,
      this.template,
      this.packedTemplate,
      this.currentStiffness,
      this.currentSimulationSpeed,
    );
    this.device.queue.writeBuffer(this.globalsBuffer, 0, data);
  }

  setStiffness(stiffness: number): void {
    this.assertAlive();
    this.currentStiffness = requireNonNegativeFinite(stiffness, "stiffness");
    this.updateGlobals();
  }

  setSimulationSpeed(simulationSpeed: number): void {
    this.assertAlive();
    this.currentSimulationSpeed = requireNonNegativeFinite(simulationSpeed, "simulationSpeed");
    this.updateGlobals();
  }

  writeVertexOverrides(
    overrides: readonly OctahedralWebGpuVertexOverride3D[],
  ): OctahedralWebGpuOverrideStats3D {
    this.assertAlive();
    if (overrides.length === 0) {
      return Object.freeze({
        vertexCount: 0,
        bufferWrites: 0,
        positionBytes: 0,
        velocityBytes: 0,
      });
    }

    const byGlobalVertex = new Map<number, OctahedralWebGpuVertexOverride3D>();
    for (const override of overrides) {
      if (
        !Number.isSafeInteger(override.linkIndex)
        || override.linkIndex < 0
        || override.linkIndex >= this.topology.linkCount
      ) {
        throw new Error(`invalid override linkIndex: ${String(override.linkIndex)}`);
      }
      if (
        !Number.isSafeInteger(override.vertexIndex)
        || override.vertexIndex < 0
        || override.vertexIndex >= this.template.vertexCount
      ) {
        throw new Error(`invalid override vertexIndex: ${String(override.vertexIndex)}`);
      }
      if (
        override.position.length !== 3
        || !override.position.every(Number.isFinite)
        || (override.velocity !== undefined
          && (override.velocity.length !== 3 || !override.velocity.every(Number.isFinite)))
      ) {
        throw new Error("vertex override position/velocity must be finite vec3");
      }

      const globalVertex =
        override.linkIndex * this.template.vertexCount + override.vertexIndex;
      if (byGlobalVertex.has(globalVertex)) {
        throw new Error(
          `duplicate vertex override: link=${override.linkIndex} vertex=${override.vertexIndex}`,
        );
      }
      byGlobalVertex.set(globalVertex, override);
    }

    const ordered = [...byGlobalVertex.entries()].sort((left, right) => left[0] - right[0]);
    let bufferWrites = 0;
    let positionBytes = 0;
    let velocityBytes = 0;
    let cursor = 0;

    while (cursor < ordered.length) {
      const runStart = cursor;
      const firstGlobal = ordered[cursor]![0];
      let previousGlobal = firstGlobal;
      cursor += 1;
      while (cursor < ordered.length && ordered[cursor]![0] === previousGlobal + 1) {
        previousGlobal = ordered[cursor]![0];
        cursor += 1;
      }

      const run = ordered.slice(runStart, cursor);
      const positions = new Float32Array(run.length * 3);
      const velocities = new Float32Array(run.length * 3);
      for (let index = 0; index < run.length; index += 1) {
        const override = run[index]![1];
        positions.set(override.position, index * 3);
        velocities.set(override.velocity ?? [0, 0, 0], index * 3);
      }

      const byteOffset = firstGlobal * 3 * 4;
      this.device.queue.writeBuffer(this.positionBuffer, byteOffset, positions);
      this.device.queue.writeBuffer(this.velocityBuffer, byteOffset, velocities);
      bufferWrites += 2;
      positionBytes += positions.byteLength;
      velocityBytes += velocities.byteLength;
    }

    return Object.freeze({
      vertexCount: ordered.length,
      bufferWrites,
      positionBytes,
      velocityBytes,
    });
  }

  step(): OctahedralWebGpuStepStats {
    this.assertAlive();
    const totalVertices = this.topology.linkCount * this.template.vertexCount;
    const encoder = this.device.createCommandEncoder({ label: "octahedral-webgpu-step" });
    let computePasses = 0;

    if (encodeDispatch(
      encoder,
      this.pipelines.clear_forces_main!,
      this.defaultBindGroup,
      totalVertices,
      this.maximumWorkgroups,
    )) computePasses += 1;

    for (let batchIndex = 0; batchIndex < this.packedTemplate.batches.length; batchIndex += 1) {
      const batch = this.packedTemplate.batches[batchIndex]!;
      if (encodeDispatch(
        encoder,
        this.pipelines.spring_batch_main!,
        this.batchBindGroups[batchIndex]!,
        this.topology.linkCount * batch.count,
        this.maximumWorkgroups,
      )) computePasses += 1;
    }

    if (encodeDispatch(
      encoder,
      this.pipelines.hinge_gather_main!,
      this.defaultBindGroup,
      this.topology.linkCount,
      this.maximumWorkgroups,
    )) computePasses += 1;

    if (encodeDispatch(
      encoder,
      this.pipelines.hinge_zero_main!,
      this.defaultBindGroup,
      this.topology.linkCount,
      this.maximumWorkgroups,
    )) computePasses += 1;

    if (encodeDispatch(
      encoder,
      this.pipelines.integrate_main!,
      this.defaultBindGroup,
      totalVertices,
      this.maximumWorkgroups,
    )) computePasses += 1;

    if (encodeDispatch(
      encoder,
      this.pipelines.project_hinges_main!,
      this.defaultBindGroup,
      this.topology.linkCount,
      this.maximumWorkgroups,
    )) computePasses += 1;

    this.device.queue.submit([encoder.finish()]);

    return Object.freeze({
      springBatchDispatches: this.packedTemplate.batches.length,
      computePasses,
      dynamicStateUploadBytes: 0 as const,
    });
  }

  private async readBack(buffer: WebGpuBufferLike, logicalBytes: number): Promise<Float32Array> {
    this.assertAlive();
    if (logicalBytes === 0) return new Float32Array(0);

    const readback = createBuffer(
      this.device,
      "octahedral-webgpu-readback",
      logicalBytes,
      GPU_BUFFER_USAGE.MAP_READ | GPU_BUFFER_USAGE.COPY_DST,
    );
    const encoder = this.device.createCommandEncoder({ label: "octahedral-webgpu-readback-copy" });
    encoder.copyBufferToBuffer(buffer, 0, readback, 0, logicalBytes);
    this.device.queue.submit([encoder.finish()]);

    let mapped = false;
    try {
      await readback.mapAsync(GPU_MAP_MODE_READ, 0, logicalBytes);
      mapped = true;
      const range = readback.getMappedRange(0, logicalBytes);
      return new Float32Array(range.slice(0));
    } finally {
      if (mapped) readback.unmap();
      readback.destroy();
    }
  }

  readBackPositions(): Promise<Float32Array> {
    const bytes = this.topology.linkCount * this.template.vertexCount * 3 * 4;
    return this.readBack(this.positionBuffer, bytes);
  }

  readBackVelocities(): Promise<Float32Array> {
    const bytes = this.topology.linkCount * this.template.vertexCount * 3 * 4;
    return this.readBack(this.velocityBuffer, bytes);
  }

  snapshot(): OctahedralWebGpuSnapshot3D {
    const totalPhysicalVertices = this.topology.linkCount * this.template.vertexCount;
    const fieldBytes = totalPhysicalVertices * 3 * 4;
    return Object.freeze({
      status: this.destroyed ? "destroyed" : this.deviceLost ? "device-lost" : "available",
      deviceLostReason: this.deviceLostReason,
      linkCount: this.topology.linkCount,
      vertexCount: this.template.vertexCount,
      edgeCount: this.template.edgeCount,
      totalPhysicalVertices,
      positionBytes: fieldBytes,
      velocityBytes: fieldBytes,
      forceBytes: fieldBytes,
      gpuDynamicXyzBytes: fieldBytes * 3,
      springBatchCount: this.packedTemplate.batches.length,
      stiffness: this.currentStiffness,
      simulationSpeed: this.currentSimulationSpeed,
      destroyed: this.destroyed,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    const buffers = [
      this.positionBuffer,
      this.velocityBuffer,
      this.forceBuffer,
      this.topologyBuffer,
      this.incomingOffsetsBuffer,
      this.incomingRefsBuffer,
      this.templateBuffer,
      this.seedCentersBuffer,
      this.globalsBuffer,
      this.defaultBatchBuffer,
      ...this.batchBuffers,
    ];
    for (const buffer of buffers) buffer.destroy();
  }
}

function bindGroupEntries(
  positionBuffer: WebGpuBufferLike,
  velocityBuffer: WebGpuBufferLike,
  forceBuffer: WebGpuBufferLike,
  topologyBuffer: WebGpuBufferLike,
  incomingOffsetsBuffer: WebGpuBufferLike,
  incomingRefsBuffer: WebGpuBufferLike,
  templateBuffer: WebGpuBufferLike,
  seedCentersBuffer: WebGpuBufferLike,
  globalsBuffer: WebGpuBufferLike,
  batchBuffer: WebGpuBufferLike,
): readonly object[] {
  return [
    { binding: 0, resource: { buffer: positionBuffer } },
    { binding: 1, resource: { buffer: velocityBuffer } },
    { binding: 2, resource: { buffer: forceBuffer } },
    { binding: 3, resource: { buffer: topologyBuffer } },
    { binding: 4, resource: { buffer: incomingOffsetsBuffer } },
    { binding: 5, resource: { buffer: incomingRefsBuffer } },
    { binding: 6, resource: { buffer: templateBuffer } },
    { binding: 7, resource: { buffer: globalsBuffer } },
    { binding: 8, resource: { buffer: batchBuffer } },
    { binding: 9, resource: { buffer: seedCentersBuffer } },
  ];
}

export async function createOctahedralWebGpuCompute3D(
  device: WebGpuDeviceLike,
  network: VisualLinkNetwork,
  options: OctahedralWebGpuComputeOptions,
): Promise<OctahedralWebGpuCompute3D> {
  const stiffness = requireNonNegativeFinite(options.stiffness, "stiffness");
  const simulationSpeed = requireNonNegativeFinite(options.simulationSpeed, "simulationSpeed");
  const topology = buildOctahedralLinkTopology3D(network);
  const template = getOctahedralLinkTemplate3D(options.aspectRatio);
  const reverse = buildOctahedralReverseIncidence3D(topology);
  const packedTemplate = packOctahedralWebGpuTemplate3D(template);
  const seedCenters = resolveOctahedralSeedCenters3D(template, topology);

  const totalPhysicalVertices = topology.linkCount * template.vertexCount;
  const fieldBytes = totalPhysicalVertices * 3 * 4;
  const maxStorage = device.limits?.maxStorageBufferBindingSize;
  if (maxStorage !== undefined && fieldBytes > maxStorage) {
    throw new Error(
      `octahedral WebGPU state buffer ${fieldBytes} exceeds maxStorageBufferBindingSize ${maxStorage}`,
    );
  }

  const positionBuffer = createBuffer(
    device,
    "octahedral-positions",
    fieldBytes,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC | GPU_BUFFER_USAGE.COPY_DST,
  );
  const velocityBuffer = createBuffer(
    device,
    "octahedral-velocities",
    fieldBytes,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC | GPU_BUFFER_USAGE.COPY_DST,
  );
  const forceBuffer = createBuffer(
    device,
    "octahedral-forces",
    fieldBytes,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC | GPU_BUFFER_USAGE.COPY_DST,
  );

  const topologyData = topologyWords(topology);
  const topologyBuffer = createBuffer(
    device,
    "octahedral-topology",
    topologyData.byteLength,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
  );
  writeWhole(device, topologyBuffer, topologyData);

  const incomingOffsetsBuffer = createBuffer(
    device,
    "octahedral-incoming-offsets",
    reverse.incomingOffsets.byteLength,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
  );
  writeWhole(device, incomingOffsetsBuffer, reverse.incomingOffsets);

  const incomingRefsBuffer = createBuffer(
    device,
    "octahedral-incoming-refs",
    reverse.incomingRefs.byteLength,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
  );
  writeWhole(device, incomingRefsBuffer, reverse.incomingRefs);

  const templateBuffer = createBuffer(
    device,
    "octahedral-template-words",
    packedTemplate.words.byteLength,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
  );
  writeWhole(device, templateBuffer, packedTemplate.words);

  const seedCentersBuffer = createBuffer(
    device,
    "octahedral-seed-centers",
    seedCenters.byteLength,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
  );
  writeWhole(device, seedCentersBuffer, seedCenters);

  const globalBytes = globalsData(topology, template, packedTemplate, stiffness, simulationSpeed);
  const globalsBuffer = createBuffer(
    device,
    "octahedral-globals",
    globalBytes.byteLength,
    GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
  );
  device.queue.writeBuffer(globalsBuffer, 0, globalBytes);

  const defaultBatchBuffer = createBuffer(
    device,
    "octahedral-batch-default",
    16,
    GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
  );
  writeWhole(device, defaultBatchBuffer, batchData(0, 0));

  const batchBuffers = packedTemplate.batches.map((batch, index) => {
    const buffer = createBuffer(
      device,
      `octahedral-batch-${index}`,
      16,
      GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    );
    writeWhole(device, buffer, batchData(batch.offset, batch.count));
    return buffer;
  });

  const shaderModule = device.createShaderModule({
    label: "octahedral-webgpu-compute",
    code: OCTAHEDRAL_WEBGPU_WGSL,
  });
  await assertShaderModuleCompilation(shaderModule, "octahedral-webgpu-compute");

  const bindGroupLayout = device.createBindGroupLayout({
    label: "octahedral-webgpu-layout",
    entries: [
      { binding: 0, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
      { binding: 1, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 4, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 5, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 6, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 7, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "uniform" } },
      { binding: 8, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "uniform" } },
      { binding: 9, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "read-only-storage" } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: "octahedral-webgpu-pipeline-layout",
    bindGroupLayouts: [bindGroupLayout],
  });

  const entryPoints = [
    "init_main",
    "clear_forces_main",
    "spring_batch_main",
    "hinge_gather_main",
    "hinge_zero_main",
    "integrate_main",
    "project_hinges_main",
  ] as const;

  const pipelineEntries = await Promise.all(entryPoints.map(async (entryPoint) => {
    const pipeline = await device.createComputePipelineAsync({
      label: `octahedral-${entryPoint}`,
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint },
    });
    return [entryPoint, pipeline] as const;
  }));
  const pipelines = Object.freeze(Object.fromEntries(pipelineEntries)) as Readonly<Record<string, WebGpuComputePipelineLike>>;

  const makeBindGroup = (batchBuffer: WebGpuBufferLike, label: string): object => (
    device.createBindGroup({
      label,
      layout: bindGroupLayout,
      entries: bindGroupEntries(
        positionBuffer,
        velocityBuffer,
        forceBuffer,
        topologyBuffer,
        incomingOffsetsBuffer,
        incomingRefsBuffer,
        templateBuffer,
        seedCentersBuffer,
        globalsBuffer,
        batchBuffer,
      ),
    })
  );

  const defaultBindGroup = makeBindGroup(defaultBatchBuffer, "octahedral-webgpu-default-bind-group");
  const batchBindGroups = batchBuffers.map((buffer, index) => (
    makeBindGroup(buffer, `octahedral-webgpu-batch-bind-group-${index}`)
  ));

  const controller = new OctahedralWebGpuController({
    device,
    topology,
    template,
    reverse,
    packedTemplate,
    positionBuffer,
    velocityBuffer,
    forceBuffer,
    topologyBuffer,
    incomingOffsetsBuffer,
    incomingRefsBuffer,
    templateBuffer,
    seedCentersBuffer,
    globalsBuffer,
    defaultBatchBuffer,
    batchBuffers,
    defaultBindGroup,
    batchBindGroups,
    pipelines,
    stiffness,
    simulationSpeed,
  });

  // GPU-only initialization: no packed CPU position/velocity/force allocation or upload.
  const encoder = device.createCommandEncoder({ label: "octahedral-webgpu-init" });
  const maximum = maxWorkgroups(device);
  encodeDispatch(
    encoder,
    pipelines.init_main!,
    defaultBindGroup,
    totalPhysicalVertices,
    maximum,
  );
  encodeDispatch(
    encoder,
    pipelines.project_hinges_main!,
    defaultBindGroup,
    topology.linkCount,
    maximum,
  );
  device.queue.submit([encoder.finish()]);

  return controller;
}

export async function requestOctahedralWebGpuDevice3D(
  requiredStorageBufferBytes = 0,
): Promise<WebGpuDeviceLike | null> {
  if (!Number.isSafeInteger(requiredStorageBufferBytes) || requiredStorageBufferBytes < 0) {
    throw new Error(`invalid requiredStorageBufferBytes: ${String(requiredStorageBufferBytes)}`);
  }

  const navigatorLike = (globalThis as unknown as {
    readonly navigator?: { readonly gpu?: WebGpuApiLike };
  }).navigator;
  const gpu = navigatorLike?.gpu;
  if (!gpu) return null;

  try {
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;

    const supported = adapter.limits?.maxStorageBufferBindingSize;
    if (supported !== undefined && requiredStorageBufferBytes > supported) return null;

    const requiredLimits = requiredStorageBufferBytes > 0
      ? { maxStorageBufferBindingSize: requiredStorageBufferBytes }
      : undefined;
    return await adapter.requestDevice(requiredLimits === undefined ? undefined : { requiredLimits });
  } catch {
    return null;
  }
}

function maxAbsoluteDelta(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) throw new Error("differential arrays have different lengths");
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(left[index]! - right[index]!));
  }
  return maximum;
}

export async function runOctahedralWebGpuDifferentialWitness3D(
  network: VisualLinkNetwork,
  options: OctahedralWebGpuComputeOptions,
  witnessOptions: {
    readonly device?: WebGpuDeviceLike;
    readonly steps?: number;
    readonly tolerance?: number;
  } = {},
): Promise<OctahedralWebGpuDifferentialResult3D> {
  const steps = witnessOptions.steps ?? 1;
  const tolerance = witnessOptions.tolerance ?? 2e-4;
  if (!Number.isSafeInteger(steps) || steps < 0) throw new Error(`invalid differential steps: ${String(steps)}`);
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error(`invalid differential tolerance: ${String(tolerance)}`);

  const template = getOctahedralLinkTemplate3D(options.aspectRatio);
  const topology = buildOctahedralLinkTopology3D(network);
  const fieldBytes = topology.linkCount * template.vertexCount * 3 * 4;
  const device = witnessOptions.device ?? await requestOctahedralWebGpuDevice3D(fieldBytes);
  if (!device) {
    return Object.freeze({
      available: false,
      passed: false,
      steps,
      tolerance,
      maxPositionDelta: null,
      maxVelocityDelta: null,
      reason: "WebGPU unavailable or required storage-buffer limit unsupported",
    });
  }

  const cpu = createOctahedralLivePhysics3D(network, options);
  const gpu = await createOctahedralWebGpuCompute3D(device, network, options);

  try {
    for (let step = 0; step < steps; step += 1) {
      cpu.step();
      gpu.step();
    }

    const [gpuPositions, gpuVelocities] = await Promise.all([
      gpu.readBackPositions(),
      gpu.readBackVelocities(),
    ]);
    const maxPositionDelta = maxAbsoluteDelta(cpu.positions, gpuPositions);
    const maxVelocityDelta = maxAbsoluteDelta(cpu.velocities, gpuVelocities);
    return Object.freeze({
      available: true,
      passed: maxPositionDelta <= tolerance && maxVelocityDelta <= tolerance,
      steps,
      tolerance,
      maxPositionDelta,
      maxVelocityDelta,
    });
  } finally {
    gpu.destroy();
  }
}
