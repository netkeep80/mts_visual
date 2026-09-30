import {
  MONOLITHIC_SELF_LOOP_UNIT_ARC_LENGTH,
} from "../monolithic-link-shape3d.js";
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
const DETAIL_SELECTION_CONTROL_BYTES = 96;

const GPU_BUFFER_USAGE = Object.freeze({
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
});
const GPU_SHADER_STAGE_COMPUTE = 0x0004;

export type MonolithicLinkWebGpuDetailSelectionMode3D =
  | "manual"
  | "gpu-partition";

export interface MonolithicLinkWebGpuShapeStepStats3D {
  readonly compactDispatches: number;
  readonly selectorDispatches: number;
  readonly detailDispatches: number;
  readonly dispatches: number;
  readonly computePasses: number;
  readonly detailedLinkCount: number;
  readonly selectionMode: MonolithicLinkWebGpuDetailSelectionMode3D;
  readonly dynamicStateUploadBytes: 0;
}

export interface MonolithicLinkWebGpuShapeDetailUpdateStats3D {
  readonly detailedLinkCount: number;
  readonly detailCapacity: number;
  readonly selectionMode: MonolithicLinkWebGpuDetailSelectionMode3D;
  readonly indexUploadBytes: number;
  readonly globalsUploadBytes: number;
  readonly selectionControlUploadBytes: number;
}

export interface MonolithicLinkWebGpuDetailSelectionView3D {
  readonly viewProjection: readonly number[] | Float32Array;
  readonly selectedLink?: number | null;
  readonly frustumMargin?: number;
}

export interface MonolithicLinkWebGpuShapeSnapshot3D {
  readonly status: "available" | "destroyed";
  readonly linkCount: number;
  readonly detailedLinkCount: number;
  readonly detailCapacity: number;
  readonly octahedronCount: number;
  readonly sectionCount: number;
  readonly parameterBytes: number;
  readonly gaugeBytes: number;
  readonly detailLinkIndexBytes: number;
  readonly sectionFrameBytes: number;
  readonly topologyBytes: number;
  readonly selectionMode: MonolithicLinkWebGpuDetailSelectionMode3D;
  readonly selectionControlBytes: number;
  readonly compactDynamicStateBytes: number;
  readonly detailDynamicStateBytes: number;
  readonly dynamicStateBytes: number;
}

export interface MonolithicLinkWebGpuShapeOptions3D {
  readonly detailCapacity?: number;
  readonly detailLinkIndices?: readonly number[];
}

export interface MonolithicLinkWebGpuShape3D {
  readonly compute: MonolithicLinkWebGpuCompute3D;
  readonly template: MonolithicLinkSpringTemplate3D;
  readonly parameterBuffer: WebGpuBufferLike;
  readonly gaugeBuffer: WebGpuBufferLike;
  readonly detailLinkIndexBuffer: WebGpuBufferLike;
  readonly sectionFrameBuffer: WebGpuBufferLike;
  readonly detailSelectionControlBuffer: WebGpuBufferLike;
  setDetailLinkIndices(
    indices: readonly number[],
  ): MonolithicLinkWebGpuShapeDetailUpdateStats3D;
  setGpuDetailSelectionView(
    view: MonolithicLinkWebGpuDetailSelectionView3D,
  ): MonolithicLinkWebGpuShapeDetailUpdateStats3D;
  update(): MonolithicLinkWebGpuShapeStepStats3D;
  snapshot(): MonolithicLinkWebGpuShapeSnapshot3D;
  destroy(): void;
}

