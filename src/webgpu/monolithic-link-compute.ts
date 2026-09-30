import type { VisualLinkNetwork } from "../index.js";
import {
  MONOLITHIC_LINK_BASE_TIME_STEP,
  createMonolithicLinkSemanticCenterSeed3D,
  getMonolithicLinkSpringTemplate3D,
  type MonolithicLinkSpringOptions3D,
} from "../monolithic-link-spring3d.js";
import {
  buildOctahedralLinkTopology3D,
  type OctahedralLinkTopology3D,
} from "../octahedral-link3d.js";
import {
  computeOctahedralWebGpuDispatch2D,
  type WebGpuBufferLike,
  type WebGpuDeviceLike,
} from "./octahedral-compute.js";

const DEFAULT_MAX_WORKGROUPS_PER_DIMENSION = 65_535;
const REQUIRED_STORAGE_BUFFERS_PER_STAGE = 4;

const GPU_BUFFER_USAGE = Object.freeze({
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
});
const GPU_MAP_MODE_READ = 0x0001;
const GPU_SHADER_STAGE_COMPUTE = 0x0004;

export type MonolithicLinkWebGpuVec3 = readonly [number, number, number];

export interface MonolithicLinkWebGpuState3D {
  readonly centers: Float32Array;
  readonly velocities: Float32Array;
}

export interface MonolithicLinkWebGpuTopology3D {
  readonly linkCount: number;
  readonly startIndices: Uint32Array;
  readonly endIndices: Uint32Array;
}

export interface MonolithicLinkWebGpuInitialState3D {
  readonly centers: Float32Array;
  readonly velocities?: Float32Array;
}

export interface MonolithicLinkWebGpuStepStats3D {
  readonly linkForceDispatches: number;
  readonly gatherIntegrateDispatches: number;
  readonly computePasses: number;
  readonly dynamicStateUploadBytes: 0;
}

export interface MonolithicLinkWebGpuSnapshot3D {
  readonly status: "available" | "device-lost" | "destroyed";
  readonly deviceLostReason: string | null;
  readonly linkCount: number;
  readonly centerBytes: number;
  readonly velocityBytes: number;
  readonly linkForceBytes: number;
  readonly topologyBytes: number;
  readonly stretchStiffness: number;
  readonly straighteningStiffness: number;
  readonly nonlinearity: number;
  readonly centerMass: number;
  readonly dampingRate: number;
  readonly simulationSpeed: number;
  readonly restLength: number;
}

export interface MonolithicLinkWebGpuCenterOverride3D {
  readonly linkIndex: number;
  readonly position: MonolithicLinkWebGpuVec3;
  readonly velocity?: MonolithicLinkWebGpuVec3;
}

export interface MonolithicLinkWebGpuOverrideStats3D {
  readonly linkCount: number;
  readonly bufferWrites: number;
  readonly centerBytes: number;
  readonly velocityBytes: number;
}

export interface MonolithicLinkWebGpuCompute3D {
  readonly topology: MonolithicLinkWebGpuTopology3D;
  readonly centerBuffer: WebGpuBufferLike;
  readonly velocityBuffer: WebGpuBufferLike;
  readonly linkForceBuffer: WebGpuBufferLike;
  readonly restLength: number;
  readonly stretchStiffness: number;
  readonly straighteningStiffness: number;
  readonly nonlinearity: number;
  readonly centerMass: number;
  readonly dampingRate: number;
  readonly simulationSpeed: number;
  setStretchStiffness(value: number): void;
  setStraighteningStiffness(value: number): void;
  setNonlinearity(value: number): void;
  setCenterMass(value: number): void;
  setDampingRate(value: number): void;
  setSimulationSpeed(value: number): void;
  step(): MonolithicLinkWebGpuStepStats3D;
  writeCenterOverrides(
    overrides: readonly MonolithicLinkWebGpuCenterOverride3D[],
  ): MonolithicLinkWebGpuOverrideStats3D;
  readBackState(): Promise<MonolithicLinkWebGpuState3D>;
  snapshot(): MonolithicLinkWebGpuSnapshot3D;
  destroy(): void;
}

