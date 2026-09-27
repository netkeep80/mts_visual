import type {
  OctahedralLinkTemplate3D,
} from "../octahedral-link3d.js";
import type {
  OctahedralWebGpuCompute3D,
  WebGpuBufferLike,
} from "./octahedral-compute.js";

const GPU_BUFFER_USAGE = Object.freeze({
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
});

const GPU_SHADER_STAGE = Object.freeze({
  VERTEX: 0x0001,
  FRAGMENT: 0x0002,
});

export const OCTAHEDRAL_WEBGPU_RENDER_UNIFORM_BYTES = 128;
export const OCTAHEDRAL_WEBGPU_CENTER_VERTICES_PER_LINK = 6;
export const OCTAHEDRAL_WEBGPU_ARROW_VERTICES_PER_LINK = 3;

interface WebGpuRenderQueueLike {
  writeBuffer(
    buffer: WebGpuBufferLike,
    bufferOffset: number,
    data: ArrayBuffer | ArrayBufferView,
    dataOffset?: number,
    size?: number,
  ): void;
  submit(commandBuffers: readonly object[]): void;
}

interface WebGpuRenderPipelineLike {
  readonly label?: string;
}

interface WebGpuRenderPassLike {
  setPipeline(pipeline: WebGpuRenderPipelineLike): void;
  setBindGroup(index: number, bindGroup: object): void;
  draw(
    vertexCount: number,
    instanceCount?: number,
    firstVertex?: number,
    firstInstance?: number,
  ): void;
  end(): void;
}

interface WebGpuRenderCommandEncoderLike {
  beginRenderPass(descriptor: {
    readonly colorAttachments: readonly object[];
    readonly depthStencilAttachment?: object;
  }): WebGpuRenderPassLike;
  finish(): object;
}

export interface WebGpuRenderDeviceLike {
  readonly queue: WebGpuRenderQueueLike;
  createBuffer(descriptor: {
    readonly label?: string;
    readonly size: number;
    readonly usage: number;
  }): WebGpuBufferLike;
  createShaderModule(descriptor: {
    readonly label?: string;
    readonly code: string;
  }): object;
  createBindGroupLayout(descriptor: {
    readonly label?: string;
    readonly entries: readonly object[];
  }): object;
  createPipelineLayout(descriptor: {
    readonly label?: string;
    readonly bindGroupLayouts: readonly object[];
  }): object;
  createRenderPipelineAsync(descriptor: {
    readonly label?: string;
    readonly layout: object;
    readonly vertex: {
      readonly module: object;
      readonly entryPoint: string;
    };
    readonly fragment: {
      readonly module: object;
      readonly entryPoint: string;
      readonly targets: readonly { readonly format: string }[];
    };
    readonly primitive?: object;
    readonly depthStencil?: object;
  }): Promise<WebGpuRenderPipelineLike>;
  createBindGroup(descriptor: {
    readonly label?: string;
    readonly layout: object;
    readonly entries: readonly object[];
  }): object;
  createCommandEncoder(descriptor?: {
    readonly label?: string;
  }): WebGpuRenderCommandEncoderLike;
}

export interface OctahedralWebGpuRendererOptions3D {
  readonly colorFormat: string;
  readonly depthFormat?: string;
  readonly centerMarkerPixels?: number;
  readonly arrowLengthPixels?: number;
}

export interface OctahedralWebGpuRenderFrame3D {
  readonly targetView: object;
  readonly depthView?: object;
  readonly viewProjection: readonly number[] | Float32Array;
  readonly width: number;
  readonly height: number;
  readonly clearColor?: {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
  };
  readonly loadOp?: "clear" | "load";
}

export interface OctahedralWebGpuRenderStats3D {
  readonly linkCount: number;
  readonly drawCalls: number;
  readonly surfaceVertexInvocations: number;
  readonly centerVertexInvocations: number;
  readonly arrowVertexInvocations: number;
  readonly dynamicStateUploadBytes: 0;
  readonly controlUploadBytes: number;
  readonly bufferCopies: 0;
  readonly readbacks: 0;
}

export interface OctahedralWebGpuRenderEstimate3D {
  readonly linkCount: number;
  readonly surfaceVerticesPerLink: number;
  readonly centerVerticesPerLink: 6;
  readonly arrowVerticesPerLink: 3;
  readonly surfaceVertexInvocations: number;
  readonly centerVertexInvocations: number;
  readonly arrowVertexInvocations: number;
  readonly drawCalls: number;
  readonly rendererDynamicPositionBytes: 0;
  readonly rendererInstanceAddressBytes: 0;
  readonly dynamicStateUploadBytesPerFrame: 0;
}

