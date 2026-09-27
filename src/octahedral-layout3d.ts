import type {
  OctahedralLinkTemplate3D,
  OctahedralLinkTopology3D,
} from "./octahedral-link3d.js";

const EPSILON = 1e-12;

export interface OctahedralSeedGrid3D {
  readonly side: number;
  readonly depth: number;
  readonly spacing: number;
}

function requireLinkCount(linkCount: number): number {
  if (!Number.isSafeInteger(linkCount) || linkCount < 0) {
    throw new Error(`invalid octahedral seed linkCount: ${String(linkCount)}`);
  }
  return linkCount;
}

function requireLinkIndex(linkIndex: number, linkCount: number): number {
  if (!Number.isSafeInteger(linkIndex) || linkIndex < 0 || linkIndex >= linkCount) {
    throw new Error(
      `invalid octahedral seed linkIndex: ${String(linkIndex)} for ${String(linkCount)} Links`,
    );
  }
  return linkIndex;
}

export function getOctahedralSeedGrid3D(
  template: OctahedralLinkTemplate3D,
  linkCount: number,
): OctahedralSeedGrid3D {
  const count = requireLinkCount(linkCount);
  const side = count <= 1 ? 1 : Math.ceil(Math.cbrt(count));
  const depth = count === 0 ? 1 : Math.ceil(count / (side * side));
  // Presentation seed density is a cross-section property, not a rod-length
  // property. Scaling center spacing with restLength makes longer, more
  // line-like Links start just as axially strained as short ones.
  const spacing = template.diameter * 1.5;
  return Object.freeze({ side, depth, spacing });
}

export function computeOctahedralSeedCenter3D(
  template: OctahedralLinkTemplate3D,
  linkIndex: number,
  linkCount: number,
): readonly [number, number, number] {
  const count = requireLinkCount(linkCount);
  if (count === 0) {
    throw new Error("octahedral seed center is undefined for an empty topology");
  }
  const index = requireLinkIndex(linkIndex, count);
  if (count === 1) return [0, 0, 0];

  const grid = getOctahedralSeedGrid3D(template, count);
  const plane = grid.side * grid.side;
  const xIndex = index % grid.side;
  const yIndex = Math.floor(index / grid.side) % grid.side;
  const zIndex = Math.floor(index / plane);

  return [
    (xIndex - (grid.side - 1) / 2) * grid.spacing,
    (yIndex - (grid.side - 1) / 2) * grid.spacing,
    (zIndex - (grid.depth - 1) / 2) * grid.spacing,
  ];
}

function normalize3(
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] | undefined {
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length <= EPSILON) return undefined;
  return [x / length, y / length, z / length];
}

function fallbackAxis3D(linkIndex: number): readonly [number, number, number] {
  switch (linkIndex % 6) {
    case 0: return [1, 0, 0];
    case 1: return [0, 1, 0];
    case 2: return [0, 0, 1];
    case 3: return [-1, 0, 0];
    case 4: return [0, -1, 0];
    default: return [0, 0, -1];
  }
}

export function computeOctahedralSeedAxis3D(
  template: OctahedralLinkTemplate3D,
  topology: OctahedralLinkTopology3D,
  linkIndex: number,
): readonly [number, number, number] {
  const index = requireLinkIndex(linkIndex, topology.linkCount);
  const startTarget = topology.startIndices[index]!;
  const endTarget = topology.endIndices[index]!;
  const start = computeOctahedralSeedCenter3D(template, startTarget, topology.linkCount);
  const end = computeOctahedralSeedCenter3D(template, endTarget, topology.linkCount);
  return normalize3(
    end[0] - start[0],
    end[1] - start[1],
    end[2] - start[2],
  ) ?? fallbackAxis3D(index);
}

function basisForAxis(
  axis: readonly [number, number, number],
): Readonly<{
  x: readonly [number, number, number];
  y: readonly [number, number, number];
  z: readonly [number, number, number];
}> {
  const [zx, zy, zz] = axis;
  const helper: readonly [number, number, number] = Math.abs(zz) < 0.9
    ? [0, 0, 1]
    : [0, 1, 0];

  const crossX = helper[1] * zz - helper[2] * zy;
  const crossY = helper[2] * zx - helper[0] * zz;
  const crossZ = helper[0] * zy - helper[1] * zx;
  const x = normalize3(crossX, crossY, crossZ);
  if (x === undefined) throw new Error("octahedral seed axis basis is degenerate");

  const y: readonly [number, number, number] = [
    zy * x[2] - zz * x[1],
    zz * x[0] - zx * x[2],
    zx * x[1] - zy * x[0],
  ];

  return Object.freeze({ x, y, z: axis });
}

