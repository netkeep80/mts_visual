import {
  getMonolithicLinkSpringTemplate3D,
  type MonolithicLinkSpringTemplate3D,
} from "../monolithic-link-spring3d.js";
import type {
  MonolithicLinkWebGpuCompute3D,
} from "./monolithic-link-compute.js";
import type {
  WebGpuBufferLike,
  WebGpuDeviceLike,
} from "./octahedral-compute.js";

const WORKGROUP_SIZE = 64;
const DEFAULT_MAX_WORKGROUPS_PER_DIMENSION = 65_535;

const GPU_BUFFER_USAGE = Object.freeze({
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
});
const GPU_SHADER_STAGE_COMPUTE = 0x0004;

export interface MonolithicLinkWebGpuShapeStepStats3D {
  readonly dispatches: number;
  readonly computePasses: number;
  readonly dynamicStateUploadBytes: 0;
}

export interface MonolithicLinkWebGpuShapeSnapshot3D {
  readonly status: "available" | "destroyed";
  readonly linkCount: number;
  readonly octahedronCount: number;
  readonly sectionCount: number;
  readonly parameterBytes: number;
  readonly topologyBytes: number;
  readonly dynamicStateBytes: number;
}

export interface MonolithicLinkWebGpuShape3D {
  readonly compute: MonolithicLinkWebGpuCompute3D;
  readonly template: MonolithicLinkSpringTemplate3D;
  readonly parameterBuffer: WebGpuBufferLike;
  update(): MonolithicLinkWebGpuShapeStepStats3D;
  snapshot(): MonolithicLinkWebGpuShapeSnapshot3D;
  destroy(): void;
}

export const MONOLITHIC_LINK_SHAPE_PARAMETER_WGSL = /* wgsl */ `
struct ShapeGlobals {
  counts: vec4<u32>,
  geometry: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> semantic_centers: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> topology_data: array<u32>;
@group(0) @binding(2) var<storage, read_write> shape_parameters: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> globals: ShapeGlobals;

fn safe_normalize(value: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> {
  let n = length(value);
  if (n <= 1e-9) {
    return fallback;
  }
  return value / n;
}

fn deterministic_axis(link: u32) -> vec3<f32> {
  let angle = f32(link) * 0.7548776662466927;
  return safe_normalize(
    vec3<f32>(
      cos(angle),
      0.35 + 0.1 * sin(angle * 1.7),
      sin(angle),
    ),
    vec3<f32>(0.0, 0.0, 1.0),
  );
}

fn hermite_derivative(
  start: vec3<f32>,
  finish: vec3<f32>,
  start_tangent: vec3<f32>,
  end_tangent: vec3<f32>,
  t: f32,
) -> vec3<f32> {
  let t2 = t * t;
  let h00 = 6.0 * t2 - 6.0 * t;
  let h10 = 3.0 * t2 - 4.0 * t + 1.0;
  let h01 = -6.0 * t2 + 6.0 * t;
  let h11 = 3.0 * t2 - 2.0 * t;
  return
    start * h00
    + start_tangent * h10
    + finish * h01
    + end_tangent * h11;
}

fn buckling_basis_derivative(t: f32) -> f32 {
  let one_minus = 1.0 - t;
  return 192.0
    * t * t
    * one_minus * one_minus
    * (1.0 - 2.0 * t);
}

fn half_arc_length(
  start: vec3<f32>,
  finish: vec3<f32>,
  start_direction: vec3<f32>,
  end_direction: vec3<f32>,
  amplitude: f32,
) -> f32 {
  let chord_length = length(finish - start);
  let tangent_scale = max(chord_length, globals.geometry.y * 0.25);
  let start_tangent = start_direction * tangent_scale;
  let end_tangent = end_direction * tangent_scale;

  let steps = 32u;
  let h = 1.0 / f32(steps);
  var sum = 0.0;
  for (var i = 0u; i <= steps; i = i + 1u) {
    let t = f32(i) * h;
    let base = hermite_derivative(
      start,
      finish,
      start_tangent,
      end_tangent,
      t,
    );
    let buckling = amplitude * buckling_basis_derivative(t);
    let speed = sqrt(dot(base, base) + buckling * buckling);
    var weight = 2.0;
    if (i == 0u || i == steps) {
      weight = 1.0;
    } else if ((i & 1u) == 1u) {
      weight = 4.0;
    }
    sum = sum + weight * speed;
  }
  return sum * h / 3.0;
}

fn solve_amplitude(
  start: vec3<f32>,
  finish: vec3<f32>,
  start_direction: vec3<f32>,
  end_direction: vec3<f32>,
) -> f32 {
  let rest = globals.geometry.y;
  let base = half_arc_length(
    start,
    finish,
    start_direction,
    end_direction,
    0.0,
  );
  if (base + 1e-5 >= rest) {
    return 0.0;
  }

  var low = 0.0;
  var high = max(max(rest, length(finish - start)), 1.0);
  for (var grow = 0u; grow < 12u; grow = grow + 1u) {
    if (
      half_arc_length(
        start,
        finish,
        start_direction,
        end_direction,
        high,
      ) >= rest
    ) {
      break;
    }
    high = high * 2.0;
  }

  for (var iteration = 0u; iteration < 24u; iteration = iteration + 1u) {
    let middle = (low + high) * 0.5;
    if (
      half_arc_length(
        start,
        finish,
        start_direction,
        end_direction,
        middle,
      ) < rest
    ) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) * 0.5;
}

@compute @workgroup_size(64)
fn shape_parameter_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let link = gid.x + gid.y * 65535u * 64u;
  if (link >= globals.counts.x) {
    return;
  }

  let start_index = topology_data[link * 2u];
  let end_index = topology_data[link * 2u + 1u];

  let s = semantic_centers[start_index].xyz;
  let c = semantic_centers[link].xyz;
  let e = semantic_centers[end_index].xyz;

  let first_chord = c - s;
  let second_chord = e - c;
  let first_length = length(first_chord);
  let second_length = length(second_chord);

  let seed = deterministic_axis(link);
  let first_direction = safe_normalize(first_chord, seed);
  let second_direction = safe_normalize(second_chord, first_direction);
  let overall = safe_normalize(e - s, first_direction);
  let shared_direction = safe_normalize(
    first_direction + second_direction,
    overall,
  );

  let first_self = select(0.0, 1.0, first_length <= 1e-9);
  let second_self = select(0.0, 1.0, second_length <= 1e-9);

  var first_amplitude = 0.0;
  var second_amplitude = 0.0;
  if (first_self == 0.0) {
    first_amplitude = solve_amplitude(
      s,
      c,
      first_direction,
      shared_direction,
    );
  }
  if (second_self == 0.0) {
    second_amplitude = solve_amplitude(
      c,
      e,
      shared_direction,
      second_direction,
    );
  }

  shape_parameters[link] = vec4<f32>(
    first_amplitude,
    second_amplitude,
    first_self,
    second_self,
  );
}
`;

