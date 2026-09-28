import {
  getOctahedralLinkTemplate3D,
  OCTAHEDRAL_TRIANGLE_RADIUS,
} from "../octahedral-link3d.js";
import type {
  MonolithicLinkWebGpuCompute3D,
} from "./monolithic-link-compute.js";
import type {
  MonolithicLinkWebGpuShape3D,
} from "./monolithic-link-shape.js";
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

const GPU_SHADER_STAGE_VERTEX = 0x0001;
const GPU_SHADER_STAGE_FRAGMENT = 0x0002;
const RENDER_UNIFORM_BYTES = 128;
const CENTER_L2_TRIANGLE_COUNT = 80;
const CENTER_VERTEX_COUNT = CENTER_L2_TRIANGLE_COUNT * 3 * 2;
const END_CONE_SEGMENT_COUNT = 12;
const END_CONE_VERTEX_COUNT = END_CONE_SEGMENT_COUNT * 4;

export interface MonolithicLinkWebGpuRenderFrame3D
extends OctahedralWebGpuRenderFrame3D {
  readonly showCenterMarkers?: boolean;
  readonly showEndCones?: boolean;
  readonly centerMarkerScale?: number;
  readonly endConeScale?: number;
  readonly hoveredCenterLink?: number | null;
  readonly smoothNormals?: boolean;
}

export interface MonolithicLinkWebGpuRendererOptions3D {
  readonly colorFormat: string;
  readonly depthFormat?: string;
}

export interface MonolithicLinkWebGpuRenderStats3D {
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

export interface MonolithicLinkWebGpuRendererSnapshot3D {
  readonly status: "available" | "destroyed";
  readonly linkCount: number;
  readonly octahedronCount: number;
  readonly sectionCount: number;
  readonly surfaceVerticesPerLink: number;
  readonly wireframeVerticesPerLink: number;
  readonly sharedSemanticCenterBuffer: true;
  readonly sharedShapeParameterBuffer: true;
  readonly rendererDynamicStateBytes: 0;
  readonly dynamicStateUploadBytesPerFrame: 0;
  readonly staticTemplateBytes: number;
  readonly uniformBytes: number;
  readonly colorFormat: string;
  readonly depthFormat: string | null;
}

export interface MonolithicLinkWebGpuRenderer3D {
  readonly compute: MonolithicLinkWebGpuCompute3D;
  readonly shape: MonolithicLinkWebGpuShape3D;
  readonly semanticCenterBuffer: WebGpuBufferLike;
  readonly shapeParameterBuffer: WebGpuBufferLike;
  readonly shapeGaugeBuffer: WebGpuBufferLike;
  readonly shapeSectionFrameBuffer: WebGpuBufferLike;
  render(
    frame: MonolithicLinkWebGpuRenderFrame3D,
  ): MonolithicLinkWebGpuRenderStats3D;
  snapshot(): MonolithicLinkWebGpuRendererSnapshot3D;
  destroy(): void;
}

interface WebGpuRenderPipelineLike {
  readonly label?: string;
}

function requireFormat(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("invalid " + name + ": " + String(value));
  }
  return value;
}

function requirePositiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("invalid " + name + ": " + String(value));
  }
  return value;
}

function requireViewProjection(
  value: readonly number[] | Float32Array,
): Float32Array {
  if (value.length !== 16) {
    throw new Error("invalid viewProjection length: " + value.length);
  }
  const result = new Float32Array(16);
  for (let index = 0; index < 16; index += 1) {
    const component = value[index]!;
    if (!Number.isFinite(component)) {
      throw new Error(
        "non-finite viewProjection[" + index + "]",
      );
    }
    result[index] = component;
  }
  return result;
}

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
  if (data.byteLength > 0) {
    device.queue.writeBuffer(buffer, 0, data);
  }
  return buffer;
}

function packedTopology(
  compute: MonolithicLinkWebGpuCompute3D,
): Uint32Array {
  const result = new Uint32Array(compute.topology.linkCount * 2);
  for (let link = 0; link < compute.topology.linkCount; link += 1) {
    result[link * 2] = compute.topology.startIndices[link]!;
    result[link * 2 + 1] = compute.topology.endIndices[link]!;
  }
  return result;
}

function clearColor(
  value: MonolithicLinkWebGpuRenderFrame3D["clearColor"],
): { r: number; g: number; b: number; a: number } {
  const selected = value ?? { r: 0, g: 0, b: 0, a: 1 };
  for (const [name, component] of Object.entries(selected)) {
    if (!Number.isFinite(component)) {
      throw new Error(
        "invalid clearColor." + name + ": " + String(component),
      );
    }
  }
  return {
    r: selected.r,
    g: selected.g,
    b: selected.b,
    a: selected.a,
  };
}

