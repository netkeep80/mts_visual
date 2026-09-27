import {
  normalizeVisualLinkNetwork,
  type VisualKey,
  type VisualLinkNetwork,
} from "./index.js";

const EPSILON = 1e-12;
const SQRT_TWO = Math.SQRT2;

export const OCTAHEDRAL_EDGE_REST_LENGTH = 1;
export const OCTAHEDRAL_TRIANGLE_RADIUS = 1 / Math.sqrt(3);
export const OCTAHEDRAL_DIAMETER = 2 / Math.sqrt(3);
export const OCTAHEDRAL_MODULE_HEIGHT = Math.sqrt(2 / 3);

export const OCTAHEDRAL_PRESENTATION_BASELINE_OCTAHEDRA = 20;
export const OCTAHEDRAL_PRESENTATION_BASELINE_ASPECT_RATIO =
  Math.SQRT2 * (OCTAHEDRAL_PRESENTATION_BASELINE_OCTAHEDRA / 2);

export type OctahedralLink3DErrorCode =
  | "invalid-aspect-ratio"
  | "invalid-stiffness"
  | "invalid-buffer"
  | "non-finite-state";

export class OctahedralLink3DError extends Error {
  readonly code: OctahedralLink3DErrorCode;

  constructor(code: OctahedralLink3DErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "OctahedralLink3DError";
    this.code = code;
  }
}

export interface OctahedralAspectResolution {
  readonly requestedAspectRatio: number;
  readonly resolvedAspectRatio: number;
  readonly pairCount: number;
  readonly octahedronCount: number;
}

export interface OctahedralLinkTemplate3D {
  readonly pairCount: number;
  readonly octahedronCount: number;
  readonly aspectRatio: number;
  readonly restLength: number;
  readonly diameter: number;
  readonly edgeRestLength: 1;
  readonly vertexCount: number;
  readonly edgeCount: number;
  readonly surfaceTriangleCount: number;
  readonly restPositions: Float32Array;
  readonly edgeA: Uint32Array;
  readonly edgeB: Uint32Array;
  readonly surfaceTriangles: Uint32Array;
  readonly gradientT: Float32Array;
  readonly startTriangle: readonly [number, number, number];
  readonly centerTriangle: readonly [number, number, number];
  readonly endTriangle: readonly [number, number, number];
  readonly edgeBatches: readonly Uint32Array[];
}

export interface OctahedralLinkTopology3D {
  readonly linkCount: number;
  readonly keys: readonly VisualKey[];
  readonly startIndices: Uint32Array;
  readonly endIndices: Uint32Array;
}

export interface OctahedralSpringEvaluation {
  readonly edgeEvaluations: number;
  readonly pairwiseSemanticLinkEvaluations: 0;
  readonly explicitBendEvaluations: 0;
}

export interface OctahedralSpringForceResult {
  readonly forces: Float32Array;
  readonly evaluations: OctahedralSpringEvaluation;
}

const templateCache = new Map<number, OctahedralLinkTemplate3D>();

function requireFiniteRange(
  values: Float32Array,
  start: number,
  length: number,
  label: string,
): void {
  const end = start + length;
  if (start < 0 || length < 0 || end > values.length) {
    throw new OctahedralLink3DError("invalid-buffer", `${label}: [${start},${end}) outside ${values.length}`);
  }
  for (let index = start; index < end; index += 1) {
    if (!Number.isFinite(values[index]!)) {
      throw new OctahedralLink3DError("non-finite-state", `${label}[${index}]`);
    }
  }
}

function requireStiffness(stiffness: number): void {
  if (!Number.isFinite(stiffness) || stiffness < 0) {
    throw new OctahedralLink3DError("invalid-stiffness", String(stiffness));
  }
}

export function resolveOctahedralAspectRatio(aspectRatio: number): OctahedralAspectResolution {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new OctahedralLink3DError("invalid-aspect-ratio", String(aspectRatio));
  }

  const rawPairCount = aspectRatio / SQRT_TWO;
  if (!Number.isFinite(rawPairCount) || Math.abs(rawPairCount) > Number.MAX_SAFE_INTEGER) {
    throw new OctahedralLink3DError("invalid-aspect-ratio", String(aspectRatio));
  }

  const pairCount = Math.max(1, Math.round(rawPairCount));
  if (!Number.isSafeInteger(pairCount)) {
    throw new OctahedralLink3DError("invalid-aspect-ratio", String(aspectRatio));
  }

  return Object.freeze({
    requestedAspectRatio: aspectRatio,
    resolvedAspectRatio: SQRT_TWO * (pairCount + 1),
    pairCount,
    octahedronCount: pairCount * 2,
  });
}

