import {
  RIGID_SECTION_ANGULAR_DAMPING_RATE,
  RIGID_SECTION_BASE_TIME_STEP,
  createRigidSectionPhysics3D,
  evaluateRigidSectionPotential3D,
  getRigidSectionTemplate3D,
  multiplyRigidSectionQuaternions3D,
  rigidSectionHingeError3D,
  rigidSectionOrientationDeterminant3D,
  rigidSectionPotentialEnergy3D,
  type Quat,
  type Vec3,
} from "../src/rigid-section3d.js";
import type { VisualLinkNetwork } from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual rigid-section P1: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function approx(actual: number, expected: number, message: string, epsilon = 1e-5): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} != ${expected}`);
}

function length3(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function add3(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract3(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function dot3(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross3(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function qAxis(axis: 0 | 1 | 2, angle: number): Quat {
  const halfSin = Math.sin(angle / 2);
  const result: [number, number, number, number] = [0, 0, 0, Math.cos(angle / 2)];
  result[axis] = halfSin;
  return result;
}

function qx(angle: number): Quat {
  return qAxis(0, angle);
}

const aspect20 = 10 * Math.SQRT2;
const template = getRigidSectionTemplate3D(aspect20);
same(template.pairCount, 10, "20-octa template has ten pairs");
same(template.octahedronCount, 20, "template resolves twenty octahedra");
same(template.sectionCount, 21, "twenty octahedra need twenty-one rigid sections");
same(template.centerSection, 10, "even octahedron count gives one exact center section");
approx(template.aspectRatio, aspect20, "aspect is exact length/diameter");
approx(template.restLength / template.diameter, template.aspectRatio, "restLength/diameter equals aspect");
same(template.sectionMass, 3, "three unit node masses collapse into one rigid-section mass");
approx(template.inverseSectionMass, 1 / 3, "inverse section mass cached");
approx(template.localInertia[0], 0.5, "triangle Ixx");
approx(template.localInertia[1], 0.5, "triangle Iyy");
approx(template.localInertia[2], 1, "triangle Izz");
same(template.relationPointCount, 3, "one octahedral relation uses exactly three local potential points");

const lowerCenter: Vec3 = [0, 0, 0];
const upperCenter: Vec3 = [0, 0, template.moduleHeight];
const identity: Quat = [0, 0, 0, 1];
const restOrientation = template.canonicalRelativeOrientation;

const rest = evaluateRigidSectionPotential3D(
  template,
  lowerCenter,
  identity,
  upperCenter,
  restOrientation,
  5,
);
approx(rest.energy, 0, "canonical rigid octahedron is exact potential minimum", 1e-12);
assert(length3(rest.lowerForce) < 1e-6, "canonical lower force is zero");
assert(length3(rest.upperForce) < 1e-6, "canonical upper force is zero");
assert(length3(rest.lowerTorque) < 1e-6, "canonical lower torque is zero");
assert(length3(rest.upperTorque) < 1e-6, "canonical upper torque is zero");

const translatedUpper: Vec3 = [0.1, 0, template.moduleHeight];
const translated = evaluateRigidSectionPotential3D(
  template,
  lowerCenter,
  identity,
  translatedUpper,
  restOrientation,
  5,
);
assert(translated.upperForce[0] < -1, "translated upper triangle is pulled back toward its local well");
assert(translated.lowerForce[0] > 1, "lower triangle receives equal opposite reaction");
const forceSum = add3(translated.lowerForce, translated.upperForce);
assert(length3(forceSum) < 1e-6, "local potential conserves net linear force");
assert(translated.energy > 0, "translated relation stores positive potential energy");

const totalTorqueAboutOrigin = add3(
  add3(translated.lowerTorque, cross3(lowerCenter, translated.lowerForce)),
  add3(translated.upperTorque, cross3(translatedUpper, translated.upperForce)),
);
assert(
  length3(totalTorqueAboutOrigin) < 1e-5,
  "equal/opposite point reactions conserve total angular momentum about origin",
);

const rotatedOrientation = multiplyRigidSectionQuaternions3D(restOrientation, qx(0.15));
const rotated = evaluateRigidSectionPotential3D(
  template,
  lowerCenter,
  identity,
  upperCenter,
  rotatedOrientation,
  5,
);
assert(rotated.energy > 0, "relative rotation stores potential energy");
assert(Math.abs(rotated.upperTorque[0]) > 0.05, "relative rotation creates restoring torque");

const gradientEpsilon = 1e-4;
const energyAtTranslatedX = (x: number): number => evaluateRigidSectionPotential3D(
  template,
  lowerCenter,
  identity,
  [x, 0, template.moduleHeight],
  restOrientation,
  5,
).energy;
const numericDx = (
  energyAtTranslatedX(0.1 + gradientEpsilon)
  - energyAtTranslatedX(0.1 - gradientEpsilon)
) / (2 * gradientEpsilon);
approx(
  translated.upperForce[0],
  -numericDx,
  "translation force is the negative finite-difference energy gradient",
  2e-3,
);

const gradientAngle = 0.15;
const rotationalGradientMeasurements: string[] = [];
for (const axis of [0, 1, 2] as const) {
  const upperOrientationAt = (angle: number): Quat =>
    multiplyRigidSectionQuaternions3D(qAxis(axis, angle), restOrientation);
  const upperEnergyAt = (angle: number): number =>
    evaluateRigidSectionPotential3D(
      template,
      lowerCenter,
      identity,
      upperCenter,
      upperOrientationAt(angle),
      5,
    ).energy;
  const upperAtGradient = evaluateRigidSectionPotential3D(
    template,
    lowerCenter,
    identity,
    upperCenter,
    upperOrientationAt(gradientAngle),
    5,
  );
  const numericUpper = (
    upperEnergyAt(gradientAngle + gradientEpsilon)
    - upperEnergyAt(gradientAngle - gradientEpsilon)
  ) / (2 * gradientEpsilon);
  approx(
    upperAtGradient.upperTorque[axis],
    -numericUpper,
    `world-axis ${axis} upper restoring torque is the negative rotational energy gradient`,
    3e-3,
  );

  const lowerOrientationAt = (angle: number): Quat => qAxis(axis, angle);
  const lowerEnergyAt = (angle: number): number =>
    evaluateRigidSectionPotential3D(
      template,
      lowerCenter,
      lowerOrientationAt(angle),
      upperCenter,
      restOrientation,
      5,
    ).energy;
  const lowerAtGradient = evaluateRigidSectionPotential3D(
    template,
    lowerCenter,
    lowerOrientationAt(gradientAngle),
    upperCenter,
    restOrientation,
    5,
  );
  const numericLower = (
    lowerEnergyAt(gradientAngle + gradientEpsilon)
    - lowerEnergyAt(gradientAngle - gradientEpsilon)
  ) / (2 * gradientEpsilon);
  approx(
    lowerAtGradient.lowerTorque[axis],
    -numericLower,
    `world-axis ${axis} lower restoring torque is the negative rotational energy gradient`,
    3e-3,
  );
  rotationalGradientMeasurements.push(
    `axis=${axis}:upper=${numericUpper.toFixed(6)},lower=${numericLower.toFixed(6)}`,
  );
}

const root: VisualLinkNetwork = {
  links: [{ key: "R", startKey: "R", endKey: "R" }],
};
const r = createRigidSectionPhysics3D(root, {
  aspectRatio: aspect20,
  stiffness: 2,
  simulationSpeed: 1,
});
same(r.bodyCount, 21, "R stores one rigid body per cross-section and no apex particles");
assert(rigidSectionHingeError3D(r) < 1e-6, "double-self R starts with exact point hinges");
r.assertFiniteState();

const rootInitialEnergy = rigidSectionPotentialEnergy3D(r);
assert(Number.isFinite(rootInitialEnergy) && rootInitialEnergy >= 0, "R initial potential is finite");


const selfSeedAudit = createRigidSectionPhysics3D(root, {
  aspectRatio: 50 * Math.SQRT2,
  stiffness: 5,
  simulationSpeed: 0,
});
const selfMiddle = selfSeedAudit.template.centerSection;
const selfPoint = (local: number): Vec3 => {
  const body = selfSeedAudit.sectionBodyIndex(0, local);
  const offset = body * 3;
  return [
    selfSeedAudit.centers[offset]!,
    selfSeedAudit.centers[offset + 1]!,
    selfSeedAudit.centers[offset + 2]!,
  ];
};
const selfTurns: number[] = [];
const selfSegments: number[] = [];
for (let local = 0; local < selfMiddle; local += 1) {
  selfSegments.push(length3(subtract3(selfPoint(local + 1), selfPoint(local))));
}
for (let local = 1; local < selfMiddle; local += 1) {
  const before = subtract3(selfPoint(local), selfPoint(local - 1));
  const after = subtract3(selfPoint(local + 1), selfPoint(local));
  const cosine = Math.max(
    -1,
    Math.min(1, dot3(before, after) / (length3(before) * length3(after))),
  );
  selfTurns.push(Math.acos(cosine));
}
const selfTurnMean = selfTurns.reduce((sum, value) => sum + value, 0) / selfTurns.length;
const selfTurnVariance = selfTurns.reduce(
  (sum, value) => sum + (value - selfTurnMean) ** 2,
  0,
) / selfTurns.length;
const selfTurnStd = Math.sqrt(selfTurnVariance);
const selfSegmentMin = Math.min(...selfSegments);
const selfSegmentMax = Math.max(...selfSegments);
assert(
  selfTurnStd > 0.02,
  `100-octa self seed must not pre-bake constant-curvature circles: std=${selfTurnStd}`,
);
assert(
  selfTurns[0]! < selfTurnMean * 0.5,
  `free point-hinge endpoint starts with low curvature rather than circular bending: first=${selfTurns[0]} mean=${selfTurnMean}`,
);
assert(
  selfSegmentMax / selfSegmentMin < 1.02,
  `arc-length resampled self seed keeps neighboring sections near-uniform: min=${selfSegmentMin} max=${selfSegmentMax}`,
);
selfSeedAudit.evaluateForces();
const seedStartBody = selfSeedAudit.sectionBodyIndex(0, 0);
const seedEndBody = selfSeedAudit.sectionBodyIndex(
  0,
  selfSeedAudit.template.sectionCount - 1,
);
const seedTorque = (body: number): number => {
  const offset = body * 3;
  return Math.hypot(
    selfSeedAudit.torques[offset]!,
    selfSeedAudit.torques[offset + 1]!,
    selfSeedAudit.torques[offset + 2]!,
  );
};
const seedStartTorque = seedTorque(seedStartBody);
const seedEndTorque = seedTorque(seedEndBody);
assert(
  seedStartTorque < 0.05 && seedEndTorque < 0.05,
  `free-hinge seed should not inject the old circular endpoint moment: start=${seedStartTorque} end=${seedEndTorque}`,
);
console.log(
  `[v0.5 #71 neutral self seed] turnMean=${selfTurnMean.toExponential(6)} `
  + `turnStd=${selfTurnStd.toExponential(6)} firstTurn=${selfTurns[0]!.toExponential(6)} `
  + `segmentRange=[${selfSegmentMin.toFixed(6)},${selfSegmentMax.toFixed(6)}] `
  + `endpointTorque=[${seedStartTorque.toExponential(6)},${seedEndTorque.toExponential(6)}]`,
);
for (let step = 0; step < 600; step += 1) r.step();
assert(rigidSectionHingeError3D(r) < 2e-4, "double-self hinges remain coincident under dynamics");
r.assertFiniteState();

