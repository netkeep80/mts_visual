export type RigidSectionScreenPoint2D = readonly [number, number] | null;
export type RigidSectionInteractionVec3 = readonly [number, number, number];

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`invalid rigid interaction ${label}: ${String(value)}`);
  }
  return value;
}

function requirePositiveFinite(value: number, label: string): number {
  requireFinite(value, label);
  if (!(value > 0)) {
    throw new Error(`invalid rigid interaction ${label}: ${String(value)}`);
  }
  return value;
}

function requireVec3(
  value: RigidSectionInteractionVec3,
  label: string,
): RigidSectionInteractionVec3 {
  if (value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`invalid rigid interaction ${label}`);
  }
  return value;
}

/**
 * Select the nearest projected semantic CENTER inside a screen-space hit radius.
 *
 * The caller owns world -> screen projection. Null entries represent centers
 * outside the current camera frustum.
 */
export function pickRigidSectionCenterScreen2D(
  projectedCenters: readonly RigidSectionScreenPoint2D[],
  clientX: number,
  clientY: number,
  hitRadiusPixels: number,
): number {
  requireFinite(clientX, "clientX");
  requireFinite(clientY, "clientY");
  const radius = requirePositiveFinite(hitRadiusPixels, "hitRadiusPixels");

  let selected = -1;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < projectedCenters.length; index += 1) {
    const point = projectedCenters[index];
    if (point === undefined || point === null) continue;
    if (point.length !== 2 || !point.every(Number.isFinite)) {
      throw new Error(`invalid rigid interaction projectedCenters[${index}]`);
    }
    const distance = Math.hypot(
      clientX - point[0],
      clientY - point[1],
    );
    if (distance <= radius && distance < selectedDistance) {
      selected = index;
      selectedDistance = distance;
    }
  }
  return selected;
}

/**
 * Convert screen-space pointer motion into a world-space delta in the camera
 * right/up plane at the selected CENTER depth.
 */
export function rigidSectionScreenDragDelta3D(
  cameraRight: RigidSectionInteractionVec3,
  cameraUp: RigidSectionInteractionVec3,
  depth: number,
  viewportHeightPixels: number,
  dxPixels: number,
  dyPixels: number,
  verticalFovRadians = Math.PI / 4,
): RigidSectionInteractionVec3 {
  const right = requireVec3(cameraRight, "cameraRight");
  const up = requireVec3(cameraUp, "cameraUp");
  const resolvedDepth = requirePositiveFinite(depth, "depth");
  const viewportHeight = requirePositiveFinite(
    viewportHeightPixels,
    "viewportHeightPixels",
  );
  const fov = requirePositiveFinite(verticalFovRadians, "verticalFovRadians");
  if (!(fov < Math.PI)) {
    throw new Error(
      `invalid rigid interaction verticalFovRadians: ${String(verticalFovRadians)}`,
    );
  }
  const dx = requireFinite(dxPixels, "dxPixels");
  const dy = requireFinite(dyPixels, "dyPixels");

  const worldPerPixel =
    2 * resolvedDepth * Math.tan(fov / 2) / viewportHeight;
  return [
    right[0] * dx * worldPerPixel - up[0] * dy * worldPerPixel,
    right[1] * dx * worldPerPixel - up[1] * dy * worldPerPixel,
    right[2] * dx * worldPerPixel - up[2] * dy * worldPerPixel,
  ];
}


export const RIGID_SECTION_CENTER_ICOSAHEDRON_PHI =
  (1 + Math.sqrt(5)) / 2;
export const RIGID_SECTION_CENTER_ICOSAHEDRON_NORMALIZATION =
  Math.sqrt(
    1
    + RIGID_SECTION_CENTER_ICOSAHEDRON_PHI
      * RIGID_SECTION_CENTER_ICOSAHEDRON_PHI,
  );

/**
 * Fixed world-space CENTER marker orientation.
 * Vertices are normalized to unit circumradius.
 */
export const RIGID_SECTION_CENTER_ICOSAHEDRON_VERTICES = Object.freeze(([
  [-1, RIGID_SECTION_CENTER_ICOSAHEDRON_PHI, 0],
  [1, RIGID_SECTION_CENTER_ICOSAHEDRON_PHI, 0],
  [-1, -RIGID_SECTION_CENTER_ICOSAHEDRON_PHI, 0],
  [1, -RIGID_SECTION_CENTER_ICOSAHEDRON_PHI, 0],
  [0, -1, RIGID_SECTION_CENTER_ICOSAHEDRON_PHI],
  [0, 1, RIGID_SECTION_CENTER_ICOSAHEDRON_PHI],
  [0, -1, -RIGID_SECTION_CENTER_ICOSAHEDRON_PHI],
  [0, 1, -RIGID_SECTION_CENTER_ICOSAHEDRON_PHI],
  [RIGID_SECTION_CENTER_ICOSAHEDRON_PHI, 0, -1],
  [RIGID_SECTION_CENTER_ICOSAHEDRON_PHI, 0, 1],
  [-RIGID_SECTION_CENTER_ICOSAHEDRON_PHI, 0, -1],
  [-RIGID_SECTION_CENTER_ICOSAHEDRON_PHI, 0, 1],
] as const).map(([x, y, z]) => Object.freeze([
  x / RIGID_SECTION_CENTER_ICOSAHEDRON_NORMALIZATION,
  y / RIGID_SECTION_CENTER_ICOSAHEDRON_NORMALIZATION,
  z / RIGID_SECTION_CENTER_ICOSAHEDRON_NORMALIZATION,
] as const))));

