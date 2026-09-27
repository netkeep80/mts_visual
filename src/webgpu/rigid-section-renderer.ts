import {
  getOctahedralLinkTemplate3D,
} from "../octahedral-link3d.js";
import type {
  RigidSectionTemplate3D,
} from "../rigid-section3d.js";
import type {
  RigidSectionWebGpuCompute3D,
} from "./rigid-section-compute.js";
import {
  buildOctahedralWireframeIndices3D,
  type OctahedralWebGpuRenderFrame3D,
  type WebGpuRenderDeviceLike,
} from "./octahedral-renderer.js";
import type {
  WebGpuBufferLike,
} from "./octahedral-compute.js";

const GPU_BUFFER_USAGE = Object.freeze({
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
});

const GPU_SHADER_STAGE = Object.freeze({
  VERTEX: 0x0001,
});

export const RIGID_SECTION_WEBGPU_RENDER_UNIFORM_BYTES = 112;
export const RIGID_SECTION_WEBGPU_CENTER_VERTICES_PER_LINK = 6;
export const RIGID_SECTION_WEBGPU_ARROW_VERTICES_PER_LINK = 6;

export type RigidSectionWebGpuRenderFrame3D = OctahedralWebGpuRenderFrame3D;

export interface RigidSectionWebGpuRendererOptions3D {
  readonly colorFormat: string;
  readonly depthFormat?: string;
  readonly centerMarkerPixels?: number;
  readonly arrowLengthPixels?: number;
}

export interface RigidSectionWebGpuRenderStats3D {
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

export interface RigidSectionWebGpuRenderEstimate3D {
  readonly linkCount: number;
  readonly surfaceVerticesPerLink: number;
  readonly centerVerticesPerLink: 6;
  readonly arrowVerticesPerLink: 6;
  readonly surfaceVertexInvocations: number;
  readonly centerVertexInvocations: number;
  readonly arrowVertexInvocations: number;
  readonly drawCalls: number;
  readonly rendererDynamicStateBytes: 0;
  readonly dynamicStateUploadBytesPerFrame: 0;
}

export interface RigidSectionWebGpuRendererSnapshot3D
extends RigidSectionWebGpuRenderEstimate3D {
  readonly status: "available" | "device-lost" | "destroyed";
  readonly deviceLostReason: string | null;
  readonly wireframeVerticesPerLink: number;
  readonly sharedCenterBuffer: true;
  readonly sharedOrientationBuffer: true;
  readonly staticTemplateBytes: number;
  readonly uniformBytes: number;
  readonly colorFormat: string;
  readonly depthFormat: string | null;
}

export interface RigidSectionWebGpuRenderer3D {
  readonly compute: RigidSectionWebGpuCompute3D;
  readonly centerBuffer: WebGpuBufferLike;
  readonly orientationBuffer: WebGpuBufferLike;
  render(frame: RigidSectionWebGpuRenderFrame3D): RigidSectionWebGpuRenderStats3D;
  snapshot(): RigidSectionWebGpuRendererSnapshot3D;
  destroy(): void;
}

interface WebGpuRenderPipelineLike {
  readonly label?: string;
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

function safeProduct(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`rigid-section WebGPU render estimate overflow: ${label}=${String(value)}`);
  }
  return value;
}

function materialTopology(template: RigidSectionTemplate3D): {
  readonly surface: Uint32Array;
  readonly wireframe: Uint32Array;
  readonly gradient: Float32Array;
} {
  const octahedral = getOctahedralLinkTemplate3D(template.aspectRatio);
  if (
    octahedral.octahedronCount !== template.octahedronCount
    || octahedral.vertexCount !== template.sectionCount * 3
  ) {
    throw new Error(
      `rigid/octahedral template mismatch: rigid octa=${template.octahedronCount} sections=${template.sectionCount}; octahedral octa=${octahedral.octahedronCount} vertices=${octahedral.vertexCount}`,
    );
  }
  return Object.freeze({
    surface: octahedral.surfaceTriangles,
    wireframe: buildOctahedralWireframeIndices3D(octahedral.surfaceTriangles),
    gradient: octahedral.gradientT,
  });
}