for (let body = 0; body < r.bodyCount; body += 1) {
  const offset = body * 4;
  const orientation: Quat = [
    r.orientations[offset]!,
    r.orientations[offset + 1]!,
    r.orientations[offset + 2]!,
    r.orientations[offset + 3]!,
  ];
  approx(
    rigidSectionOrientationDeterminant3D(orientation),
    1,
    `rigid section ${body} remains a proper rotation and cannot reflect`,
    2e-5,
  );
}

const rootBasis: VisualLinkNetwork = {
  links: [
    { key: "R", startKey: "R", endKey: "R" },
    { key: "O", startKey: "O", endKey: "R" },
    { key: "C", startKey: "R", endKey: "C" },
    { key: "L", startKey: "O", endKey: "C" },
    { key: "U", startKey: "C", endKey: "O" },
  ],
};
const basis = createRigidSectionPhysics3D(rootBasis, {
  aspectRatio: aspect20,
  stiffness: 2,
  simulationSpeed: 1,
});
same(basis.bodyCount, 5 * 21, "ROCLU stores only rigid cross-sections");
assert(rigidSectionHingeError3D(basis) < 1e-5, "ROCLU starts with exact semantic point hinges");

const evaluations = basis.evaluateForces();
same(
  evaluations.relationPointEvaluations,
  5 * 20 * 3,
  "relation work is exactly three potential points per octahedron",
);
same(evaluations.pairwiseSemanticLinkEvaluations, 0, "rigid-section physics has no semantic all-pairs path");
same(
  evaluations.hingeConstraintEvaluations,
  5 * 2,
  "exact hinge-star solve evaluates each semantic incidence once",
);