export interface MonolithicLinkWebGpuDifferentialResult3D {
  readonly passed: boolean;
  readonly steps: number;
  readonly tolerance: number;
  readonly maxCenterDelta: number;
  readonly maxVelocityDelta: number;
}

interface ResolvedPhysics {
  readonly stretchStiffness: number;
  readonly straighteningStiffness: number;
  readonly nonlinearity: number;
  readonly centerMass: number;
  readonly dampingRate: number;
  readonly simulationSpeed: number;
}

interface ReverseIncidence {
  readonly incomingOffsets: Uint32Array;
  readonly incomingRefs: Uint32Array;
}

export const MONOLITHIC_LINK_WEBGPU_WGSL = /* wgsl */ `
struct Globals {
  counts: vec4<u32>,
  physics: vec4<f32>,
  geometry: vec4<f32>,
};

@group(0) @binding(0) var<storage, read_write> centers: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> link_forces: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> topology_data: array<u32>;
@group(0) @binding(4) var<uniform> globals: Globals;

fn linear_index(gid: vec3<u32>) -> u32 {
  return gid.x + gid.y * 65535u * 64u;
}

fn half_spring_force(first: vec3<f32>, second: vec3<f32>) -> vec3<f32> {
  let delta = second - first;
  let distance = length(delta);
  if (distance <= 1e-9 || globals.physics.x == 0.0) {
    return vec3<f32>(0.0);
  }
  let extension = distance - globals.geometry.y;
  let normalized_extension_squared =
    extension * extension / (globals.geometry.y * globals.geometry.y);
  let magnitude =
    globals.physics.x
    * extension
    * (1.0 + globals.physics.z * normalized_extension_squared);
  return delta * (magnitude / distance);
}

@compute @workgroup_size(64)
fn link_force_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let link = linear_index(gid);
  if (link >= globals.counts.x) {
    return;
  }

  let start_index = topology_data[link * 2u];
  let end_index = topology_data[link * 2u + 1u];

  let s = centers[start_index].xyz;
  let c = centers[link].xyz;
  let e = centers[end_index].xyz;

  let first_force = half_spring_force(s, c);
  let second_force = half_spring_force(c, e);

  // A whole-Link bend requires two independent arms. Semantic
  // self-incidence aliases START or END with CENTER, so that arm has no
  // direction and must not turn the straightening term into axial compression.
  let has_three_point_bend =
    start_index != link && end_index != link;
  var straight_gradient = vec3<f32>(0.0);
  if (has_three_point_bend) {
    let q = s - 2.0 * c + e;
    let q2 = dot(q, q);
    let straight_scale =
      globals.physics.y
      * (1.0 + globals.physics.z * q2 / (globals.geometry.x * globals.geometry.x));
    straight_gradient = q * straight_scale;
  }

  let fs = first_force - straight_gradient;
  let fc = -first_force + second_force + 2.0 * straight_gradient;
  let fe = -second_force - straight_gradient;

  let base = link * 3u;
  link_forces[base] = vec4<f32>(fs, 0.0);
  link_forces[base + 1u] = vec4<f32>(fc, 0.0);
  link_forces[base + 2u] = vec4<f32>(fe, 0.0);
}

@compute @workgroup_size(64)
fn gather_integrate_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let link = linear_index(gid);
  if (link >= globals.counts.x) {
    return;
  }

  var force = link_forces[link * 3u + 1u].xyz;

  let begin = topology_data[globals.counts.y + link];
  let finish = topology_data[globals.counts.y + link + 1u];
  for (var cursor = begin; cursor < finish; cursor = cursor + 1u) {
    let encoded = topology_data[globals.counts.z + cursor];
    let source_link = encoded / 2u;
    let role = encoded & 1u;
    let contribution_slot = select(
      source_link * 3u,
      source_link * 3u + 2u,
      role == 1u,
    );
    force = force + link_forces[contribution_slot].xyz;
  }

  let dt = globals.physics.w;
  if (dt == 0.0) {
    return;
  }

  var velocity = velocities[link].xyz;
  velocity =
    (velocity + force * globals.geometry.z * dt)
    * globals.geometry.w;
  let next_center = centers[link].xyz + velocity * dt;

  velocities[link] = vec4<f32>(velocity, 0.0);
  centers[link] = vec4<f32>(next_center, 0.0);
}
`;

function requireNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid monolithic WebGPU ${label}: ${String(value)}`);
  }
  return value;
}

function requirePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid monolithic WebGPU ${label}: ${String(value)}`);
  }
  return value;
}

function resolvePhysics(options: MonolithicLinkSpringOptions3D): ResolvedPhysics {
  return Object.freeze({
    stretchStiffness: requireNonNegative(
      options.stretchStiffness,
      "stretchStiffness",
    ),
    straighteningStiffness: requireNonNegative(
      options.straighteningStiffness,
      "straighteningStiffness",
    ),
    nonlinearity: requireNonNegative(options.nonlinearity ?? 0, "nonlinearity"),
    centerMass: requirePositive(options.centerMass ?? 1, "centerMass"),
    dampingRate: requireNonNegative(options.dampingRate ?? 1.5, "dampingRate"),
    simulationSpeed: requireNonNegative(
      options.simulationSpeed ?? 1,
      "simulationSpeed",
    ),
  });
}

function buildReverseIncidence(
  topology: MonolithicLinkWebGpuTopology3D,
): ReverseIncidence {
  const counts = new Uint32Array(topology.linkCount);
  for (let source = 0; source < topology.linkCount; source += 1) {
    const startTarget = topology.startIndices[source]!;
    const endTarget = topology.endIndices[source]!;
    counts[startTarget] = counts[startTarget]! + 1;
    counts[endTarget] = counts[endTarget]! + 1;
  }

  const incomingOffsets = new Uint32Array(topology.linkCount + 1);
  for (let target = 0; target < topology.linkCount; target += 1) {
    incomingOffsets[target + 1] =
      incomingOffsets[target]! + counts[target]!;
  }

  const incomingRefs = new Uint32Array(topology.linkCount * 2);
  const cursors = incomingOffsets.slice(0, topology.linkCount);
  for (let source = 0; source < topology.linkCount; source += 1) {
    const startTarget = topology.startIndices[source]!;
    const startCursor = cursors[startTarget]!;
    incomingRefs[startCursor] = source * 2;
    cursors[startTarget] = startCursor + 1;

    const endTarget = topology.endIndices[source]!;
    const endCursor = cursors[endTarget]!;
    incomingRefs[endCursor] = source * 2 + 1;
    cursors[endTarget] = endCursor + 1;
  }

  return Object.freeze({ incomingOffsets, incomingRefs });
}

function packedTopologyData(
  topology: MonolithicLinkWebGpuTopology3D,
  reverse: ReverseIncidence,
): Uint32Array {
  const topologyWords = topology.linkCount * 2;
  const result = new Uint32Array(
    topologyWords
    + reverse.incomingOffsets.length
    + reverse.incomingRefs.length,
  );
  for (let link = 0; link < topology.linkCount; link += 1) {
    result[link * 2] = topology.startIndices[link]!;
    result[link * 2 + 1] = topology.endIndices[link]!;
  }
  result.set(reverse.incomingOffsets, topologyWords);
  result.set(
    reverse.incomingRefs,
    topologyWords + reverse.incomingOffsets.length,
  );
  return result;
}