export function estimateRigidSectionWebGpuRender3D(
  linkCount: number,
  template: RigidSectionTemplate3D,
): RigidSectionWebGpuRenderEstimate3D {
  if (!Number.isSafeInteger(linkCount) || linkCount < 0) {
    throw new Error(`invalid rigid-section render linkCount: ${String(linkCount)}`);
  }
  const topology = materialTopology(template);
  const surfaceVerticesPerLink = topology.surface.length;
  return Object.freeze({
    linkCount,
    surfaceVerticesPerLink,
    centerVerticesPerLink: RIGID_SECTION_WEBGPU_CENTER_VERTICES_PER_LINK as 6,
    arrowVerticesPerLink: RIGID_SECTION_WEBGPU_ARROW_VERTICES_PER_LINK as 6,
    surfaceVertexInvocations: safeProduct(
      linkCount,
      surfaceVerticesPerLink,
      "surfaceVertexInvocations",
    ),
    centerVertexInvocations: safeProduct(
      linkCount,
      RIGID_SECTION_WEBGPU_CENTER_VERTICES_PER_LINK,
      "centerVertexInvocations",
    ),
    arrowVertexInvocations: safeProduct(
      linkCount,
      RIGID_SECTION_WEBGPU_ARROW_VERTICES_PER_LINK,
      "arrowVertexInvocations",
    ),
    drawCalls: linkCount === 0 ? 0 : 3,
    rendererDynamicStateBytes: 0 as const,
    dynamicStateUploadBytesPerFrame: 0 as const,
  });
}

