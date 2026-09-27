import {
  buildOctahedralLinkTopology3D,
  OCTAHEDRAL_DIAMETER,
  OCTAHEDRAL_EDGE_REST_LENGTH,
  OCTAHEDRAL_MODULE_HEIGHT,
  OCTAHEDRAL_TRIANGLE_RADIUS,
  type OctahedralLinkTopology3D,
} from "./octahedral-link3d.js";
import type { VisualLinkNetwork } from "./index.js";

const EPSILON = 1e-9;
const TWO_PI = 2 * Math.PI;
export const RIGID_SECTION_NODE_MASS = 1;
export const RIGID_SECTION_MASS = 3 * RIGID_SECTION_NODE_MASS;
export const RIGID_SECTION_INV_MASS = 1 / RIGID_SECTION_MASS;
export const RIGID_SECTION_LINEAR_DAMPING_RATE = 1.5;
export const RIGID_SECTION_ANGULAR_DAMPING_RATE = 1.5;
export const RIGID_SECTION_BASE_TIME_STEP = 1 / 120;
// Point-hinge constraints form disjoint stars keyed by semantic CENTER bodies.
 // One exact star-average solve replaces the old non-conservative 12-pass Jacobi loop.
export const RIGID_SECTION_HINGE_SOLVER_ITERATIONS = 1;
const CENTER_SEED_ITERATIONS = 64;
const CENTER_SEED_RELAXATION = 0.8;
const CENTER_SEED_RATIO = 0.8;

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export interface RigidSectionAspectResolution {
  readonly requestedAspectRatio: number;
  readonly resolvedAspectRatio: number;
  readonly pairCount: number;
  readonly octahedronCount: number;
}

export interface RigidSectionTemplate3D {
  readonly pairCount: number;
  readonly octahedronCount: number;
  readonly sectionCount: number;
  readonly centerSection: number;
  readonly aspectRatio: number;
  readonly restLength: number;
  readonly halfRestLength: number;
  readonly diameter: number;
  readonly edgeRestLength: 1;
  readonly moduleHeight: number;
  readonly localTriangleVertices: Float32Array;
  readonly canonicalUpperVertices: Float32Array;
  readonly canonicalRelativeOrientation: Quat;
  readonly sectionMass: number;
  readonly inverseSectionMass: number;
  readonly localInertia: Vec3;
  readonly inverseLocalInertia: Vec3;
  readonly relationPointCount: number;
}

export interface RigidSectionPotentialResult3D {
  readonly lowerForce: Vec3;
  readonly lowerTorque: Vec3;
  readonly upperForce: Vec3;
  readonly upperTorque: Vec3;
  readonly energy: number;
  readonly pointEvaluations: 3;
}

export interface RigidSectionStepEvaluation3D {
  readonly relationPointEvaluations: number;
  readonly hingeConstraintEvaluations: number;
  readonly pairwiseSemanticLinkEvaluations: 0;
}

export interface RigidSectionReverseIncidence3D {
  readonly incomingOffsets: Uint32Array;
  readonly incomingRefs: Uint32Array;
}

export function buildRigidSectionReverseIncidence3D(
  topology: OctahedralLinkTopology3D,
): RigidSectionReverseIncidence3D {
  const counts = new Uint32Array(topology.linkCount);
  for (let source = 0; source < topology.linkCount; source += 1) {
    const startTarget = topology.startIndices[source]!;
    const endTarget = topology.endIndices[source]!;
    counts[startTarget] = counts[startTarget]! + 1;
    counts[endTarget] = counts[endTarget]! + 1;
  }

  const incomingOffsets = new Uint32Array(topology.linkCount + 1);
  for (let link = 0; link < topology.linkCount; link += 1) {
    incomingOffsets[link + 1] = incomingOffsets[link]! + counts[link]!;
  }

  const incomingRefs = new Uint32Array(topology.linkCount * 2);
  const cursors = incomingOffsets.slice(0, topology.linkCount);
  for (let source = 0; source < topology.linkCount; source += 1) {
    const startTarget = topology.startIndices[source]!;
    incomingRefs[cursors[startTarget]!] = source * 2;
    cursors[startTarget] = cursors[startTarget]! + 1;

    const endTarget = topology.endIndices[source]!;
    incomingRefs[cursors[endTarget]!] = source * 2 + 1;
    cursors[endTarget] = cursors[endTarget]! + 1;
  }

  return Object.freeze({ incomingOffsets, incomingRefs });
}