function globalsData(
  topology: MonolithicLinkWebGpuTopology3D,
  restLength: number,
  physics: ResolvedPhysics,
): ArrayBuffer {
  const buffer = new ArrayBuffer(48);
  const u32 = new Uint32Array(buffer);
  const f32 = new Float32Array(buffer);

  const topologyWords = topology.linkCount * 2;
  u32[0] = topology.linkCount;
  u32[1] = topologyWords;
  u32[2] = topologyWords + topology.linkCount + 1;
  u32[3] = 0;

  const dt = MONOLITHIC_LINK_BASE_TIME_STEP * physics.simulationSpeed;
  f32[4] = physics.stretchStiffness;
  f32[5] = physics.straighteningStiffness;
  f32[6] = physics.nonlinearity;
  f32[7] = dt;
  f32[8] = restLength;
  f32[9] = restLength / 2;
  f32[10] = 1 / physics.centerMass;
  f32[11] = Math.exp(-physics.dampingRate * dt);
  return buffer;
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

function maximumWorkgroups(device: WebGpuDeviceLike): number {
  const value = device.limits?.maxComputeWorkgroupsPerDimension;
  if (value === undefined) return DEFAULT_MAX_WORKGROUPS_PER_DIMENSION;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `invalid monolithic WebGPU maxComputeWorkgroupsPerDimension: ${String(value)}`,
    );
  }
  return Math.min(value, DEFAULT_MAX_WORKGROUPS_PER_DIMENSION);
}

function encodeDispatch(
  encoder: ReturnType<WebGpuDeviceLike["createCommandEncoder"]>,
  pipeline: Awaited<ReturnType<WebGpuDeviceLike["createComputePipelineAsync"]>>,
  bindGroup: object,
  invocationCount: number,
  maximum: number,
): boolean {
  if (invocationCount <= 0) return false;
  const dispatch = computeOctahedralWebGpuDispatch2D(
    invocationCount,
    maximum,
  );
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(
    dispatch.workgroupsX,
    dispatch.workgroupsY,
    1,
  );
  pass.end();
  return true;
}

async function assertShaderCompilation(
  shader: ReturnType<WebGpuDeviceLike["createShaderModule"]>,
): Promise<void> {
  if (typeof shader.getCompilationInfo !== "function") return;
  const info = await shader.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === "error");
  if (errors.length === 0) return;
  throw new Error(
    "monolithic-link WebGPU WGSL compilation failed:\n"
      + errors.map((message) =>
        `- ${message.lineNum ?? "?"}:${message.linePos ?? "?"} ${message.message}`
      ).join("\n"),
  );
}

