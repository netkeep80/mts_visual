import type { VisualLinkNetwork } from "../index.js";
import {
  buildOctahedralLinkTopology3D,
  type OctahedralLinkTopology3D,
} from "../octahedral-link3d.js";
import {
  RIGID_SECTION_ANGULAR_DAMPING_RATE,
  RIGID_SECTION_BASE_TIME_STEP,
  RIGID_SECTION_LINEAR_DAMPING_RATE,
  buildRigidSectionReverseIncidence3D,
  createRigidSectionPhysics3D,
  getRigidSectionTemplate3D,
  type RigidSectionTemplate3D,
} from "../rigid-section3d.js";
import {
  computeOctahedralWebGpuDispatch2D,
  type WebGpuBufferLike,
  type WebGpuDeviceLike,
} from "./octahedral-compute.js";

const WORKGROUP_SIZE = 64;
const DEFAULT_MAX_WORKGROUPS_PER_DIMENSION = 65_535;
const REQUIRED_STORAGE_BUFFERS_PER_STAGE = 7;

const GPU_BUFFER_USAGE = Object.freeze({
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
});
const GPU_MAP_MODE_READ = 0x0001;
const GPU_SHADER_STAGE_COMPUTE = 0x0004;

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

interface WebGpuComputePipelineLike {
  readonly label?: string;
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

export interface RigidSectionWebGpuComputeOptions3D {
  readonly aspectRatio: number;
  readonly stiffness: number;
  readonly simulationSpeed: number;
}

export interface RigidSectionWebGpuStepStats3D {
  readonly relationBatchDispatches: 2;
  readonly hingeDispatches: 2;
  readonly computePasses: 6;
  readonly dynamicStateUploadBytes: 0;
}

export interface RigidSectionWebGpuState3D {
  readonly centers: Float32Array;
  readonly orientations: Float32Array;
  readonly linearVelocities: Float32Array;
  readonly angularVelocities: Float32Array;
}

export interface RigidSectionWebGpuSnapshot3D {
  readonly status: "available" | "device-lost" | "destroyed";
  readonly deviceLostReason: string | null;
  readonly linkCount: number;
  readonly sectionCount: number;
  readonly bodyCount: number;
  readonly centerBytes: number;
  readonly orientationBytes: number;
  readonly velocityBytes: number;
  readonly angularVelocityBytes: number;
  readonly forceBytes: number;
  readonly torqueBytes: number;
  readonly stiffness: number;
  readonly simulationSpeed: number;
}

export interface RigidSectionWebGpuCompute3D {
  readonly topology: OctahedralLinkTopology3D;
  readonly template: RigidSectionTemplate3D;
  readonly centerBuffer: WebGpuBufferLike;
  readonly orientationBuffer: WebGpuBufferLike;
  readonly linearVelocityBuffer: WebGpuBufferLike;
  readonly angularVelocityBuffer: WebGpuBufferLike;
  readonly stiffness: number;
  readonly simulationSpeed: number;
  step(): RigidSectionWebGpuStepStats3D;
  setStiffness(value: number): void;
  setSimulationSpeed(value: number): void;
  readBackState(): Promise<RigidSectionWebGpuState3D>;
  snapshot(): RigidSectionWebGpuSnapshot3D;
  destroy(): void;
}

export interface RigidSectionWebGpuDifferentialResult3D {
  readonly passed: boolean;
  readonly steps: number;
  readonly tolerance: number;
  readonly maxCenterDelta: number;
  readonly maxOrientationDelta: number;
  readonly maxLinearVelocityDelta: number;
  readonly maxAngularVelocityDelta: number;
}

export const RIGID_SECTION_WEBGPU_WGSL = `
struct Globals {
  counts: vec4<u32>,
  counts2: vec4<u32>,
  physics: vec4<f32>,
  geometry: vec4<f32>,
  inverse_inertia: vec4<f32>,
};

@group(0) @binding(0) var<storage, read_write> centers: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> orientations: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> linear_velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> angular_velocities: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> accumulation: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> topology_data: array<u32>;
@group(0) @binding(6) var<storage, read_write> scratch: array<vec4<f32>>;
@group(0) @binding(7) var<uniform> globals: Globals;
@group(0) @binding(8) var<uniform> control: vec4<u32>;

fn force_slot(body: u32) -> u32 {
  return body * 2u;
}

fn torque_slot(body: u32) -> u32 {
  return body * 2u + 1u;
}

fn scratch_center_slot(body: u32) -> u32 {
  return body * 2u;
}

fn scratch_velocity_slot(body: u32) -> u32 {
  return body * 2u + 1u;
}

fn linear_index(gid: vec3<u32>) -> u32 {
  return gid.x * ${WORKGROUP_SIZE}u + gid.y * 65535u * ${WORKGROUP_SIZE}u;
}

fn q_normalize(q: vec4<f32>) -> vec4<f32> {
  let n = length(q);
  if (n <= 1e-12) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  return q / n;
}

fn q_conjugate(q: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(-q.xyz, q.w);
}

fn q_mul_raw(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  );
}

fn q_rotate(q_input: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let q = q_normalize(q_input);
  let uv = cross(q.xyz, v);
  let uuv = cross(q.xyz, uv);
  return v + 2.0 * (q.w * uv + uuv);
}

fn local_triangle_vertex(corner: u32) -> vec3<f32> {
  let angle = f32(corner) * 2.0943951023931953;
  let r = globals.geometry.y;
  return vec3<f32>(r * cos(angle), r * sin(angle), 0.0);
}

fn canonical_upper_vertex(corner: u32) -> vec3<f32> {
  let angle = f32(corner) * 2.0943951023931953 + 1.0471975511965976;
  let r = globals.geometry.y;
  return vec3<f32>(r * cos(angle), r * sin(angle), globals.geometry.x);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn clear_force_torque_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let body = linear_index(gid);
  if (body >= globals.counts.w) {
    return;
  }
  accumulation[force_slot(body)] = vec4<f32>(0.0);
  accumulation[torque_slot(body)] = vec4<f32>(0.0);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn relation_batch_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let linear = linear_index(gid);
  let pair_count = globals.counts2.y;
  let total = globals.counts.x * pair_count;
  if (linear >= total) {
    return;
  }

  let link = linear / pair_count;
  let pair = linear % pair_count;
  let parity = control.x;
  let local = pair * 2u + parity;
  let lower = link * globals.counts.y + local;
  let upper = lower + 1u;

  let lower_center = centers[lower].xyz;
  let upper_center = centers[upper].xyz;
  let lower_q = orientations[lower];
  let upper_q = orientations[upper];
  let k = globals.physics.x;

  var lower_force = accumulation[force_slot(lower)].xyz;
  var upper_force = accumulation[force_slot(upper)].xyz;
  var lower_torque = accumulation[torque_slot(lower)].xyz;
  var upper_torque = accumulation[torque_slot(upper)].xyz;

  for (var corner = 0u; corner < 3u; corner = corner + 1u) {
    let local_upper = local_triangle_vertex(corner);
    let local_target = canonical_upper_vertex(corner);
    let actual = upper_center + q_rotate(upper_q, local_upper);
    let target_point = lower_center + q_rotate(lower_q, local_target);
    let delta = actual - target_point;
    let force_upper = -k * delta;
    let force_lower = -force_upper;

    upper_force = upper_force + force_upper;
    lower_force = lower_force + force_lower;
    upper_torque = upper_torque + cross(actual - upper_center, force_upper);
    lower_torque = lower_torque + cross(target_point - lower_center, force_lower);
  }

  accumulation[force_slot(lower)] = vec4<f32>(lower_force, 0.0);
  accumulation[force_slot(upper)] = vec4<f32>(upper_force, 0.0);
  accumulation[torque_slot(lower)] = vec4<f32>(lower_torque, 0.0);
  accumulation[torque_slot(upper)] = vec4<f32>(upper_torque, 0.0);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn integrate_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let body = linear_index(gid);
  if (body >= globals.counts.w) {
    return;
  }

  let dt = globals.physics.y;
  if (dt == 0.0) {
    return;
  }

  var v = linear_velocities[body].xyz;
  v = (v + accumulation[force_slot(body)].xyz * globals.geometry.z * dt) * globals.physics.z;
  let next_center = centers[body].xyz + v * dt;

  let q = q_normalize(orientations[body]);
  var omega = angular_velocities[body].xyz;
  let conjugate_q = q_conjugate(q);
  let torque_local = q_rotate(conjugate_q, accumulation[torque_slot(body)].xyz);
  let omega_local = q_rotate(conjugate_q, omega);
  let angular_momentum_local = omega_local / globals.inverse_inertia.xyz;
  let gyroscopic = cross(omega_local, angular_momentum_local);
  let alpha_local = (torque_local - gyroscopic) * globals.inverse_inertia.xyz;
  let alpha_world = q_rotate(q, alpha_local);

  omega = (omega + alpha_world * dt) * globals.physics.w;
  let dq = q_mul_raw(vec4<f32>(omega, 0.0), q);
  let next_q = q_normalize(q + 0.5 * dq * dt);

  centers[body] = vec4<f32>(next_center, 0.0);
  linear_velocities[body] = vec4<f32>(v, 0.0);
  angular_velocities[body] = vec4<f32>(omega, 0.0);
  orientations[body] = next_q;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn hinge_star_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let target_link = linear_index(gid);
  if (target_link >= globals.counts.x) {
    return;
  }

  let section_count = globals.counts.y;
  let middle = globals.counts.z;
  let end_section = section_count - 1u;
  let middle_body = target_link * section_count + middle;

  var center_sum = centers[middle_body].xyz;
  var velocity_sum = linear_velocities[middle_body].xyz;
  var member_count = 1u;

  let begin = topology_data[globals.counts2.z + target_link];
  let finish = topology_data[globals.counts2.z + target_link + 1u];
  for (var cursor = begin; cursor < finish; cursor = cursor + 1u) {
    let encoded = topology_data[globals.counts2.w + cursor];
    let source_link = encoded / 2u;
    let role = encoded & 1u;
    let source_local = select(0u, end_section, role == 1u);
    let endpoint_body = source_link * section_count + source_local;
    center_sum = center_sum + centers[endpoint_body].xyz;
    velocity_sum = velocity_sum + linear_velocities[endpoint_body].xyz;
    member_count = member_count + 1u;
  }

  let inverse_count = 1.0 / f32(member_count);
  scratch[scratch_center_slot(middle_body)] = vec4<f32>(center_sum * inverse_count, 0.0);
  scratch[scratch_velocity_slot(middle_body)] = vec4<f32>(velocity_sum * inverse_count, 0.0);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn hinge_apply_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let link = linear_index(gid);
  if (link >= globals.counts.x) {
    return;
  }

  let section_count = globals.counts.y;
  let middle = globals.counts.z;
  let end_section = section_count - 1u;
  let own_middle = link * section_count + middle;

  centers[own_middle] = scratch[scratch_center_slot(own_middle)];
  linear_velocities[own_middle] = scratch[scratch_velocity_slot(own_middle)];

  let start_target = topology_data[link * 2u];
  let start_target_middle = start_target * section_count + middle;
  let start_body = link * section_count;
  centers[start_body] = scratch[scratch_center_slot(start_target_middle)];
  linear_velocities[start_body] = scratch[scratch_velocity_slot(start_target_middle)];

  let end_target = topology_data[link * 2u + 1u];
  let end_target_middle = end_target * section_count + middle;
  let end_body = link * section_count + end_section;
  centers[end_body] = scratch[scratch_center_slot(end_target_middle)];
  linear_velocities[end_body] = scratch[scratch_velocity_slot(end_target_middle)];
}
`;

function requireNonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid rigid-section WebGPU ${label}: ${value}`);
  }
  return value;
}

function createBuffer(
  device: WebGpuDeviceLike,
  label: string,
  size: number,
  usage: number,
): WebGpuBufferLike {
  return device.createBuffer({
    label,
    size: Math.max(4, size),
    usage,
  });
}

function writeWhole(
  device: WebGpuDeviceLike,
  buffer: WebGpuBufferLike,
  data: ArrayBuffer | ArrayBufferView,
): void {
  if (data.byteLength > 0) device.queue.writeBuffer(buffer, 0, data);
}

function packVec3ToVec4(values: Float32Array): Float32Array {
  const count = values.length / 3;
  const result = new Float32Array(count * 4);
  for (let index = 0; index < count; index += 1) {
    result[index * 4] = values[index * 3]!;
    result[index * 4 + 1] = values[index * 3 + 1]!;
    result[index * 4 + 2] = values[index * 3 + 2]!;
  }
  return result;
}

function unpackVec4ToVec3(values: Float32Array): Float32Array {
  const count = values.length / 4;
  const result = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    result[index * 3] = values[index * 4]!;
    result[index * 3 + 1] = values[index * 4 + 1]!;
    result[index * 3 + 2] = values[index * 4 + 2]!;
  }
  return result;
}

function topologyWords(topology: OctahedralLinkTopology3D): Uint32Array {
  const words = new Uint32Array(topology.linkCount * 2);
  for (let link = 0; link < topology.linkCount; link += 1) {
    words[link * 2] = topology.startIndices[link]!;
    words[link * 2 + 1] = topology.endIndices[link]!;
  }
  return words;
}

function packedTopologyData(
  topology: OctahedralLinkTopology3D,
  incomingOffsets: Uint32Array,
  incomingRefs: Uint32Array,
): Uint32Array {
  const topologyPart = topologyWords(topology);
  const packed = new Uint32Array(
    topologyPart.length + incomingOffsets.length + incomingRefs.length,
  );
  packed.set(topologyPart, 0);
  packed.set(incomingOffsets, topologyPart.length);
  packed.set(incomingRefs, topologyPart.length + incomingOffsets.length);
  return packed;
}

function globalsData(
  topology: OctahedralLinkTopology3D,
  template: RigidSectionTemplate3D,
  stiffness: number,
  simulationSpeed: number,
): ArrayBuffer {
  const buffer = new ArrayBuffer(80);
  const u32 = new Uint32Array(buffer);
  const f32 = new Float32Array(buffer);
  const bodyCount = topology.linkCount * template.sectionCount;

  u32[0] = topology.linkCount;
  u32[1] = template.sectionCount;
  u32[2] = template.centerSection;
  u32[3] = bodyCount;
  u32[4] = template.octahedronCount;
  u32[5] = template.pairCount;
  u32[6] = topology.linkCount * 2;
  u32[7] = u32[6]! + topology.linkCount + 1;

  const dt = RIGID_SECTION_BASE_TIME_STEP * simulationSpeed;
  f32[8] = stiffness;
  f32[9] = dt;
  f32[10] = Math.exp(-RIGID_SECTION_LINEAR_DAMPING_RATE * dt);
  f32[11] = Math.exp(-RIGID_SECTION_ANGULAR_DAMPING_RATE * dt);
  f32[12] = template.moduleHeight;
  f32[13] = template.localTriangleVertices[0]!;
  f32[14] = template.inverseSectionMass;
  f32[15] = 0;
  f32[16] = template.inverseLocalInertia[0];
  f32[17] = template.inverseLocalInertia[1];
  f32[18] = template.inverseLocalInertia[2];
  f32[19] = 0;
  return buffer;
}

async function assertShaderCompilation(
  module: WebGpuShaderModuleLike,
  label: string,
): Promise<void> {
  if (typeof module.getCompilationInfo !== "function") return;
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === "error");
  if (errors.length === 0) return;
  const details = errors.map((message) => {
    const location = message.lineNum === undefined
      ? ""
      : message.linePos === undefined
        ? ` line ${message.lineNum}`
        : ` line ${message.lineNum}:${message.linePos}`;
    return `- ${label}${location}: ${message.message}`;
  });
  throw new Error(`${label} WGSL compilation failed:\n${details.join("\n")}`);
}

function maxWorkgroups(device: WebGpuDeviceLike): number {
  const value = device.limits?.maxComputeWorkgroupsPerDimension;
  if (value === undefined) return DEFAULT_MAX_WORKGROUPS_PER_DIMENSION;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`invalid maxComputeWorkgroupsPerDimension: ${value}`);
  }
  return Math.min(value, DEFAULT_MAX_WORKGROUPS_PER_DIMENSION);
}

function encodeDispatch(
  encoder: WebGpuCommandEncoderLike,
  pipeline: WebGpuComputePipelineLike,
  bindGroup: object,
  invocationCount: number,
  maximum: number,
): boolean {
  if (invocationCount <= 0) return false;
  const dispatch = computeOctahedralWebGpuDispatch2D(invocationCount, maximum);
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(dispatch.workgroupsX, dispatch.workgroupsY, 1);
  pass.end();
  return true;
}

async function readBackBuffer(
  device: WebGpuDeviceLike,
  source: WebGpuBufferLike,
  logicalBytes: number,
): Promise<Float32Array> {
  if (logicalBytes === 0) return new Float32Array(0);
  const readback = createBuffer(
    device,
    "rigid-section-readback",
    logicalBytes,
    GPU_BUFFER_USAGE.MAP_READ | GPU_BUFFER_USAGE.COPY_DST,
  );
  const encoder = device.createCommandEncoder({ label: "rigid-section-readback-copy" }) as WebGpuCommandEncoderLike;
  encoder.copyBufferToBuffer(source, 0, readback, 0, logicalBytes);
  device.queue.submit([encoder.finish()]);

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

class RigidSectionWebGpuController implements RigidSectionWebGpuCompute3D {
  readonly topology: OctahedralLinkTopology3D;
  readonly template: RigidSectionTemplate3D;
  readonly centerBuffer: WebGpuBufferLike;
  readonly orientationBuffer: WebGpuBufferLike;
  readonly linearVelocityBuffer: WebGpuBufferLike;
  readonly angularVelocityBuffer: WebGpuBufferLike;

  private readonly device: WebGpuDeviceLike;
  private readonly accumulationBuffer: WebGpuBufferLike;
  private readonly topologyDataBuffer: WebGpuBufferLike;
  private readonly globalsBuffer: WebGpuBufferLike;
  private readonly scratchBuffer: WebGpuBufferLike;
  private readonly controlBuffers: readonly WebGpuBufferLike[];
  private readonly bindGroups: readonly object[];
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
    template: RigidSectionTemplate3D;
    centerBuffer: WebGpuBufferLike;
    orientationBuffer: WebGpuBufferLike;
    linearVelocityBuffer: WebGpuBufferLike;
    angularVelocityBuffer: WebGpuBufferLike;
    accumulationBuffer: WebGpuBufferLike;
    topologyDataBuffer: WebGpuBufferLike;
    globalsBuffer: WebGpuBufferLike;
    scratchBuffer: WebGpuBufferLike;
    controlBuffers: readonly WebGpuBufferLike[];
    bindGroups: readonly object[];
    pipelines: Readonly<Record<string, WebGpuComputePipelineLike>>;
    stiffness: number;
    simulationSpeed: number;
  }) {
    this.device = args.device;
    this.topology = args.topology;
    this.template = args.template;
    this.centerBuffer = args.centerBuffer;
    this.orientationBuffer = args.orientationBuffer;
    this.linearVelocityBuffer = args.linearVelocityBuffer;
    this.angularVelocityBuffer = args.angularVelocityBuffer;
    this.accumulationBuffer = args.accumulationBuffer;
    this.topologyDataBuffer = args.topologyDataBuffer;
    this.globalsBuffer = args.globalsBuffer;
    this.scratchBuffer = args.scratchBuffer;
    this.controlBuffers = args.controlBuffers;
    this.bindGroups = args.bindGroups;
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
    if (this.destroyed) throw new Error("rigid-section WebGPU controller is destroyed");
    if (this.deviceLost) {
      throw new Error(`rigid-section WebGPU device lost: ${this.deviceLostReason ?? "unknown"}`);
    }
  }

  private updateGlobals(): void {
    writeWhole(
      this.device,
      this.globalsBuffer,
      globalsData(
        this.topology,
        this.template,
        this.currentStiffness,
        this.currentSimulationSpeed,
      ),
    );
  }

  setStiffness(value: number): void {
    this.assertAlive();
    this.currentStiffness = requireNonNegativeFinite(value, "stiffness");
    this.updateGlobals();
  }

  setSimulationSpeed(value: number): void {
    this.assertAlive();
    this.currentSimulationSpeed = requireNonNegativeFinite(value, "simulationSpeed");
    this.updateGlobals();
  }

  step(): RigidSectionWebGpuStepStats3D {
    this.assertAlive();
    const encoder = this.device.createCommandEncoder({ label: "rigid-section-step" }) as WebGpuCommandEncoderLike;
    const bodyCount = this.topology.linkCount * this.template.sectionCount;
    const relationBatchCount = this.topology.linkCount * this.template.pairCount;
    let computePasses = 0;

    if (encodeDispatch(
      encoder,
      this.pipelines.clear_force_torque_main!,
      this.bindGroups[0]!,
      bodyCount,
      this.maximumWorkgroups,
    )) computePasses += 1;

    if (encodeDispatch(
      encoder,
      this.pipelines.relation_batch_main!,
      this.bindGroups[0]!,
      relationBatchCount,
      this.maximumWorkgroups,
    )) computePasses += 1;

    if (encodeDispatch(
      encoder,
      this.pipelines.relation_batch_main!,
      this.bindGroups[1]!,
      relationBatchCount,
      this.maximumWorkgroups,
    )) computePasses += 1;

    if (encodeDispatch(
      encoder,
      this.pipelines.integrate_main!,
      this.bindGroups[0]!,
      bodyCount,
      this.maximumWorkgroups,
    )) computePasses += 1;

    if (encodeDispatch(
      encoder,
      this.pipelines.hinge_star_main!,
      this.bindGroups[0]!,
      this.topology.linkCount,
      this.maximumWorkgroups,
    )) computePasses += 1;

    if (encodeDispatch(
      encoder,
      this.pipelines.hinge_apply_main!,
      this.bindGroups[0]!,
      this.topology.linkCount,
      this.maximumWorkgroups,
    )) computePasses += 1;

    this.device.queue.submit([encoder.finish()]);
    return Object.freeze({
      relationBatchDispatches: 2 as const,
      hingeDispatches: 2 as const,
      computePasses: computePasses as 6,
      dynamicStateUploadBytes: 0 as const,
    });
  }

  async readBackState(): Promise<RigidSectionWebGpuState3D> {
    this.assertAlive();
    const bodyCount = this.topology.linkCount * this.template.sectionCount;
    const vec4Bytes = bodyCount * 4 * 4;
    const [centers4, orientations, velocities4, angular4] = await Promise.all([
      readBackBuffer(this.device, this.centerBuffer, vec4Bytes),
      readBackBuffer(this.device, this.orientationBuffer, vec4Bytes),
      readBackBuffer(this.device, this.linearVelocityBuffer, vec4Bytes),
      readBackBuffer(this.device, this.angularVelocityBuffer, vec4Bytes),
    ]);
    return Object.freeze({
      centers: unpackVec4ToVec3(centers4),
      orientations,
      linearVelocities: unpackVec4ToVec3(velocities4),
      angularVelocities: unpackVec4ToVec3(angular4),
    });
  }

  snapshot(): RigidSectionWebGpuSnapshot3D {
    const bodyCount = this.topology.linkCount * this.template.sectionCount;
    const vec4Bytes = bodyCount * 4 * 4;
    return Object.freeze({
      status: this.destroyed ? "destroyed" : this.deviceLost ? "device-lost" : "available",
      deviceLostReason: this.deviceLostReason,
      linkCount: this.topology.linkCount,
      sectionCount: this.template.sectionCount,
      bodyCount,
      centerBytes: vec4Bytes,
      orientationBytes: vec4Bytes,
      velocityBytes: vec4Bytes,
      angularVelocityBytes: vec4Bytes,
      forceBytes: vec4Bytes,
      torqueBytes: vec4Bytes,
      stiffness: this.currentStiffness,
      simulationSpeed: this.currentSimulationSpeed,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const buffer of [
      this.centerBuffer,
      this.orientationBuffer,
      this.linearVelocityBuffer,
      this.angularVelocityBuffer,
      this.accumulationBuffer,
      this.topologyDataBuffer,
      this.globalsBuffer,
      this.scratchBuffer,
      ...this.controlBuffers,
    ]) buffer.destroy();
  }
}

function controlData(value: number): Uint32Array {
  return new Uint32Array([value, 0, 0, 0]);
}

function buildEntries(args: {
  centerBuffer: WebGpuBufferLike;
  orientationBuffer: WebGpuBufferLike;
  linearVelocityBuffer: WebGpuBufferLike;
  angularVelocityBuffer: WebGpuBufferLike;
  accumulationBuffer: WebGpuBufferLike;
  topologyDataBuffer: WebGpuBufferLike;
  scratchBuffer: WebGpuBufferLike;
  globalsBuffer: WebGpuBufferLike;
  controlBuffer: WebGpuBufferLike;
}): readonly object[] {
  return [
    { binding: 0, resource: { buffer: args.centerBuffer } },
    { binding: 1, resource: { buffer: args.orientationBuffer } },
    { binding: 2, resource: { buffer: args.linearVelocityBuffer } },
    { binding: 3, resource: { buffer: args.angularVelocityBuffer } },
    { binding: 4, resource: { buffer: args.accumulationBuffer } },
    { binding: 5, resource: { buffer: args.topologyDataBuffer } },
    { binding: 6, resource: { buffer: args.scratchBuffer } },
    { binding: 7, resource: { buffer: args.globalsBuffer } },
    { binding: 8, resource: { buffer: args.controlBuffer } },
  ];
}

export async function createRigidSectionWebGpuCompute3D(
  device: WebGpuDeviceLike,
  network: VisualLinkNetwork,
  options: RigidSectionWebGpuComputeOptions3D,
): Promise<RigidSectionWebGpuCompute3D> {
  const stiffness = requireNonNegativeFinite(options.stiffness, "stiffness");
  const simulationSpeed = requireNonNegativeFinite(options.simulationSpeed, "simulationSpeed");
  const topology = buildOctahedralLinkTopology3D(network);
  const template = getRigidSectionTemplate3D(options.aspectRatio);
  const cpuSeed = createRigidSectionPhysics3D(network, {
    aspectRatio: options.aspectRatio,
    stiffness,
    simulationSpeed,
  });
  const reverse = buildRigidSectionReverseIncidence3D(topology);
  const bodyCount = topology.linkCount * template.sectionCount;
  const vec4Bytes = bodyCount * 4 * 4;
  const maxStorageBuffers = device.limits?.maxStorageBuffersPerShaderStage;
  if (
    maxStorageBuffers !== undefined
    && maxStorageBuffers < REQUIRED_STORAGE_BUFFERS_PER_STAGE
  ) {
    throw new Error(
      `rigid-section WebGPU requires ${REQUIRED_STORAGE_BUFFERS_PER_STAGE} storage buffers per shader stage; adapter exposes ${maxStorageBuffers}`,
    );
  }

  const centerBuffer = createBuffer(device, "rigid-section-centers", vec4Bytes,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC | GPU_BUFFER_USAGE.COPY_DST);
  const orientationBuffer = createBuffer(device, "rigid-section-orientations", vec4Bytes,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC | GPU_BUFFER_USAGE.COPY_DST);
  const linearVelocityBuffer = createBuffer(device, "rigid-section-linear-velocities", vec4Bytes,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC | GPU_BUFFER_USAGE.COPY_DST);
  const angularVelocityBuffer = createBuffer(device, "rigid-section-angular-velocities", vec4Bytes,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC | GPU_BUFFER_USAGE.COPY_DST);
  const accumulationBuffer = createBuffer(
    device,
    "rigid-section-accumulation",
    vec4Bytes * 2,
    GPU_BUFFER_USAGE.STORAGE,
  );
  const scratchBuffer = createBuffer(
    device,
    "rigid-section-scratch",
    vec4Bytes * 2,
    GPU_BUFFER_USAGE.STORAGE,
  );
  const topologyData = packedTopologyData(
    topology,
    reverse.incomingOffsets,
    reverse.incomingRefs,
  );
  const topologyDataBuffer = createBuffer(
    device,
    "rigid-section-topology-data",
    topologyData.byteLength,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
  );
  const globalsBuffer = createBuffer(device, "rigid-section-globals", 80,
    GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST);

  writeWhole(device, centerBuffer, packVec3ToVec4(cpuSeed.centers));
  writeWhole(device, orientationBuffer, cpuSeed.orientations);
  writeWhole(device, linearVelocityBuffer, packVec3ToVec4(cpuSeed.linearVelocities));
  writeWhole(device, angularVelocityBuffer, packVec3ToVec4(cpuSeed.angularVelocities));
  writeWhole(device, topologyDataBuffer, topologyData);
  writeWhole(device, globalsBuffer, globalsData(topology, template, stiffness, simulationSpeed));

  const controlValues = [0, 1] as const;
  const controlBuffers = controlValues.map((value, index) => {
    const buffer = createBuffer(
      device,
      `rigid-section-control-${index}`,
      16,
      GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    );
    writeWhole(device, buffer, controlData(value));
    return buffer;
  });

  const shader = device.createShaderModule({
    label: "rigid-section-webgpu-compute",
    code: RIGID_SECTION_WEBGPU_WGSL,
  }) as WebGpuShaderModuleLike;
  await assertShaderCompilation(shader, "rigid-section-webgpu-compute");

  const layout = device.createBindGroupLayout({
    label: "rigid-section-layout",
    entries: [
      { binding: 0, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
      { binding: 1, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
      { binding: 4, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
      { binding: 5, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 6, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
      { binding: 7, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "uniform" } },
      { binding: 8, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "uniform" } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: "rigid-section-pipeline-layout",
    bindGroupLayouts: [layout],
  });

  const entries = [
    "clear_force_torque_main",
    "relation_batch_main",
    "integrate_main",
    "hinge_star_main",
    "hinge_apply_main",
  ] as const;
  const pipelinePairs = await Promise.all(entries.map(async (entryPoint) => {
    const pipeline = await device.createComputePipelineAsync({
      label: `rigid-section-${entryPoint}`,
      layout: pipelineLayout,
      compute: { module: shader as object, entryPoint },
    });
    return [entryPoint, pipeline] as const;
  }));
  const pipelines = Object.freeze(Object.fromEntries(pipelinePairs)) as Readonly<Record<string, WebGpuComputePipelineLike>>;

  const common = {
    centerBuffer,
    orientationBuffer,
    linearVelocityBuffer,
    angularVelocityBuffer,
    accumulationBuffer,
    topologyDataBuffer,
    scratchBuffer,
    globalsBuffer,
  };
  const bindGroups = controlBuffers.map((controlBuffer, index) => device.createBindGroup({
    label: `rigid-section-bind-${index}`,
    layout,
    entries: buildEntries({ ...common, controlBuffer }),
  }));

  return new RigidSectionWebGpuController({
    device,
    topology,
    template,
    ...common,
    controlBuffers,
    bindGroups,
    pipelines,
    stiffness,
    simulationSpeed,
  });
}

function maxDelta(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) {
    throw new Error(`rigid-section differential length mismatch: ${left.length} != ${right.length}`);
  }
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(left[index]! - right[index]!));
  }
  return maximum;
}

export async function runRigidSectionWebGpuDifferential3D(
  device: WebGpuDeviceLike,
  network: VisualLinkNetwork,
  options: RigidSectionWebGpuComputeOptions3D,
  steps = 4,
  tolerance = 0.003,
): Promise<RigidSectionWebGpuDifferentialResult3D> {
  if (!Number.isSafeInteger(steps) || steps < 0) {
    throw new Error(`invalid rigid-section differential steps: ${steps}`);
  }
  const cpu = createRigidSectionPhysics3D(network, options);
  const gpu = await createRigidSectionWebGpuCompute3D(device, network, options);
  try {
    for (let step = 0; step < steps; step += 1) {
      cpu.step();
      gpu.step();
    }
    const state = await gpu.readBackState();
    const maxCenterDelta = maxDelta(cpu.centers, state.centers);
    const maxOrientationDelta = maxDelta(cpu.orientations, state.orientations);
    const maxLinearVelocityDelta = maxDelta(cpu.linearVelocities, state.linearVelocities);
    const maxAngularVelocityDelta = maxDelta(cpu.angularVelocities, state.angularVelocities);
    return Object.freeze({
      passed:
        maxCenterDelta <= tolerance
        && maxOrientationDelta <= tolerance
        && maxLinearVelocityDelta <= tolerance
        && maxAngularVelocityDelta <= tolerance,
      steps,
      tolerance,
      maxCenterDelta,
      maxOrientationDelta,
      maxLinearVelocityDelta,
      maxAngularVelocityDelta,
    });
  } finally {
    gpu.destroy();
  }
}