export interface OctahedralWebGpuRendererSnapshot3D
  extends OctahedralWebGpuRenderEstimate3D {
  readonly status: "available" | "device-lost" | "destroyed";
  readonly deviceLostReason: string | null;
  readonly sharedPositionBuffer: true;
  readonly staticTemplateBytes: number;
  readonly uniformBytes: number;
  readonly colorFormat: string;
  readonly depthFormat: string | null;
}

export interface OctahedralWebGpuRenderer3D {
  readonly compute: OctahedralWebGpuCompute3D;
  readonly positionBuffer: WebGpuBufferLike;
  render(frame: OctahedralWebGpuRenderFrame3D): OctahedralWebGpuRenderStats3D;
  snapshot(): OctahedralWebGpuRendererSnapshot3D;
  destroy(): void;
}

function requireFormat(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`invalid ${name}: ${String(value)}`);
  }
  return value;
}

function requirePositiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid ${name}: ${String(value)}`);
  }
  return value;
}

function requireLinkCount(linkCount: number): number {
  if (!Number.isSafeInteger(linkCount) || linkCount < 0) {
    throw new Error(`invalid render linkCount: ${String(linkCount)}`);
  }
  return linkCount;
}

function safeProduct(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`octahedral WebGPU render estimate overflow: ${label}=${String(value)}`);
  }
  return value;
}

export function estimateOctahedralWebGpuRender3D(
  linkCount: number,
  template: OctahedralLinkTemplate3D,
): OctahedralWebGpuRenderEstimate3D {
  const count = requireLinkCount(linkCount);
  const surfaceVerticesPerLink = template.surfaceTriangles.length;
  return Object.freeze({
    linkCount: count,
    surfaceVerticesPerLink,
    centerVerticesPerLink: OCTAHEDRAL_WEBGPU_CENTER_VERTICES_PER_LINK as 6,
    arrowVerticesPerLink: OCTAHEDRAL_WEBGPU_ARROW_VERTICES_PER_LINK as 3,
    surfaceVertexInvocations: safeProduct(count, surfaceVerticesPerLink, "surfaceVertexInvocations"),
    centerVertexInvocations: safeProduct(
      count,
      OCTAHEDRAL_WEBGPU_CENTER_VERTICES_PER_LINK,
      "centerVertexInvocations",
    ),
    arrowVertexInvocations: safeProduct(
      count,
      OCTAHEDRAL_WEBGPU_ARROW_VERTICES_PER_LINK,
      "arrowVertexInvocations",
    ),
    drawCalls: count === 0 ? 0 : 3,
    rendererDynamicPositionBytes: 0 as const,
    rendererInstanceAddressBytes: 0 as const,
    dynamicStateUploadBytesPerFrame: 0 as const,
  });
}

export const OCTAHEDRAL_WEBGPU_RENDER_WGSL = /* wgsl */ `
struct SceneUniforms {
  view_projection: mat4x4<f32>,
  counts_center: vec4<u32>,
  center_end: vec4<u32>,
  ring_surface: vec4<u32>,
  viewport_sizes: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> surface_indices: array<u32>;
@group(0) @binding(2) var<storage, read> gradient_t: array<f32>;
@group(0) @binding(3) var<uniform> scene: SceneUniforms;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
};

fn load_position(link: u32, local_vertex: u32) -> vec3<f32> {
  let scalar = (link * scene.counts_center.y + local_vertex) * 3u;
  return vec3<f32>(
    positions[scalar],
    positions[scalar + 1u],
    positions[scalar + 2u],
  );
}

fn center_position(link: u32) -> vec3<f32> {
  let a = load_position(link, scene.counts_center.z);
  let b = load_position(link, scene.counts_center.w);
  let c = load_position(link, scene.center_end.x);
  return (a + b + c) / 3.0;
}

fn end_ring_center(link: u32) -> vec3<f32> {
  let a = load_position(link, scene.center_end.z);
  let b = load_position(link, scene.center_end.w);
  let c = load_position(link, scene.ring_surface.x);
  return (a + b + c) / 3.0;
}

