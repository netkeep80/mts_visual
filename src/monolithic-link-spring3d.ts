import {
  buildOctahedralLinkTopology3D,
  OCTAHEDRAL_DIAMETER,
  OCTAHEDRAL_EDGE_REST_LENGTH,
  OCTAHEDRAL_MODULE_HEIGHT,
  type OctahedralLinkTopology3D,
} from "./octahedral-link3d.js";
import type { VisualLinkNetwork } from "./index.js";

const EPSILON = 1e-9;
export const MONOLITHIC_LINK_BASE_TIME_STEP = 1 / 120;
export const MONOLITHIC_LINK_DEFAULT_CENTER_MASS = 1;
export const MONOLITHIC_LINK_DEFAULT_DAMPING_RATE = 1.5;

export type MonolithicLinkVec3 = readonly [number, number, number];

export interface MonolithicLinkSpringTemplate3D {
  readonly pairCount: number;
  readonly octahedronCount: number;
  readonly aspectRatio: number;
  readonly restLength: number;
  readonly halfRestLength: number;
  readonly diameter: number;
  readonly edgeRestLength: number;
  readonly moduleHeight: number;
}

export interface MonolithicLinkSpringMaterial3D {
  readonly stretchStiffness: number;
  readonly straighteningStiffness: number;
  readonly nonlinearity?: number;
}

export interface MonolithicLinkSpringOptions3D
extends MonolithicLinkSpringMaterial3D {
  readonly aspectRatio: number;
  readonly centerMass?: number;
  readonly dampingRate?: number;
  readonly simulationSpeed?: number;
}

export interface MonolithicLinkSpringPotential3D {
  readonly startForce: MonolithicLinkVec3;
  readonly centerForce: MonolithicLinkVec3;
  readonly endForce: MonolithicLinkVec3;
  readonly stretchEnergy: number;
  readonly straighteningEnergy: number;
  readonly energy: number;
}

export interface MonolithicLinkSpringStepStats3D {
  readonly linkPotentialEvaluations: number;
  readonly linkForceContributions: number;
  readonly semanticCenterIntegrations: number;
  readonly octahedralPhysicsEvaluations: 0;
}

const templateCache = new Map<number, MonolithicLinkSpringTemplate3D>();

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`monolithic Link non-finite ${label}: ${String(value)}`);
  }
  return value;
}

function nonNegative(value: number, label: string): number {
  finite(value, label);
  if (value < 0) {
    throw new Error(`invalid monolithic Link ${label}: ${String(value)}`);
  }
  return value;
}

function positive(value: number, label: string): number {
  finite(value, label);
  if (!(value > 0)) {
    throw new Error(`invalid monolithic Link ${label}: ${String(value)}`);
  }
  return value;
}