function levelVertex(level: number, corner: number): number {
  return level * 3 + corner;
}

function pushUniqueEdge(
  edgeA: number[],
  edgeB: number[],
  edgeKeys: Set<string>,
  left: number,
  right: number,
): void {
  const a = Math.min(left, right);
  const b = Math.max(left, right);
  const key = `${a}:${b}`;
  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);
  edgeA.push(a);
  edgeB.push(b);
}

function buildConflictFreeEdgeBatches(edgeA: Uint32Array, edgeB: Uint32Array): readonly Uint32Array[] {
  const batches: number[][] = [];
  const usedVertices: Set<number>[] = [];

  for (let edge = 0; edge < edgeA.length; edge += 1) {
    const a = edgeA[edge]!;
    const b = edgeB[edge]!;
    let placed = false;
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const used = usedVertices[batchIndex]!;
      if (used.has(a) || used.has(b)) continue;
      batches[batchIndex]!.push(edge);
      used.add(a);
      used.add(b);
      placed = true;
      break;
    }
    if (!placed) {
      batches.push([edge]);
      usedVertices.push(new Set([a, b]));
    }
  }

  return Object.freeze(batches.map((batch) => new Uint32Array(batch)));
}

function buildOctahedralTemplate(pairCount: number): OctahedralLinkTemplate3D {
  const octahedronCount = pairCount * 2;
  const levelCount = octahedronCount + 1;
  const vertexCount = levelCount * 3;
  const restLength = octahedronCount * OCTAHEDRAL_MODULE_HEIGHT;
  const halfLength = restLength / 2;

  const restPositions = new Float32Array(vertexCount * 3);
  const gradientT = new Float32Array(vertexCount);

  for (let level = 0; level < levelCount; level += 1) {
    const rotation = level % 2 === 0 ? 0 : Math.PI / 3;
    const z = -halfLength + level * OCTAHEDRAL_MODULE_HEIGHT;
    const t = level / octahedronCount;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = levelVertex(level, corner);
      const offset = vertex * 3;
      const angle = rotation + corner * (2 * Math.PI / 3);
      restPositions[offset] = OCTAHEDRAL_TRIANGLE_RADIUS * Math.cos(angle);
      restPositions[offset + 1] = OCTAHEDRAL_TRIANGLE_RADIUS * Math.sin(angle);
      restPositions[offset + 2] = z;
      gradientT[vertex] = t;
    }
  }

  const edgeAList: number[] = [];
  const edgeBList: number[] = [];
  const edgeKeys = new Set<string>();

  // Every transverse level has one triangular ring. START/END are the
  // geometric centroids of the first/last rings; there are no apex particles.
  for (let level = 0; level < levelCount; level += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      pushUniqueEdge(
        edgeAList,
        edgeBList,
        edgeKeys,
        levelVertex(level, corner),
        levelVertex(level, (corner + 1) % 3),
      );
    }
  }

  // Each regular octahedron contributes six diagonals between adjacent rings.
  for (let module = 0; module < octahedronCount; module += 1) {
    const adjacentCornerOffset = module % 2 === 0 ? 2 : 1;
    for (let corner = 0; corner < 3; corner += 1) {
      pushUniqueEdge(
        edgeAList,
        edgeBList,
        edgeKeys,
        levelVertex(module, corner),
        levelVertex(module + 1, corner),
      );
      pushUniqueEdge(
        edgeAList,
        edgeBList,
        edgeKeys,
        levelVertex(module, corner),
        levelVertex(module + 1, (corner + adjacentCornerOffset) % 3),
      );
    }
  }

  const edgeA = new Uint32Array(edgeAList);
  const edgeB = new Uint32Array(edgeBList);

  // External surface = two terminal triangular faces plus six side triangles
  // per octahedron. Shared transverse faces inside the mast are not rendered.
  const triangles: number[] = [
    levelVertex(0, 0),
    levelVertex(0, 2),
    levelVertex(0, 1),
  ];

  for (let module = 0; module < octahedronCount; module += 1) {
    const adjacentCornerOffset = module % 2 === 0 ? 2 : 1;
    for (let corner = 0; corner < 3; corner += 1) {
      const bottom = levelVertex(module, corner);
      const top = levelVertex(module + 1, corner);
      const topAdjacent = levelVertex(module + 1, (corner + adjacentCornerOffset) % 3);
      const bottomAdjacent = levelVertex(module, (corner - adjacentCornerOffset + 3) % 3);
      triangles.push(bottom, top, topAdjacent);
      triangles.push(bottom, bottomAdjacent, top);
    }
  }

  triangles.push(
    levelVertex(octahedronCount, 0),
    levelVertex(octahedronCount, 1),
    levelVertex(octahedronCount, 2),
  );

  const centerLevel = pairCount;
  const startTriangle = Object.freeze([
    levelVertex(0, 0),
    levelVertex(0, 1),
    levelVertex(0, 2),
  ]) as readonly [number, number, number];
  const centerTriangle = Object.freeze([
    levelVertex(centerLevel, 0),
    levelVertex(centerLevel, 1),
    levelVertex(centerLevel, 2),
  ]) as readonly [number, number, number];
  const endTriangle = Object.freeze([
    levelVertex(octahedronCount, 0),
    levelVertex(octahedronCount, 1),
    levelVertex(octahedronCount, 2),
  ]) as readonly [number, number, number];

  const surfaceTriangles = new Uint32Array(triangles);
  const edgeBatches = buildConflictFreeEdgeBatches(edgeA, edgeB);

  return Object.freeze({
    pairCount,
    octahedronCount,
    aspectRatio: SQRT_TWO * pairCount,
    restLength,
    diameter: OCTAHEDRAL_DIAMETER,
    edgeRestLength: OCTAHEDRAL_EDGE_REST_LENGTH as 1,
    vertexCount,
    edgeCount: edgeA.length,
    surfaceTriangleCount: surfaceTriangles.length / 3,
    restPositions,
    edgeA,
    edgeB,
    surfaceTriangles,
    gradientT,
    startTriangle,
    centerTriangle,
    endTriangle,
    edgeBatches,
  });
}