const initialCenters = basis.topology.keys.map((_, link) => basis.semanticCenter(link));

for (let settle = 0; settle < 300; settle += 1) basis.step();
const settledEnergy = rigidSectionPotentialEnergy3D(basis);
const oIndex = basis.topology.keys.indexOf("O");
assert(oIndex >= 0, "perturbation witness resolves O");
const perturbedBody = basis.sectionBodyIndex(oIndex, 4);
const perturbedOffset = perturbedBody * 3;
basis.centers[perturbedOffset] = basis.centers[perturbedOffset]! + 0.35;
basis.centers[perturbedOffset + 1] = basis.centers[perturbedOffset + 1]! - 0.22;
basis.centers[perturbedOffset + 2] = basis.centers[perturbedOffset + 2]! + 0.18;
const qOffset = perturbedBody * 4;
const perturbedOrientation = multiplyRigidSectionQuaternions3D(
  qx(0.18),
  [
    basis.orientations[qOffset]!,
    basis.orientations[qOffset + 1]!,
    basis.orientations[qOffset + 2]!,
    basis.orientations[qOffset + 3]!,
  ],
);
basis.orientations[qOffset] = perturbedOrientation[0];
basis.orientations[qOffset + 1] = perturbedOrientation[1];
basis.orientations[qOffset + 2] = perturbedOrientation[2];
basis.orientations[qOffset + 3] = perturbedOrientation[3];
basis.linearVelocities.fill(0);
basis.angularVelocities.fill(0);