export const MONOLITHIC_LINK_SHAPE_PARAMETER_WGSL = /* wgsl */ `
struct ShapeGlobals {
  counts: vec4<u32>,
  geometry: vec4<f32>,
};

struct DetailSelectionGlobals {
  view_projection: mat4x4<f32>,
  counts: vec4<u32>,
  options: vec4<f32>,
};

struct AxisFrame {
  x: vec3<f32>,
  y: vec3<f32>,
  z: vec3<f32>,
};

@group(0) @binding(0) var<storage, read> semantic_centers: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> topology_data: array<u32>;
@group(0) @binding(2) var<storage, read_write> shape_parameters: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> roll_gauge: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> detail_link_indices: array<u32>;
@group(0) @binding(5) var<storage, read_write> section_frames: array<vec4<f32>>;
@group(0) @binding(6) var<uniform> globals: ShapeGlobals;
@group(0) @binding(7) var<uniform> detail_selection: DetailSelectionGlobals;

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

fn deterministic_frame(link: u32) -> AxisFrame {
  let z = deterministic_axis(link);
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

fn update_roll_gauge(
  link: u32,
  first: vec3<f32>,
  second: vec3<f32>,
  overall_axis: vec3<f32>,
) -> vec3<f32> {
  let fallback = deterministic_perpendicular(overall_axis, link);
  let stored = roll_gauge[link];

  var previous = fallback;
  if (stored.w > 0.5) {
    previous = safe_normalize(
      stored.xyz - overall_axis * dot(stored.xyz, overall_axis),
      fallback,
    );
  }

  let crossed = cross(first, second);
  let crossed_length = length(crossed);
  let denominator = length(first) * length(second);
  let bend_sine = select(
    0.0,
    clamp(crossed_length / denominator, 0.0, 1.0),
    denominator > 1e-9,
  );

  var normal = previous;
  if (crossed_length > 1e-9) {
    var geometric = crossed / crossed_length;
    if (dot(geometric, previous) < 0.0) {
      geometric = -geometric;
    }

    let raw_weight = (bend_sine - 0.015) / (0.08 - 0.015);
    let t = clamp(raw_weight, 0.0, 1.0);
    let weight = t * t * (3.0 - 2.0 * t);
    normal = safe_normalize(
      previous * (1.0 - weight) + geometric * weight,
      previous,
    );
  }

  roll_gauge[link] = vec4<f32>(normal, 1.0);
  return normal;
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

fn ordinary_point(
  start: vec3<f32>,
  finish: vec3<f32>,
  start_direction: vec3<f32>,
  end_direction: vec3<f32>,
  bend_direction: vec3<f32>,
  amplitude: f32,
  t: f32,
) -> vec3<f32> {
  let chord_length = length(finish - start);
  let tangent_scale = max(chord_length, globals.geometry.y * 0.25);
  return hermite_point(
    start,
    finish,
    start_direction * tangent_scale,
    end_direction * tangent_scale,
    t,
  ) + bend_direction * (amplitude * buckling_basis(t));
}

fn ordinary_tangent(
  start: vec3<f32>,
  finish: vec3<f32>,
  start_direction: vec3<f32>,
  end_direction: vec3<f32>,
  bend_direction: vec3<f32>,
  amplitude: f32,
  t: f32,
) -> vec3<f32> {
  let chord_length = length(finish - start);
  let tangent_scale = max(chord_length, globals.geometry.y * 0.25);
  return hermite_derivative(
    start,
    finish,
    start_direction * tangent_scale,
    end_direction * tangent_scale,
    t,
  ) + bend_direction * (amplitude * buckling_basis_derivative(t));
}

fn self_loop_base_point(t: f32) -> vec3<f32> {
  let theta = 6.283185307179586 * t;
  let sine = sin(theta);
  let one_minus_cos = 1.0 - cos(theta);
  let hinge_opening = 3.141592653589793 * t * (1.0 - t);
  return vec3<f32>(
    0.60 * one_minus_cos * one_minus_cos + hinge_opening,
    0.35 * sine * one_minus_cos,
    sine,
  );
}

fn self_loop_base_derivative(t: f32) -> vec3<f32> {
  let theta = 6.283185307179586 * t;
  let sine = sin(theta);
  let cosine = cos(theta);
  let one_minus_cos = 1.0 - cosine;
  return vec3<f32>(
    1.20 * one_minus_cos * sine * 6.283185307179586
      + 3.141592653589793 * (1.0 - 2.0 * t),
    0.35 * (cosine * one_minus_cos + sine * sine) * 6.283185307179586,
    cosine * 6.283185307179586,
  );
}

fn self_point(
  anchor: vec3<f32>,
  link: u32,
  t: f32,
  lobe_sign: f32,
) -> vec3<f32> {
  let frame = deterministic_frame(link);
  let base = self_loop_base_point(t);
  let scale = globals.geometry.y / ${MONOLITHIC_SELF_LOOP_UNIT_ARC_LENGTH};
  return anchor
    + frame.z * (scale * base.z)
    + frame.x * (lobe_sign * scale * base.x)
    + frame.y * (lobe_sign * scale * base.y);
}

fn self_tangent(
  link: u32,
  t: f32,
  lobe_sign: f32,
) -> vec3<f32> {
  let frame = deterministic_frame(link);
  let base = self_loop_base_derivative(t);
  let scale = globals.geometry.y / ${MONOLITHIC_SELF_LOOP_UNIT_ARC_LENGTH};
  return
    frame.z * (scale * base.z)
    + frame.x * (lobe_sign * scale * base.x)
    + frame.y * (lobe_sign * scale * base.y);
}

fn curve_point(
  self_curve: bool,
  anchor: vec3<f32>,
  finish: vec3<f32>,
  start_direction: vec3<f32>,
  end_direction: vec3<f32>,
  bend_direction: vec3<f32>,
  amplitude: f32,
  link: u32,
  t: f32,
  lobe_sign: f32,
) -> vec3<f32> {
  if (self_curve) {
    return self_point(anchor, link, t, lobe_sign);
  }
  return ordinary_point(
    anchor,
    finish,
    start_direction,
    end_direction,
    bend_direction,
    amplitude,
    t,
  );
}

fn curve_tangent(
  self_curve: bool,
  anchor: vec3<f32>,
  finish: vec3<f32>,
  start_direction: vec3<f32>,
  end_direction: vec3<f32>,
  bend_direction: vec3<f32>,
  amplitude: f32,
  link: u32,
  t: f32,
  lobe_sign: f32,
) -> vec3<f32> {
  if (self_curve) {
    return self_tangent(link, t, lobe_sign);
  }
  return ordinary_tangent(
    anchor,
    finish,
    start_direction,
    end_direction,
    bend_direction,
    amplitude,
    t,
  );
}

fn curve_polyline_length(
  self_curve: bool,
  anchor: vec3<f32>,
  finish: vec3<f32>,
  start_direction: vec3<f32>,
  end_direction: vec3<f32>,
  bend_direction: vec3<f32>,
  amplitude: f32,
  link: u32,
  lobe_sign: f32,
  samples: u32,
) -> f32 {
  var previous = curve_point(
    self_curve,
    anchor,
    finish,
    start_direction,
    end_direction,
    bend_direction,
    amplitude,
    link,
    0.0,
    lobe_sign,
  );
  var total = 0.0;
  for (var sample = 1u; sample <= samples; sample = sample + 1u) {
    let t = f32(sample) / f32(samples);
    let current = curve_point(
      self_curve,
      anchor,
      finish,
      start_direction,
      end_direction,
      bend_direction,
      amplitude,
      link,
      t,
      lobe_sign,
    );
    total = total + length(current - previous);
    previous = current;
  }
  return total;
}

fn transport_x(
  value: vec3<f32>,
  from_tangent: vec3<f32>,
  to_tangent: vec3<f32>,
  seed: u32,
) -> vec3<f32> {
  let source_axis = safe_normalize(from_tangent, deterministic_axis(seed));
  let target_axis = safe_normalize(to_tangent, source_axis);
  let axis_raw = cross(source_axis, target_axis);
  let sine = length(axis_raw);
  let cosine = clamp(dot(source_axis, target_axis), -1.0, 1.0);
  var transported = value;

  if (sine > 1e-7) {
    let axis = axis_raw / sine;
    transported =
      value * cosine
      + cross(axis, value) * sine
      + axis * dot(axis, value) * (1.0 - cosine);
  } else if (cosine < 0.0) {
    let axis = deterministic_perpendicular(source_axis, seed);
    transported = -value + axis * (2.0 * dot(axis, value));
  }

  return safe_normalize(
    transported - target_axis * dot(transported, target_axis),
    deterministic_perpendicular(target_axis, seed),
  );
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

  let first_self_value = select(0.0, 1.0, first_length <= 1e-9);
  let second_self_value = select(0.0, 1.0, second_length <= 1e-9);
  let first_self = first_self_value > 0.5;
  let second_self = second_self_value > 0.5;

  var shared_direction = safe_normalize(
    first_direction + second_direction,
    overall,
  );
  if (first_self && !second_self) {
    shared_direction = second_direction;
  } else if (second_self && !first_self) {
    shared_direction = first_direction;
  }

  let bend = update_roll_gauge(
    link,
    first_chord,
    second_chord,
    overall,
  );

  var first_amplitude = 0.0;
  var second_amplitude = 0.0;
  if (!first_self) {
    first_amplitude = solve_amplitude(
      s,
      c,
      first_direction,
      shared_direction,
    );
  }
  if (!second_self) {
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
    first_self_value,
    second_self_value,
  );
}

fn detail_candidate_better(
  candidate_visible: bool,
  candidate_radius: f32,
  candidate_depth: f32,
  candidate_link: u32,
  best_visible: bool,
  best_radius: f32,
  best_depth: f32,
  best_link: u32,
) -> bool {
  if (candidate_visible != best_visible) {
    return candidate_visible;
  }
  if (candidate_radius != best_radius) {
    return candidate_radius < best_radius;
  }
  if (candidate_depth != best_depth) {
    return candidate_depth < best_depth;
  }
  return candidate_link < best_link;
}

@compute @workgroup_size(64)
fn shape_detail_select_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let slot = gid.x + gid.y * 65535u * 64u;
  let link_count = detail_selection.counts.x;
  let detail_count = detail_selection.counts.y;
  if (slot >= detail_count || detail_count == 0u) {
    return;
  }

  let selected_link = detail_selection.counts.z;
  if (
    selected_link < link_count
    && selected_link % detail_count == slot
  ) {
    detail_link_indices[slot] = selected_link;
    return;
  }

  let margin = detail_selection.options.x;
  var best_link = slot;
  var best_visible = false;
  var best_radius = 1e30;
  var best_depth = 1e30;

  var candidate = slot;
  loop {
    if (candidate >= link_count) {
      break;
    }

    let center = semantic_centers[candidate].xyz;
    let clip = detail_selection.view_projection
      * vec4<f32>(center, 1.0);

    var visible = false;
    var radius = 1e30;
    var depth = 1e30;
    if (clip.w > 1e-6) {
      let ndc = clip.xyz / clip.w;
      visible =
        abs(ndc.x) <= 1.0 + margin
        && abs(ndc.y) <= 1.0 + margin
        && ndc.z >= -1.0 - margin
        && ndc.z <= 1.0 + margin;
      if (visible) {
        radius = dot(ndc.xy, ndc.xy);
        depth = clip.w;
      }
    }

    if (
      detail_candidate_better(
        visible,
        radius,
        depth,
        candidate,
        best_visible,
        best_radius,
        best_depth,
        best_link,
      )
    ) {
      best_link = candidate;
      best_visible = visible;
      best_radius = radius;
      best_depth = depth;
    }

    candidate = candidate + detail_count;
  }

  detail_link_indices[slot] = best_link;
}

@compute @workgroup_size(64)
fn shape_detail_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let slot = gid.x + gid.y * 65535u * 64u;
  if (slot >= globals.counts.w) {
    return;
  }
  let link = detail_link_indices[slot];
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
  let seed = deterministic_axis(link);
  let first_direction = safe_normalize(first_chord, seed);
  let second_direction = safe_normalize(second_chord, first_direction);
  let overall = safe_normalize(e - s, first_direction);

  let params = shape_parameters[link];
  let first_amplitude = params.x;
  let second_amplitude = params.y;
  let first_self = params.z > 0.5;
  let second_self = params.w > 0.5;

  var shared_direction = safe_normalize(
    first_direction + second_direction,
    overall,
  );
  if (first_self && !second_self) {
    shared_direction = second_direction;
  } else if (second_self && !first_self) {
    shared_direction = first_direction;
  }

  let bend = safe_normalize(
    roll_gauge[link].xyz,
    deterministic_perpendicular(overall, link),
  );

  let half_segments = globals.counts.y;
  let section_count = globals.counts.z;
  let frame_base = slot * section_count;
  let arc_samples = max(256u, half_segments * 8u);

  let first_total = curve_polyline_length(
    first_self,
    s,
    c,
    first_direction,
    shared_direction,
    bend,
    first_amplitude,
    link,
    -1.0,
    arc_samples,
  );

  var previous_tangent = safe_normalize(
    curve_tangent(
      first_self,
      s,
      c,
      first_direction,
      shared_direction,
      bend,
      first_amplitude,
      link,
      0.0,
      -1.0,
    ),
    first_direction,
  );
  var transported_x = cross(bend, previous_tangent);
  if (length(transported_x) <= 1e-8) {
    transported_x = deterministic_perpendicular(previous_tangent, link);
  } else {
    transported_x = normalize(transported_x);
  }
  section_frames[frame_base] = vec4<f32>(transported_x, 0.0);

  var previous_point = curve_point(
    first_self,
    s,
    c,
    first_direction,
    shared_direction,
    bend,
    first_amplitude,
    link,
    0.0,
    -1.0,
  );
  var previous_sample_t = 0.0;
  var cumulative = 0.0;
  var next_section = 1u;

  for (var sample = 1u; sample <= arc_samples; sample = sample + 1u) {
    let sample_t = f32(sample) / f32(arc_samples);
    let current_point = curve_point(
      first_self,
      s,
      c,
      first_direction,
      shared_direction,
      bend,
      first_amplitude,
      link,
      sample_t,
      -1.0,
    );
    let segment_length = length(current_point - previous_point);
    let next_cumulative = cumulative + segment_length;

    loop {
      if (next_section > half_segments) {
        break;
      }
      let target_arc = first_total * f32(next_section) / f32(half_segments);
      if (target_arc > next_cumulative && sample < arc_samples) {
        break;
      }
      var fraction = 1.0;
      if (segment_length > 1e-9) {
        fraction = clamp(
          (target_arc - cumulative) / segment_length,
          0.0,
          1.0,
        );
      }
      let resolved_t = previous_sample_t
        + (sample_t - previous_sample_t) * fraction;
      let tangent = safe_normalize(
        curve_tangent(
          first_self,
          s,
          c,
          first_direction,
          shared_direction,
          bend,
          first_amplitude,
          link,
          resolved_t,
          -1.0,
        ),
        previous_tangent,
      );
      transported_x = transport_x(
        transported_x,
        previous_tangent,
        tangent,
        link + next_section,
      );
      section_frames[frame_base + next_section] =
        vec4<f32>(transported_x, resolved_t);
      previous_tangent = tangent;
      next_section = next_section + 1u;
    }

    previous_point = current_point;
    previous_sample_t = sample_t;
    cumulative = next_cumulative;
  }

  let second_start_tangent = safe_normalize(
    curve_tangent(
      second_self,
      c,
      e,
      shared_direction,
      second_direction,
      bend,
      second_amplitude,
      link,
      0.0,
      1.0,
    ),
    previous_tangent,
  );
  transported_x = transport_x(
    transported_x,
    previous_tangent,
    second_start_tangent,
    link + half_segments,
  );
  previous_tangent = second_start_tangent;

  let second_total = curve_polyline_length(
    second_self,
    c,
    e,
    shared_direction,
    second_direction,
    bend,
    second_amplitude,
    link,
    1.0,
    arc_samples,
  );
  previous_point = curve_point(
    second_self,
    c,
    e,
    shared_direction,
    second_direction,
    bend,
    second_amplitude,
    link,
    0.0,
    1.0,
  );
  previous_sample_t = 0.0;
  cumulative = 0.0;
  var next_local = 1u;

  for (var sample = 1u; sample <= arc_samples; sample = sample + 1u) {
    let sample_t = f32(sample) / f32(arc_samples);
    let current_point = curve_point(
      second_self,
      c,
      e,
      shared_direction,
      second_direction,
      bend,
      second_amplitude,
      link,
      sample_t,
      1.0,
    );
    let segment_length = length(current_point - previous_point);
    let next_cumulative = cumulative + segment_length;

    loop {
      if (next_local > half_segments) {
        break;
      }
      let target_arc = second_total * f32(next_local) / f32(half_segments);
      if (target_arc > next_cumulative && sample < arc_samples) {
        break;
      }
      var fraction = 1.0;
      if (segment_length > 1e-9) {
        fraction = clamp(
          (target_arc - cumulative) / segment_length,
          0.0,
          1.0,
        );
      }
      let resolved_t = previous_sample_t
        + (sample_t - previous_sample_t) * fraction;
      let tangent = safe_normalize(
        curve_tangent(
          second_self,
          c,
          e,
          shared_direction,
          second_direction,
          bend,
          second_amplitude,
          link,
          resolved_t,
          1.0,
        ),
        previous_tangent,
      );
      let section = half_segments + next_local;
      transported_x = transport_x(
        transported_x,
        previous_tangent,
        tangent,
        link + section,
      );
      section_frames[frame_base + section] =
        vec4<f32>(transported_x, resolved_t);
      previous_tangent = tangent;
      next_local = next_local + 1u;
    }

    previous_point = current_point;
    previous_sample_t = sample_t;
    cumulative = next_cumulative;
  }
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
  detailLinkCount: number,
  template: MonolithicLinkSpringTemplate3D,
): ArrayBuffer {
  const buffer = new ArrayBuffer(32);
  const u32 = new Uint32Array(buffer);
  const f32 = new Float32Array(buffer);
  u32[0] = linkCount;
  u32[1] = template.octahedronCount / 2;
  u32[2] = template.octahedronCount + 1;
  u32[3] = detailLinkCount;
  f32[4] = template.restLength;
  f32[5] = template.halfRestLength;
  f32[6] = 0;
  f32[7] = 0;
  return buffer;
}

function detailSelectionData(
  linkCount: number,
  detailCapacity: number,
  view: MonolithicLinkWebGpuDetailSelectionView3D,
): ArrayBuffer {
  const matrix = view.viewProjection;
  if (matrix.length !== 16) {
    throw new Error(
      `invalid monolithic shape detail viewProjection length: ${matrix.length}`,
    );
  }
  const buffer = new ArrayBuffer(DETAIL_SELECTION_CONTROL_BYTES);
  const f32 = new Float32Array(buffer);
  const u32 = new Uint32Array(buffer);
  for (let index = 0; index < 16; index += 1) {
    const value = matrix[index]!;
    if (!Number.isFinite(value)) {
      throw new Error(
        `non-finite monolithic shape detail viewProjection[${index}]`,
      );
    }
    f32[index] = value;
  }

  const selected = view.selectedLink;
  let selectedValue = 0xffff_ffff;
  if (selected !== undefined && selected !== null && selected !== -1) {
    if (
      !Number.isSafeInteger(selected)
      || selected < 0
      || selected >= linkCount
    ) {
      throw new Error(
        `invalid monolithic shape detail selectedLink: ${String(selected)}`,
      );
    }
    selectedValue = selected;
  }

  const margin = view.frustumMargin ?? 0.18;
  if (!Number.isFinite(margin) || margin < 0 || margin > 4) {
    throw new Error(
      `invalid monolithic shape detail frustumMargin: ${String(view.frustumMargin)}`,
    );
  }

  u32[16] = linkCount;
  u32[17] = detailCapacity;
  u32[18] = selectedValue;
  u32[19] = 1;
  f32[20] = margin;
  f32[21] = 0;
  f32[22] = 0;
  f32[23] = 0;
  return buffer;
}

function identityDetailSelectionData(
  linkCount: number,
  detailCapacity: number,
): ArrayBuffer {
  return detailSelectionData(linkCount, detailCapacity, {
    viewProjection: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    selectedLink: null,
    frustumMargin: 0.18,
  });
}

function requireDetailCapacity(
  value: number,
  linkCount: number,
): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > linkCount) {
    throw new Error(
      `invalid monolithic shape detailCapacity: ${String(value)}`,
    );
  }
  return value;
}

function adapterDetailCapacity(
  device: WebGpuDeviceLike,
  linkCount: number,
  sectionCount: number,
): number {
  const storageLimit = device.limits?.maxStorageBufferBindingSize;
  const bufferLimit = device.limits?.maxBufferSize;
  for (const [name, value] of [
    ["maxStorageBufferBindingSize", storageLimit],
    ["maxBufferSize", bufferLimit],
  ] as const) {
    if (
      value !== undefined
      && (!Number.isSafeInteger(value) || value <= 0)
    ) {
      throw new Error(
        `invalid monolithic shape ${name}: ${String(value)}`,
      );
    }
  }
  const limit = Math.min(
    storageLimit ?? Number.MAX_SAFE_INTEGER,
    bufferLimit ?? Number.MAX_SAFE_INTEGER,
  );
  if (limit === Number.MAX_SAFE_INTEGER) return linkCount;
  return Math.min(
    linkCount,
    Math.floor(limit / (sectionCount * 16)),
  );
}

function normalizeDetailLinkIndices(
  values: readonly number[],
  linkCount: number,
  detailCapacity: number,
): Uint32Array {
  if (values.length > detailCapacity) {
    throw new Error(
      `monolithic shape detail selection exceeds capacity: ${values.length} > ${detailCapacity}`,
    );
  }
  const seen = new Set<number>();
  const result = new Uint32Array(values.length);
  for (let slot = 0; slot < values.length; slot += 1) {
    const link = values[slot]!;
    if (!Number.isSafeInteger(link) || link < 0 || link >= linkCount) {
      throw new Error(
        `invalid monolithic shape detail link index: ${String(link)}`,
      );
    }
    if (seen.has(link)) {
      throw new Error(
        `duplicate monolithic shape detail link index: ${link}`,
      );
    }
    seen.add(link);
    result[slot] = link;
  }
  return result;
}

function defaultDetailLinkIndices(
  detailCapacity: number,
): Uint32Array {
  const result = new Uint32Array(detailCapacity);
  for (let index = 0; index < detailCapacity; index += 1) {
    result[index] = index;
  }
  return result;
}

class MonolithicLinkWebGpuShapeController
implements MonolithicLinkWebGpuShape3D {
  readonly parameterBuffer: WebGpuBufferLike;
  readonly gaugeBuffer: WebGpuBufferLike;
  readonly detailLinkIndexBuffer: WebGpuBufferLike;
  readonly sectionFrameBuffer: WebGpuBufferLike;
  readonly detailSelectionControlBuffer: WebGpuBufferLike;
  readonly template: MonolithicLinkSpringTemplate3D;

  private readonly topologyBuffer: WebGpuBufferLike;
  private readonly globalsBuffer: WebGpuBufferLike;
  private readonly bindGroup: object;
  private readonly compactPipeline:
    Awaited<ReturnType<WebGpuDeviceLike["createComputePipelineAsync"]>>;
  private readonly selectorPipeline:
    Awaited<ReturnType<WebGpuDeviceLike["createComputePipelineAsync"]>>;
  private readonly detailPipeline:
    Awaited<ReturnType<WebGpuDeviceLike["createComputePipelineAsync"]>>;
  private readonly maxWorkgroups: number;
  private readonly detailCapacityValue: number;
  private currentDetailLinkIndices: Uint32Array;
  private selectionModeValue: MonolithicLinkWebGpuDetailSelectionMode3D = "manual";
  private destroyed = false;

  constructor(
    private readonly device: WebGpuDeviceLike,
    readonly compute: MonolithicLinkWebGpuCompute3D,
    template: MonolithicLinkSpringTemplate3D,
    args: {
      parameterBuffer: WebGpuBufferLike;
      gaugeBuffer: WebGpuBufferLike;
      detailLinkIndexBuffer: WebGpuBufferLike;
      sectionFrameBuffer: WebGpuBufferLike;
      detailSelectionControlBuffer: WebGpuBufferLike;
      topologyBuffer: WebGpuBufferLike;
      globalsBuffer: WebGpuBufferLike;
      bindGroup: object;
      compactPipeline:
        Awaited<ReturnType<WebGpuDeviceLike["createComputePipelineAsync"]>>;
      selectorPipeline:
        Awaited<ReturnType<WebGpuDeviceLike["createComputePipelineAsync"]>>;
      detailPipeline:
        Awaited<ReturnType<WebGpuDeviceLike["createComputePipelineAsync"]>>;
      detailCapacity: number;
      detailLinkIndices: Uint32Array;
    },
  ) {
    this.template = template;
    this.parameterBuffer = args.parameterBuffer;
    this.gaugeBuffer = args.gaugeBuffer;
    this.detailLinkIndexBuffer = args.detailLinkIndexBuffer;
    this.sectionFrameBuffer = args.sectionFrameBuffer;
    this.detailSelectionControlBuffer = args.detailSelectionControlBuffer;
    this.topologyBuffer = args.topologyBuffer;
    this.globalsBuffer = args.globalsBuffer;
    this.bindGroup = args.bindGroup;
    this.compactPipeline = args.compactPipeline;
    this.selectorPipeline = args.selectorPipeline;
    this.detailPipeline = args.detailPipeline;
    this.detailCapacityValue = args.detailCapacity;
    this.currentDetailLinkIndices = args.detailLinkIndices;
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

  setDetailLinkIndices(
    indices: readonly number[],
  ): MonolithicLinkWebGpuShapeDetailUpdateStats3D {
    this.assertAlive();
    const normalized = normalizeDetailLinkIndices(
      indices,
      this.compute.topology.linkCount,
      this.detailCapacityValue,
    );
    if (normalized.byteLength > 0) {
      this.device.queue.writeBuffer(
        this.detailLinkIndexBuffer,
        0,
        normalized,
      );
    }
    const globals = globalsData(
      this.compute.topology.linkCount,
      normalized.length,
      this.template,
    );
    this.device.queue.writeBuffer(this.globalsBuffer, 0, globals);
    this.currentDetailLinkIndices = normalized;
    this.selectionModeValue = "manual";
    return Object.freeze({
      detailedLinkCount: normalized.length,
      detailCapacity: this.detailCapacityValue,
      selectionMode: "manual" as const,
      indexUploadBytes: normalized.byteLength,
      globalsUploadBytes: globals.byteLength,
      selectionControlUploadBytes: 0,
    });
  }

  setGpuDetailSelectionView(
    view: MonolithicLinkWebGpuDetailSelectionView3D,
  ): MonolithicLinkWebGpuShapeDetailUpdateStats3D {
    this.assertAlive();
    const linkCount = this.compute.topology.linkCount;
    if (this.detailCapacityValue <= 0 || linkCount <= 0) {
      this.currentDetailLinkIndices = new Uint32Array(0);
      this.selectionModeValue = "manual";
      const globals = globalsData(linkCount, 0, this.template);
      this.device.queue.writeBuffer(this.globalsBuffer, 0, globals);
      return Object.freeze({
        detailedLinkCount: 0,
        detailCapacity: this.detailCapacityValue,
        selectionMode: "manual" as const,
        indexUploadBytes: 0,
        globalsUploadBytes: globals.byteLength,
        selectionControlUploadBytes: 0,
      });
    }

    if (linkCount <= this.detailCapacityValue) {
      return this.setDetailLinkIndices(
        Array.from(defaultDetailLinkIndices(linkCount)),
      );
    }

    const control = detailSelectionData(
      linkCount,
      this.detailCapacityValue,
      view,
    );
    const globals = globalsData(
      linkCount,
      this.detailCapacityValue,
      this.template,
    );
    this.device.queue.writeBuffer(
      this.detailSelectionControlBuffer,
      0,
      control,
    );
    this.device.queue.writeBuffer(this.globalsBuffer, 0, globals);
    this.currentDetailLinkIndices = defaultDetailLinkIndices(
      this.detailCapacityValue,
    );
    this.selectionModeValue = "gpu-partition";
    return Object.freeze({
      detailedLinkCount: this.detailCapacityValue,
      detailCapacity: this.detailCapacityValue,
      selectionMode: "gpu-partition" as const,
      indexUploadBytes: 0,
      globalsUploadBytes: globals.byteLength,
      selectionControlUploadBytes: control.byteLength,
    });
  }

  update(): MonolithicLinkWebGpuShapeStepStats3D {
    this.assertAlive();
    const linkCount = this.compute.topology.linkCount;
    const detailCount = this.currentDetailLinkIndices.length;
    if (linkCount === 0) {
      return Object.freeze({
        compactDispatches: 0,
        selectorDispatches: 0,
        detailDispatches: 0,
        dispatches: 0,
        computePasses: 0,
        detailedLinkCount: 0,
        selectionMode: this.selectionModeValue,
        dynamicStateUploadBytes: 0 as const,
      });
    }

    const encoder = this.device.createCommandEncoder({
      label: "monolithic-link-shape-update",
    });

    const compactGroups = Math.ceil(linkCount / WORKGROUP_SIZE);
    const compactX = Math.min(compactGroups, this.maxWorkgroups);
    const compactY = Math.ceil(compactGroups / this.maxWorkgroups);
    const compactPass = encoder.beginComputePass();
    compactPass.setPipeline(this.compactPipeline);
    compactPass.setBindGroup(0, this.bindGroup);
    compactPass.dispatchWorkgroups(compactX, compactY, 1);
    compactPass.end();

    let selectorDispatches = 0;
    if (
      detailCount > 0
      && this.selectionModeValue === "gpu-partition"
    ) {
      const selectorGroups = Math.ceil(detailCount / WORKGROUP_SIZE);
      const selectorX = Math.min(selectorGroups, this.maxWorkgroups);
      const selectorY = Math.ceil(selectorGroups / this.maxWorkgroups);
      const selectorPass = encoder.beginComputePass();
      selectorPass.setPipeline(this.selectorPipeline);
      selectorPass.setBindGroup(0, this.bindGroup);
      selectorPass.dispatchWorkgroups(selectorX, selectorY, 1);
      selectorPass.end();
      selectorDispatches = 1;
    }

    let detailDispatches = 0;
    if (detailCount > 0) {
      const detailGroups = Math.ceil(detailCount / WORKGROUP_SIZE);
      const detailX = Math.min(detailGroups, this.maxWorkgroups);
      const detailY = Math.ceil(detailGroups / this.maxWorkgroups);
      const detailPass = encoder.beginComputePass();
      detailPass.setPipeline(this.detailPipeline);
      detailPass.setBindGroup(0, this.bindGroup);
      detailPass.dispatchWorkgroups(detailX, detailY, 1);
      detailPass.end();
      detailDispatches = 1;
    }

    this.device.queue.submit([encoder.finish()]);

    return Object.freeze({
      compactDispatches: 1,
      selectorDispatches,
      detailDispatches,
      dispatches: 1 + selectorDispatches + detailDispatches,
      computePasses: 1 + selectorDispatches + detailDispatches,
      detailedLinkCount: detailCount,
      selectionMode: this.selectionModeValue,
      dynamicStateUploadBytes: 0 as const,
    });
  }

  snapshot(): MonolithicLinkWebGpuShapeSnapshot3D {
    const linkCount = this.compute.topology.linkCount;
    const compactDynamicStateBytes = linkCount * 32;
    const detailLinkIndexBytes = this.detailCapacityValue * 4;
    const sectionFrameBytes =
      this.detailCapacityValue
      * (this.template.octahedronCount + 1) * 16;
    const detailDynamicStateBytes =
      detailLinkIndexBytes + sectionFrameBytes;
    return Object.freeze({
      status: this.destroyed ? "destroyed" : "available",
      linkCount,
      detailedLinkCount: this.currentDetailLinkIndices.length,
      detailCapacity: this.detailCapacityValue,
      octahedronCount: this.template.octahedronCount,
      sectionCount: this.template.octahedronCount + 1,
      parameterBytes: linkCount * 16,
      gaugeBytes: linkCount * 16,
      detailLinkIndexBytes,
      sectionFrameBytes,
      topologyBytes: this.topologyBuffer.size,
      selectionMode: this.selectionModeValue,
      selectionControlBytes: DETAIL_SELECTION_CONTROL_BYTES,
      compactDynamicStateBytes,
      detailDynamicStateBytes,
      dynamicStateBytes:
        compactDynamicStateBytes + detailDynamicStateBytes,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.parameterBuffer.destroy();
    this.gaugeBuffer.destroy();
    this.detailLinkIndexBuffer.destroy();
    this.sectionFrameBuffer.destroy();
    this.detailSelectionControlBuffer.destroy();
    this.topologyBuffer.destroy();
    this.globalsBuffer.destroy();
  }
}

export async function createMonolithicLinkWebGpuShape3D(
  device: WebGpuDeviceLike,
  compute: MonolithicLinkWebGpuCompute3D,
  aspectRatio: number,
  options: MonolithicLinkWebGpuShapeOptions3D = {},
): Promise<MonolithicLinkWebGpuShape3D> {
  const template = getMonolithicLinkSpringTemplate3D(aspectRatio);
  if (Math.abs(template.restLength - compute.restLength) > 1e-5) {
    throw new Error(
      `monolithic shape/compute restLength mismatch: ${template.restLength} != ${compute.restLength}`,
    );
  }

  const linkCount = compute.topology.linkCount;
  const sectionCount = template.octahedronCount + 1;
  const adapterCapacity = adapterDetailCapacity(
    device,
    linkCount,
    sectionCount,
  );
  const detailCapacity = options.detailCapacity === undefined
    ? adapterCapacity
    : Math.min(
      requireDetailCapacity(options.detailCapacity, linkCount),
      adapterCapacity,
    );
  const initialDetailLinkIndices = options.detailLinkIndices === undefined
    ? defaultDetailLinkIndices(detailCapacity)
    : normalizeDetailLinkIndices(
      options.detailLinkIndices,
      linkCount,
      detailCapacity,
    );

  const topology = packedTopology(compute);
  const parameterBuffer = createBuffer(
    device,
    "monolithic-link-shape-parameters",
    linkCount * 16,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC,
  );
  const gaugeBuffer = createBuffer(
    device,
    "monolithic-link-roll-gauge",
    linkCount * 16,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC,
  );
  const detailLinkIndexBuffer = createBuffer(
    device,
    "monolithic-link-detail-indices",
    detailCapacity * 4,
    GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
  );
  const sectionFrameBuffer = createBuffer(
    device,
    "monolithic-link-section-frames",
    detailCapacity * sectionCount * 16,
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
  const detailSelectionControlBuffer = createBuffer(
    device,
    "monolithic-link-detail-selection",
    DETAIL_SELECTION_CONTROL_BYTES,
    GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
  );
  if (topology.byteLength > 0) {
    device.queue.writeBuffer(topologyBuffer, 0, topology);
  }
  if (initialDetailLinkIndices.byteLength > 0) {
    device.queue.writeBuffer(
      detailLinkIndexBuffer,
      0,
      initialDetailLinkIndices,
    );
  }
  device.queue.writeBuffer(
    globalsBuffer,
    0,
    globalsData(linkCount, initialDetailLinkIndices.length, template),
  );
  device.queue.writeBuffer(
    detailSelectionControlBuffer,
    0,
    identityDetailSelectionData(linkCount, detailCapacity),
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
      { binding: 0, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
      { binding: 4, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
      { binding: 5, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "storage" } },
      { binding: 6, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "uniform" } },
      { binding: 7, visibility: GPU_SHADER_STAGE_COMPUTE, buffer: { type: "uniform" } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: "monolithic-link-shape-pipeline-layout",
    bindGroupLayouts: [layout],
  });
  const [compactPipeline, selectorPipeline, detailPipeline] = await Promise.all([
    device.createComputePipelineAsync({
      label: "monolithic-link-shape-parameter-pipeline",
      layout: pipelineLayout,
      compute: { module: shader as object, entryPoint: "shape_parameter_main" },
    }),
    device.createComputePipelineAsync({
      label: "monolithic-link-shape-detail-selector-pipeline",
      layout: pipelineLayout,
      compute: { module: shader as object, entryPoint: "shape_detail_select_main" },
    }),
    device.createComputePipelineAsync({
      label: "monolithic-link-shape-detail-pipeline",
      layout: pipelineLayout,
      compute: { module: shader as object, entryPoint: "shape_detail_main" },
    }),
  ]);
  const bindGroup = device.createBindGroup({
    label: "monolithic-link-shape-bind",
    layout,
    entries: [
      { binding: 0, resource: { buffer: compute.centerBuffer } },
      { binding: 1, resource: { buffer: topologyBuffer } },
      { binding: 2, resource: { buffer: parameterBuffer } },
      { binding: 3, resource: { buffer: gaugeBuffer } },
      { binding: 4, resource: { buffer: detailLinkIndexBuffer } },
      { binding: 5, resource: { buffer: sectionFrameBuffer } },
      { binding: 6, resource: { buffer: globalsBuffer } },
      { binding: 7, resource: { buffer: detailSelectionControlBuffer } },
    ],
  });

  return new MonolithicLinkWebGpuShapeController(
    device,
    compute,
    template,
    {
      parameterBuffer,
      gaugeBuffer,
      detailLinkIndexBuffer,
      sectionFrameBuffer,
      detailSelectionControlBuffer,
      topologyBuffer,
      globalsBuffer,
      bindGroup,
      compactPipeline,
      selectorPipeline,
      detailPipeline,
      detailCapacity,
      detailLinkIndices: initialDetailLinkIndices,
    },
  );
}