function maximumWorkgroups(device: WebGpuDeviceLike): number {
  const value = device.limits?.maxComputeWorkgroupsPerDimension;
  if (value === undefined) return DEFAULT_MAX_WORKGROUPS_PER_DIMENSION;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `invalid monolithic shape maxComputeWorkgroupsPerDimension: ${String(value)}`,
    );
  }
  return Math.min(value, DEFAULT_MAX_WORKGROUPS_PER_DIMENSION);
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

function packedTopology(compute: MonolithicLinkWebGpuCompute3D): Uint32Array {
  const result = new Uint32Array(compute.topology.linkCount * 2);
  for (let link = 0; link < compute.topology.linkCount; link += 1) {
    result[link * 2] = compute.topology.startIndices[link]!;
    result[link * 2 + 1] = compute.topology.endIndices[link]!;
  }
  return result;
}

function globalsData(
  linkCount: number,
  template: MonolithicLinkSpringTemplate3D,
): ArrayBuffer {
  const buffer = new ArrayBuffer(32);
  const u32 = new Uint32Array(buffer);
  const f32 = new Float32Array(buffer);
  u32[0] = linkCount;
  u32[1] = 0;
  u32[2] = 0;
  u32[3] = 0;
  f32[4] = template.restLength;
  f32[5] = template.halfRestLength;
  f32[6] = 0;
  f32[7] = 0;
  return buffer;
}