export interface RigidSectionPhysicsOptions3D {
  readonly aspectRatio: number;
  readonly stiffness: number;
  readonly simulationSpeed?: number;
}

const templateCache = new Map<number, RigidSectionTemplate3D>();

function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`rigid-section non-finite ${label}: ${value}`);
  return value;
}

function requireStiffness(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid rigid-section stiffness: ${value}`);
  }
  return value;
}

function requireSimulationSpeed(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid rigid-section simulation speed: ${value}`);
  }
  return value;
}

export function resolveRigidSectionAspectRatio(
  aspectRatio: number,
): RigidSectionAspectResolution {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new Error(`invalid rigid-section aspect ratio: ${aspectRatio}`);
  }

  // With flattened end tetrahedra the geometric Link length is exactly N
  // octahedral module heights. For a regular octahedron h/diameter = 1/sqrt(2).
  const rawPairCount = aspectRatio / Math.SQRT2;
  const pairCount = Math.max(1, Math.round(rawPairCount));
  if (!Number.isSafeInteger(pairCount)) {
    throw new Error(`invalid rigid-section pair count: ${pairCount}`);
  }

  const octahedronCount = pairCount * 2;
  return Object.freeze({
    requestedAspectRatio: aspectRatio,
    resolvedAspectRatio: Math.SQRT2 * pairCount,
    pairCount,
    octahedronCount,
  });
}

function triangleVertex(corner: number): Vec3 {
  const angle = corner * TWO_PI / 3;
  return [
    OCTAHEDRAL_TRIANGLE_RADIUS * Math.cos(angle),
    OCTAHEDRAL_TRIANGLE_RADIUS * Math.sin(angle),
    0,
  ];
}

function buildTemplate(pairCount: number): RigidSectionTemplate3D {
  const octahedronCount = pairCount * 2;
  const sectionCount = octahedronCount + 1;
  const centerSection = octahedronCount / 2;
  const restLength = octahedronCount * OCTAHEDRAL_MODULE_HEIGHT;
  const localTriangleVertices = new Float32Array(9);
  const canonicalUpperVertices = new Float32Array(9);

  const twist = Math.PI / 3;
  const cosTwist = Math.cos(twist);
  const sinTwist = Math.sin(twist);

  for (let corner = 0; corner < 3; corner += 1) {
    const local = triangleVertex(corner);
    const offset = corner * 3;
    localTriangleVertices[offset] = local[0];
    localTriangleVertices[offset + 1] = local[1];
    localTriangleVertices[offset + 2] = 0;

    canonicalUpperVertices[offset] = cosTwist * local[0] - sinTwist * local[1];
    canonicalUpperVertices[offset + 1] = sinTwist * local[0] + cosTwist * local[1];
    canonicalUpperVertices[offset + 2] = OCTAHEDRAL_MODULE_HEIGHT;
  }

  // Three equal point masses at radius 1/sqrt(3):
  // Ixx = Iyy = 1/2, Izz = 1 for unit node mass.
  const localInertia: Vec3 = [0.5, 0.5, 1];
  const inverseLocalInertia: Vec3 = [2, 2, 1];

  return Object.freeze({
    pairCount,
    octahedronCount,
    sectionCount,
    centerSection,
    aspectRatio: Math.SQRT2 * pairCount,
    restLength,
    halfRestLength: restLength / 2,
    diameter: OCTAHEDRAL_DIAMETER,
    edgeRestLength: OCTAHEDRAL_EDGE_REST_LENGTH,
    moduleHeight: OCTAHEDRAL_MODULE_HEIGHT,
    localTriangleVertices,
    canonicalUpperVertices,
    canonicalRelativeOrientation: Object.freeze([
      0,
      0,
      Math.sin(twist / 2),
      Math.cos(twist / 2),
    ]) as Quat,
    sectionMass: RIGID_SECTION_MASS,
    inverseSectionMass: RIGID_SECTION_INV_MASS,
    localInertia,
    inverseLocalInertia,
    relationPointCount: 3,
  });
}