async function readBackBuffer(
  device: WebGpuDeviceLike,
  source: WebGpuBufferLike,
  logicalBytes: number,
): Promise<Float32Array> {
  if (logicalBytes === 0) return new Float32Array(0);
  const readback = createBuffer(
    device,
    "monolithic-link-readback",
    logicalBytes,
    GPU_BUFFER_USAGE.MAP_READ | GPU_BUFFER_USAGE.COPY_DST,
  );
  const encoder = device.createCommandEncoder({
    label: "monolithic-link-readback-copy",
  });
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

class MonolithicLinkWebGpuController
implements MonolithicLinkWebGpuCompute3D {
  readonly topology: MonolithicLinkWebGpuTopology3D;
  readonly centerBuffer: WebGpuBufferLike;
  readonly velocityBuffer: WebGpuBufferLike;
  readonly linkForceBuffer: WebGpuBufferLike;
  readonly restLength: number;

  private readonly device: WebGpuDeviceLike;
  private readonly topologyBuffer: WebGpuBufferLike;
  private readonly globalsBuffer: WebGpuBufferLike;
  private readonly bindGroup: object;
  private readonly linkForcePipeline:
    Awaited<ReturnType<WebGpuDeviceLike["createComputePipelineAsync"]>>;
  private readonly gatherIntegratePipeline:
    Awaited<ReturnType<WebGpuDeviceLike["createComputePipelineAsync"]>>;
  private readonly maxWorkgroups: number;

  private currentStretchStiffness: number;
  private currentStraighteningStiffness: number;
  private currentNonlinearity: number;
  private currentCenterMass: number;
  private currentDampingRate: number;
  private currentSimulationSpeed: number;
  private destroyed = false;
  private deviceLost = false;
  private deviceLostReason: string | null = null;

  constructor(args: {
    device: WebGpuDeviceLike;
    topology: MonolithicLinkWebGpuTopology3D;
    centerBuffer: WebGpuBufferLike;
    velocityBuffer: WebGpuBufferLike;
    linkForceBuffer: WebGpuBufferLike;
    topologyBuffer: WebGpuBufferLike;
    globalsBuffer: WebGpuBufferLike;
    bindGroup: object;
    linkForcePipeline:
      Awaited<ReturnType<WebGpuDeviceLike["createComputePipelineAsync"]>>;
    gatherIntegratePipeline:
      Awaited<ReturnType<WebGpuDeviceLike["createComputePipelineAsync"]>>;
    restLength: number;
    physics: ResolvedPhysics;
  }) {
    this.device = args.device;
    this.topology = args.topology;
    this.centerBuffer = args.centerBuffer;
    this.velocityBuffer = args.velocityBuffer;
    this.linkForceBuffer = args.linkForceBuffer;
    this.topologyBuffer = args.topologyBuffer;
    this.globalsBuffer = args.globalsBuffer;
    this.bindGroup = args.bindGroup;
    this.linkForcePipeline = args.linkForcePipeline;
    this.gatherIntegratePipeline = args.gatherIntegratePipeline;
    this.restLength = args.restLength;
    this.currentStretchStiffness = args.physics.stretchStiffness;
    this.currentStraighteningStiffness = args.physics.straighteningStiffness;
    this.currentNonlinearity = args.physics.nonlinearity;
    this.currentCenterMass = args.physics.centerMass;
    this.currentDampingRate = args.physics.dampingRate;
    this.currentSimulationSpeed = args.physics.simulationSpeed;
    this.maxWorkgroups = maximumWorkgroups(args.device);

    void args.device.lost?.then((info) => {
      if (this.destroyed) return;
      this.deviceLost = true;
      this.deviceLostReason =
        info.message ?? info.reason ?? "WebGPU device lost";
    }).catch((error: unknown) => {
      if (this.destroyed) return;
      this.deviceLost = true;
      this.deviceLostReason =
        error instanceof Error ? error.message : String(error);
    });
  }

  get stretchStiffness(): number {
    return this.currentStretchStiffness;
  }

  get straighteningStiffness(): number {
    return this.currentStraighteningStiffness;
  }

  get nonlinearity(): number {
    return this.currentNonlinearity;
  }

  get centerMass(): number {
    return this.currentCenterMass;
  }

  get dampingRate(): number {
    return this.currentDampingRate;
  }

  get simulationSpeed(): number {
    return this.currentSimulationSpeed;
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("monolithic Link WebGPU controller is destroyed");
    }
    if (this.deviceLost) {
      throw new Error(
        `monolithic Link WebGPU device lost: ${this.deviceLostReason ?? "unknown"}`,
      );
    }
  }

  private resolvedPhysics(): ResolvedPhysics {
    return Object.freeze({
      stretchStiffness: this.currentStretchStiffness,
      straighteningStiffness: this.currentStraighteningStiffness,
      nonlinearity: this.currentNonlinearity,
      centerMass: this.currentCenterMass,
      dampingRate: this.currentDampingRate,
      simulationSpeed: this.currentSimulationSpeed,
    });
  }

  private updateGlobals(): void {
    writeWhole(
      this.device,
      this.globalsBuffer,
      globalsData(this.topology, this.restLength, this.resolvedPhysics()),
    );
  }

  setStretchStiffness(value: number): void {
    this.assertAlive();
    this.currentStretchStiffness =
      requireNonNegative(value, "stretchStiffness");
    this.updateGlobals();
  }

  setStraighteningStiffness(value: number): void {
    this.assertAlive();
    this.currentStraighteningStiffness =
      requireNonNegative(value, "straighteningStiffness");
    this.updateGlobals();
  }

  setNonlinearity(value: number): void {
    this.assertAlive();
    this.currentNonlinearity = requireNonNegative(value, "nonlinearity");
    this.updateGlobals();
  }

  setCenterMass(value: number): void {
    this.assertAlive();
    this.currentCenterMass = requirePositive(value, "centerMass");
    this.updateGlobals();
  }

  setDampingRate(value: number): void {
    this.assertAlive();
    this.currentDampingRate = requireNonNegative(value, "dampingRate");
    this.updateGlobals();
  }

  setSimulationSpeed(value: number): void {
    this.assertAlive();
    this.currentSimulationSpeed =
      requireNonNegative(value, "simulationSpeed");
    this.updateGlobals();
  }

  step(): MonolithicLinkWebGpuStepStats3D {
    this.assertAlive();
    const encoder = this.device.createCommandEncoder({
      label: "monolithic-link-step",
    });
    let linkForceDispatches = 0;
    let gatherIntegrateDispatches = 0;

    if (encodeDispatch(
      encoder,
      this.linkForcePipeline,
      this.bindGroup,
      this.topology.linkCount,
      this.maxWorkgroups,
    )) linkForceDispatches = 1;

    if (encodeDispatch(
      encoder,
      this.gatherIntegratePipeline,
      this.bindGroup,
      this.topology.linkCount,
      this.maxWorkgroups,
    )) gatherIntegrateDispatches = 1;

    this.device.queue.submit([encoder.finish()]);
    return Object.freeze({
      linkForceDispatches,
      gatherIntegrateDispatches,
      computePasses: linkForceDispatches + gatherIntegrateDispatches,
      dynamicStateUploadBytes: 0 as const,
    });
  }

  writeCenterOverrides(
    overrides: readonly MonolithicLinkWebGpuCenterOverride3D[],
  ): MonolithicLinkWebGpuOverrideStats3D {
    this.assertAlive();
    if (overrides.length === 0) {
      return Object.freeze({
        linkCount: 0,
        bufferWrites: 0,
        centerBytes: 0,
        velocityBytes: 0,
      });
    }

    const ordered = [...overrides].sort(
      (left, right) => left.linkIndex - right.linkIndex,
    );
    const seen = new Set<number>();
    let bufferWrites = 0;
    let centerBytes = 0;
    let velocityBytes = 0;

    for (const override of ordered) {
      if (
        !Number.isSafeInteger(override.linkIndex)
        || override.linkIndex < 0
        || override.linkIndex >= this.topology.linkCount
      ) {
        throw new Error(
          `invalid monolithic center override linkIndex: ${String(override.linkIndex)}`,
        );
      }
      if (seen.has(override.linkIndex)) {
        throw new Error(
          `duplicate monolithic center override linkIndex: ${override.linkIndex}`,
        );
      }
      seen.add(override.linkIndex);
      if (
        override.position.length !== 3
        || !override.position.every(Number.isFinite)
        || (
          override.velocity !== undefined
          && (
            override.velocity.length !== 3
            || !override.velocity.every(Number.isFinite)
          )
        )
      ) {
        throw new Error(
          "monolithic center override position/velocity must be finite vec3",
        );
      }

      const center = new Float32Array([
        override.position[0],
        override.position[1],
        override.position[2],
        0,
      ]);
      const velocityValue = override.velocity ?? [0, 0, 0];
      const velocity = new Float32Array([
        velocityValue[0],
        velocityValue[1],
        velocityValue[2],
        0,
      ]);
      const byteOffset = override.linkIndex * 16;
      this.device.queue.writeBuffer(
        this.centerBuffer,
        byteOffset,
        center,
      );
      this.device.queue.writeBuffer(
        this.velocityBuffer,
        byteOffset,
        velocity,
      );
      bufferWrites += 2;
      centerBytes += center.byteLength;
      velocityBytes += velocity.byteLength;
    }

    return Object.freeze({
      linkCount: ordered.length,
      bufferWrites,
      centerBytes,
      velocityBytes,
    });
  }

  async readBackState(): Promise<MonolithicLinkWebGpuState3D> {
    this.assertAlive();
    const bytes = this.topology.linkCount * 16;
    const [centers4, velocities4] = await Promise.all([
      readBackBuffer(this.device, this.centerBuffer, bytes),
      readBackBuffer(this.device, this.velocityBuffer, bytes),
    ]);
    return Object.freeze({
      centers: unpackVec4ToVec3(centers4),
      velocities: unpackVec4ToVec3(velocities4),
    });
  }

  snapshot(): MonolithicLinkWebGpuSnapshot3D {
    const vectorBytes = this.topology.linkCount * 16;
    return Object.freeze({
      status:
        this.destroyed
          ? "destroyed"
          : this.deviceLost
            ? "device-lost"
            : "available",
      deviceLostReason: this.deviceLostReason,
      linkCount: this.topology.linkCount,
      centerBytes: vectorBytes,
      velocityBytes: vectorBytes,
      linkForceBytes: this.topology.linkCount * 3 * 16,
      topologyBytes: this.topologyBuffer.size,
      stretchStiffness: this.currentStretchStiffness,
      straighteningStiffness: this.currentStraighteningStiffness,
      nonlinearity: this.currentNonlinearity,
      centerMass: this.currentCenterMass,
      dampingRate: this.currentDampingRate,
      simulationSpeed: this.currentSimulationSpeed,
      restLength: this.restLength,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const buffer of [
      this.centerBuffer,
      this.velocityBuffer,
      this.linkForceBuffer,
      this.topologyBuffer,
      this.globalsBuffer,
    ]) buffer.destroy();
  }
}

export async function createMonolithicLinkWebGpuCompute3D(
  device: WebGpuDeviceLike,
  network: VisualLinkNetwork,
  options: MonolithicLinkSpringOptions3D,
): Promise<MonolithicLinkWebGpuCompute3D> {
  const physics = resolvePhysics(options);
  const topology = buildOctahedralLinkTopology3D(network);
  const cpuSeed = createMonolithicLinkSpringPhysics3D(network, options);
  const restLength = cpuSeed.template.restLength;
  const reverse = buildReverseIncidence(topology);
  const topologyData = packedTopologyData(topology, reverse);

  const storageLimit = device.limits?.maxStorageBuffersPerShaderStage;
  if (
    storageLimit !== undefined
    && storageLimit < REQUIRED_STORAGE_BUFFERS_PER_STAGE
  ) {
    throw new Error(
      `monolithic Link WebGPU requires ${REQUIRED_STORAGE_BUFFERS_PER_STAGE} storage buffers per shader stage; adapter exposes ${storageLimit}`,
    );
  }

  const vectorBytes = topology.linkCount * 16;
  const centerBuffer = createBuffer(
    device,
    "monolithic-link-centers",
    vectorBytes,
    GPU_BUFFER_USAGE.STORAGE
      | GPU_BUFFER_USAGE.COPY_SRC
      | GPU_BUFFER_USAGE.COPY_DST,
  );
  const velocityBuffer = createBuffer(
    device,
    "monolithic-link-velocities",
    vectorBytes,
    GPU_BUFFER_USAGE.STORAGE
      | GPU_BUFFER_USAGE.COPY_SRC
      | GPU_BUFFER_USAGE.COPY_DST,
  );
  const linkForceBuffer = createBuffer(
    device,
    "monolithic-link-force-contributions",
    topology.linkCount * 3 * 16,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC,
  );
  const topologyBuffer = createBuffer(
    device,
    "monolithic-link-topology",
    topologyData.byteLength,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
  );
  const globalsBuffer = createBuffer(
    device,
    "monolithic-link-globals",
    48,
    GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
  );

  writeWhole(device, centerBuffer, packVec3ToVec4(cpuSeed.centers));
  writeWhole(device, velocityBuffer, packVec3ToVec4(cpuSeed.velocities));
  writeWhole(device, topologyBuffer, topologyData);
  writeWhole(
    device,
    globalsBuffer,
    globalsData(topology, restLength, physics),
  );

  const shader = device.createShaderModule({
    label: "monolithic-link-webgpu-compute",
    code: MONOLITHIC_LINK_WEBGPU_WGSL,
  });
  await assertShaderCompilation(shader);

  const layout = device.createBindGroupLayout({
    label: "monolithic-link-layout",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE_COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 1,
        visibility: GPU_SHADER_STAGE_COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 2,
        visibility: GPU_SHADER_STAGE_COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 3,
        visibility: GPU_SHADER_STAGE_COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 4,
        visibility: GPU_SHADER_STAGE_COMPUTE,
        buffer: { type: "uniform" },
      },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: "monolithic-link-pipeline-layout",
    bindGroupLayouts: [layout],
  });

  const linkForcePipeline = await device.createComputePipelineAsync({
    label: "monolithic-link-link-force",
    layout: pipelineLayout,
    compute: {
      module: shader as object,
      entryPoint: "link_force_main",
    },
  });
  const gatherIntegratePipeline = await device.createComputePipelineAsync({
    label: "monolithic-link-gather-integrate",
    layout: pipelineLayout,
    compute: {
      module: shader as object,
      entryPoint: "gather_integrate_main",
    },
  });

  const bindGroup = device.createBindGroup({
    label: "monolithic-link-bind",
    layout,
    entries: [
      { binding: 0, resource: { buffer: centerBuffer } },
      { binding: 1, resource: { buffer: velocityBuffer } },
      { binding: 2, resource: { buffer: linkForceBuffer } },
      { binding: 3, resource: { buffer: topologyBuffer } },
      { binding: 4, resource: { buffer: globalsBuffer } },
    ],
  });

  return new MonolithicLinkWebGpuController({
    device,
    topology,
    centerBuffer,
    velocityBuffer,
    linkForceBuffer,
    topologyBuffer,
    globalsBuffer,
    bindGroup,
    linkForcePipeline,
    gatherIntegratePipeline,
    restLength,
    physics,
  });
}

