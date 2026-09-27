import type { VisualLinkNetwork } from "./index.js";
import {
  resolveOctahedralSeedCenters3D,
  writeFittedOctahedralTemplate3D,
} from "./octahedral-layout3d.js";
import {
  accumulateOctahedralSpringForces3D,
  buildOctahedralLinkTopology3D,
  getOctahedralLinkTemplate3D,
  projectOctahedralHinges3D,
  projectOctahedralHingeVelocities3D,
  transferOctahedralHingeForces3D,
  type OctahedralLinkTemplate3D,
  type OctahedralLinkTopology3D,
} from "./octahedral-link3d.js";

const BASE_TIME_STEP = 1 / 120;
const INTERNAL_DAMPING_RATE = 0.8;

export interface OctahedralLivePhysics3DOptions {
  readonly aspectRatio: number;
  readonly stiffness: number;
  readonly simulationSpeed: number;
}

export interface OctahedralLiveStepStats {
  readonly springEdgeEvaluations: number;
  readonly hingeTransfers: number;
  readonly integratedVertices: number;
  readonly hingeProjections: number;
  readonly pairwiseSemanticLinkEvaluations: 0;
}

export interface OctahedralLivePhysics3D {
  readonly template: OctahedralLinkTemplate3D;
  readonly topology: OctahedralLinkTopology3D;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly stiffness: number;
  readonly simulationSpeed: number;
  step(): OctahedralLiveStepStats;
  setStiffness(stiffness: number): void;
  setSimulationSpeed(simulationSpeed: number): void;
  transition(network: VisualLinkNetwork): void;
}

function requireNonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid ${name}: ${String(value)}`);
  }
  return value;
}

function packedFloatOffset(template: OctahedralLinkTemplate3D, link: number, vertex: number): number {
  return (link * template.vertexCount + vertex) * 3;
}

function linkFloatOffset(template: OctahedralLinkTemplate3D, link: number): number {
  return link * template.vertexCount * 3;
}


function assertFiniteState(positions: Float32Array, velocities: Float32Array): void {
  for (let index = 0; index < positions.length; index += 1) {
    if (!Number.isFinite(positions[index]!) || !Number.isFinite(velocities[index]!)) {
      throw new Error(`non-finite octahedral live state at ${index}`);
    }
  }
}

class OctahedralLiveController implements OctahedralLivePhysics3D {
  readonly template: OctahedralLinkTemplate3D;
  private currentTopology: OctahedralLinkTopology3D;
  private currentPositions: Float32Array;
  private currentVelocities: Float32Array;
  private forces: Float32Array;
  private currentStiffness: number;
  private currentSimulationSpeed: number;

  constructor(network: VisualLinkNetwork, options: OctahedralLivePhysics3DOptions) {
    this.template = getOctahedralLinkTemplate3D(options.aspectRatio);
    this.currentTopology = buildOctahedralLinkTopology3D(network);
    this.currentStiffness = requireNonNegativeFinite(options.stiffness, "stiffness");
    this.currentSimulationSpeed = requireNonNegativeFinite(options.simulationSpeed, "simulationSpeed");

    const length = this.currentTopology.linkCount * this.template.vertexCount * 3;
    this.currentPositions = new Float32Array(length);
    this.currentVelocities = new Float32Array(length);
    this.forces = new Float32Array(length);

    const seedCenters = resolveOctahedralSeedCenters3D(
      this.template,
      this.currentTopology,
    );
    for (let link = 0; link < this.currentTopology.linkCount; link += 1) {
      writeFittedOctahedralTemplate3D(
        this.template,
        this.currentTopology,
        this.currentPositions,
        link,
        seedCenters,
      );
    }
    projectOctahedralHinges3D(this.currentTopology, this.template, this.currentPositions);
    projectOctahedralHingeVelocities3D(
      this.currentTopology,
      this.template,
      this.currentVelocities,
    );
    assertFiniteState(this.currentPositions, this.currentVelocities);
  }

  get topology(): OctahedralLinkTopology3D {
    return this.currentTopology;
  }

  get positions(): Float32Array {
    return this.currentPositions;
  }

  get velocities(): Float32Array {
    return this.currentVelocities;
  }

  get stiffness(): number {
    return this.currentStiffness;
  }

  get simulationSpeed(): number {
    return this.currentSimulationSpeed;
  }

  setStiffness(stiffness: number): void {
    this.currentStiffness = requireNonNegativeFinite(stiffness, "stiffness");
  }

  setSimulationSpeed(simulationSpeed: number): void {
    this.currentSimulationSpeed = requireNonNegativeFinite(simulationSpeed, "simulationSpeed");
  }

  step(): OctahedralLiveStepStats {
    this.forces.fill(0);
    let springEdgeEvaluations = 0;

    for (let link = 0; link < this.currentTopology.linkCount; link += 1) {
      springEdgeEvaluations += accumulateOctahedralSpringForces3D(
        this.template,
        this.currentPositions,
        this.forces,
        this.currentStiffness,
        link,
      ).edgeEvaluations;
    }

    const hingeTransfers = transferOctahedralHingeForces3D(
      this.currentTopology,
      this.template,
      this.forces,
    );

    const dt = BASE_TIME_STEP * this.currentSimulationSpeed;
    const damping = Math.exp(-INTERNAL_DAMPING_RATE * dt);
    let integratedVertices = 0;

    if (dt > 0) {
      for (let link = 0; link < this.currentTopology.linkCount; link += 1) {
        for (let vertex = 0; vertex < this.template.vertexCount; vertex += 1) {
          const offset = packedFloatOffset(this.template, link, vertex);
          const vx = (this.currentVelocities[offset]! + this.forces[offset]! * dt) * damping;
          const vy = (this.currentVelocities[offset + 1]! + this.forces[offset + 1]! * dt) * damping;
          const vz = (this.currentVelocities[offset + 2]! + this.forces[offset + 2]! * dt) * damping;

          this.currentVelocities[offset] = vx;
          this.currentVelocities[offset + 1] = vy;
          this.currentVelocities[offset + 2] = vz;
          this.currentPositions[offset] = this.currentPositions[offset]! + vx * dt;
          this.currentPositions[offset + 1] = this.currentPositions[offset + 1]! + vy * dt;
          this.currentPositions[offset + 2] = this.currentPositions[offset + 2]! + vz * dt;
          integratedVertices += 1;
        }
      }
    }

    const hingeProjections = projectOctahedralHinges3D(
      this.currentTopology,
      this.template,
      this.currentPositions,
    );
    projectOctahedralHingeVelocities3D(
      this.currentTopology,
      this.template,
      this.currentVelocities,
    );
    assertFiniteState(this.currentPositions, this.currentVelocities);

    return Object.freeze({
      springEdgeEvaluations,
      hingeTransfers,
      integratedVertices,
      hingeProjections,
      pairwiseSemanticLinkEvaluations: 0 as const,
    });
  }

  transition(network: VisualLinkNetwork): void {
    const nextTopology = buildOctahedralLinkTopology3D(network);
    const nextLength = nextTopology.linkCount * this.template.vertexCount * 3;
    const nextPositions = new Float32Array(nextLength);
    const nextVelocities = new Float32Array(nextLength);

    const oldByKey = new Map(this.currentTopology.keys.map((key, index) => [key, index] as const));
    const span = this.template.vertexCount * 3;
    const nextSeedCenters = resolveOctahedralSeedCenters3D(this.template, nextTopology);

    for (let nextIndex = 0; nextIndex < nextTopology.linkCount; nextIndex += 1) {
      const key = nextTopology.keys[nextIndex]!;
      const oldIndex = oldByKey.get(key);
      const nextOffset = nextIndex * span;
      if (oldIndex !== undefined) {
        const oldOffset = oldIndex * span;
        nextPositions.set(this.currentPositions.subarray(oldOffset, oldOffset + span), nextOffset);
        nextVelocities.set(this.currentVelocities.subarray(oldOffset, oldOffset + span), nextOffset);
      } else {
        writeFittedOctahedralTemplate3D(
          this.template,
          nextTopology,
          nextPositions,
          nextIndex,
          nextSeedCenters,
        );
      }
    }

    this.currentTopology = nextTopology;
    this.currentPositions = nextPositions;
    this.currentVelocities = nextVelocities;
    this.forces = new Float32Array(nextLength);

    projectOctahedralHinges3D(this.currentTopology, this.template, this.currentPositions);
    projectOctahedralHingeVelocities3D(
      this.currentTopology,
      this.template,
      this.currentVelocities,
    );
    assertFiniteState(this.currentPositions, this.currentVelocities);
  }
}

export function createOctahedralLivePhysics3D(
  network: VisualLinkNetwork,
  options: OctahedralLivePhysics3DOptions,
): OctahedralLivePhysics3D {
  return new OctahedralLiveController(network, options);
}

export function transitionOctahedralLivePhysics3DNetwork(
  controller: OctahedralLivePhysics3D,
  network: VisualLinkNetwork,
): void {
  controller.transition(network);
}
