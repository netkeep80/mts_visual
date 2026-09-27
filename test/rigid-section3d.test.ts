import {
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

function cross3(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function qx(angle: number): Quat {
  return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
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
  5 * 2 * 12,
  "hinge solver work is fixed linear work per semantic Link",
);

const initialCenters = basis.topology.keys.map((_, link) => basis.semanticCenter(link));
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

console.log(
  `[v0.5 P1 rigid sections] PASS R-energy=${rootInitialEnergy.toFixed(6)} `
  + `ROCLU-bodies=${basis.bodyCount} relationPoints=${evaluations.relationPointEvaluations}`,
);