function buildUniformData(
  compute: MonolithicLinkWebGpuCompute3D,
  shape: MonolithicLinkWebGpuShape3D,
  frame: MonolithicLinkWebGpuRenderFrame3D,
): ArrayBuffer {
  const matrix = requireViewProjection(frame.viewProjection);
  const width = requirePositiveFinite(frame.width, "render width");
  const height = requirePositiveFinite(frame.height, "render height");
  const buffer = new ArrayBuffer(RENDER_UNIFORM_BYTES);
  const f32 = new Float32Array(buffer);
  const u32 = new Uint32Array(buffer);

  f32.set(matrix, 0);
  u32[16] = compute.topology.linkCount;
  u32[17] = shape.template.octahedronCount;
  u32[18] = shape.template.octahedronCount / 2;
  u32[19] = shape.template.octahedronCount + 1;

  f32[20] = width;
  f32[21] = height;
  f32[22] = requirePositiveFinite(
    frame.centerMarkerScale ?? 1,
    "centerMarkerScale",
  );
  f32[23] = requirePositiveFinite(
    frame.endConeScale ?? 1,
    "endConeScale",
  );

  f32[24] = OCTAHEDRAL_TRIANGLE_RADIUS;
  f32[25] = shape.template.edgeRestLength;
  f32[26] = shape.template.restLength;
  f32[27] = shape.template.halfRestLength;

  f32[28] = shape.template.halfRestLength / 8.448334738583334;
  f32[29] = frame.smoothNormals === false ? 0 : 1;
  f32[30] = 0;
  f32[31] = 0;
  return buffer;
}

