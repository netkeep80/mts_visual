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
    if (point === null) continue;
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