export function getOctahedralLinkTemplate3D(aspectRatio: number): OctahedralLinkTemplate3D {
  const resolution = resolveOctahedralAspectRatio(aspectRatio);
  const cached = templateCache.get(resolution.pairCount);
  if (cached !== undefined) return cached;
  const template = buildOctahedralTemplate(resolution.pairCount);
  templateCache.set(resolution.pairCount, template);
  return template;
}

export function buildOctahedralLinkTopology3D(network: VisualLinkNetwork): OctahedralLinkTopology3D {
  const normalized = normalizeVisualLinkNetwork(network);
  const keys = Object.freeze(normalized.links.map((link) => link.key));
  const byKey = new Map(keys.map((key, index) => [key, index] as const));
  const startIndices = new Uint32Array(keys.length);
  const endIndices = new Uint32Array(keys.length);

  for (let index = 0; index < normalized.links.length; index += 1) {
    const link = normalized.links[index]!;
    startIndices[index] = byKey.get(link.startKey)!;
    endIndices[index] = byKey.get(link.endKey)!;
  }

  return Object.freeze({
    linkCount: keys.length,
    keys,
    startIndices,
    endIndices,
  });
}

function packedFloatOffset(template: OctahedralLinkTemplate3D, linkIndex: number, vertex: number): number {
  return (linkIndex * template.vertexCount + vertex) * 3;
}

function writeCenterInto(
  template: OctahedralLinkTemplate3D,
  positions: Float32Array,
  linkIndex: number,
  out: Float32Array,
  outOffset: number,
): void {
  const linkBase = linkIndex * template.vertexCount * 3;
  requireFiniteRange(positions, linkBase, template.vertexCount * 3, "positions");
  let x = 0;
  let y = 0;
  let z = 0;
  for (const vertex of template.centerTriangle) {
    const offset = packedFloatOffset(template, linkIndex, vertex);
    x += positions[offset]!;
    y += positions[offset + 1]!;
    z += positions[offset + 2]!;
  }
  out[outOffset] = x / 3;
  out[outOffset + 1] = y / 3;
  out[outOffset + 2] = z / 3;
}

export function computeOctahedralGeometricCenter3D(
  template: OctahedralLinkTemplate3D,
  positions: Float32Array,
  linkIndex = 0,
): readonly [number, number, number] {
  const out = new Float32Array(3);
  writeCenterInto(template, positions, linkIndex, out, 0);
  return [out[0]!, out[1]!, out[2]!];
}