fn quad_offset(vertex: u32) -> vec2<f32> {
  let local = vertex % 6u;
  if (local == 0u) { return vec2<f32>(-1.0, -1.0); }
  if (local == 1u) { return vec2<f32>( 1.0, -1.0); }
  if (local == 2u) { return vec2<f32>( 1.0,  1.0); }
  if (local == 3u) { return vec2<f32>(-1.0, -1.0); }
  if (local == 4u) { return vec2<f32>( 1.0,  1.0); }
  return vec2<f32>(-1.0, 1.0);
}

@vertex
fn surface_vertex(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> VertexOut {
  let local_vertex = surface_indices[vertex_index];
  let world = load_position(instance_index, local_vertex);
  let t = clamp(gradient_t[local_vertex], 0.0, 1.0);

  var out: VertexOut;
  out.position = scene.view_projection * vec4<f32>(world, 1.0);
  out.color = vec3<f32>(1.0 - t, 0.0, t);
  return out;
}

@vertex
fn center_vertex(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> VertexOut {
  let world = center_position(instance_index);
  let raw_clip = scene.view_projection * vec4<f32>(world, 1.0);
  let pixel_ndc = vec2<f32>(
    2.0 / max(scene.viewport_sizes.x, 1.0),
    2.0 / max(scene.viewport_sizes.y, 1.0),
  );
  let offset = quad_offset(vertex_index)
    * scene.viewport_sizes.z
    * pixel_ndc;

  var out: VertexOut;
  out.position = vec4<f32>(
    raw_clip.xy + offset * raw_clip.w,
    raw_clip.z,
    raw_clip.w,
  );
  out.color = vec3<f32>(0.0, 1.0, 0.0);
  return out;
}

@vertex
fn arrow_vertex(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> VertexOut {
  let tip_world = load_position(instance_index, scene.center_end.y);
  let base_world = end_ring_center(instance_index);
  let tip_clip = scene.view_projection * vec4<f32>(tip_world, 1.0);
  let base_clip = scene.view_projection * vec4<f32>(base_world, 1.0);

  let tip_w = select(1e-6, tip_clip.w, abs(tip_clip.w) > 1e-6);
  let base_w = select(1e-6, base_clip.w, abs(base_clip.w) > 1e-6);
  let tip_ndc = tip_clip.xy / tip_w;
  let base_ndc = base_clip.xy / base_w;

  var direction_pixels = vec2<f32>(
    (tip_ndc.x - base_ndc.x) * scene.viewport_sizes.x * 0.5,
    (tip_ndc.y - base_ndc.y) * scene.viewport_sizes.y * 0.5,
  );
  if (dot(direction_pixels, direction_pixels) <= 1e-12) {
    direction_pixels = vec2<f32>(0.0, 1.0);
  } else {
    direction_pixels = normalize(direction_pixels);
  }

  let perpendicular = vec2<f32>(-direction_pixels.y, direction_pixels.x);
  let arrow_length = scene.viewport_sizes.w;
  let half_width = arrow_length * 0.4;

  var pixel_offset = vec2<f32>(0.0);
  let local = vertex_index % 3u;
  if (local == 1u) {
    pixel_offset = -direction_pixels * arrow_length + perpendicular * half_width;
  } else if (local == 2u) {
    pixel_offset = -direction_pixels * arrow_length - perpendicular * half_width;
  }

  let offset_ndc = vec2<f32>(
    pixel_offset.x * 2.0 / max(scene.viewport_sizes.x, 1.0),
    pixel_offset.y * 2.0 / max(scene.viewport_sizes.y, 1.0),
  );

  var out: VertexOut;
  out.position = vec4<f32>(
    (tip_ndc + offset_ndc) * tip_clip.w,
    tip_clip.z,
    tip_clip.w,
  );
  out.color = vec3<f32>(0.0, 0.0, 1.0);
  return out;
}

@fragment
fn fragment_main(input: VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color, 1.0);
}
`;

function createStorageBuffer(
  device: WebGpuRenderDeviceLike,
  label: string,
  data: ArrayBufferView,
): WebGpuBufferLike {
  const size = Math.max(4, data.byteLength);
  const buffer = device.createBuffer({
    label,
    size,
    usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
  });
  if (data.byteLength > 0) {
    device.queue.writeBuffer(buffer, 0, data);
  }
  return buffer;
}

function requireViewProjection(
  value: readonly number[] | Float32Array,
): Float32Array {
  if (value.length !== 16) {
    throw new Error(`invalid viewProjection length: ${value.length}`);
  }
  const result = new Float32Array(16);
  for (let index = 0; index < 16; index += 1) {
    const component = value[index]!;
    if (!Number.isFinite(component)) {
      throw new Error(`non-finite viewProjection[${index}]`);
    }
    result[index] = component;
  }
  return result;
}

function buildUniformData(
  compute: OctahedralWebGpuCompute3D,
  frame: OctahedralWebGpuRenderFrame3D,
  centerMarkerPixels: number,
  arrowLengthPixels: number,
): ArrayBuffer {
  const matrix = requireViewProjection(frame.viewProjection);
  const width = requirePositiveFinite(frame.width, "render width");
  const height = requirePositiveFinite(frame.height, "render height");
  const template = compute.template;
  const buffer = new ArrayBuffer(OCTAHEDRAL_WEBGPU_RENDER_UNIFORM_BYTES);
  const f32 = new Float32Array(buffer);
  const u32 = new Uint32Array(buffer);

  f32.set(matrix, 0);

  u32[16] = compute.topology.linkCount;
  u32[17] = template.vertexCount;
  u32[18] = template.centerTriangle[0];
  u32[19] = template.centerTriangle[1];

  u32[20] = template.centerTriangle[2];
  u32[21] = template.endApex;

  const lastLevelBase = template.octahedronCount * 3;
  u32[22] = lastLevelBase;
  u32[23] = lastLevelBase + 1;

  u32[24] = lastLevelBase + 2;
  u32[25] = template.surfaceTriangles.length;
  u32[26] = 0;
  u32[27] = 0;

  f32[28] = width;
  f32[29] = height;
  f32[30] = centerMarkerPixels;
  f32[31] = arrowLengthPixels;

  return buffer;
}

function clearColor(
  value: OctahedralWebGpuRenderFrame3D["clearColor"],
): { r: number; g: number; b: number; a: number } {
  const selected = value ?? { r: 0, g: 0, b: 0, a: 1 };
  for (const [name, component] of Object.entries(selected)) {
    if (!Number.isFinite(component)) {
      throw new Error(`invalid clearColor.${name}: ${String(component)}`);
    }
  }
  return {
    r: selected.r,
    g: selected.g,
    b: selected.b,
    a: selected.a,
  };
}

function computeStatus(
  compute: OctahedralWebGpuCompute3D,
): ReturnType<OctahedralWebGpuCompute3D["snapshot"]> {
  return compute.snapshot();
}

class OctahedralWebGpuRendererController
implements OctahedralWebGpuRenderer3D {
  readonly positionBuffer: WebGpuBufferLike;

  private readonly device: WebGpuRenderDeviceLike;
  private readonly surfaceIndicesBuffer: WebGpuBufferLike;
  private readonly gradientBuffer: WebGpuBufferLike;
  private readonly uniformBuffer: WebGpuBufferLike;
  private readonly bindGroup: object;
  private readonly surfacePipeline: WebGpuRenderPipelineLike;
  private readonly centerPipeline: WebGpuRenderPipelineLike;
  private readonly arrowPipeline: WebGpuRenderPipelineLike;
  private readonly colorFormatValue: string;
  private readonly depthFormatValue: string | null;
  private readonly centerMarkerPixels: number;
  private readonly arrowLengthPixels: number;
  private readonly staticTemplateBytes: number;
  private destroyed = false;

  constructor(
    device: WebGpuRenderDeviceLike,
    readonly compute: OctahedralWebGpuCompute3D,
    args: {
      surfaceIndicesBuffer: WebGpuBufferLike;
      gradientBuffer: WebGpuBufferLike;
      uniformBuffer: WebGpuBufferLike;
      bindGroup: object;
      surfacePipeline: WebGpuRenderPipelineLike;
      centerPipeline: WebGpuRenderPipelineLike;
      arrowPipeline: WebGpuRenderPipelineLike;
      colorFormat: string;
      depthFormat: string | null;
      centerMarkerPixels: number;
      arrowLengthPixels: number;
      staticTemplateBytes: number;
    },
  ) {
    this.device = device;
    this.positionBuffer = compute.positionBuffer;
    this.surfaceIndicesBuffer = args.surfaceIndicesBuffer;
    this.gradientBuffer = args.gradientBuffer;
    this.uniformBuffer = args.uniformBuffer;
    this.bindGroup = args.bindGroup;
    this.surfacePipeline = args.surfacePipeline;
    this.centerPipeline = args.centerPipeline;
    this.arrowPipeline = args.arrowPipeline;
    this.colorFormatValue = args.colorFormat;
    this.depthFormatValue = args.depthFormat;
    this.centerMarkerPixels = args.centerMarkerPixels;
    this.arrowLengthPixels = args.arrowLengthPixels;
    this.staticTemplateBytes = args.staticTemplateBytes;
  }

  private assertRenderable(): ReturnType<OctahedralWebGpuCompute3D["snapshot"]> {
    if (this.destroyed) {
      throw new Error("octahedral WebGPU renderer is destroyed");
    }
    const computeSnapshot = computeStatus(this.compute);
    if (computeSnapshot.status !== "available") {
      throw new Error(
        `octahedral WebGPU compute is ${computeSnapshot.status}: ${computeSnapshot.deviceLostReason ?? "unavailable"}`,
      );
    }
    return computeSnapshot;
  }

  render(frame: OctahedralWebGpuRenderFrame3D): OctahedralWebGpuRenderStats3D {
    const computeSnapshot = this.assertRenderable();
    if (this.depthFormatValue !== null && frame.depthView === undefined) {
      throw new Error("octahedral WebGPU renderer requires a depthView");
    }

    const uniforms = buildUniformData(
      this.compute,
      frame,
      this.centerMarkerPixels,
      this.arrowLengthPixels,
    );
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    const colorAttachment = {
      view: frame.targetView,
      clearValue: clearColor(frame.clearColor),
      loadOp: frame.loadOp ?? "clear",
      storeOp: "store",
    };
    const renderPassDescriptor = frame.depthView === undefined
      ? { colorAttachments: [colorAttachment] }
      : {
        colorAttachments: [colorAttachment],
        depthStencilAttachment: {
          view: frame.depthView,
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      };

    const encoder = this.device.createCommandEncoder({
      label: "octahedral-webgpu-zero-copy-render",
    });
    const pass = encoder.beginRenderPass(renderPassDescriptor);

    let drawCalls = 0;
    const linkCount = computeSnapshot.linkCount;
    if (linkCount > 0) {
      pass.setBindGroup(0, this.bindGroup);

      pass.setPipeline(this.surfacePipeline);
      pass.draw(this.compute.template.surfaceTriangles.length, linkCount, 0, 0);
      drawCalls += 1;

      pass.setPipeline(this.centerPipeline);
      pass.draw(OCTAHEDRAL_WEBGPU_CENTER_VERTICES_PER_LINK, linkCount, 0, 0);
      drawCalls += 1;

      pass.setPipeline(this.arrowPipeline);
      pass.draw(OCTAHEDRAL_WEBGPU_ARROW_VERTICES_PER_LINK, linkCount, 0, 0);
      drawCalls += 1;
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);

    const estimate = estimateOctahedralWebGpuRender3D(linkCount, this.compute.template);
    return Object.freeze({
      linkCount,
      drawCalls,
      surfaceVertexInvocations: estimate.surfaceVertexInvocations,
      centerVertexInvocations: estimate.centerVertexInvocations,
      arrowVertexInvocations: estimate.arrowVertexInvocations,
      dynamicStateUploadBytes: 0 as const,
      controlUploadBytes: OCTAHEDRAL_WEBGPU_RENDER_UNIFORM_BYTES,
      bufferCopies: 0 as const,
      readbacks: 0 as const,
    });
  }

  snapshot(): OctahedralWebGpuRendererSnapshot3D {
    const computeSnapshot = computeStatus(this.compute);
    const estimate = estimateOctahedralWebGpuRender3D(
      computeSnapshot.linkCount,
      this.compute.template,
    );
    const status = this.destroyed
      ? "destroyed"
      : computeSnapshot.status;

    return Object.freeze({
      ...estimate,
      status,
      deviceLostReason: computeSnapshot.deviceLostReason,
      sharedPositionBuffer: true as const,
      staticTemplateBytes: this.staticTemplateBytes,
      uniformBytes: OCTAHEDRAL_WEBGPU_RENDER_UNIFORM_BYTES,
      colorFormat: this.colorFormatValue,
      depthFormat: this.depthFormatValue,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.surfaceIndicesBuffer.destroy();
    this.gradientBuffer.destroy();
    this.uniformBuffer.destroy();
  }
}

export async function createOctahedralWebGpuZeroCopyRenderer3D(
  device: WebGpuRenderDeviceLike,
  compute: OctahedralWebGpuCompute3D,
  options: OctahedralWebGpuRendererOptions3D,
): Promise<OctahedralWebGpuRenderer3D> {
  const computeSnapshot = compute.snapshot();
  if (computeSnapshot.status !== "available") {
    throw new Error(
      `cannot create octahedral WebGPU renderer from compute status ${computeSnapshot.status}`,
    );
  }

  const colorFormat = requireFormat(options.colorFormat, "colorFormat");
  const depthFormat = options.depthFormat === undefined
    ? null
    : requireFormat(options.depthFormat, "depthFormat");
  const centerMarkerPixels = requirePositiveFinite(
    options.centerMarkerPixels ?? 3,
    "centerMarkerPixels",
  );
  const arrowLengthPixels = requirePositiveFinite(
    options.arrowLengthPixels ?? 12,
    "arrowLengthPixels",
  );

  const surfaceIndicesBuffer = createStorageBuffer(
    device,
    "octahedral-render-surface-indices",
    compute.template.surfaceTriangles,
  );
  const gradientBuffer = createStorageBuffer(
    device,
    "octahedral-render-gradient",
    compute.template.gradientT,
  );
  const uniformBuffer = device.createBuffer({
    label: "octahedral-render-uniforms",
    size: OCTAHEDRAL_WEBGPU_RENDER_UNIFORM_BYTES,
    usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
  });

  const shaderModule = device.createShaderModule({
    label: "octahedral-webgpu-zero-copy-render-shader",
    code: OCTAHEDRAL_WEBGPU_RENDER_WGSL,
  });

  const bindGroupLayout = device.createBindGroupLayout({
    label: "octahedral-webgpu-zero-copy-render-layout",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE.VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 1,
        visibility: GPU_SHADER_STAGE.VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 2,
        visibility: GPU_SHADER_STAGE.VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 3,
        visibility: GPU_SHADER_STAGE.VERTEX,
        buffer: { type: "uniform" },
      },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    label: "octahedral-webgpu-zero-copy-render-pipeline-layout",
    bindGroupLayouts: [bindGroupLayout],
  });

  const pipelineDescriptor = (
    label: string,
    entryPoint: string,
  ): Parameters<WebGpuRenderDeviceLike["createRenderPipelineAsync"]>[0] => {
    const descriptor = {
      label,
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint,
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fragment_main",
        targets: [{ format: colorFormat }],
      },
      primitive: {
        topology: "triangle-list",
        cullMode: "none",
      },
    };

    if (depthFormat === null) return descriptor;
    return {
      ...descriptor,
      depthStencil: {
        format: depthFormat,
        depthWriteEnabled: true,
        depthCompare: "less-equal",
      },
    };
  };

  const [surfacePipeline, centerPipeline, arrowPipeline] = await Promise.all([
    device.createRenderPipelineAsync(
      pipelineDescriptor(
        "octahedral-webgpu-surface-pipeline",
        "surface_vertex",
      ),
    ),
    device.createRenderPipelineAsync(
      pipelineDescriptor(
        "octahedral-webgpu-center-pipeline",
        "center_vertex",
      ),
    ),
    device.createRenderPipelineAsync(
      pipelineDescriptor(
        "octahedral-webgpu-arrow-pipeline",
        "arrow_vertex",
      ),
    ),
  ]);

  const bindGroup = device.createBindGroup({
    label: "octahedral-webgpu-zero-copy-render-bind-group",
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: compute.positionBuffer } },
      { binding: 1, resource: { buffer: surfaceIndicesBuffer } },
      { binding: 2, resource: { buffer: gradientBuffer } },
      { binding: 3, resource: { buffer: uniformBuffer } },
    ],
  });

  return new OctahedralWebGpuRendererController(
    device,
    compute,
    {
      surfaceIndicesBuffer,
      gradientBuffer,
      uniformBuffer,
      bindGroup,
      surfacePipeline,
      centerPipeline,
      arrowPipeline,
      colorFormat,
      depthFormat,
      centerMarkerPixels,
      arrowLengthPixels,
      staticTemplateBytes:
        compute.template.surfaceTriangles.byteLength
        + compute.template.gradientT.byteLength,
    },
  );
}