class MonolithicLinkWebGpuShapeController
implements MonolithicLinkWebGpuShape3D {
  readonly parameterBuffer: WebGpuBufferLike;
  readonly template: MonolithicLinkSpringTemplate3D;

  private readonly topologyBuffer: WebGpuBufferLike;
  private readonly globalsBuffer: WebGpuBufferLike;
  private readonly bindGroup: object;
  private readonly pipeline:
    Awaited<ReturnType<WebGpuDeviceLike["createComputePipelineAsync"]>>;
  private readonly maxWorkgroups: number;
  private destroyed = false;

  constructor(
    private readonly device: WebGpuDeviceLike,
    readonly compute: MonolithicLinkWebGpuCompute3D,
    template: MonolithicLinkSpringTemplate3D,
    args: {
      parameterBuffer: WebGpuBufferLike;
      topologyBuffer: WebGpuBufferLike;
      globalsBuffer: WebGpuBufferLike;
      bindGroup: object;
      pipeline:
        Awaited<ReturnType<WebGpuDeviceLike["createComputePipelineAsync"]>>;
    },
  ) {
    this.template = template;
    this.parameterBuffer = args.parameterBuffer;
    this.topologyBuffer = args.topologyBuffer;
    this.globalsBuffer = args.globalsBuffer;
    this.bindGroup = args.bindGroup;
    this.pipeline = args.pipeline;
    this.maxWorkgroups = maximumWorkgroups(device);
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("monolithic Link WebGPU shape controller is destroyed");
    }
    if (this.compute.snapshot().status !== "available") {
      throw new Error("monolithic Link WebGPU shape source compute is unavailable");
    }
  }

  update(): MonolithicLinkWebGpuShapeStepStats3D {
    this.assertAlive();
    const linkCount = this.compute.topology.linkCount;
    if (linkCount === 0) {
      return Object.freeze({
        dispatches: 0,
        computePasses: 0,
        dynamicStateUploadBytes: 0 as const,
      });
    }

    const totalWorkgroups = Math.ceil(linkCount / WORKGROUP_SIZE);
    const workgroupsX = Math.min(totalWorkgroups, this.maxWorkgroups);
    const workgroupsY = Math.ceil(totalWorkgroups / this.maxWorkgroups);

    const encoder = this.device.createCommandEncoder({
      label: "monolithic-link-shape-parameter-update",
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(workgroupsX, workgroupsY, 1);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    return Object.freeze({
      dispatches: 1,
      computePasses: 1,
      dynamicStateUploadBytes: 0 as const,
    });
  }

  snapshot(): MonolithicLinkWebGpuShapeSnapshot3D {
    const linkCount = this.compute.topology.linkCount;
    return Object.freeze({
      status: this.destroyed ? "destroyed" : "available",
      linkCount,
      octahedronCount: this.template.octahedronCount,
      sectionCount: this.template.octahedronCount + 1,
      parameterBytes: linkCount * 16,
      topologyBytes: this.topologyBuffer.size,
      dynamicStateBytes: linkCount * 16,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.parameterBuffer.destroy();
    this.topologyBuffer.destroy();
    this.globalsBuffer.destroy();
  }
}

export async function createMonolithicLinkWebGpuShape3D(
  device: WebGpuDeviceLike,
  compute: MonolithicLinkWebGpuCompute3D,
  aspectRatio: number,
): Promise<MonolithicLinkWebGpuShape3D> {
  const template = getMonolithicLinkSpringTemplate3D(aspectRatio);
  if (Math.abs(template.restLength - compute.restLength) > 1e-5) {
    throw new Error(
      `monolithic shape/compute restLength mismatch: ${template.restLength} != ${compute.restLength}`,
    );
  }

  const topology = packedTopology(compute);
  const parameterBuffer = createBuffer(
    device,
    "monolithic-link-shape-parameters",
    compute.topology.linkCount * 16,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC,
  );
  const topologyBuffer = createBuffer(
    device,
    "monolithic-link-shape-topology",
    topology.byteLength,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
  );
  const globalsBuffer = createBuffer(
    device,
    "monolithic-link-shape-globals",
    32,
    GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
  );
  if (topology.byteLength > 0) {
    device.queue.writeBuffer(topologyBuffer, 0, topology);
  }
  device.queue.writeBuffer(
    globalsBuffer,
    0,
    globalsData(compute.topology.linkCount, template),
  );

  const shader = device.createShaderModule({
    label: "monolithic-link-shape-parameter-shader",
    code: MONOLITHIC_LINK_SHAPE_PARAMETER_WGSL,
  });
  if (typeof shader.getCompilationInfo === "function") {
    const compilation = await shader.getCompilationInfo();
    const errors = compilation.messages.filter(
      (message) => message.type === "error",
    );
    if (errors.length > 0) {
      throw new Error(
        "monolithic shape WGSL compilation failed:\n"
        + errors.map((message) =>
          `- ${message.lineNum ?? "?"}:${message.linePos ?? "?"} ${message.message}`
        ).join("\n"),
      );
    }
  }

  const layout = device.createBindGroupLayout({
    label: "monolithic-link-shape-layout",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE_COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 1,
        visibility: GPU_SHADER_STAGE_COMPUTE,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 2,
        visibility: GPU_SHADER_STAGE_COMPUTE,
        buffer: { type: "storage" },
      },
      {
        binding: 3,
        visibility: GPU_SHADER_STAGE_COMPUTE,
        buffer: { type: "uniform" },
      },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: "monolithic-link-shape-pipeline-layout",
    bindGroupLayouts: [layout],
  });
  const pipeline = await device.createComputePipelineAsync({
    label: "monolithic-link-shape-parameter-pipeline",
    layout: pipelineLayout,
    compute: {
      module: shader as object,
      entryPoint: "shape_parameter_main",
    },
  });
  const bindGroup = device.createBindGroup({
    label: "monolithic-link-shape-bind",
    layout,
    entries: [
      { binding: 0, resource: { buffer: compute.centerBuffer } },
      { binding: 1, resource: { buffer: topologyBuffer } },
      { binding: 2, resource: { buffer: parameterBuffer } },
      { binding: 3, resource: { buffer: globalsBuffer } },
    ],
  });

  return new MonolithicLinkWebGpuShapeController(
    device,
    compute,
    template,
    {
      parameterBuffer,
      topologyBuffer,
      globalsBuffer,
      bindGroup,
      pipeline,
    },
  );
}