const perturbedEnergy = rigidSectionPotentialEnergy3D(basis);
assert(
  perturbedEnergy > settledEnergy + 0.05,
  `deterministic section perturbation raises potential energy: settled=${settledEnergy} perturbed=${perturbedEnergy}`,
);
for (let relax = 0; relax < 900; relax += 1) basis.step();
const relaxedEnergy = rigidSectionPotentialEnergy3D(basis);
assert(
  relaxedEnergy < perturbedEnergy * 0.75,
  `damped rigid-section dynamics removes perturbation energy: perturbed=${perturbedEnergy} relaxed=${relaxedEnergy}`,
);

for (let step = 0; step < 400; step += 1) basis.step();
basis.assertFiniteState();
assert(rigidSectionHingeError3D(basis) < 5e-4, "ROCLU hinges remain bounded after integration");

let movedCenters = 0;
for (let link = 0; link < basis.topology.linkCount; link += 1) {
  const before = initialCenters[link]!;
  const after = basis.semanticCenter(link);
  const displacement = Math.hypot(
    after[0] - before[0],
    after[1] - before[1],
    after[2] - before[2],
  );
  if (displacement > 1e-4) movedCenters += 1;
}
assert(movedCenters > 0, "rigid-section root basis has dynamically free semantic centers");

for (let body = 0; body < basis.bodyCount; body += 1) {
  const offset = body * 4;
  const orientation: Quat = [
    basis.orientations[offset]!,
    basis.orientations[offset + 1]!,
    basis.orientations[offset + 2]!,
    basis.orientations[offset + 3]!,
  ];
  assert(
    rigidSectionOrientationDeterminant3D(orientation) > 0.9999,
    "no rigid cross-section can enter a mirrored / inside-out orientation",
  );
}

const conservativeHinge = createRigidSectionPhysics3D(root, {
  aspectRatio: 2 * Math.SQRT2,
  stiffness: 0,
  simulationSpeed: 1,
});
const conservativeStart = conservativeHinge.sectionBodyIndex(0, 0);
const sumField = (values: Float32Array): Vec3 => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let offset = 0; offset < values.length; offset += 3) {
    x += values[offset]!;
    y += values[offset + 1]!;
    z += values[offset + 2]!;
  }
  return [x, y, z];
};

conservativeHinge.centers[conservativeStart * 3] =
  conservativeHinge.centers[conservativeStart * 3]! + 0.75;
