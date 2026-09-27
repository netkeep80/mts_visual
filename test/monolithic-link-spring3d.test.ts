import {
  createMonolithicLinkSpringPhysics3D,
  evaluateMonolithicLinkSpring3D,
  getMonolithicLinkSpringTemplate3D,
  type MonolithicLinkVec3,
} from "../src/monolithic-link-spring3d.js";
import {
  createRigidSectionPhysics3D,
} from "../src/rigid-section3d.js";
import type { VisualLinkNetwork } from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`@mts/visual v0.5/#92 monolithic Link spring: ${message}`);
  }
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function approx(
  actual: number,
  expected: number,
  message: string,
  epsilon = 1e-7,
): void {
  assert(
    Math.abs(actual - expected) <= epsilon,
    `${message}: ${actual} != ${expected} (eps=${epsilon})`,
  );
}

function add3(a: MonolithicLinkVec3, b: MonolithicLinkVec3): MonolithicLinkVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract3(
  a: MonolithicLinkVec3,
  b: MonolithicLinkVec3,
): MonolithicLinkVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a: MonolithicLinkVec3, b: MonolithicLinkVec3): MonolithicLinkVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length3(value: MonolithicLinkVec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function torqueAbout(
  point: MonolithicLinkVec3,
  origin: MonolithicLinkVec3,
  force: MonolithicLinkVec3,
): MonolithicLinkVec3 {
  return cross3(subtract3(point, origin), force);
}

function forceDelta(
  left: MonolithicLinkVec3,
  right: MonolithicLinkVec3,
): number {
  return length3(subtract3(left, right));
}

const template16 = getMonolithicLinkSpringTemplate3D(8 * Math.SQRT2);
same(template16.octahedronCount, 16, "16-octa Link length resolves exactly");
const template256 = getMonolithicLinkSpringTemplate3D(128 * Math.SQRT2);
same(template256.octahedronCount, 256, "256-octa Link length resolves exactly");
approx(
  template256.restLength / template16.restLength,
  16,
  "octahedron count changes physical rest length explicitly",
);

const half = template16.halfRestLength;
const rest = evaluateMonolithicLinkSpring3D(
  [0, 0, 0],
  [half, 0, 0],
  [2 * half, 0, 0],
  template16.restLength,
  {
    stretchStiffness: 4,
    straighteningStiffness: 3,
    nonlinearity: 0,
  },
);
approx(rest.energy, 0, "straight rest Link stores zero energy");
approx(length3(rest.startForce), 0, "straight rest START force is zero");
approx(length3(rest.centerForce), 0, "straight rest CENTER force is zero");
approx(length3(rest.endForce), 0, "straight rest END force is zero");

const start: MonolithicLinkVec3 = [0.2, -0.3, 0.1];
const center: MonolithicLinkVec3 = [half * 0.72, 1.1, -0.4];
const end: MonolithicLinkVec3 = [template16.restLength * 0.88, -0.45, 0.6];
const material = {
  stretchStiffness: 5,
  straighteningStiffness: 2.5,
  nonlinearity: 1.75,
} as const;
const deformed = evaluateMonolithicLinkSpring3D(
  start,
  center,
  end,
  template16.restLength,
  material,
);

const forceSum = add3(add3(deformed.startForce, deformed.centerForce), deformed.endForce);
assert(length3(forceSum) < 1e-9, "one Link conserves total internal linear force");

const origin: MonolithicLinkVec3 = [1.7, -2.1, 0.8];
const torqueSum = add3(
  add3(
    torqueAbout(start, origin, deformed.startForce),
    torqueAbout(center, origin, deformed.centerForce),
  ),
  torqueAbout(end, origin, deformed.endForce),
);
assert(
  length3(torqueSum) < 1e-8,
  "one Link conserves total internal torque about an arbitrary origin",
);

const epsilon = 1e-5;
const centerEnergyAtX = (x: number): number =>
  evaluateMonolithicLinkSpring3D(
    start,
    [x, center[1], center[2]],
    end,
    template16.restLength,
    material,
  ).energy;
const numericCenterDx =
  (centerEnergyAtX(center[0] + epsilon) - centerEnergyAtX(center[0] - epsilon))
  / (2 * epsilon);
approx(
  deformed.centerForce[0],
  -numericCenterDx,
  "CENTER force is the negative global potential-energy gradient",
  2e-4,
);

const linear = evaluateMonolithicLinkSpring3D(
  start,
  center,
  end,
  template16.restLength,
  { ...material, nonlinearity: 0 },
);
assert(
  deformed.energy > linear.energy,
  "positive nonlinearity adds conservative hardening energy",
);

const self = evaluateMonolithicLinkSpring3D(
  [3, 4, 5],
  [3, 4, 5],
  [3, 4, 5],
  template16.restLength,
  material,
);
assert(Number.isFinite(self.energy), "double-self energy remains finite");
approx(length3(self.startForce), 0, "double-self START contribution has deterministic zero subgradient");
approx(length3(self.centerForce), 0, "double-self CENTER contribution remains finite and zero");
approx(length3(self.endForce), 0, "double-self END contribution has deterministic zero subgradient");

// The central architectural witness: one perturbation changes all three
// interaction-point forces in one evaluation. There is no section-by-section
// propagation path in the monolithic potential.
const immediateBefore = evaluateMonolithicLinkSpring3D(
  [0, 0, 0],
  [half * 0.9, 0.6, 0.1],
  [template16.restLength * 0.95, -0.2, 0.3],
  template16.restLength,
  material,
);
const immediateAfter = evaluateMonolithicLinkSpring3D(
  [0, 0, 0],
  [half * 0.9 + 0.35, 1.0, -0.15],
  [template16.restLength * 0.95, -0.2, 0.3],
  template16.restLength,
  material,
);
assert(
  forceDelta(immediateBefore.startForce, immediateAfter.startForce) > 1e-3,
  "START reacts on the same monolithic evaluation",
);
assert(
  forceDelta(immediateBefore.centerForce, immediateAfter.centerForce) > 1e-3,
  "CENTER reacts on the same monolithic evaluation",
);
assert(
  forceDelta(immediateBefore.endForce, immediateAfter.endForce) > 1e-3,
  "END reacts on the same monolithic evaluation",
);

const basis: VisualLinkNetwork = {
  links: [
    { key: "R", startKey: "R", endKey: "R" },
    { key: "O", startKey: "O", endKey: "R" },
    { key: "C", startKey: "R", endKey: "C" },
    { key: "L", startKey: "O", endKey: "C" },
    { key: "U", startKey: "C", endKey: "O" },
  ],
};

const shortPhysics = createMonolithicLinkSpringPhysics3D(basis, {
  aspectRatio: 8 * Math.SQRT2,
  stretchStiffness: 5,
  straighteningStiffness: 2,
  nonlinearity: 0.5,
  centerMass: 3,
  dampingRate: 0.7,
  simulationSpeed: 1,
});
const longPhysics = createMonolithicLinkSpringPhysics3D(basis, {
  aspectRatio: 128 * Math.SQRT2,
  stretchStiffness: 5,
  straighteningStiffness: 2,
  nonlinearity: 0.5,
  centerMass: 3,
  dampingRate: 0.7,
  simulationSpeed: 1,
});

same(shortPhysics.centers.length, 5 * 3, "16-octa physics stores one CENTER vec3 per semantic Link");
same(longPhysics.centers.length, 5 * 3, "256-octa physics stores the same semantic CENTER state size");
same(shortPhysics.velocities.length, 5 * 3, "16-octa physics stores one velocity vec3 per semantic Link");
same(longPhysics.velocities.length, 5 * 3, "256-octa physics stores the same velocity state size");
same(shortPhysics.linkForceContributions.length, 5 * 9, "force Stage A stores exactly S/C/E per Link");
same(longPhysics.linkForceContributions.length, 5 * 9, "force Stage A storage is independent of octahedron count");

const shortEvaluation = shortPhysics.evaluateForces();
const longEvaluation = longPhysics.evaluateForces();
for (const [name, stats] of [
  ["16-octa", shortEvaluation],
  ["256-octa", longEvaluation],
] as const) {
  same(stats.linkPotentialEvaluations, 5, `${name} performs one physical potential evaluation per Link`);
  same(stats.linkForceContributions, 15, `${name} produces exactly three force contributions per Link`);
  same(stats.octahedralPhysicsEvaluations, 0, `${name} performs zero octahedral physics evaluations`);
}
shortPhysics.step();
longPhysics.step();
shortPhysics.assertFiniteState();
longPhysics.assertFiniteState();

// Negative witness for the superseded rigid-section architecture.
//
// Moving the semantic middle section affects only the two adjacent local
// relations on the first force evaluation. A distant section sees exactly the
// old force until later integration steps propagate the disturbance.
const serialNetwork: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "A" },
    { key: "B", startKey: "B", endKey: "B" },
    { key: "X", startKey: "A", endKey: "B" },
  ],
};
const serialOptions = {
  aspectRatio: 64 * Math.SQRT2,
  stiffness: 5,
  simulationSpeed: 0,
} as const;
const serialBaseline = createRigidSectionPhysics3D(serialNetwork, serialOptions);
const serialPerturbed = createRigidSectionPhysics3D(serialNetwork, serialOptions);
same(serialBaseline.template.octahedronCount, 128, "negative witness uses a long 128-octa serial Link");