function add3(a: MonolithicLinkVec3, b: MonolithicLinkVec3): MonolithicLinkVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract3(a: MonolithicLinkVec3, b: MonolithicLinkVec3): MonolithicLinkVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale3(a: MonolithicLinkVec3, scale: number): MonolithicLinkVec3 {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

function dot3(a: MonolithicLinkVec3, b: MonolithicLinkVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length3(a: MonolithicLinkVec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function readVec3(values: Float32Array | Float64Array, index: number): MonolithicLinkVec3 {
  const offset = index * 3;
  return [values[offset]!, values[offset + 1]!, values[offset + 2]!];
}

function writeVec3(
  values: Float32Array | Float64Array,
  index: number,
  value: MonolithicLinkVec3,
): void {
  const offset = index * 3;
  values[offset] = value[0];
  values[offset + 1] = value[1];
  values[offset + 2] = value[2];
}

function addToVec3(
  values: Float64Array,
  index: number,
  value: MonolithicLinkVec3,
): void {
  const offset = index * 3;
  values[offset] = values[offset]! + value[0];
  values[offset + 1] = values[offset + 1]! + value[1];
  values[offset + 2] = values[offset + 2]! + value[2];
}

export function getMonolithicLinkSpringTemplate3D(
  aspectRatio: number,
): MonolithicLinkSpringTemplate3D {
  positive(aspectRatio, "aspectRatio");
  const pairCount = Math.max(1, Math.round(aspectRatio / Math.SQRT2));
  if (!Number.isSafeInteger(pairCount)) {
    throw new Error(`invalid monolithic Link pairCount: ${String(pairCount)}`);
  }

  const cached = templateCache.get(pairCount);
  if (cached !== undefined) return cached;

  const octahedronCount = pairCount * 2;
  const restLength = octahedronCount * OCTAHEDRAL_MODULE_HEIGHT;
  const template = Object.freeze({
    pairCount,
    octahedronCount,
    aspectRatio: Math.SQRT2 * pairCount,
    restLength,
    halfRestLength: restLength / 2,
    diameter: OCTAHEDRAL_DIAMETER,
    edgeRestLength: OCTAHEDRAL_EDGE_REST_LENGTH,
    moduleHeight: OCTAHEDRAL_MODULE_HEIGHT,
  });
  templateCache.set(pairCount, template);
  return template;
}

interface HalfSpringResult {
  readonly energy: number;
  /** Force applied to the first endpoint. The second endpoint gets -forceFirst. */
  readonly forceFirst: MonolithicLinkVec3;
}

function evaluateHalfSpring(
  first: MonolithicLinkVec3,
  second: MonolithicLinkVec3,
  restLength: number,
  stiffness: number,
  nonlinearity: number,
): HalfSpringResult {
  const delta = subtract3(second, first);
  const length = length3(delta);
  const extension = length - restLength;
  const extension2 = extension * extension;
  const energy =
    0.5 * stiffness * extension2
    + 0.25
      * stiffness
      * nonlinearity
      * extension2
      * extension2
      / (restLength * restLength);

  if (!(length > EPSILON) || stiffness === 0) {
    // At exact coincidence the norm gradient is undefined. Zero is a stable,
    // deterministic subgradient. If the endpoints alias the same semantic
    // CENTER (self-incidence), their equal/opposite internal forces would
    // cancel on that CENTER anyway.
    return Object.freeze({
      energy,
      forceFirst: [0, 0, 0] as MonolithicLinkVec3,
    });
  }

  const magnitude =
    stiffness
    * extension
    * (1 + nonlinearity * extension2 / (restLength * restLength));
  const direction = scale3(delta, 1 / length);
  return Object.freeze({
    energy,
    forceFirst: scale3(direction, magnitude),
  });
}

/**
 * Evaluate one complete semantic Link as one monolithic three-point spring.
 *
 * There is no octahedron/section loop here. S, C and E react in one potential
 * evaluation regardless of visual Link length.
 */
export function evaluateMonolithicLinkSpring3D(
  start: MonolithicLinkVec3,
  center: MonolithicLinkVec3,
  end: MonolithicLinkVec3,
  restLength: number,
  material: MonolithicLinkSpringMaterial3D,
): MonolithicLinkSpringPotential3D {
  const resolvedRestLength = positive(restLength, "restLength");
  const stretchStiffness = nonNegative(
    material.stretchStiffness,
    "stretchStiffness",
  );
  const straighteningStiffness = nonNegative(
    material.straighteningStiffness,
    "straighteningStiffness",
  );
  const nonlinearity = nonNegative(
    material.nonlinearity ?? 0,
    "nonlinearity",
  );
  const halfRestLength = resolvedRestLength / 2;

  const firstHalf = evaluateHalfSpring(
    start,
    center,
    halfRestLength,
    stretchStiffness,
    nonlinearity,
  );
  const secondHalf = evaluateHalfSpring(
    center,
    end,
    halfRestLength,
    stretchStiffness,
    nonlinearity,
  );

  const q = add3(subtract3(start, scale3(center, 2)), end);
  const q2 = dot3(q, q);
  const straighteningEnergy =
    0.5 * straighteningStiffness * q2
    + 0.25
      * straighteningStiffness
      * nonlinearity
      * q2
      * q2
      / (resolvedRestLength * resolvedRestLength);
  const straighteningScale =
    straighteningStiffness
    * (1 + nonlinearity * q2 / (resolvedRestLength * resolvedRestLength));
  const straighteningGradient = scale3(q, straighteningScale);

  const startForce = add3(
    firstHalf.forceFirst,
    scale3(straighteningGradient, -1),
  );
  const centerForce = add3(
    add3(
      scale3(firstHalf.forceFirst, -1),
      secondHalf.forceFirst,
    ),
    scale3(straighteningGradient, 2),
  );
  const endForce = add3(
    scale3(secondHalf.forceFirst, -1),
    scale3(straighteningGradient, -1),
  );

  const stretchEnergy = firstHalf.energy + secondHalf.energy;
  return Object.freeze({
    startForce,
    centerForce,
    endForce,
    stretchEnergy,
    straighteningEnergy,
    energy: stretchEnergy + straighteningEnergy,
  });
}

function compactSemanticCenterSeed(
  template: MonolithicLinkSpringTemplate3D,
  index: number,
  count: number,
): MonolithicLinkVec3 {
  if (count <= 1) return [0, 0, 0];
  const side = Math.ceil(Math.cbrt(count));
  const plane = side * side;
  const depth = Math.ceil(count / plane);
  const spacing = Math.max(
    template.diameter * 1.5,
    template.halfRestLength * 0.25,
  );
  const x = index % side;
  const y = Math.floor(index / side) % side;
  const z = Math.floor(index / plane);
  return [
    (x - (side - 1) / 2) * spacing,
    (y - (side - 1) / 2) * spacing,
    (z - (depth - 1) / 2) * spacing,
  ];
}

export class MonolithicLinkSpringPhysics3D {
  readonly topology: OctahedralLinkTopology3D;
  readonly template: MonolithicLinkSpringTemplate3D;
  readonly centers: Float32Array;
  readonly velocities: Float32Array;
  readonly forces: Float64Array;
  /**
   * Stage-A compatible layout: for Link i,
   * [Fs.xyz, Fc.xyz, Fe.xyz].
   */
  readonly linkForceContributions: Float64Array;

  stretchStiffness: number;
  straighteningStiffness: number;
  nonlinearity: number;
  centerMass: number;
  dampingRate: number;
  simulationSpeed: number;

  constructor(
    network: VisualLinkNetwork,
    options: MonolithicLinkSpringOptions3D,
  ) {
    this.topology = buildOctahedralLinkTopology3D(network);
    this.template = getMonolithicLinkSpringTemplate3D(options.aspectRatio);
    this.stretchStiffness = nonNegative(
      options.stretchStiffness,
      "stretchStiffness",
    );
    this.straighteningStiffness = nonNegative(
      options.straighteningStiffness,
      "straighteningStiffness",
    );
    this.nonlinearity = nonNegative(options.nonlinearity ?? 0, "nonlinearity");
    this.centerMass = positive(
      options.centerMass ?? MONOLITHIC_LINK_DEFAULT_CENTER_MASS,
      "centerMass",
    );
    this.dampingRate = nonNegative(
      options.dampingRate ?? MONOLITHIC_LINK_DEFAULT_DAMPING_RATE,
      "dampingRate",
    );
    this.simulationSpeed = nonNegative(
      options.simulationSpeed ?? 1,
      "simulationSpeed",
    );

    const count = this.topology.linkCount;
    this.centers = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.forces = new Float64Array(count * 3);
    this.linkForceContributions = new Float64Array(count * 9);

    for (let link = 0; link < count; link += 1) {
      writeVec3(
        this.centers,
        link,
        compactSemanticCenterSeed(this.template, link, count),
      );
    }
  }

  semanticCenter(link: number): MonolithicLinkVec3 {
    if (!Number.isSafeInteger(link) || link < 0 || link >= this.topology.linkCount) {
      throw new Error(`invalid monolithic Link index: ${String(link)}`);
    }
    return readVec3(this.centers, link);
  }

  linkPotential(link: number): MonolithicLinkSpringPotential3D {
    if (!Number.isSafeInteger(link) || link < 0 || link >= this.topology.linkCount) {
      throw new Error(`invalid monolithic Link index: ${String(link)}`);
    }
    const startIndex = this.topology.startIndices[link]!;
    const endIndex = this.topology.endIndices[link]!;
    return evaluateMonolithicLinkSpring3D(
      readVec3(this.centers, startIndex),
      readVec3(this.centers, link),
      readVec3(this.centers, endIndex),
      this.template.restLength,
      {
        stretchStiffness: this.stretchStiffness,
        straighteningStiffness: this.straighteningStiffness,
        nonlinearity: this.nonlinearity,
      },
    );
  }

  evaluateForces(): MonolithicLinkSpringStepStats3D {
    this.forces.fill(0);
    this.linkForceContributions.fill(0);

    for (let link = 0; link < this.topology.linkCount; link += 1) {
      const result = this.linkPotential(link);
      const base = link * 9;
      this.linkForceContributions.set(result.startForce, base);
      this.linkForceContributions.set(result.centerForce, base + 3);
      this.linkForceContributions.set(result.endForce, base + 6);

      addToVec3(
        this.forces,
        this.topology.startIndices[link]!,
        result.startForce,
      );
      addToVec3(this.forces, link, result.centerForce);
      addToVec3(
        this.forces,
        this.topology.endIndices[link]!,
        result.endForce,
      );
    }

    return Object.freeze({
      linkPotentialEvaluations: this.topology.linkCount,
      linkForceContributions: this.topology.linkCount * 3,
      semanticCenterIntegrations: 0,
      octahedralPhysicsEvaluations: 0 as const,
    });
  }

  potentialEnergy(): number {
    let energy = 0;
    for (let link = 0; link < this.topology.linkCount; link += 1) {
      energy += this.linkPotential(link).energy;
    }
    return energy;
  }

  step(): MonolithicLinkSpringStepStats3D {
    const evaluated = this.evaluateForces();
    const dt = MONOLITHIC_LINK_BASE_TIME_STEP * this.simulationSpeed;
    if (dt === 0) return evaluated;

    const inverseMass = 1 / this.centerMass;
    const damping = Math.exp(-this.dampingRate * dt);
    for (let link = 0; link < this.topology.linkCount; link += 1) {
      const velocity = readVec3(this.velocities, link);
      const force = readVec3(this.forces, link);
      const nextVelocity = scale3(
        add3(velocity, scale3(force, inverseMass * dt)),
        damping,
      );
      writeVec3(this.velocities, link, nextVelocity);
      writeVec3(
        this.centers,
        link,
        add3(readVec3(this.centers, link), scale3(nextVelocity, dt)),
      );
    }

    this.assertFiniteState();
    return Object.freeze({
      ...evaluated,
      semanticCenterIntegrations: this.topology.linkCount,
    });
  }

  assertFiniteState(): void {
    for (const [label, values] of [
      ["centers", this.centers],
      ["velocities", this.velocities],
    ] as const) {
      for (let index = 0; index < values.length; index += 1) {
        finite(values[index]!, `${label}[${index}]`);
      }
    }
  }
}

export function createMonolithicLinkSpringPhysics3D(
  network: VisualLinkNetwork,
  options: MonolithicLinkSpringOptions3D,
): MonolithicLinkSpringPhysics3D {
  return new MonolithicLinkSpringPhysics3D(network, options);
}