export function getRigidSectionTemplate3D(aspectRatio: number): RigidSectionTemplate3D {
  const resolved = resolveRigidSectionAspectRatio(aspectRatio);
  const cached = templateCache.get(resolved.pairCount);
  if (cached !== undefined) return cached;
  const template = buildTemplate(resolved.pairCount);
  templateCache.set(resolved.pairCount, template);
  return template;
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale3(a: Vec3, scale: number): Vec3 {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize3(a: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 {
  const length = length3(a);
  if (!(length > EPSILON) || !Number.isFinite(length)) return fallback;
  return [a[0] / length, a[1] / length, a[2] / length];
}

export function normalizeRigidSectionQuaternion3D(q: Quat): Quat {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(length > EPSILON) || !Number.isFinite(length)) return [0, 0, 0, 1];
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

export function multiplyRigidSectionQuaternions3D(left: Quat, right: Quat): Quat {
  const [lx, ly, lz, lw] = left;
  const [rx, ry, rz, rw] = right;
  return normalizeRigidSectionQuaternion3D([
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ]);
}

export function rotateRigidSectionVector3D(q: Quat, vector: Vec3): Vec3 {
  const normalized = normalizeRigidSectionQuaternion3D(q);
  const qv: Vec3 = [normalized[0], normalized[1], normalized[2]];
  const uv = cross3(qv, vector);
  const uuv = cross3(qv, uv);
  return add3(vector, add3(scale3(uv, 2 * normalized[3]), scale3(uuv, 2)));
}

function quaternionFromBasis(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quat {
  // Active local->world rotation matrix stored by columns.
  const m00 = xAxis[0];
  const m01 = yAxis[0];
  const m02 = zAxis[0];
  const m10 = xAxis[1];
  const m11 = yAxis[1];
  const m12 = zAxis[1];
  const m20 = xAxis[2];
  const m21 = yAxis[2];
  const m22 = zAxis[2];
  const trace = m00 + m11 + m22;

  let x: number;
  let y: number;
  let z: number;
  let w: number;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }

  return normalizeRigidSectionQuaternion3D([x, y, z, w]);
}

function quaternionAroundLocalZ(angle: number): Quat {
  return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
}

function frameForTangent(tangent: Vec3, twist: number): Quat {
  const zAxis = normalize3(tangent);
  const helper: Vec3 = Math.abs(zAxis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const xAxis = normalize3(cross3(helper, zAxis), [1, 0, 0]);
  const yAxis = normalize3(cross3(zAxis, xAxis), [0, 1, 0]);
  return multiplyRigidSectionQuaternions3D(
    quaternionFromBasis(xAxis, yAxis, zAxis),
    quaternionAroundLocalZ(twist),
  );
}

function readVec3(buffer: Float32Array | Float64Array, index: number): Vec3 {
  const offset = index * 3;
  return [buffer[offset]!, buffer[offset + 1]!, buffer[offset + 2]!];
}

function writeVec3(buffer: Float32Array | Float64Array, index: number, value: Vec3): void {
  const offset = index * 3;
  buffer[offset] = value[0];
  buffer[offset + 1] = value[1];
  buffer[offset + 2] = value[2];
}

function readQuat(buffer: Float32Array, index: number): Quat {
  const offset = index * 4;
  return [buffer[offset]!, buffer[offset + 1]!, buffer[offset + 2]!, buffer[offset + 3]!];
}

function writeQuat(buffer: Float32Array, index: number, value: Quat): void {
  const q = normalizeRigidSectionQuaternion3D(value);
  const offset = index * 4;
  buffer[offset] = q[0];
  buffer[offset + 1] = q[1];
  buffer[offset + 2] = q[2];
  buffer[offset + 3] = q[3];
}

function addToVec3(buffer: Float64Array, index: number, value: Vec3): void {
  const offset = index * 3;
  buffer[offset] = buffer[offset]! + value[0];
  buffer[offset + 1] = buffer[offset + 1]! + value[1];
  buffer[offset + 2] = buffer[offset + 2]! + value[2];
}

function pointFromBody(center: Vec3, orientation: Quat, local: Vec3): Vec3 {
  return add3(center, rotateRigidSectionVector3D(orientation, local));
}

export function evaluateRigidSectionPotential3D(
  template: RigidSectionTemplate3D,
  lowerCenter: Vec3,
  lowerOrientation: Quat,
  upperCenter: Vec3,
  upperOrientation: Quat,
  stiffness: number,
): RigidSectionPotentialResult3D {
  const k = requireStiffness(stiffness);
  let lowerForce: Vec3 = [0, 0, 0];
  let lowerTorque: Vec3 = [0, 0, 0];
  let upperForce: Vec3 = [0, 0, 0];
  let upperTorque: Vec3 = [0, 0, 0];
  let energy = 0;

  for (let corner = 0; corner < 3; corner += 1) {
    const offset = corner * 3;
    const localUpper: Vec3 = [
      template.localTriangleVertices[offset]!,
      template.localTriangleVertices[offset + 1]!,
      template.localTriangleVertices[offset + 2]!,
    ];
    const canonicalTarget: Vec3 = [
      template.canonicalUpperVertices[offset]!,
      template.canonicalUpperVertices[offset + 1]!,
      template.canonicalUpperVertices[offset + 2]!,
    ];

    const actual = pointFromBody(upperCenter, upperOrientation, localUpper);
    const target = pointFromBody(lowerCenter, lowerOrientation, canonicalTarget);
    const delta = subtract3(actual, target);
    const forceOnUpper = scale3(delta, -k);
    const forceOnLower = scale3(forceOnUpper, -1);

    upperForce = add3(upperForce, forceOnUpper);
    lowerForce = add3(lowerForce, forceOnLower);
    upperTorque = add3(
      upperTorque,
      cross3(subtract3(actual, upperCenter), forceOnUpper),
    );
    lowerTorque = add3(
      lowerTorque,
      cross3(subtract3(target, lowerCenter), forceOnLower),
    );
    energy += 0.5 * k * dot3(delta, delta);
  }

  return Object.freeze({
    lowerForce,
    lowerTorque,
    upperForce,
    upperTorque,
    energy,
    pointEvaluations: 3,
  });
}

function compactCenterSeed(template: RigidSectionTemplate3D, index: number, count: number): Vec3 {
  if (count <= 1) return [0, 0, 0];
  const side = Math.ceil(Math.cbrt(count));
  const plane = side * side;
  const depth = Math.ceil(count / plane);
  const spacing = Math.max(template.diameter * 1.5, template.halfRestLength * 0.25);
  const x = index % side;
  const y = Math.floor(index / side) % side;
  const z = Math.floor(index / plane);
  return [
    (x - (side - 1) / 2) * spacing,
    (y - (side - 1) / 2) * spacing,
    (z - (depth - 1) / 2) * spacing,
  ];
}

function fallbackPairDirection(source: number, target: number): Vec3 {
  const hash = (
    Math.imul(Math.min(source, target) + 1, 73_856_093)
    ^ Math.imul(Math.max(source, target) + 1, 19_349_663)
  ) >>> 0;
  const axes: readonly Vec3[] = [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1],
  ];
  const axis = axes[hash % axes.length]!;
  return source <= target ? axis : scale3(axis, -1);
}

export function resolveRigidSectionSemanticCenters3D(
  template: RigidSectionTemplate3D,
  topology: OctahedralLinkTopology3D,
): Float32Array {
  const count = topology.linkCount;
  if (count === 0) return new Float32Array(0);

  const centers = new Float64Array(count * 3);
  for (let link = 0; link < count; link += 1) {
    writeVec3(centers, link, compactCenterSeed(template, link, count));
  }

  const correction = new Float64Array(count * 3);
  const weights = new Float64Array(count);
  const targetLength = template.halfRestLength * CENTER_SEED_RATIO;

  const accumulate = (source: number, target: number): void => {
    if (source === target) return;
    const sourceCenter = readVec3(centers, source);
    const targetCenter = readVec3(centers, target);
    let delta = subtract3(targetCenter, sourceCenter);
    let length = length3(delta);
    if (!(length > EPSILON)) {
      delta = fallbackPairDirection(source, target);
      length = 1;
    }
    const halfError = (targetLength - length) * 0.5;
    const direction = scale3(delta, 1 / length);
    const move = scale3(direction, halfError);
    addToVec3(correction, source, scale3(move, -1));
    addToVec3(correction, target, move);
    weights[source] = weights[source]! + 1;
    weights[target] = weights[target]! + 1;
  };

  for (let iteration = 0; iteration < CENTER_SEED_ITERATIONS; iteration += 1) {
    correction.fill(0);
    weights.fill(0);
    for (let link = 0; link < count; link += 1) {
      accumulate(link, topology.startIndices[link]!);
      accumulate(link, topology.endIndices[link]!);
    }
    for (let link = 0; link < count; link += 1) {
      const weight = weights[link]!;
      if (!(weight > 0)) continue;
      const current = readVec3(centers, link);
      const shift = scale3(readVec3(correction, link), CENTER_SEED_RELAXATION / weight);
      writeVec3(centers, link, add3(current, shift));
    }
  }

  return new Float32Array(centers);
}

function semanticCenterAt(
  centers: Float32Array,
  link: number,
): Vec3 {
  return readVec3(centers, link);
}

function deterministicLinkAxes(link: number): readonly [Vec3, Vec3, Vec3] {
  const angle = (link * 0.7548776662466927) % TWO_PI;
  const z: Vec3 = normalize3([Math.cos(angle), 0.35 + 0.1 * Math.sin(angle * 1.7), Math.sin(angle)]);
  const helper: Vec3 = Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const x = normalize3(cross3(helper, z), [1, 0, 0]);
  const y = normalize3(cross3(z, x), [0, 1, 0]);
  return [x, y, z];
}

function selfLoopPoint(
  center: Vec3,
  axes: readonly [Vec3, Vec3, Vec3],
  radius: number,
  u: number,
  lobeSign: number,
): Vec3 {
  const theta = TWO_PI * u;
  const [xAxis, , zAxis] = axes;
  return add3(
    center,
    add3(
      scale3(zAxis, radius * Math.sin(theta)),
      scale3(xAxis, lobeSign * radius * (1 - Math.cos(theta))),
    ),
  );
}

function initializeLinkSections(
  template: RigidSectionTemplate3D,
  topology: OctahedralLinkTopology3D,
  semanticCenters: Float32Array,
  link: number,
  centers: Float32Array,
  orientations: Float32Array,
): void {
  const sectionCount = template.sectionCount;
  const middle = template.centerSection;
  const base = link * sectionCount;
  const own = semanticCenterAt(semanticCenters, link);
  const startTargetIndex = topology.startIndices[link]!;
  const endTargetIndex = topology.endIndices[link]!;
  const startTarget = semanticCenterAt(semanticCenters, startTargetIndex);
  const endTarget = semanticCenterAt(semanticCenters, endTargetIndex);
  const axes = deterministicLinkAxes(link);
  const loopRadius = template.halfRestLength / TWO_PI;

  for (let local = 0; local < sectionCount; local += 1) {
    let position: Vec3;
    if (local <= middle) {
      const u = middle === 0 ? 1 : local / middle;
      if (startTargetIndex === link) {
        position = selfLoopPoint(own, axes, loopRadius, u, -1);
      } else {
        position = add3(startTarget, scale3(subtract3(own, startTarget), u));
      }
    } else {
      const u = (local - middle) / (sectionCount - 1 - middle);
      if (endTargetIndex === link) {
        position = selfLoopPoint(own, axes, loopRadius, u, 1);
      } else {
        position = add3(own, scale3(subtract3(endTarget, own), u));
      }
    }
    writeVec3(centers, base + local, position);
  }

  for (let local = 0; local < sectionCount; local += 1) {
    const current = readVec3(centers, base + local);
    const previous = readVec3(centers, base + Math.max(0, local - 1));
    const next = readVec3(centers, base + Math.min(sectionCount - 1, local + 1));
    let tangent = subtract3(next, previous);
    if (!(length3(tangent) > EPSILON)) {
      tangent = local === 0 ? subtract3(next, current) : subtract3(current, previous);
    }
    if (!(length3(tangent) > EPSILON)) tangent = axes[2];
    const twist = local * Math.PI / 3;
    writeQuat(orientations, base + local, frameForTangent(tangent, twist));
  }
}

export class RigidSectionPhysics3D {
  readonly topology: OctahedralLinkTopology3D;
  readonly template: RigidSectionTemplate3D;
  readonly centers: Float32Array;
  readonly orientations: Float32Array;
  readonly linearVelocities: Float32Array;
  readonly angularVelocities: Float32Array;
  readonly forces: Float64Array;
  readonly torques: Float64Array;
  readonly reverseIncidence: RigidSectionReverseIncidence3D;
  private readonly hingeScratchCenters: Float32Array;
  private readonly hingeScratchVelocities: Float32Array;
  stiffness: number;
  simulationSpeed: number;

  constructor(network: VisualLinkNetwork, options: RigidSectionPhysicsOptions3D) {
    this.topology = buildOctahedralLinkTopology3D(network);
    this.template = getRigidSectionTemplate3D(options.aspectRatio);
    this.stiffness = requireStiffness(options.stiffness);
    this.simulationSpeed = requireSimulationSpeed(options.simulationSpeed ?? 1);

    const bodyCount = this.topology.linkCount * this.template.sectionCount;
    this.centers = new Float32Array(bodyCount * 3);
    this.orientations = new Float32Array(bodyCount * 4);
    this.linearVelocities = new Float32Array(bodyCount * 3);
    this.angularVelocities = new Float32Array(bodyCount * 3);
    this.forces = new Float64Array(bodyCount * 3);
    this.torques = new Float64Array(bodyCount * 3);
    this.reverseIncidence = buildRigidSectionReverseIncidence3D(this.topology);
    this.hingeScratchCenters = new Float32Array(bodyCount * 3);
    this.hingeScratchVelocities = new Float32Array(bodyCount * 3);

    const semanticCenters = resolveRigidSectionSemanticCenters3D(this.template, this.topology);
    for (let link = 0; link < this.topology.linkCount; link += 1) {
      initializeLinkSections(
        this.template,
        this.topology,
        semanticCenters,
        link,
        this.centers,
        this.orientations,
      );
    }
    this.projectHinges();
  }

  get bodyCount(): number {
    return this.topology.linkCount * this.template.sectionCount;
  }

  sectionBodyIndex(link: number, localSection: number): number {
    if (!Number.isInteger(link) || link < 0 || link >= this.topology.linkCount) {
      throw new Error(`invalid rigid-section link index: ${link}`);
    }
    if (
      !Number.isInteger(localSection)
      || localSection < 0
      || localSection >= this.template.sectionCount
    ) {
      throw new Error(`invalid rigid-section local section: ${localSection}`);
    }
    return link * this.template.sectionCount + localSection;
  }

  semanticCenter(link: number): Vec3 {
    return readVec3(this.centers, this.sectionBodyIndex(link, this.template.centerSection));
  }

  startCenter(link: number): Vec3 {
    return readVec3(this.centers, this.sectionBodyIndex(link, 0));
  }

  endCenter(link: number): Vec3 {
    return readVec3(
      this.centers,
      this.sectionBodyIndex(link, this.template.sectionCount - 1),
    );
  }

  evaluateForces(): RigidSectionStepEvaluation3D {
    this.forces.fill(0);
    this.torques.fill(0);
    let relationPointEvaluations = 0;

    for (let link = 0; link < this.topology.linkCount; link += 1) {
      for (let local = 0; local < this.template.octahedronCount; local += 1) {
        const lower = this.sectionBodyIndex(link, local);
        const upper = this.sectionBodyIndex(link, local + 1);
        const result = evaluateRigidSectionPotential3D(
          this.template,
          readVec3(this.centers, lower),
          readQuat(this.orientations, lower),
          readVec3(this.centers, upper),
          readQuat(this.orientations, upper),
          this.stiffness,
        );
        addToVec3(this.forces, lower, result.lowerForce);
        addToVec3(this.forces, upper, result.upperForce);
        addToVec3(this.torques, lower, result.lowerTorque);
        addToVec3(this.torques, upper, result.upperTorque);
        relationPointEvaluations += result.pointEvaluations;
      }
    }

    return Object.freeze({
      relationPointEvaluations,
      hingeConstraintEvaluations:
        this.topology.linkCount * 2 * RIGID_SECTION_HINGE_SOLVER_ITERATIONS,
      pairwiseSemanticLinkEvaluations: 0,
    });
  }

  private worldAngularAcceleration(body: number): Vec3 {
    const q = readQuat(this.orientations, body);
    const torqueWorld = readVec3(this.torques, body);
    const omegaWorld = readVec3(this.angularVelocities, body);
    const conjugate: Quat = [-q[0], -q[1], -q[2], q[3]];
    const torqueLocal = rotateRigidSectionVector3D(conjugate, torqueWorld);
    const omegaLocal = rotateRigidSectionVector3D(conjugate, omegaWorld);
    const angularMomentumLocal: Vec3 = [
      omegaLocal[0] * this.template.localInertia[0],
      omegaLocal[1] * this.template.localInertia[1],
      omegaLocal[2] * this.template.localInertia[2],
    ];
    const gyroscopic = cross3(omegaLocal, angularMomentumLocal);
    const alphaLocal: Vec3 = [
      (torqueLocal[0] - gyroscopic[0]) * this.template.inverseLocalInertia[0],
      (torqueLocal[1] - gyroscopic[1]) * this.template.inverseLocalInertia[1],
      (torqueLocal[2] - gyroscopic[2]) * this.template.inverseLocalInertia[2],
    ];
    return rotateRigidSectionVector3D(q, alphaLocal);
  }

  private integrate(dt: number): void {
    const linearDamping = Math.exp(-RIGID_SECTION_LINEAR_DAMPING_RATE * dt);
    const angularDamping = Math.exp(-RIGID_SECTION_ANGULAR_DAMPING_RATE * dt);

    for (let body = 0; body < this.bodyCount; body += 1) {
      const velocity = readVec3(this.linearVelocities, body);
      const force = readVec3(this.forces, body);
      const nextVelocity = scale3(
        add3(velocity, scale3(force, this.template.inverseSectionMass * dt)),
        linearDamping,
      );
      writeVec3(this.linearVelocities, body, nextVelocity);
      writeVec3(
        this.centers,
        body,
        add3(readVec3(this.centers, body), scale3(nextVelocity, dt)),
      );

      const omega = readVec3(this.angularVelocities, body);
      const alpha = this.worldAngularAcceleration(body);
      const nextOmega = scale3(add3(omega, scale3(alpha, dt)), angularDamping);
      writeVec3(this.angularVelocities, body, nextOmega);

      const q = readQuat(this.orientations, body);
      const omegaQuat: Quat = [nextOmega[0], nextOmega[1], nextOmega[2], 0];
      const dq = multiplyQuaternionRaw(omegaQuat, q);
      writeQuat(this.orientations, body, [
        q[0] + 0.5 * dq[0] * dt,
        q[1] + 0.5 * dq[1] * dt,
        q[2] + 0.5 * dq[2] * dt,
        q[3] + 0.5 * dq[3] * dt,
      ]);
    }
  }

  projectHinges(): void {
    const sectionCount = this.template.sectionCount;
    const middle = this.template.centerSection;
    const endSection = sectionCount - 1;

    // The hinge graph is a disjoint union of stars:
    //
    //   CENTER(target) -- START(source)
    //                  -- END(source)
    //                  -- ...
    //
    // Every START/END body belongs to exactly one target star and every
    // semantic CENTER owns exactly one star. With equal section masses, the
    // exact rigid point-constraint projection is therefore the arithmetic
    // mean of position and velocity over each star. This preserves each
    // star's center of mass and linear momentum exactly while satisfying all
    // hinge coincidences in one deterministic O(N) solve.
    for (let targetLink = 0; targetLink < this.topology.linkCount; targetLink += 1) {
      const middleBody = this.sectionBodyIndex(targetLink, middle);
      let centerSum = readVec3(this.centers, middleBody);
      let velocitySum = readVec3(this.linearVelocities, middleBody);
      let memberCount = 1;

      const begin = this.reverseIncidence.incomingOffsets[targetLink]!;
      const finish = this.reverseIncidence.incomingOffsets[targetLink + 1]!;
      for (let cursor = begin; cursor < finish; cursor += 1) {
        const encoded = this.reverseIncidence.incomingRefs[cursor]!;
        const sourceLink = Math.floor(encoded / 2);
        const role = encoded & 1;
        const endpointBody = this.sectionBodyIndex(
          sourceLink,
          role === 0 ? 0 : endSection,
        );
        centerSum = add3(centerSum, readVec3(this.centers, endpointBody));
        velocitySum = add3(
          velocitySum,
          readVec3(this.linearVelocities, endpointBody),
        );
        memberCount += 1;
      }

      const inverseCount = 1 / memberCount;
      writeVec3(
        this.hingeScratchCenters,
        middleBody,
        scale3(centerSum, inverseCount),
      );
      writeVec3(
        this.hingeScratchVelocities,
        middleBody,
        scale3(velocitySum, inverseCount),
      );
    }

    for (let link = 0; link < this.topology.linkCount; link += 1) {
      const ownMiddle = this.sectionBodyIndex(link, middle);
      writeVec3(
        this.centers,
        ownMiddle,
        readVec3(this.hingeScratchCenters, ownMiddle),
      );
      writeVec3(
        this.linearVelocities,
        ownMiddle,
        readVec3(this.hingeScratchVelocities, ownMiddle),
      );

      const startTargetMiddle = this.sectionBodyIndex(
        this.topology.startIndices[link]!,
        middle,
      );
      const startBody = this.sectionBodyIndex(link, 0);
      writeVec3(
        this.centers,
        startBody,
        readVec3(this.hingeScratchCenters, startTargetMiddle),
      );
      writeVec3(
        this.linearVelocities,
        startBody,
        readVec3(this.hingeScratchVelocities, startTargetMiddle),
      );

      const endTargetMiddle = this.sectionBodyIndex(
        this.topology.endIndices[link]!,
        middle,
      );
      const endBody = this.sectionBodyIndex(link, endSection);
      writeVec3(
        this.centers,
        endBody,
        readVec3(this.hingeScratchCenters, endTargetMiddle),
      );
      writeVec3(
        this.linearVelocities,
        endBody,
        readVec3(this.hingeScratchVelocities, endTargetMiddle),
      );
    }
  }

  step(): RigidSectionStepEvaluation3D {
    const dt = RIGID_SECTION_BASE_TIME_STEP * this.simulationSpeed;
    const evaluation = this.evaluateForces();
    if (dt === 0) return evaluation;
    this.integrate(dt);
    this.projectHinges();
    this.assertFiniteState();
    return evaluation;
  }

  assertFiniteState(): void {
    const arrays: readonly (Float32Array | Float64Array)[] = [
      this.centers,
      this.orientations,
      this.linearVelocities,
      this.angularVelocities,
    ];
    for (const values of arrays) {
      for (let index = 0; index < values.length; index += 1) {
        assertFinite(values[index]!, `state[${index}]`);
      }
    }
  }
}

function multiplyQuaternionRaw(left: Quat, right: Quat): Quat {
  const [lx, ly, lz, lw] = left;
  const [rx, ry, rz, rw] = right;
  return [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ];
}

export function createRigidSectionPhysics3D(
  network: VisualLinkNetwork,
  options: RigidSectionPhysicsOptions3D,
): RigidSectionPhysics3D {
  return new RigidSectionPhysics3D(network, options);
}

export function rigidSectionOrientationDeterminant3D(orientation: Quat): number {
  const q = normalizeRigidSectionQuaternion3D(orientation);
  // Unit quaternions parameterize SO(3): determinant is analytically +1.
  // Compute it explicitly as a fail-closed diagnostic for numerical state.
  const [x, y, z, w] = q;
  const m00 = 1 - 2 * (y * y + z * z);
  const m01 = 2 * (x * y - z * w);
  const m02 = 2 * (x * z + y * w);
  const m10 = 2 * (x * y + z * w);
  const m11 = 1 - 2 * (x * x + z * z);
  const m12 = 2 * (y * z - x * w);
  const m20 = 2 * (x * z - y * w);
  const m21 = 2 * (y * z + x * w);
  const m22 = 1 - 2 * (x * x + y * y);

  return (
    m00 * (m11 * m22 - m12 * m21)
    - m01 * (m10 * m22 - m12 * m20)
    + m02 * (m10 * m21 - m11 * m20)
  );
}

export function rigidSectionHingeError3D(
  controller: RigidSectionPhysics3D,
): number {
  let maximum = 0;
  const middle = controller.template.centerSection;
  const endSection = controller.template.sectionCount - 1;
  for (let link = 0; link < controller.topology.linkCount; link += 1) {
    const start = controller.startCenter(link);
    const startTarget = readVec3(
      controller.centers,
      controller.sectionBodyIndex(controller.topology.startIndices[link]!, middle),
    );
    const end = controller.endCenter(link);
    const endTarget = readVec3(
      controller.centers,
      controller.sectionBodyIndex(controller.topology.endIndices[link]!, middle),
    );
    maximum = Math.max(
      maximum,
      length3(subtract3(start, startTarget)),
      length3(subtract3(end, endTarget)),
    );
  }
  return maximum;
}

export function rigidSectionPotentialEnergy3D(
  controller: RigidSectionPhysics3D,
): number {
  let energy = 0;
  for (let link = 0; link < controller.topology.linkCount; link += 1) {
    for (let local = 0; local < controller.template.octahedronCount; local += 1) {
      const lower = controller.sectionBodyIndex(link, local);
      const upper = controller.sectionBodyIndex(link, local + 1);
      energy += evaluateRigidSectionPotential3D(
        controller.template,
        readVec3(controller.centers, lower),
        readQuat(controller.orientations, lower),
        readVec3(controller.centers, upper),
        readQuat(controller.orientations, upper),
        controller.stiffness,
      ).energy;
    }
  }
  return energy;
}