export function writeFittedOctahedralTemplate3D(
  template: OctahedralLinkTemplate3D,
  topology: OctahedralLinkTopology3D,
  positions: Float32Array,
  linkIndex: number,
): void {
  const index = requireLinkIndex(linkIndex, topology.linkCount);
  const span = template.vertexCount * 3;
  const base = index * span;
  if (positions.length < base + span) {
    throw new Error(
      `octahedral seed position buffer too small: ${positions.length} < ${base + span}`,
    );
  }

  const center = computeOctahedralSeedCenter3D(template, index, topology.linkCount);
  const startTarget = topology.startIndices[index]!;
  const endTarget = topology.endIndices[index]!;
  const startCenter = computeOctahedralSeedCenter3D(
    template,
    startTarget,
    topology.linkCount,
  );
  const endCenter = computeOctahedralSeedCenter3D(
    template,
    endTarget,
    topology.linkCount,
  );
  const basis = basisForAxis(computeOctahedralSeedAxis3D(template, topology, index));
  const halfLength = template.restLength / 2;

  for (let vertex = 0; vertex < template.vertexCount; vertex += 1) {
    const local = vertex * 3;
    const lx = template.restPositions[local]!;
    const ly = template.restPositions[local + 1]!;
    const lz = template.restPositions[local + 2]!;
    const offset = base + local;
    const fraction = Math.min(1, Math.abs(lz) / halfLength);
    const target = lz < 0 ? startCenter : endCenter;
    const targetIndex = lz < 0 ? startTarget : endTarget;
    const selfHalf = targetIndex === index;

    if (selfHalf) {
      // A self-incidence half must not be seeded by collapsing every
      // longitudinal level onto own CENTER.  Embed its material centerline as
      // a deterministic closed loop whose arc length is approximately the
      // half-mast rest length.  START/END apexes still return exactly to CENTER.
      const side = lz < 0 ? -1 : 1;
      const theta = 2 * Math.PI * fraction;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      const loopRadius = halfLength / (2 * Math.PI);

      const centerlineX = center[0] + side * loopRadius * (
        sinTheta * basis.z[0] + (1 - cosTheta) * basis.x[0]
      );
      const centerlineY = center[1] + side * loopRadius * (
        sinTheta * basis.z[1] + (1 - cosTheta) * basis.x[1]
      );
      const centerlineZ = center[2] + side * loopRadius * (
        sinTheta * basis.z[2] + (1 - cosTheta) * basis.x[2]
      );

      // Rotate the transverse frame with the material tangent.  Using the
      // material-parametric tangent keeps the frame continuous through CENTER
      // for START-self, END-self, and double-self alike.
      const normalX = cosTheta * basis.x[0] - sinTheta * basis.z[0];
      const normalY = cosTheta * basis.x[1] - sinTheta * basis.z[1];
      const normalZ = cosTheta * basis.x[2] - sinTheta * basis.z[2];

      positions[offset] = centerlineX + normalX * lx + basis.y[0] * ly;
      positions[offset + 1] = centerlineY + normalY * lx + basis.y[1] * ly;
      positions[offset + 2] = centerlineZ + normalZ * lx + basis.y[2] * ly;
      continue;
    }

    // Non-self halves retain the fitted path from own CENTER to the semantic
    // target center, distributing incidence deformation over the complete
    // half-mast instead of tearing only the cap springs.
    const centerlineX = center[0] + (target[0] - center[0]) * fraction;
    const centerlineY = center[1] + (target[1] - center[1]) * fraction;
    const centerlineZ = center[2] + (target[2] - center[2]) * fraction;

    positions[offset] = centerlineX + basis.x[0] * lx + basis.y[0] * ly;
    positions[offset + 1] = centerlineY + basis.x[1] * lx + basis.y[1] * ly;
    positions[offset + 2] = centerlineZ + basis.x[2] * lx + basis.y[2] * ly;
  }
}