const xIndex = serialPerturbed.topology.keys.indexOf("X");
assert(xIndex >= 0, "negative witness resolves ordinary X Link");
const middle = serialPerturbed.template.centerSection;
const middleBody = serialPerturbed.sectionBodyIndex(xIndex, middle);
serialPerturbed.centers[middleBody * 3] =
  serialPerturbed.centers[middleBody * 3]! + 0.35;
serialPerturbed.centers[middleBody * 3 + 1] =
  serialPerturbed.centers[middleBody * 3 + 1]! - 0.2;

serialBaseline.evaluateForces();
serialPerturbed.evaluateForces();

let affectedSections = 0;
let farStartDelta = 0;
let farEndDelta = 0;
for (let local = 0; local < serialPerturbed.template.sectionCount; local += 1) {
  const body = serialPerturbed.sectionBodyIndex(xIndex, local);
  const offset = body * 3;
  const delta = Math.hypot(
    serialPerturbed.forces[offset]! - serialBaseline.forces[offset]!,
    serialPerturbed.forces[offset + 1]! - serialBaseline.forces[offset + 1]!,
    serialPerturbed.forces[offset + 2]! - serialBaseline.forces[offset + 2]!,
  );
  if (delta > 1e-9) affectedSections += 1;
  if (local === 0) farStartDelta = delta;
  if (local === serialPerturbed.template.sectionCount - 1) farEndDelta = delta;
}
assert(
  affectedSections > 0 && affectedSections <= 3,
  `old local-section model changes only center-neighbor sections on first evaluation: affected=${affectedSections}`,
);
approx(
  farStartDelta,
  0,
  "old local-section model does not transmit center perturbation to far START in one evaluation",
  1e-12,
);
approx(
  farEndDelta,
  0,
  "old local-section model does not transmit center perturbation to far END in one evaluation",
  1e-12,
);

console.log(
  `[v0.5 #92 monolithic spring] PASS rest16=${template16.restLength.toFixed(6)} `
  + `rest256=${template256.restLength.toFixed(6)} immediate=[`
  + `${forceDelta(immediateBefore.startForce, immediateAfter.startForce).toExponential(3)},`
  + `${forceDelta(immediateBefore.centerForce, immediateAfter.centerForce).toExponential(3)},`
  + `${forceDelta(immediateBefore.endForce, immediateAfter.endForce).toExponential(3)}] `
  + `oldAffected=${affectedSections}/${serialPerturbed.template.sectionCount}`,
);