const positionSumBeforeProjection = sumField(conservativeHinge.centers);
conservativeHinge.linearVelocities.fill(0);
conservativeHinge.linearVelocities[conservativeStart * 3] = 1;
const momentumSumBeforeProjection = sumField(conservativeHinge.linearVelocities);
conservativeHinge.projectHinges();
const positionSumAfterProjection = sumField(conservativeHinge.centers);
const momentumSumAfterProjection = sumField(conservativeHinge.linearVelocities);
for (let axis = 0; axis < 3; axis += 1) {
  approx(
    positionSumAfterProjection[axis]!,
    positionSumBeforeProjection[axis]!,
    `exact hinge-star projection preserves center of mass axis ${axis}`,
    2e-6,
  );
  approx(
    momentumSumAfterProjection[axis]!,
    momentumSumBeforeProjection[axis]!,
    `exact hinge-star projection preserves linear momentum axis ${axis}`,
    2e-6,
  );
}
assert(
  rigidSectionHingeError3D(conservativeHinge) < 2e-6,
  "exact hinge-star projection satisfies point coincidence in one solve",
);

const gyroscopic = createRigidSectionPhysics3D(root, {
  aspectRatio: 2 * Math.SQRT2,
  stiffness: 0,
  simulationSpeed: 1,
});
const gyroscopicBody = gyroscopic.sectionBodyIndex(0, 1);
const gyroscopicQ = gyroscopicBody * 4;
gyroscopic.orientations[gyroscopicQ] = 0;
gyroscopic.orientations[gyroscopicQ + 1] = 0;
gyroscopic.orientations[gyroscopicQ + 2] = 0;
gyroscopic.orientations[gyroscopicQ + 3] = 1;
gyroscopic.angularVelocities.fill(0);
const gyroscopicOmega = gyroscopicBody * 3;
gyroscopic.angularVelocities[gyroscopicOmega] = 1;
gyroscopic.angularVelocities[gyroscopicOmega + 2] = 1;
gyroscopic.step();
const expectedGyroscopicY =
  RIGID_SECTION_BASE_TIME_STEP
  * Math.exp(
    -RIGID_SECTION_ANGULAR_DAMPING_RATE * RIGID_SECTION_BASE_TIME_STEP,
  );
approx(
  gyroscopic.angularVelocities[gyroscopicOmega + 1]!,
  expectedGyroscopicY,
  "anisotropic torque-free body includes Euler gyroscopic coupling",
  5e-5,
);

const largeLinkCount = 10_000;
const largeNetwork: VisualLinkNetwork = {
  links: Array.from({ length: largeLinkCount }, (_, index) => {
    const key = `S${String(index).padStart(5, "0")}`;
    return { key, startKey: key, endKey: key };
  }),
};
const large = createRigidSectionPhysics3D(largeNetwork, {
  aspectRatio: Math.SQRT2,
  stiffness: 1,
  simulationSpeed: 0,
});
same(large.template.octahedronCount, 2, "large witness uses minimum even two-octahedron Link");
same(large.bodyCount, largeLinkCount * 3, "large witness body storage grows linearly");
const largeEvaluation = large.evaluateForces();
same(
  largeEvaluation.relationPointEvaluations,
  largeLinkCount * 2 * 3,
  "large relation evaluation count is exactly O(N)",
);
same(
  largeEvaluation.hingeConstraintEvaluations,
  largeLinkCount * 2,
  "large exact hinge-star evaluation count is exactly O(N)",
);
same(
  largeEvaluation.pairwiseSemanticLinkEvaluations,
  0,
  "large fixture still performs zero semantic all-pairs evaluations",
);

same(template.sectionMass, getRigidSectionTemplate3D(2 * Math.SQRT2).sectionMass,
  "section mass is a canonical profile constant, not a per-Link tunable parameter");
same(template.localInertia.join(","), getRigidSectionTemplate3D(2 * Math.SQRT2).localInertia.join(","),
  "section inertia comes from canonical triangle geometry, not a hidden stiffness parameter");

console.log(
  `[v0.5 P2 rigid sections] PASS R-energy=${rootInitialEnergy.toFixed(6)} `
  + `ROCLU-bodies=${basis.bodyCount} relationPoints=${evaluations.relationPointEvaluations}`,
);
console.log(
  `[v0.5 P2 contracts] PASS numericDx=${numericDx.toFixed(6)} `
  + `rotGrad=[${rotationalGradientMeasurements.join(" ")}] `
  + `settled=${settledEnergy.toFixed(6)} perturbed=${perturbedEnergy.toFixed(6)} relaxed=${relaxedEnergy.toFixed(6)} `
  + `largeRelationPoints=${largeEvaluation.relationPointEvaluations}`,
);