export const RIGID_SECTION_WEBGPU_RENDER_WGSL = /* wgsl */ `
struct SceneUniforms {
  view_projection: mat4x4<f32>,
  counts: vec4<u32>,
  viewport: vec4<f32>,
  geometry: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> centers: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> orientations: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> surface_indices: array<u32>;
@group(0) @binding(3) var<storage, read> gradient_t: array<f32>;
@group(0) @binding(4) var<uniform> scene: SceneUniforms;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
};

fn q_normalize(q: vec4<f32>) -> vec4<f32> {
  let n = length(q);
  if (n <= 1e-12) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  return q / n;
}

fn q_rotate(q_input: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let q = q_normalize(q_input);
  let uv = cross(q.xyz, v);
  let uuv = cross(q.xyz, uv);
  return v + 2.0 * (q.w * uv + uuv);
}

fn body_index(link: u32, section: u32) -> u32 {
  return link * scene.counts.y + section;
}

fn local_triangle_vertex(corner: u32) -> vec3<f32> {
  let angle = f32(corner) * 2.0943951023931953;
  let radius = scene.geometry.x;
  return vec3<f32>(
    radius * cos(angle),
    radius * sin(angle),
    0.0,
  );
}

fn material_vertex(link: u32, local_vertex: u32) -> vec3<f32> {
  let section = local_vertex / 3u;
  let corner = local_vertex % 3u;
  let body = body_index(link, section);
  return centers[body].xyz
    + q_rotate(orientations[body], local_triangle_vertex(corner));
}

fn section_center(link: u32, section: u32) -> vec3<f32> {
  return centers[body_index(link, section)].xyz;
}

fn projected_pixel_distance(a_world: vec3<f32>, b_world: vec3<f32>) -> f32 {
  let a_clip = scene.view_projection * vec4<f32>(a_world, 1.0);
  let b_clip = scene.view_projection * vec4<f32>(b_world, 1.0);
  let a_w = select(1e-6, a_clip.w, abs(a_clip.w) > 1e-6);
  let b_w = select(1e-6, b_clip.w, abs(b_clip.w) > 1e-6);
  let a_ndc = a_clip.xy / a_w;
  let b_ndc = b_clip.xy / b_w;
  let delta_pixels = vec2<f32>(
    (a_ndc.x - b_ndc.x) * scene.viewport.x * 0.5,
    (a_ndc.y - b_ndc.y) * scene.viewport.y * 0.5,
  );
  return length(delta_pixels);
}

fn end_section_projected_diameter_pixels(link: u32) -> f32 {
  let end_section = scene.counts.y - 1u;
  let base = end_section * 3u;
  let a = material_vertex(link, base);
  let b = material_vertex(link, base + 1u);
  let c = material_vertex(link, base + 2u);
  return max(
    projected_pixel_distance(a, b),
    max(
      projected_pixel_distance(b, c),
      projected_pixel_distance(c, a),
    ),
  );
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
  let world = material_vertex(instance_index, local_vertex);
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
  let world = section_center(instance_index, scene.counts.z);
  let raw_clip = scene.view_projection * vec4<f32>(world, 1.0);
  let pixel_ndc = vec2<f32>(
    2.0 / max(scene.viewport.x, 1.0),
    2.0 / max(scene.viewport.y, 1.0),
  );
  let offset = quad_offset(vertex_index)
    * scene.viewport.z
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
  let end_section = scene.counts.y - 1u;
  let previous_section = select(0u, end_section - 1u, end_section > 0u);
  let tip_world = section_center(instance_index, end_section);
  let base_world = section_center(instance_index, previous_section);
  let tip_clip = scene.view_projection * vec4<f32>(tip_world, 1.0);
  let base_clip = scene.view_projection * vec4<f32>(base_world, 1.0);

  let tip_w = select(1e-6, tip_clip.w, abs(tip_clip.w) > 1e-6);
  let base_w = select(1e-6, base_clip.w, abs(base_clip.w) > 1e-6);
  let tip_ndc = tip_clip.xy / tip_w;
  let base_ndc = base_clip.xy / base_w;

  var direction_pixels = vec2<f32>(
    (tip_ndc.x - base_ndc.x) * scene.viewport.x * 0.5,
    (tip_ndc.y - base_ndc.y) * scene.viewport.y * 0.5,
  );
  if (dot(direction_pixels, direction_pixels) <= 1e-12) {
    direction_pixels = vec2<f32>(0.0, 1.0);
  } else {
    direction_pixels = normalize(direction_pixels);
  }

  let perpendicular = vec2<f32>(-direction_pixels.y, direction_pixels.x);
  let diameter_pixels = end_section_projected_diameter_pixels(instance_index);
  let arrow_length = max(scene.viewport.w, diameter_pixels * 3.0);
  let half_width = arrow_length * 0.55;
  let shoulder = -direction_pixels * arrow_length * 0.72;
  let tail = -direction_pixels * arrow_length * 1.15;

  var pixel_offset = vec2<f32>(0.0);
  let local = vertex_index % 6u;
  if (local == 1u) {
    pixel_offset = shoulder + perpendicular * half_width;
  } else if (local == 2u || local == 4u) {
    pixel_offset = tail;
  } else if (local == 5u) {
    pixel_offset = shoulder - perpendicular * half_width;
  }

  let offset_ndc = vec2<f32>(
    pixel_offset.x * 2.0 / max(scene.viewport.x, 1.0),
    pixel_offset.y * 2.0 / max(scene.viewport.y, 1.0),
  );

  var out: VertexOut;
  out.position = vec4<f32>(
    (tip_ndc + offset_ndc) * tip_clip.w,
    tip_clip.z,
    tip_clip.w,
  );
  out.color = vec3<f32>(0.0, 0.95, 1.0);
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
  const buffer = device.createBuffer({
    label,
    size: Math.max(4, data.byteLength),
    usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
  });
  if (data.byteLength > 0) device.queue.writeBuffer(buffer, 0, data);
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
  compute: RigidSectionWebGpuCompute3D,
  frame: RigidSectionWebGpuRenderFrame3D,
  centerMarkerPixels: number,
  arrowLengthPixels: number,
): ArrayBuffer {
  const matrix = requireViewProjection(frame.viewProjection);
  const width = requirePositiveFinite(frame.width, "render width");
  const height = requirePositiveFinite(frame.height, "render height");
  const buffer = new ArrayBuffer(RIGID_SECTION_WEBGPU_RENDER_UNIFORM_BYTES);
  const f32 = new Float32Array(buffer);
  const u32 = new Uint32Array(buffer);

  f32.set(matrix, 0);
  u32[16] = compute.topology.linkCount;
  u32[17] = compute.template.sectionCount;
  u32[18] = compute.template.centerSection;
  u32[19] = compute.template.octahedronCount;

  f32[20] = width;
  f32[21] = height;
  f32[22] = centerMarkerPixels;
  f32[23] = arrowLengthPixels;

  f32[24] = compute.template.localTriangleVertices[0]!;
  f32[25] = compute.template.moduleHeight;
  f32[26] = compute.template.diameter;
  f32[27] = 0;

  return buffer;
}

function clearColor(
  value: RigidSectionWebGpuRenderFrame3D["clearColor"],
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

class RigidSectionWebGpuRendererController
implements RigidSectionWebGpuRenderer3D {
  readonly centerBuffer: WebGpuBufferLike;
  readonly orientationBuffer: WebGpuBufferLike;

  private readonly surfaceIndicesBuffer: WebGpuBufferLike;
  private readonly wireframeIndicesBuffer: WebGpuBufferLike;
  private readonly gradientBuffer: WebGpuBufferLike;
  private readonly uniformBuffer: WebGpuBufferLike;
  private readonly surfaceBindGroup: object;
  private readonly wireframeBindGroup: object;
  private readonly surfacePipeline: WebGpuRenderPipelineLike;
  private readonly wireframePipeline: WebGpuRenderPipelineLike;
  private readonly centerPipeline: WebGpuRenderPipelineLike;
  private readonly arrowPipeline: WebGpuRenderPipelineLike;
  private destroyed = false;

  constructor(
    private readonly device: WebGpuRenderDeviceLike,
    readonly compute: RigidSectionWebGpuCompute3D,
    private readonly colorFormatValue: string,
    private readonly depthFormatValue: string | null,
    private readonly centerMarkerPixels: number,
    private readonly arrowLengthPixels: number,
    private readonly staticTemplateBytes: number,
    args: {
      surfaceIndicesBuffer: WebGpuBufferLike;
      wireframeIndicesBuffer: WebGpuBufferLike;
      gradientBuffer: WebGpuBufferLike;
      uniformBuffer: WebGpuBufferLike;
      surfaceBindGroup: object;
      wireframeBindGroup: object;
      surfacePipeline: WebGpuRenderPipelineLike;
      wireframePipeline: WebGpuRenderPipelineLike;
      centerPipeline: WebGpuRenderPipelineLike;
      arrowPipeline: WebGpuRenderPipelineLike;
    },
  ) {
    this.centerBuffer = compute.centerBuffer;
    this.orientationBuffer = compute.orientationBuffer;
    this.surfaceIndicesBuffer = args.surfaceIndicesBuffer;
    this.wireframeIndicesBuffer = args.wireframeIndicesBuffer;
    this.gradientBuffer = args.gradientBuffer;
    this.uniformBuffer = args.uniformBuffer;
    this.surfaceBindGroup = args.surfaceBindGroup;
    this.wireframeBindGroup = args.wireframeBindGroup;
    this.surfacePipeline = args.surfacePipeline;
    this.wireframePipeline = args.wireframePipeline;
    this.centerPipeline = args.centerPipeline;
    this.arrowPipeline = args.arrowPipeline;
  }

  private assertRenderable() {
    if (this.destroyed) {
      throw new Error("rigid-section WebGPU renderer is destroyed");
    }
    const snapshot = this.compute.snapshot();
    if (snapshot.status !== "available") {
      throw new Error(
        `rigid-section WebGPU compute is ${snapshot.status}: ${snapshot.deviceLostReason ?? "unavailable"}`,
      );
    }
    return snapshot;
  }

  render(frame: RigidSectionWebGpuRenderFrame3D): RigidSectionWebGpuRenderStats3D {
    const computeSnapshot = this.assertRenderable();
    if (this.depthFormatValue !== null && frame.depthView === undefined) {
      throw new Error("rigid-section WebGPU renderer requires a depthView");
    }

    const uniformData = buildUniformData(
      this.compute,
      frame,
      this.centerMarkerPixels,
      this.arrowLengthPixels,
    );
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

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
      label: "rigid-section-webgpu-zero-copy-render",
    });
    const pass = encoder.beginRenderPass(renderPassDescriptor);

    let drawCalls = 0;
    if (computeSnapshot.linkCount > 0) {
      const wireframe = frame.wireframe === true;
      pass.setBindGroup(0, wireframe ? this.wireframeBindGroup : this.surfaceBindGroup);
      pass.setPipeline(wireframe ? this.wireframePipeline : this.surfacePipeline);
      pass.draw(
        wireframe
          ? this.wireframeIndicesBuffer.size / Uint32Array.BYTES_PER_ELEMENT
          : this.surfaceIndicesBuffer.size / Uint32Array.BYTES_PER_ELEMENT,
        computeSnapshot.linkCount,
        0,
        0,
      );
      drawCalls += 1;

      pass.setBindGroup(0, this.surfaceBindGroup);
      pass.setPipeline(this.centerPipeline);
      pass.draw(RIGID_SECTION_WEBGPU_CENTER_VERTICES_PER_LINK, computeSnapshot.linkCount, 0, 0);
      drawCalls += 1;

      pass.setPipeline(this.arrowPipeline);
      pass.draw(RIGID_SECTION_WEBGPU_ARROW_VERTICES_PER_LINK, computeSnapshot.linkCount, 0, 0);
      drawCalls += 1;
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);

    const estimate = estimateRigidSectionWebGpuRender3D(
      computeSnapshot.linkCount,
      this.compute.template,
    );
    return Object.freeze({
      linkCount: computeSnapshot.linkCount,
      drawCalls,
      surfaceVertexInvocations: estimate.surfaceVertexInvocations,
      centerVertexInvocations: estimate.centerVertexInvocations,
      arrowVertexInvocations: estimate.arrowVertexInvocations,
      dynamicStateUploadBytes: 0 as const,
      controlUploadBytes: RIGID_SECTION_WEBGPU_RENDER_UNIFORM_BYTES,
      bufferCopies: 0 as const,
      readbacks: 0 as const,
    });
  }

  snapshot(): RigidSectionWebGpuRendererSnapshot3D {
    const computeSnapshot = this.compute.snapshot();
    const estimate = estimateRigidSectionWebGpuRender3D(
      computeSnapshot.linkCount,
      this.compute.template,
    );
    return Object.freeze({
      ...estimate,
      status: this.destroyed ? "destroyed" : computeSnapshot.status,
      deviceLostReason: computeSnapshot.deviceLostReason,
      wireframeVerticesPerLink:
        this.wireframeIndicesBuffer.size / Uint32Array.BYTES_PER_ELEMENT,
      sharedCenterBuffer: true as const,
      sharedOrientationBuffer: true as const,
      staticTemplateBytes: this.staticTemplateBytes,
      uniformBytes: RIGID_SECTION_WEBGPU_RENDER_UNIFORM_BYTES,
      colorFormat: this.colorFormatValue,
      depthFormat: this.depthFormatValue,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.surfaceIndicesBuffer.destroy();
    this.wireframeIndicesBuffer.destroy();
    this.gradientBuffer.destroy();
    this.uniformBuffer.destroy();
  }
}

export async function createRigidSectionWebGpuZeroCopyRenderer3D(
  device: WebGpuRenderDeviceLike,
  compute: RigidSectionWebGpuCompute3D,
  options: RigidSectionWebGpuRendererOptions3D,
): Promise<RigidSectionWebGpuRenderer3D> {
  const computeSnapshot = compute.snapshot();
  if (computeSnapshot.status !== "available") {
    throw new Error(
      `cannot create rigid-section WebGPU renderer from compute status ${computeSnapshot.status}`,
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
    options.arrowLengthPixels ?? 18,
    "arrowLengthPixels",
  );

  const topology = materialTopology(compute.template);
  const surfaceIndicesBuffer = createStorageBuffer(
    device,
    "rigid-section-render-surface-indices",
    topology.surface,
  );
  const wireframeIndicesBuffer = createStorageBuffer(
    device,
    "rigid-section-render-wireframe-indices",
    topology.wireframe,
  );
  const gradientBuffer = createStorageBuffer(
    device,
    "rigid-section-render-gradient",
    topology.gradient,
  );
  const uniformBuffer = device.createBuffer({
    label: "rigid-section-render-uniforms",
    size: RIGID_SECTION_WEBGPU_RENDER_UNIFORM_BYTES,
    usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
  });

  const module = device.createShaderModule({
    label: "rigid-section-webgpu-zero-copy-render-shader",
    code: RIGID_SECTION_WEBGPU_RENDER_WGSL,
  });
  const bindGroupLayout = device.createBindGroupLayout({
    label: "rigid-section-webgpu-zero-copy-render-layout",
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
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 4,
        visibility: GPU_SHADER_STAGE.VERTEX,
        buffer: { type: "uniform" },
      },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: "rigid-section-webgpu-zero-copy-render-pipeline-layout",
    bindGroupLayouts: [bindGroupLayout],
  });

  const pipelineDescriptor = (
    label: string,
    entryPoint: string,
    topologyMode: "triangle-list" | "line-list" = "triangle-list",
  ): Parameters<WebGpuRenderDeviceLike["createRenderPipelineAsync"]>[0] => {
    const descriptor = {
      label,
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint,
      },
      fragment: {
        module,
        entryPoint: "fragment_main",
        targets: [{ format: colorFormat }],
      },
      primitive: {
        topology: topologyMode,
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

  const [
    surfacePipeline,
    wireframePipeline,
    centerPipeline,
    arrowPipeline,
  ] = await Promise.all([
    device.createRenderPipelineAsync(
      pipelineDescriptor("rigid-section-webgpu-surface-pipeline", "surface_vertex"),
    ),
    device.createRenderPipelineAsync(
      pipelineDescriptor(
        "rigid-section-webgpu-wireframe-pipeline",
        "surface_vertex",
        "line-list",
      ),
    ),
    device.createRenderPipelineAsync(
      pipelineDescriptor("rigid-section-webgpu-center-pipeline", "center_vertex"),
    ),
    device.createRenderPipelineAsync(
      pipelineDescriptor("rigid-section-webgpu-arrow-pipeline", "arrow_vertex"),
    ),
  ]);

  const surfaceBindGroup = device.createBindGroup({
    label: "rigid-section-webgpu-zero-copy-render-bind-group",
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: compute.centerBuffer } },
      { binding: 1, resource: { buffer: compute.orientationBuffer } },
      { binding: 2, resource: { buffer: surfaceIndicesBuffer } },
      { binding: 3, resource: { buffer: gradientBuffer } },
      { binding: 4, resource: { buffer: uniformBuffer } },
    ],
  });
  const wireframeBindGroup = device.createBindGroup({
    label: "rigid-section-webgpu-wireframe-render-bind-group",
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: compute.centerBuffer } },
      { binding: 1, resource: { buffer: compute.orientationBuffer } },
      { binding: 2, resource: { buffer: wireframeIndicesBuffer } },
      { binding: 3, resource: { buffer: gradientBuffer } },
      { binding: 4, resource: { buffer: uniformBuffer } },
    ],
  });

  return new RigidSectionWebGpuRendererController(
    device,
    compute,
    colorFormat,
    depthFormat,
    centerMarkerPixels,
    arrowLengthPixels,
    topology.surface.byteLength + topology.wireframe.byteLength + topology.gradient.byteLength,
    {
      surfaceIndicesBuffer,
      wireframeIndicesBuffer,
      gradientBuffer,
      uniformBuffer,
      surfaceBindGroup,
      wireframeBindGroup,
      surfacePipeline,
      wireframePipeline,
      centerPipeline,
      arrowPipeline,
    },
  );
}