export const RIGID_SECTION_CENTER_ICOSAHEDRON_FACES = Object.freeze([
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
] as const);

export const RIGID_SECTION_CENTER_ICOSAHEDRON_TRIANGLE_COUNT = 20;
export const RIGID_SECTION_CENTER_ICOSAHEDRON_VERTEX_COUNT =
  RIGID_SECTION_CENTER_ICOSAHEDRON_TRIANGLE_COUNT * 3;
export const RIGID_SECTION_END_CONE_SIDE_COUNT = 6;
export const RIGID_SECTION_END_CONE_VERTEX_COUNT =
  RIGID_SECTION_END_CONE_SIDE_COUNT * 3;

function subtract3(
  a: RigidSectionInteractionVec3,
  b: RigidSectionInteractionVec3,
): RigidSectionInteractionVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function addScaled3(
  origin: RigidSectionInteractionVec3,
  value: RigidSectionInteractionVec3,
  scale: number,
): RigidSectionInteractionVec3 {
  return [
    origin[0] + value[0] * scale,
    origin[1] + value[1] * scale,
    origin[2] + value[2] * scale,
  ];
}

function dot3(
  a: RigidSectionInteractionVec3,
  b: RigidSectionInteractionVec3,
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(
  a: RigidSectionInteractionVec3,
  b: RigidSectionInteractionVec3,
): RigidSectionInteractionVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize3(
  value: RigidSectionInteractionVec3,
): RigidSectionInteractionVec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new Error("invalid rigid interaction rayDirection");
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

function raySphereDistance(
  origin: RigidSectionInteractionVec3,
  direction: RigidSectionInteractionVec3,
  center: RigidSectionInteractionVec3,
  radius: number,
): number | null {
  const oc = subtract3(origin, center);
  const b = dot3(oc, direction);
  const c = dot3(oc, oc) - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const near = -b - root;
  if (near >= 0) return near;
  const far = -b + root;
  return far >= 0 ? far : null;
}

function rayTriangleDistance(
  origin: RigidSectionInteractionVec3,
  direction: RigidSectionInteractionVec3,
  a: RigidSectionInteractionVec3,
  b: RigidSectionInteractionVec3,
  c: RigidSectionInteractionVec3,
): number | null {
  const epsilon = 1e-9;
  const edge1 = subtract3(b, a);
  const edge2 = subtract3(c, a);
  const p = cross3(direction, edge2);
  const determinant = dot3(edge1, p);
  if (Math.abs(determinant) <= epsilon) return null;
  const inverseDeterminant = 1 / determinant;
  const t = subtract3(origin, a);
  const u = dot3(t, p) * inverseDeterminant;
  if (u < 0 || u > 1) return null;
  const q = cross3(t, edge1);
  const v = dot3(direction, q) * inverseDeterminant;
  if (v < 0 || u + v > 1) return null;
  const distance = dot3(edge2, q) * inverseDeterminant;
  return distance >= 0 ? distance : null;
}

/**
 * Exact world-space picking against the same regular icosahedron rendered for
 * each semantic CENTER. The radius is the marker circumradius.
 */
export function pickRigidSectionCenterIcosahedra3D(
  rayOrigin: RigidSectionInteractionVec3,
  rayDirection: RigidSectionInteractionVec3,
  centers: readonly RigidSectionInteractionVec3[],
  circumradius: number,
): number {
  const origin = requireVec3(rayOrigin, "rayOrigin");
  const direction = normalize3(requireVec3(rayDirection, "rayDirection"));
  const radius = requirePositiveFinite(circumradius, "circumradius");

  let selected = -1;
  let selectedDistance = Number.POSITIVE_INFINITY;

  for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
    const center = requireVec3(centers[centerIndex]!, `centers[${centerIndex}]`);
    const broadPhase = raySphereDistance(origin, direction, center, radius);
    if (broadPhase === null || broadPhase > selectedDistance) continue;

    for (const face of RIGID_SECTION_CENTER_ICOSAHEDRON_FACES) {
      const va = RIGID_SECTION_CENTER_ICOSAHEDRON_VERTICES[face[0]]!;
      const vb = RIGID_SECTION_CENTER_ICOSAHEDRON_VERTICES[face[1]]!;
      const vc = RIGID_SECTION_CENTER_ICOSAHEDRON_VERTICES[face[2]]!;
      const a = addScaled3(center, va, radius);
      const b = addScaled3(center, vb, radius);
      const c = addScaled3(center, vc, radius);
      const hit = rayTriangleDistance(origin, direction, a, b, c);
      if (hit !== null && hit < selectedDistance) {
        selectedDistance = hit;
        selected = centerIndex;
      }
    }
  }

  return selected;
}