export const MONOLITHIC_LINK_WEBGPU_RENDER_WGSL = /* wgsl */ `
const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;

const CENTER_ICO_VERTICES: array<vec3<f32>, 12> = array<vec3<f32>, 12>(
  vec3<f32>(-0.5257311121, 0.8506508084, 0.0),
  vec3<f32>(0.5257311121, 0.8506508084, 0.0),
  vec3<f32>(-0.5257311121, -0.8506508084, 0.0),
  vec3<f32>(0.5257311121, -0.8506508084, 0.0),
  vec3<f32>(0.0, -0.5257311121, 0.8506508084),
  vec3<f32>(0.0, 0.5257311121, 0.8506508084),
  vec3<f32>(0.0, -0.5257311121, -0.8506508084),
  vec3<f32>(0.0, 0.5257311121, -0.8506508084),
  vec3<f32>(0.8506508084, 0.0, -0.5257311121),
  vec3<f32>(0.8506508084, 0.0, 0.5257311121),
  vec3<f32>(-0.8506508084, 0.0, -0.5257311121),
  vec3<f32>(-0.8506508084, 0.0, 0.5257311121)
);

const CENTER_ICO_FACES: array<vec3<u32>, 20> = array<vec3<u32>, 20>(
  vec3<u32>(0u, 11u, 5u),
  vec3<u32>(0u, 5u, 1u),
  vec3<u32>(0u, 1u, 7u),
  vec3<u32>(0u, 7u, 10u),
  vec3<u32>(0u, 10u, 11u),
  vec3<u32>(1u, 5u, 9u),
  vec3<u32>(5u, 11u, 4u),
  vec3<u32>(11u, 10u, 2u),
  vec3<u32>(10u, 7u, 6u),
  vec3<u32>(7u, 1u, 8u),
  vec3<u32>(3u, 9u, 4u),
  vec3<u32>(3u, 4u, 2u),
  vec3<u32>(3u, 2u, 6u),
  vec3<u32>(3u, 6u, 8u),
  vec3<u32>(3u, 8u, 9u),
  vec3<u32>(4u, 9u, 5u),
  vec3<u32>(2u, 4u, 11u),
  vec3<u32>(6u, 2u, 10u),
  vec3<u32>(8u, 6u, 7u),
  vec3<u32>(9u, 8u, 1u)
);

struct SceneUniforms {
  view_projection: mat4x4<f32>,
  counts: vec4<u32>,
  viewport: vec4<f32>,
  geometry: vec4<f32>,
  shape: vec4<f32>,
};

struct AxisFrame {
  x: vec3<f32>,
  y: vec3<f32>,
  z: vec3<f32>,
};

struct ShapeSample {
  point: vec3<f32>,
  tangent: vec3<f32>,
};

@group(0) @binding(0) var<storage, read> semantic_centers: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> shape_parameters: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> roll_gauge: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> section_frames: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> topology_data: array<u32>;
@group(0) @binding(5) var<storage, read> surface_indices: array<u32>;
@group(0) @binding(6) var<storage, read> gradient_t: array<f32>;
@group(0) @binding(7) var<uniform> scene: SceneUniforms;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) world_position: vec3<f32>,
  @location(2) smooth_normal: vec3<f32>,
};

fn safe_normalize(value: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> {
  let n = length(value);
  if (n <= 1e-8) {
    return fallback;
  }
  return value / n;
}

fn deterministic_frame(link: u32) -> AxisFrame {
  let angle = f32(link) * 0.7548776662466927;
  let z = safe_normalize(
    vec3<f32>(
      cos(angle),
      0.35 + 0.1 * sin(angle * 1.7),
      sin(angle),
    ),
    vec3<f32>(0.0, 0.0, 1.0),
  );
  var helper = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(z.y) >= 0.9) {
    helper = vec3<f32>(1.0, 0.0, 0.0);
  }
  let x = safe_normalize(
    cross(helper, z),
    vec3<f32>(1.0, 0.0, 0.0),
  );
  let y = safe_normalize(
    cross(z, x),
    vec3<f32>(0.0, 1.0, 0.0),
  );
  return AxisFrame(x, y, z);
}

fn deterministic_perpendicular(
  direction: vec3<f32>,
  link: u32,
) -> vec3<f32> {
  let frame = deterministic_frame(link);
  var candidate = frame.x;
  var alignment = abs(dot(candidate, direction));
  let y_alignment = abs(dot(frame.y, direction));
  if (y_alignment < alignment) {
    candidate = frame.y;
    alignment = y_alignment;
  }
  let z_alignment = abs(dot(frame.z, direction));
  if (z_alignment < alignment) {
    candidate = frame.z;
  }
  return safe_normalize(
    candidate - direction * dot(candidate, direction),
    frame.x,
  );
}

fn hermite_point(
  start: vec3<f32>,
  finish: vec3<f32>,
  start_tangent: vec3<f32>,
  end_tangent: vec3<f32>,
  t: f32,
) -> vec3<f32> {
  let t2 = t * t;
  let t3 = t2 * t;
  let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
  let h10 = t3 - 2.0 * t2 + t;
  let h01 = -2.0 * t3 + 3.0 * t2;
  let h11 = t3 - t2;
  return
    start * h00
    + start_tangent * h10
    + finish * h01
    + end_tangent * h11;
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

fn buckling_basis(t: f32) -> f32 {
  let one_minus = 1.0 - t;
  return 64.0
    * t * t * t
    * one_minus * one_minus * one_minus;
}

fn buckling_basis_derivative(t: f32) -> f32 {
  let one_minus = 1.0 - t;
  return 192.0
    * t * t
    * one_minus * one_minus
    * (1.0 - 2.0 * t);
}

fn self_loop_base_point(t: f32) -> vec3<f32> {
  let theta = TAU * t;
  let sine = sin(theta);
  let one_minus_cos = 1.0 - cos(theta);
  let hinge_opening = PI * t * (1.0 - t);
  return vec3<f32>(
    0.60 * one_minus_cos * one_minus_cos + hinge_opening,
    0.35 * sine * one_minus_cos,
    sine,
  );
}

fn self_loop_base_derivative(t: f32) -> vec3<f32> {
  let theta = TAU * t;
  let sine = sin(theta);
  let cosine = cos(theta);
  let one_minus_cos = 1.0 - cosine;
  return vec3<f32>(
    1.20 * one_minus_cos * sine * TAU
      + PI * (1.0 - 2.0 * t),
    0.35 * (cosine * one_minus_cos + sine * sine) * TAU,
    cosine * TAU,
  );
}

fn self_sample(
  anchor: vec3<f32>,
  link: u32,
  t: f32,
  lobe_sign: f32,
) -> ShapeSample {
  let frame = deterministic_frame(link);
  let base = self_loop_base_point(t);
  let derivative = self_loop_base_derivative(t);
  let scale = scene.shape.x;
  let point = anchor
    + frame.z * (scale * base.z)
    + frame.x * (lobe_sign * scale * base.x)
    + frame.y * (lobe_sign * scale * base.y);
  let tangent =
    frame.z * (scale * derivative.z)
    + frame.x * (lobe_sign * scale * derivative.x)
    + frame.y * (lobe_sign * scale * derivative.y);
  return ShapeSample(point, tangent);
}

fn ordinary_sample(
  start: vec3<f32>,
  finish: vec3<f32>,
  start_direction: vec3<f32>,
  end_direction: vec3<f32>,
  bend_direction: vec3<f32>,
  amplitude: f32,
  t: f32,
) -> ShapeSample {
  let chord_length = length(finish - start);
  let tangent_scale = max(chord_length, scene.geometry.w * 0.25);
  let start_tangent = start_direction * tangent_scale;
  let end_tangent = end_direction * tangent_scale;
  let point = hermite_point(
    start,
    finish,
    start_tangent,
    end_tangent,
    t,
  ) + bend_direction * (amplitude * buckling_basis(t));
  let tangent = hermite_derivative(
    start,
    finish,
    start_tangent,
    end_tangent,
    t,
  ) + bend_direction * (amplitude * buckling_basis_derivative(t));
  return ShapeSample(point, tangent);
}

fn sample_section(link: u32, section: u32) -> ShapeSample {
  let descriptor = section_frames[link * scene.counts.w + section];
  let t = descriptor.w;
  let start_index = topology_data[link * 2u];
  let end_index = topology_data[link * 2u + 1u];
  let s = semantic_centers[start_index].xyz;
  let c = semantic_centers[link].xyz;
  let e = semantic_centers[end_index].xyz;
  let params = shape_parameters[link];

  let first_chord = c - s;
  let second_chord = e - c;
  let seed = deterministic_frame(link).z;
  let first_direction = safe_normalize(first_chord, seed);
  let second_direction = safe_normalize(second_chord, first_direction);
  let overall = safe_normalize(e - s, first_direction);
  var shared_direction = safe_normalize(
    first_direction + second_direction,
    overall,
  );
  if (params.z > 0.5 && params.w <= 0.5) {
    shared_direction = second_direction;
  } else if (params.w > 0.5 && params.z <= 0.5) {
    shared_direction = first_direction;
  }
  let bend = safe_normalize(
    roll_gauge[link].xyz,
    deterministic_perpendicular(overall, link),
  );

  if (section <= scene.counts.z) {
    if (params.z > 0.5) {
      return self_sample(s, link, t, -1.0);
    }
    return ordinary_sample(
      s,
      c,
      first_direction,
      shared_direction,
      bend,
      params.x,
      t,
    );
  }

  if (params.w > 0.5) {
    return self_sample(c, link, t, 1.0);
  }
  return ordinary_sample(
    c,
    e,
    shared_direction,
    second_direction,
    bend,
    params.y,
    t,
  );
}

fn section_axes(
  link: u32,
  section: u32,
) -> AxisFrame {
  let sample = sample_section(link, section);
  let tangent = safe_normalize(
    sample.tangent,
    deterministic_frame(link).z,
  );
  let stored_x = section_frames[
    link * scene.counts.w + section
  ].xyz;
  var x = safe_normalize(
    stored_x - tangent * dot(stored_x, tangent),
    deterministic_perpendicular(tangent, link + section),
  );
  var y = safe_normalize(
    cross(tangent, x),
    deterministic_frame(link).y,
  );
  x = safe_normalize(cross(y, tangent), x);

  // Canonical labeled octahedral sections alternate 0/60 degrees.
  // Cumulative 60-degree twist would cyclically relabel triangle corners.
  let twist = select(0.0, PI / 3.0, (section & 1u) == 1u);
  let cosine = cos(twist);
  let sine = sin(twist);
  let twisted_x = x * cosine + y * sine;
  let twisted_y = y * cosine - x * sine;
  return AxisFrame(twisted_x, twisted_y, tangent);
}

fn material_vertex(link: u32, local_vertex: u32) -> vec3<f32> {
  let section = local_vertex / 3u;
  let corner = local_vertex % 3u;
  let sample = sample_section(link, section);
  let axes = section_axes(link, section);
  let angle = f32(corner) * 2.0943951023931953;
  return sample.point
    + axes.x * (scene.geometry.x * cos(angle))
    + axes.y * (scene.geometry.x * sin(angle));
}

fn section_center(link: u32, section: u32) -> vec3<f32> {
  return sample_section(link, section).point;
}

fn link_gradient(t_value: f32) -> vec3<f32> {
  let t = clamp(t_value, 0.0, 1.0);
  if (t <= 0.5) {
    let u = t * 2.0;
    return vec3<f32>(1.0 - u, u, 0.0);
  }
  let u = (t - 0.5) * 2.0;
  return vec3<f32>(0.0, 1.0 - u, u);
}

@vertex
fn surface_vertex(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> VertexOut {
  let local_vertex = surface_indices[vertex_index];
  let section = local_vertex / 3u;
  let world = material_vertex(instance_index, local_vertex);
  let center = section_center(instance_index, section);
  let t = clamp(gradient_t[local_vertex], 0.0, 1.0);

  var out: VertexOut;
  out.position = scene.view_projection * vec4<f32>(world, 1.0);
  out.color = link_gradient(t);
  out.world_position = world;
  out.smooth_normal = safe_normalize(
    world - center,
    section_axes(instance_index, section).x,
  );
  return out;
}

fn center_ico_child_vertex(
  face_index: u32,
  child_index: u32,
  corner_index: u32,
) -> vec3<f32> {
  let face = CENTER_ICO_FACES[face_index];
  let v0 = CENTER_ICO_VERTICES[face.x];
  let v1 = CENTER_ICO_VERTICES[face.y];
  let v2 = CENTER_ICO_VERTICES[face.z];
  let m01 = safe_normalize(v0 + v1, v0);
  let m12 = safe_normalize(v1 + v2, v1);
  let m20 = safe_normalize(v2 + v0, v2);

  var a = v0;
  var b = m01;
  var c = m20;
  if (child_index == 1u) {
    a = m01;
    b = v1;
    c = m12;
  } else if (child_index == 2u) {
    a = m20;
    b = m12;
    c = v2;
  } else if (child_index == 3u) {
    a = m01;
    b = m12;
    c = m20;
  }

  if (corner_index == 0u) {
    return a;
  }
  if (corner_index == 1u) {
    return b;
  }
  return c;
}

@vertex
fn center_vertex(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> VertexOut {
  let line_index = vertex_index / 2u;
  let endpoint = vertex_index & 1u;
  let child_triangle = line_index / 3u;
  let edge_index = line_index % 3u;
  let face_index = child_triangle / 4u;
  let child_index = child_triangle % 4u;

  var corner0 = 0u;
  var corner1 = 1u;
  if (edge_index == 1u) {
    corner0 = 1u;
    corner1 = 2u;
  } else if (edge_index == 2u) {
    corner0 = 2u;
    corner1 = 0u;
  }

  let unit = center_ico_child_vertex(
    face_index,
    child_index,
    select(corner0, corner1, endpoint == 1u),
  );
  let center = semantic_centers[instance_index].xyz;
  // Icosahedron diameter = 2 * octahedron diameter.
  // scene.geometry.x is the octahedron radius, so the handle radius is
  // exactly one octahedron diameter.
  let radius = 2.0 * scene.geometry.x * scene.viewport.z;
  let world = center + unit * radius;

  var out: VertexOut;
  out.position = scene.view_projection * vec4<f32>(world, 1.0);
  out.color = vec3<f32>(0.15, 1.0, 0.3);
  out.world_position = world;
  out.smooth_normal = unit;
  return out;
}

@vertex
fn arrow_vertex(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> VertexOut {
  let end_section = scene.counts.y;
  let lower_section = select(0u, end_section - 1u, end_section > 0u);
  let tip = section_center(instance_index, end_section);
  let lower_center = section_center(instance_index, lower_section);
  let axis = safe_normalize(
    tip - lower_center,
    vec3<f32>(0.0, 0.0, 1.0),
  );

  var reference = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(axis.y) > 0.9) {
    reference = vec3<f32>(1.0, 0.0, 0.0);
  }
  let tangent = safe_normalize(
    cross(axis, reference),
    vec3<f32>(1.0, 0.0, 0.0),
  );
  let bitangent = cross(axis, tangent);

  let marker_scale = scene.viewport.w;
  // Octahedron diameter = 2 * scene.geometry.x.
  // Cone diameter = 2 * octahedron diameter => radius = 2 * geometry.x.
  // Cone length = 2 * cone diameter => length = 8 * geometry.x.
  let base_radius = 2.0 * scene.geometry.x * marker_scale;
  let height = 8.0 * scene.geometry.x * marker_scale;
  let base_center = tip - axis * height;

  let segment = vertex_index / 4u;
  let local = vertex_index % 4u;
  let segment_count = 12.0;
  let angle0 = TAU * f32(segment) / segment_count;
  let angle1 = TAU * f32(segment + 1u) / segment_count;
  let base0 = base_center
    + tangent * (cos(angle0) * base_radius)
    + bitangent * (sin(angle0) * base_radius);
  let base1 = base_center
    + tangent * (cos(angle1) * base_radius)
    + bitangent * (sin(angle1) * base_radius);

  // Four vertices per segment form two line-list edges:
  // tip -> base0 and base0 -> base1.
  var world = tip;
  if (local == 1u || local == 2u) {
    world = base0;
  } else if (local == 3u) {
    world = base1;
  }

  var out: VertexOut;
  out.position = scene.view_projection * vec4<f32>(world, 1.0);
  out.color = vec3<f32>(0.0, 0.8, 1.0);
  out.world_position = world;
  out.smooth_normal = axis;
  return out;
}

@fragment
fn fragment_surface(input: VertexOut) -> @location(0) vec4<f32> {
  var normal = safe_normalize(
    input.smooth_normal,
    vec3<f32>(0.0, 1.0, 0.0),
  );
  if (scene.shape.y < 0.5) {
    var flat = safe_normalize(
      cross(dpdx(input.world_position), dpdy(input.world_position)),
      normal,
    );
    if (dot(flat, normal) < 0.0) {
      flat = -flat;
    }
    normal = flat;
  }

  let light = safe_normalize(
    vec3<f32>(0.45, 0.8, 0.55),
    vec3<f32>(0.0, 1.0, 0.0),
  );
  let diffuse = 0.28 + 0.72 * max(0.0, dot(normal, light));
  return vec4<f32>(input.color * diffuse, 1.0);
}

@fragment
fn fragment_unlit(input: VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color, 1.0);
}
`;

