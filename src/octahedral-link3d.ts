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
  readonly centerTriangle: readonly [number, number, number];
  readonly startApex: number;
  readonly endApex: number;
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

function requireFiniteBuffer(values: Float32Array, minimumLength: number, label: string): void {
  if (values.length < minimumLength) {
    throw new OctahedralLink3DError("invalid-buffer", `${label}: ${values.length} < ${minimumLength}`);
  }
  for (let index = 0; index < minimumLength; index += 1) {
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

  const rawPairCount = aspectRatio / SQRT_TWO - 1;
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
  const ringVertexCount = levelCount * 3;
  const startApex = ringVertexCount;
  const endApex = ringVertexCount + 1;
  const vertexCount = ringVertexCount + 2;
  const restLength = (octahedronCount + 2) * OCTAHEDRAL_MODULE_HEIGHT;
  const halfLength = restLength / 2;

  const restPositions = new Float32Array(vertexCount * 3);
  const gradientT = new Float32Array(vertexCount);

  for (let level = 0; level < levelCount; level += 1) {
    const rotation = level % 2 === 0 ? 0 : Math.PI / 3;
    const z = -halfLength + (level + 1) * OCTAHEDRAL_MODULE_HEIGHT;
    const t = (level + 1) / (octahedronCount + 2);
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

  restPositions[startApex * 3 + 2] = -halfLength;
  restPositions[endApex * 3 + 2] = halfLength;
  gradientT[startApex] = 0;
  gradientT[endApex] = 1;

  const edgeAList: number[] = [];
  const edgeBList: number[] = [];
  const edgeKeys = new Set<string>();

  // Every transverse level has one triangular ring.
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

  // Each regular octahedron contributes six diagonals between its two
  // triangular levels. The alternating offset follows the proven mast-calculator
  // octahedral stacking convention.
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

  // START/END tetrahedra share the first/last triangular rings.
  for (let corner = 0; corner < 3; corner += 1) {
    pushUniqueEdge(edgeAList, edgeBList, edgeKeys, startApex, levelVertex(0, corner));
    pushUniqueEdge(
      edgeAList,
      edgeBList,
      edgeKeys,
      endApex,
      levelVertex(octahedronCount, corner),
    );
  }

  const edgeA = new Uint32Array(edgeAList);
  const edgeB = new Uint32Array(edgeBList);

  // Only external triangles are rendered. Shared transverse faces are internal.
  const triangles: number[] = [];
  for (let corner = 0; corner < 3; corner += 1) {
    triangles.push(startApex, levelVertex(0, (corner + 1) % 3), levelVertex(0, corner));
  }

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

  for (let corner = 0; corner < 3; corner += 1) {
    triangles.push(
      endApex,
      levelVertex(octahedronCount, corner),
      levelVertex(octahedronCount, (corner + 1) % 3),
    );
  }

  const centerLevel = pairCount;
  const centerTriangle = Object.freeze([
    levelVertex(centerLevel, 0),
    levelVertex(centerLevel, 1),
    levelVertex(centerLevel, 2),
  ]) as readonly [number, number, number];

  const surfaceTriangles = new Uint32Array(triangles);
  const edgeBatches = buildConflictFreeEdgeBatches(edgeA, edgeB);

  return Object.freeze({
    pairCount,
    octahedronCount,
    aspectRatio: SQRT_TWO * (pairCount + 1),
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
    centerTriangle,
    startApex,
    endApex,
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
  const required = (linkIndex + 1) * template.vertexCount * 3;
  requireFiniteBuffer(positions, required, "positions");
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
  const required = (linkIndex + 1) * template.vertexCount * 3;
  requireFiniteBuffer(forces, required, "forces");
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
  const required = (linkIndex + 1) * template.vertexCount * 3;
  requireFiniteBuffer(positions, required, "positions");
  requireFiniteBuffer(forces, required, "forces");

  for (let edge = 0; edge < template.edgeCount; edge += 1) {
    const a = template.edgeA[edge]!;
    const b = template.edgeB[edge]!;
    const aOffset = packedFloatOffset(template, linkIndex, a);
    const bOffset = packedFloatOffset(template, linkIndex, b);

    let dx = positions[bOffset]! - positions[aOffset]!;
    let dy = positions[bOffset + 1]! - positions[aOffset + 1]!;
    let dz = positions[bOffset + 2]! - positions[aOffset + 2]!;
    let length = Math.hypot(dx, dy, dz);

    if (length <= EPSILON) {
      const restA = a * 3;
      const restB = b * 3;
      dx = template.restPositions[restB]! - template.restPositions[restA]!;
      dy = template.restPositions[restB + 1]! - template.restPositions[restA + 1]!;
      dz = template.restPositions[restB + 2]! - template.restPositions[restA + 2]!;
      length = OCTAHEDRAL_EDGE_REST_LENGTH;
    }

    const scale = stiffness * (length - OCTAHEDRAL_EDGE_REST_LENGTH) / length;
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

export function projectOctahedralHinges3D(
  topology: OctahedralLinkTopology3D,
  template: OctahedralLinkTemplate3D,
  positions: Float32Array,
): number {
  const required = topology.linkCount * template.vertexCount * 3;
  if (positions.length !== required) {
    throw new OctahedralLink3DError("invalid-buffer", `positions: ${positions.length} != ${required}`);
  }
  requireFiniteBuffer(positions, required, "positions");
  const center = new Float32Array(3);

  for (let link = 0; link < topology.linkCount; link += 1) {
    const startTarget = topology.startIndices[link]!;
    writeCenterInto(template, positions, startTarget, center, 0);
    let offset = packedFloatOffset(template, link, template.startApex);
    positions[offset] = center[0]!;
    positions[offset + 1] = center[1]!;
    positions[offset + 2] = center[2]!;

    const endTarget = topology.endIndices[link]!;
    writeCenterInto(template, positions, endTarget, center, 0);
    offset = packedFloatOffset(template, link, template.endApex);
    positions[offset] = center[0]!;
    positions[offset + 1] = center[1]!;
    positions[offset + 2] = center[2]!;
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
  requireFiniteBuffer(forces, required, "forces");

  for (let link = 0; link < topology.linkCount; link += 1) {
    for (const role of ["start", "end"] as const) {
      const apex = role === "start" ? template.startApex : template.endApex;
      const target = role === "start" ? topology.startIndices[link]! : topology.endIndices[link]!;
      const offset = packedFloatOffset(template, link, apex);
      const fx = forces[offset]!;
      const fy = forces[offset + 1]!;
      const fz = forces[offset + 2]!;
      forces[offset] = 0;
      forces[offset + 1] = 0;
      forces[offset + 2] = 0;
      addOctahedralCenterForce3D(template, forces, target, fx, fy, fz);
    }
  }

  return topology.linkCount * 2;
}
