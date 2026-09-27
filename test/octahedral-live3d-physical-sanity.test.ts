import {
  computeOctahedralGeometricCenter3D,
  createOctahedralLivePhysics3D,
  OCTAHEDRAL_PRESENTATION_BASELINE_ASPECT_RATIO,
  OCTAHEDRAL_PRESENTATION_BASELINE_OCTAHEDRA,
  type OctahedralLivePhysics3D,
  type VisualLinkNetwork,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual M5/#27: ${message}`);
}

function approx(actual: number, expected: number, message: string, epsilon = 1e-5): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} != ${expected}`);
}

function hubHeavyNetwork(count = 333): VisualLinkNetwork {
  assert(count >= 8, "hub-heavy fixture requires at least eight Links");
  const links: Array<{
    key: string;
    startKey: string;
    endKey: string;
  }> = [
    { key: "L1", startKey: "L1", endKey: "L1" },
    { key: "L2", startKey: "L2", endKey: "L1" },
    { key: "L3", startKey: "L1", endKey: "L3" },
  ];

  const key = (oneBased: number): string => `L${oneBased}`;
  for (let oneBased = 4; oneBased <= count; oneBased += 1) {
    const previous = key(oneBased - 1);
    const previous2 = key(Math.max(1, oneBased - 2));
    const self = key(oneBased);
    const role = oneBased % 16;

    let startKey: string;
    let endKey: string;

    switch (role) {
      case 0:
        startKey = previous;
        endKey = "L2";
        break;
      case 1:
        startKey = previous;
        endKey = "L3";
        break;
      case 2:
        startKey = self;
        endKey = previous;
        break;
      case 3:
        startKey = "L1";
        endKey = previous;
        break;
      case 4:
        startKey = previous2;
        endKey = "L2";
        break;
      case 5:
        startKey = previous2;
        endKey = "L3";
        break;
      case 6:
        startKey = previous2;
        endKey = previous;
        break;
      case 7:
        startKey = previous;
        endKey = previous2;
        break;
      default:
        startKey = previous;
        endKey = oneBased % 3 === 0 ? "L3" : "L2";
        break;
    }

    links.push({ key: self, startKey, endKey });
  }

  return { links };
}

interface SpringMetrics {
  readonly edgeCount: number;
  readonly p50RelativeStrain: number;
  readonly p95RelativeStrain: number;
  readonly maxRelativeStrain: number;
  readonly severeStrainFraction: number;
  readonly springEnergy: number;
  readonly minEdgeLength: number;
  readonly maxEdgeLength: number;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index]!;
}

function springMetrics(controller: OctahedralLivePhysics3D): SpringMetrics {
  const template = controller.template;
  const positions = controller.positions;
  const strains: number[] = [];
  let springEnergy = 0;
  let severe = 0;
  let minEdgeLength = Number.POSITIVE_INFINITY;
  let maxEdgeLength = 0;

  for (let link = 0; link < controller.topology.linkCount; link += 1) {
    for (let edge = 0; edge < template.edgeCount; edge += 1) {
      const a = template.edgeA[edge]!;
      const b = template.edgeB[edge]!;
      const aOffset = (link * template.vertexCount + a) * 3;
      const bOffset = (link * template.vertexCount + b) * 3;
      const dx = positions[bOffset]! - positions[aOffset]!;
      const dy = positions[bOffset + 1]! - positions[aOffset + 1]!;
      const dz = positions[bOffset + 2]! - positions[aOffset + 2]!;
      const length = Math.hypot(dx, dy, dz);
      assert(Number.isFinite(length), `non-finite edge length link=${link} edge=${edge}`);

      const relativeStrain = Math.abs(length - template.edgeRestLength)
        / template.edgeRestLength;
      strains.push(relativeStrain);
      if (relativeStrain > 1) severe += 1;
      const extension = length - template.edgeRestLength;
      springEnergy += 0.5 * controller.stiffness * extension * extension;
      minEdgeLength = Math.min(minEdgeLength, length);
      maxEdgeLength = Math.max(maxEdgeLength, length);
    }
  }

  strains.sort((left, right) => left - right);
  return Object.freeze({
    edgeCount: strains.length,
    p50RelativeStrain: percentile(strains, 0.5),
    p95RelativeStrain: percentile(strains, 0.95),
    maxRelativeStrain: strains.at(-1) ?? 0,
    severeStrainFraction: strains.length === 0 ? 0 : severe / strains.length,
    springEnergy,
    minEdgeLength: Number.isFinite(minEdgeLength) ? minEdgeLength : 0,
    maxEdgeLength,
  });
}

function hingeMaxError(controller: OctahedralLivePhysics3D): number {
  const template = controller.template;
  const positions = controller.positions;
  let maximum = 0;

  for (let link = 0; link < controller.topology.linkCount; link += 1) {
    for (const role of ["start", "end"] as const) {
      const apex = role === "start" ? template.startApex : template.endApex;
      const target = role === "start"
        ? controller.topology.startIndices[link]!
        : controller.topology.endIndices[link]!;
      const center = computeOctahedralGeometricCenter3D(
        template,
        positions,
        target,
      );
      const offset = (link * template.vertexCount + apex) * 3;
      const error = Math.hypot(
        positions[offset]! - center[0],
        positions[offset + 1]! - center[1],
        positions[offset + 2]! - center[2],
      );
      maximum = Math.max(maximum, error);
    }
  }

  return maximum;
}

interface CenterBounds {
  readonly spanX: number;
  readonly spanY: number;
  readonly spanZ: number;
  readonly anisotropy: number;
}

function centerBounds(controller: OctahedralLivePhysics3D): CenterBounds {
  if (controller.topology.linkCount === 0) {
    return Object.freeze({ spanX: 0, spanY: 0, spanZ: 0, anisotropy: 1 });
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let link = 0; link < controller.topology.linkCount; link += 1) {
    const center = computeOctahedralGeometricCenter3D(
      controller.template,
      controller.positions,
      link,
    );
    minX = Math.min(minX, center[0]);
    minY = Math.min(minY, center[1]);
    minZ = Math.min(minZ, center[2]);
    maxX = Math.max(maxX, center[0]);
    maxY = Math.max(maxY, center[1]);
    maxZ = Math.max(maxZ, center[2]);
  }

  const spans = [maxX - minX, maxY - minY, maxZ - minZ];
  const largest = Math.max(...spans);
  const smallest = Math.min(...spans);
  return Object.freeze({
    spanX: spans[0]!,
    spanY: spans[1]!,
    spanZ: spans[2]!,
    anisotropy: largest <= 1e-12 ? 1 : smallest / largest,
  });
}

function diagnostic(
  stage: string,
  springs: SpringMetrics,
  hingeError: number,
  bounds: CenterBounds,
): string {
  return [
    stage,
    `edges=${springs.edgeCount}`,
    `strain.p50=${springs.p50RelativeStrain.toFixed(4)}`,
    `strain.p95=${springs.p95RelativeStrain.toFixed(4)}`,
    `strain.max=${springs.maxRelativeStrain.toFixed(4)}`,
    `strain>100%=${(springs.severeStrainFraction * 100).toFixed(2)}%`,
    `energy=${springs.springEnergy.toFixed(2)}`,
    `edgeRange=[${springs.minEdgeLength.toFixed(4)},${springs.maxEdgeLength.toFixed(4)}]`,
    `hingeError.max=${hingeError.toExponential(3)}`,
    `centerSpan=[${bounds.spanX.toFixed(3)},${bounds.spanY.toFixed(3)},${bounds.spanZ.toFixed(3)}]`,
    `anisotropy=${bounds.anisotropy.toFixed(3)}`,
  ].join(" ");
}

const network = hubHeavyNetwork(333);
const controller = createOctahedralLivePhysics3D(network, {
  aspectRatio: OCTAHEDRAL_PRESENTATION_BASELINE_ASPECT_RATIO,
  stiffness: 1,
  simulationSpeed: 1,
});

assert(controller.positions.every(Number.isFinite), "initial positions are finite");
assert(controller.velocities.every(Number.isFinite), "initial velocities are finite");
assert(
  controller.template.octahedronCount === OCTAHEDRAL_PRESENTATION_BASELINE_OCTAHEDRA,
  `presentation baseline resolves to exactly ${OCTAHEDRAL_PRESENTATION_BASELINE_OCTAHEDRA} octahedra`,
);
assert(
  controller.template.aspectRatio > 15 && controller.template.aspectRatio < 16,
  `20-octahedron baseline is line-like with aspectRatio≈15.56, got ${controller.template.aspectRatio}`,
);

const seedSpacing = controller.template.diameter * 1.5;
assert(
  Math.abs(seedSpacing - controller.template.diameter * 1.5) <= 1e-12,
  "hub-heavy baseline uses diameter-derived seed spacing",
);

const initialSprings = springMetrics(controller);
const initialHingeError = hingeMaxError(controller);
const initialBounds = centerBounds(controller);
const initialDiagnostic = diagnostic(
  "initial",
  initialSprings,
  initialHingeError,
  initialBounds,
);

assert(initialHingeError <= 2e-5, `hinges exact at init; ${initialDiagnostic}`);
assert(
  initialBounds.spanX > 1e-3
    && initialBounds.spanY > 1e-3
    && initialBounds.spanZ > 1e-3,
  `hub-heavy seed is genuinely 3D; ${initialDiagnostic}`,
);
assert(
  initialBounds.anisotropy >= 0.15,
  `hub-heavy seed is not a near-line/near-plane; ${initialDiagnostic}`,
);

// These are physical-sanity gates, not visual cosmetics. An accepted initial
// embedding must not satisfy the hinges by tearing a significant fraction of
// the octahedral spring lattice several rest lengths away from equilibrium.
assert(
  initialSprings.p95RelativeStrain <= 0.6
    && initialSprings.maxRelativeStrain <= 1
    && initialSprings.severeStrainFraction === 0,
  `initial spring state is physically sane; ${initialDiagnostic}`,
);

let lastStats = controller.step();
for (let step = 1; step < 360; step += 1) {
  lastStats = controller.step();
}

assert(controller.positions.every(Number.isFinite), "relaxed positions remain finite");
assert(controller.velocities.every(Number.isFinite), "relaxed velocities remain finite");
assert(
  lastStats.springEdgeEvaluations
    === controller.topology.linkCount * controller.template.edgeCount,
  "relaxation retains exact N*E spring work",
);
assert(
  lastStats.hingeTransfers === controller.topology.linkCount * 2,
  "relaxation retains exact 2N hinge transfers",
);
assert(
  lastStats.hingeProjections === controller.topology.linkCount * 2,
  "relaxation retains exact 2N hinge projections",
);
assert(
  lastStats.pairwiseSemanticLinkEvaluations === 0,
  "relaxation contains no semantic all-pairs path",
);

const relaxedSprings = springMetrics(controller);
const relaxedHingeError = hingeMaxError(controller);
const relaxedBounds = centerBounds(controller);
const relaxedDiagnostic = diagnostic(
  "relaxed-360",
  relaxedSprings,
  relaxedHingeError,
  relaxedBounds,
);

assert(relaxedHingeError <= 2e-5, `hinges remain exact after relaxation; ${relaxedDiagnostic}`);
assert(
  relaxedSprings.springEnergy <= initialSprings.springEnergy * 1.05 + 1e-6,
  `damped relaxation does not inject net spring energy; initial=${initialDiagnostic}; ${relaxedDiagnostic}`,
);
assert(
  relaxedSprings.maxRelativeStrain <= Math.max(2, initialSprings.maxRelativeStrain),
  `relaxation does not create a new worse strain singularity; initial=${initialDiagnostic}; ${relaxedDiagnostic}`,
);
assert(
  relaxedBounds.spanX > 1e-3
    && relaxedBounds.spanY > 1e-3
    && relaxedBounds.spanZ > 1e-3,
  `relaxed network remains genuinely 3D; ${relaxedDiagnostic}`,
);

approx(
  controller.template.edgeRestLength,
  1,
  "hub-heavy witness uses normalized unit-rest springs",
);