function maxDelta(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) {
    throw new Error(
      `monolithic differential length mismatch: ${left.length} != ${right.length}`,
    );
  }
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    maximum = Math.max(
      maximum,
      Math.abs(left[index]! - right[index]!),
    );
  }
  return maximum;
}

export async function runMonolithicLinkWebGpuDifferential3D(
  device: WebGpuDeviceLike,
  network: VisualLinkNetwork,
  options: MonolithicLinkSpringOptions3D,
  steps = 4,
  tolerance = 0.003,
): Promise<MonolithicLinkWebGpuDifferentialResult3D> {
  if (!Number.isSafeInteger(steps) || steps < 0) {
    throw new Error(
      `invalid monolithic differential steps: ${String(steps)}`,
    );
  }
  const cpu = createMonolithicLinkSpringPhysics3D(network, options);
  const gpu = await createMonolithicLinkWebGpuCompute3D(
    device,
    network,
    options,
  );
  try {
    for (let step = 0; step < steps; step += 1) {
      cpu.step();
      gpu.step();
    }
    const state = await gpu.readBackState();
    const maxCenterDelta = maxDelta(cpu.centers, state.centers);
    const maxVelocityDelta = maxDelta(cpu.velocities, state.velocities);
    return Object.freeze({
      passed:
        maxCenterDelta <= tolerance
        && maxVelocityDelta <= tolerance,
      steps,
      tolerance,
      maxCenterDelta,
      maxVelocityDelta,
    });
  } finally {
    gpu.destroy();
  }
}