class MonolithicLinkWebGpuRendererController
implements MonolithicLinkWebGpuRenderer3D {
  readonly semanticCenterBuffer: WebGpuBufferLike;
  readonly shapeParameterBuffer: WebGpuBufferLike;
  readonly shapeGaugeBuffer: WebGpuBufferLike;
  readonly shapeSectionFrameBuffer: WebGpuBufferLike;

  private readonly topologyBuffer: WebGpuBufferLike;
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
    readonly compute: MonolithicLinkWebGpuCompute3D,
    readonly shape: MonolithicLinkWebGpuShape3D,
    private readonly colorFormatValue: string,
    private readonly depthFormatValue: string | null,
    private readonly staticTemplateBytes: number,
    args: {
      topologyBuffer: WebGpuBufferLike;
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
    this.semanticCenterBuffer = compute.centerBuffer;
    this.shapeParameterBuffer = shape.parameterBuffer;
    this.shapeGaugeBuffer = shape.gaugeBuffer;
    this.shapeSectionFrameBuffer = shape.sectionFrameBuffer;
    this.topologyBuffer = args.topologyBuffer;
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

  private assertRenderable(): void {
    if (this.destroyed) {
      throw new Error("monolithic Link renderer is destroyed");
    }
    if (this.compute.snapshot().status !== "available") {
      throw new Error("monolithic Link compute is unavailable");
    }
    if (this.shape.snapshot().status !== "available") {
      throw new Error("monolithic Link shape is unavailable");
    }
  }

  render(
    frame: MonolithicLinkWebGpuRenderFrame3D,
  ): MonolithicLinkWebGpuRenderStats3D {
    this.assertRenderable();
    if (
      this.depthFormatValue !== null
      && frame.depthView === undefined
    ) {
      throw new Error(
        "monolithic Link renderer requires a depthView",
      );
    }

    const uniformData = buildUniformData(
      this.compute,
      this.shape,
      frame,
    );
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      uniformData,
    );

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
      label: "monolithic-link-zero-copy-render",
    });
    const pass = encoder.beginRenderPass(renderPassDescriptor);

    const linkCount = this.compute.topology.linkCount;
    let drawCalls = 0;
    if (linkCount > 0) {
      const wireframe = frame.wireframe === true;
      const hoveredCenterLink =
        frame.hoveredCenterLink ?? -1;
      const showHoveredCenter =
        frame.showCenterMarkers !== false
        && Number.isSafeInteger(hoveredCenterLink)
        && hoveredCenterLink >= 0
        && hoveredCenterLink < linkCount;
      pass.setBindGroup(
        0,
        wireframe
          ? this.wireframeBindGroup
          : this.surfaceBindGroup,
      );
      pass.setPipeline(
        wireframe
          ? this.wireframePipeline
          : this.surfacePipeline,
      );
      pass.draw(
        wireframe
          ? this.wireframeIndicesBuffer.size
            / Uint32Array.BYTES_PER_ELEMENT
          : this.surfaceIndicesBuffer.size
            / Uint32Array.BYTES_PER_ELEMENT,
        linkCount,
        0,
        0,
      );
      drawCalls += 1;

      pass.setBindGroup(0, this.surfaceBindGroup);
      if (showHoveredCenter) {
        pass.setPipeline(this.centerPipeline);
        pass.draw(CENTER_VERTEX_COUNT, 1, 0, hoveredCenterLink);
        drawCalls += 1;
      }
      if (frame.showEndCones !== false) {
        pass.setPipeline(this.arrowPipeline);
        pass.draw(END_CONE_VERTEX_COUNT, linkCount, 0, 0);
        drawCalls += 1;
      }
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);

    const surfaceVerticesPerLink =
      this.surfaceIndicesBuffer.size
      / Uint32Array.BYTES_PER_ELEMENT;
    return Object.freeze({
      linkCount,
      drawCalls,
      surfaceVertexInvocations:
        surfaceVerticesPerLink * linkCount,
      centerVertexInvocations:
        frame.showCenterMarkers === false
          || frame.hoveredCenterLink === undefined
          || frame.hoveredCenterLink === null
          || frame.hoveredCenterLink < 0
          || frame.hoveredCenterLink >= linkCount
          ? 0
          : CENTER_VERTEX_COUNT,
      arrowVertexInvocations:
        frame.showEndCones === false
          ? 0
          : END_CONE_VERTEX_COUNT * linkCount,
      dynamicStateUploadBytes: 0 as const,
      controlUploadBytes: RENDER_UNIFORM_BYTES,
      bufferCopies: 0 as const,
      readbacks: 0 as const,
    });
  }

  snapshot(): MonolithicLinkWebGpuRendererSnapshot3D {
    const linkCount = this.compute.topology.linkCount;
    return Object.freeze({
      status: this.destroyed ? "destroyed" : "available",
      linkCount,
      octahedronCount: this.shape.template.octahedronCount,
      sectionCount: this.shape.template.octahedronCount + 1,
      surfaceVerticesPerLink:
        this.surfaceIndicesBuffer.size
        / Uint32Array.BYTES_PER_ELEMENT,
      wireframeVerticesPerLink:
        this.wireframeIndicesBuffer.size
        / Uint32Array.BYTES_PER_ELEMENT,
      sharedSemanticCenterBuffer: true as const,
      sharedShapeParameterBuffer: true as const,
      rendererDynamicStateBytes: 0 as const,
      dynamicStateUploadBytesPerFrame: 0 as const,
      staticTemplateBytes: this.staticTemplateBytes,
      uniformBytes: RENDER_UNIFORM_BYTES,
      colorFormat: this.colorFormatValue,
      depthFormat: this.depthFormatValue,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.topologyBuffer.destroy();
    this.surfaceIndicesBuffer.destroy();
    this.wireframeIndicesBuffer.destroy();
    this.gradientBuffer.destroy();
    this.uniformBuffer.destroy();
  }
}

export async function createMonolithicLinkWebGpuZeroCopyRenderer3D(
  device: WebGpuRenderDeviceLike,
  compute: MonolithicLinkWebGpuCompute3D,
  shape: MonolithicLinkWebGpuShape3D,
  options: MonolithicLinkWebGpuRendererOptions3D,
): Promise<MonolithicLinkWebGpuRenderer3D> {
  if (compute.snapshot().status !== "available") {
    throw new Error(
      "cannot create renderer from unavailable monolithic compute",
    );
  }
  if (shape.snapshot().status !== "available") {
    throw new Error(
      "cannot create renderer from unavailable monolithic shape",
    );
  }
  if (shape.compute !== compute) {
    throw new Error(
      "monolithic renderer shape/compute identity mismatch",
    );
  }

  const colorFormat = requireFormat(
    options.colorFormat,
    "colorFormat",
  );
  const depthFormat = options.depthFormat === undefined
    ? null
    : requireFormat(options.depthFormat, "depthFormat");

  const octahedral = getOctahedralLinkTemplate3D(
    shape.template.aspectRatio,
  );
  if (
    octahedral.octahedronCount
    !== shape.template.octahedronCount
  ) {
    throw new Error(
      "monolithic renderer octahedral template mismatch",
    );
  }

  const wireframe = buildOctahedralWireframeIndices3D(
    octahedral.surfaceTriangles,
  );
  const topology = packedTopology(compute);

  const topologyBuffer = createStorageBuffer(
    device,
    "monolithic-render-topology",
    topology,
  );
  const surfaceIndicesBuffer = createStorageBuffer(
    device,
    "monolithic-render-surface-indices",
    octahedral.surfaceTriangles,
  );
  const wireframeIndicesBuffer = createStorageBuffer(
    device,
    "monolithic-render-wireframe-indices",
    wireframe,
  );
  const gradientBuffer = createStorageBuffer(
    device,
    "monolithic-render-gradient",
    octahedral.gradientT,
  );
  const uniformBuffer = device.createBuffer({
    label: "monolithic-render-uniforms",
    size: RENDER_UNIFORM_BYTES,
    usage: GPU_BUFFER_USAGE.UNIFORM
      | GPU_BUFFER_USAGE.COPY_DST,
  });

  const module = device.createShaderModule({
    label: "monolithic-link-render-shader",
    code: MONOLITHIC_LINK_WEBGPU_RENDER_WGSL,
  }) as object & {
    getCompilationInfo?(): Promise<{
      readonly messages: readonly {
        readonly type?: string;
        readonly message: string;
        readonly lineNum?: number;
        readonly linePos?: number;
      }[];
    }>;
  };
  if (typeof module.getCompilationInfo === "function") {
    const compilation = await module.getCompilationInfo();
    const errors = compilation.messages.filter(
      (message) => message.type === "error",
    );
    if (errors.length > 0) {
      throw new Error(
        "monolithic render WGSL compilation failed:\n"
        + errors.map((message) =>
          "- "
          + String(message.lineNum ?? "?")
          + ":"
          + String(message.linePos ?? "?")
          + " "
          + message.message
        ).join("\n"),
      );
    }
  }

  const bindGroupLayout = device.createBindGroupLayout({
    label: "monolithic-link-render-layout",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE_VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 1,
        visibility: GPU_SHADER_STAGE_VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 2,
        visibility: GPU_SHADER_STAGE_VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 3,
        visibility: GPU_SHADER_STAGE_VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 4,
        visibility: GPU_SHADER_STAGE_VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 5,
        visibility: GPU_SHADER_STAGE_VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 6,
        visibility: GPU_SHADER_STAGE_VERTEX,
        buffer: { type: "read-only-storage" },
      },
      {
        binding: 7,
        visibility:
          GPU_SHADER_STAGE_VERTEX
          | GPU_SHADER_STAGE_FRAGMENT,
        buffer: { type: "uniform" },
      },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: "monolithic-link-render-pipeline-layout",
    bindGroupLayouts: [bindGroupLayout],
  });

  const pipelineDescriptor = (
    label: string,
    entryPoint: string,
    topologyMode: "triangle-list" | "line-list" =
      "triangle-list",
    overlay = false,
    fragmentEntryPoint = "fragment_unlit",
  ): Parameters<
    WebGpuRenderDeviceLike["createRenderPipelineAsync"]
  >[0] => {
    const descriptor = {
      label,
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint,
      },
      fragment: {
        module,
        entryPoint: fragmentEntryPoint,
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
        depthWriteEnabled: !overlay,
        depthCompare: overlay ? "always" : "less-equal",
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
      pipelineDescriptor(
        "monolithic-link-surface-pipeline",
        "surface_vertex",
        "triangle-list",
        false,
        "fragment_surface",
      ),
    ),
    device.createRenderPipelineAsync(
      pipelineDescriptor(
        "monolithic-link-wireframe-pipeline",
        "surface_vertex",
        "line-list",
      ),
    ),
    device.createRenderPipelineAsync(
      pipelineDescriptor(
        "monolithic-link-center-pipeline",
        "center_vertex",
        "line-list",
        true,
      ),
    ),
    device.createRenderPipelineAsync(
      pipelineDescriptor(
        "monolithic-link-arrow-pipeline",
        "arrow_vertex",
        "line-list",
        true,
      ),
    ),
  ]);

  const commonEntries = [
    {
      binding: 0,
      resource: { buffer: compute.centerBuffer },
    },
    {
      binding: 1,
      resource: { buffer: shape.parameterBuffer },
    },
    {
      binding: 2,
      resource: { buffer: shape.gaugeBuffer },
    },
    {
      binding: 3,
      resource: { buffer: shape.sectionFrameBuffer },
    },
    {
      binding: 4,
      resource: { buffer: topologyBuffer },
    },
  ] as const;

  const surfaceBindGroup = device.createBindGroup({
    label: "monolithic-link-surface-bind",
    layout: bindGroupLayout,
    entries: [
      ...commonEntries,
      {
        binding: 5,
        resource: { buffer: surfaceIndicesBuffer },
      },
      {
        binding: 6,
        resource: { buffer: gradientBuffer },
      },
      {
        binding: 7,
        resource: { buffer: uniformBuffer },
      },
    ],
  });
  const wireframeBindGroup = device.createBindGroup({
    label: "monolithic-link-wireframe-bind",
    layout: bindGroupLayout,
    entries: [
      ...commonEntries,
      {
        binding: 5,
        resource: { buffer: wireframeIndicesBuffer },
      },
      {
        binding: 6,
        resource: { buffer: gradientBuffer },
      },
      {
        binding: 7,
        resource: { buffer: uniformBuffer },
      },
    ],
  });

  return new MonolithicLinkWebGpuRendererController(
    device,
    compute,
    shape,
    colorFormat,
    depthFormat,
    topology.byteLength
      + octahedral.surfaceTriangles.byteLength
      + wireframe.byteLength
      + octahedral.gradientT.byteLength,
    {
      topologyBuffer,
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