export function addOctahedralCenterForce3D(
  template: OctahedralLinkTemplate3D,
  forces: Float32Array,
  linkIndex: number,
  fx: number,
  fy: number,
  fz: number,
): void {
  if (![fx, fy, fz].every(Number.isFinite)) {
    throw new OctahedralLink3DError("non-finite-state", "center force");
  }
  const linkBase = linkIndex * template.vertexCount * 3;
  requireFiniteRange(forces, linkBase, template.vertexCount * 3, "forces");
  addCenterForceUnchecked(template, forces, linkIndex, fx, fy, fz);
}

function addCenterForceUnchecked(
  template: OctahedralLinkTemplate3D,
  forces: Float32Array,
  linkIndex: number,
  fx: number,
  fy: number,
  fz: number,
): void {
  for (const vertex of template.centerTriangle) {
    const offset = packedFloatOffset(template, linkIndex, vertex);
    forces[offset] = forces[offset]! + fx / 3;
    forces[offset + 1] = forces[offset + 1]! + fy / 3;
    forces[offset + 2] = forces[offset + 2]! + fz / 3;
  }
}

export function accumulateOctahedralSpringForces3D(
  template: OctahedralLinkTemplate3D,
  positions: Float32Array,
  forces: Float32Array,
  stiffness: number,
  linkIndex = 0,
): OctahedralSpringEvaluation {
  requireStiffness(stiffness);
  const linkBase = linkIndex * template.vertexCount * 3;
  requireFiniteRange(positions, linkBase, template.vertexCount * 3, "positions");
  requireFiniteRange(forces, linkBase, template.vertexCount * 3, "forces");

  for (let edge = 0; edge < template.edgeCount; edge += 1) {
    const a = template.edgeA[edge]!;
    const b = template.edgeB[edge]!;
    const aOffset = packedFloatOffset(template, linkIndex, a);
    const bOffset = packedFloatOffset(template, linkIndex, b);

    let dx = positions[bOffset]! - positions[aOffset]!;
    let dy = positions[bOffset + 1]! - positions[aOffset + 1]!;
    let dz = positions[bOffset + 2]! - positions[aOffset + 2]!;
    let length = Math.hypot(dx, dy, dz);

    let scale: number;
    if (length <= EPSILON) {
      const restA = a * 3;
      const restB = b * 3;
      dx = template.restPositions[restB]! - template.restPositions[restA]!;
      dy = template.restPositions[restB + 1]! - template.restPositions[restA + 1]!;
      dz = template.restPositions[restB + 2]! - template.restPositions[restA + 2]!;
      // Rest vectors are unit length. A coincident edge is maximally compressed.
      scale = -stiffness;
    } else {
      scale = stiffness * (length - OCTAHEDRAL_EDGE_REST_LENGTH) / length;
    }
    const fx = dx * scale;
    const fy = dy * scale;
    const fz = dz * scale;

    forces[aOffset] = forces[aOffset]! + fx;
    forces[aOffset + 1] = forces[aOffset + 1]! + fy;
    forces[aOffset + 2] = forces[aOffset + 2]! + fz;
    forces[bOffset] = forces[bOffset]! - fx;
    forces[bOffset + 1] = forces[bOffset + 1]! - fy;
    forces[bOffset + 2] = forces[bOffset + 2]! - fz;
  }

  return Object.freeze({
    edgeEvaluations: template.edgeCount,
    pairwiseSemanticLinkEvaluations: 0 as const,
    explicitBendEvaluations: 0 as const,
  });
}

export function computeOctahedralSpringForces3D(
  template: OctahedralLinkTemplate3D,
  positions: Float32Array,
  stiffness: number,
): OctahedralSpringForceResult {
  if (positions.length !== template.vertexCount * 3) {
    throw new OctahedralLink3DError(
      "invalid-buffer",
      `positions: ${positions.length} != ${template.vertexCount * 3}`,
    );
  }
  const forces = new Float32Array(positions.length);
  const evaluations = accumulateOctahedralSpringForces3D(template, positions, forces, stiffness);
  return { forces, evaluations };
}

function triangleCentroidInto(
  template: OctahedralLinkTemplate3D,
  positions: Float32Array,
  linkIndex: number,
  triangle: readonly [number, number, number],
  out: Float32Array,
): void {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const vertex of triangle) {
    const offset = packedFloatOffset(template, linkIndex, vertex);
    x += positions[offset]!;
    y += positions[offset + 1]!;
    z += positions[offset + 2]!;
  }
  out[0] = x / 3;
  out[1] = y / 3;
  out[2] = z / 3;
}

function translateTriangle(
  template: OctahedralLinkTemplate3D,
  values: Float32Array,
  linkIndex: number,
  triangle: readonly [number, number, number],
  dx: number,
  dy: number,
  dz: number,
): void {
  for (const vertex of triangle) {
    const offset = packedFloatOffset(template, linkIndex, vertex);
    values[offset] = values[offset]! + dx;
    values[offset + 1] = values[offset + 1]! + dy;
    values[offset + 2] = values[offset + 2]! + dz;
  }
}

export function projectOctahedralHinges3D(
  topology: OctahedralLinkTopology3D,
  template: OctahedralLinkTemplate3D,
  positions: Float32Array,
): number {
  const required = topology.linkCount * template.vertexCount * 3;
  if (positions.length !== required) {
    throw new OctahedralLink3DError("invalid-buffer", `positions: ${positions.length} != ${required}`);
  }
  requireFiniteRange(positions, 0, required, "positions");
  const endpoint = new Float32Array(3);
  const target = new Float32Array(3);

  for (let link = 0; link < topology.linkCount; link += 1) {
    for (const role of ["start", "end"] as const) {
      const triangle = role === "start" ? template.startTriangle : template.endTriangle;
      const targetLink = role === "start" ? topology.startIndices[link]! : topology.endIndices[link]!;
      triangleCentroidInto(template, positions, link, triangle, endpoint);
      writeCenterInto(template, positions, targetLink, target, 0);
      translateTriangle(
        template,
        positions,
        link,
        triangle,
        target[0]! - endpoint[0]!,
        target[1]! - endpoint[1]!,
        target[2]! - endpoint[2]!,
      );
    }
  }

  return topology.linkCount * 2;
}

export function projectOctahedralHingeVelocities3D(
  topology: OctahedralLinkTopology3D,
  template: OctahedralLinkTemplate3D,
  velocities: Float32Array,
): number {
  const required = topology.linkCount * template.vertexCount * 3;
  if (velocities.length !== required) {
    throw new OctahedralLink3DError("invalid-buffer", `velocities: ${velocities.length} != ${required}`);
  }
  requireFiniteRange(velocities, 0, required, "velocities");
  const endpoint = new Float32Array(3);
  const target = new Float32Array(3);

  for (let link = 0; link < topology.linkCount; link += 1) {
    for (const role of ["start", "end"] as const) {
      const triangle = role === "start" ? template.startTriangle : template.endTriangle;
      const targetLink = role === "start" ? topology.startIndices[link]! : topology.endIndices[link]!;
      triangleCentroidInto(template, velocities, link, triangle, endpoint);
      writeCenterInto(template, velocities, targetLink, target, 0);
      translateTriangle(
        template,
        velocities,
        link,
        triangle,
        target[0]! - endpoint[0]!,
        target[1]! - endpoint[1]!,
        target[2]! - endpoint[2]!,
      );
    }
  }

  return topology.linkCount * 2;
}

export function transferOctahedralHingeForces3D(
  topology: OctahedralLinkTopology3D,
  template: OctahedralLinkTemplate3D,
  forces: Float32Array,
): number {
  const required = topology.linkCount * template.vertexCount * 3;
  if (forces.length !== required) {
    throw new OctahedralLink3DError("invalid-buffer", `forces: ${forces.length} != ${required}`);
  }
  requireFiniteRange(forces, 0, required, "forces");

  for (let link = 0; link < topology.linkCount; link += 1) {
    for (const role of ["start", "end"] as const) {
      const triangle = role === "start" ? template.startTriangle : template.endTriangle;
      const target = role === "start" ? topology.startIndices[link]! : topology.endIndices[link]!;
      let fx = 0;
      let fy = 0;
      let fz = 0;
      for (const vertex of triangle) {
        const offset = packedFloatOffset(template, link, vertex);
        fx += forces[offset]!;
        fy += forces[offset + 1]!;
        fz += forces[offset + 2]!;
      }

      // Transfer only endpoint translation. Subtracting the mean force leaves
      // the zero-net residual on the terminal ring, preserving its torque and
      // deformation instead of turning the whole face into a kinematic apex.
      for (const vertex of triangle) {
        const offset = packedFloatOffset(template, link, vertex);
        forces[offset] = forces[offset]! - fx / 3;
        forces[offset + 1] = forces[offset + 1]! - fy / 3;
        forces[offset + 2] = forces[offset + 2]! - fz / 3;
      }
      addCenterForceUnchecked(template, forces, target, fx, fy, fz);
    }
  }

  return topology.linkCount * 2;
}
