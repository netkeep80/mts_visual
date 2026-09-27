import {
  RIGID_SECTION_ANGULAR_DAMPING_RATE,
  RIGID_SECTION_BASE_TIME_STEP,
  createRigidSectionPhysics3D,
  type RigidSectionPhysics3D,
  type Vec3,
} from "../src/rigid-section3d.js";
import type { VisualLinkNetwork } from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual v0.5/#71 audit: ${message}`);
}

function readCenter(
  controller: RigidSectionPhysics3D,
  localSection: number,
): Vec3 {
  const body = controller.sectionBodyIndex(0, localSection);
  const offset = body * 3;
  return [
    controller.centers[offset]!,
    controller.centers[offset + 1]!,
    controller.centers[offset + 2]!,
  ];
}

function sumVec3(values: Float32Array): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let offset = 0; offset < values.length; offset += 3) {
    x += values[offset]!;
    y += values[offset + 1]!;
    z += values[offset + 2]!;
  }
  return [x, y, z];
}

function distance3(left: Vec3, right: Vec3): number {
  return Math.hypot(
    right[0] - left[0],
    right[1] - left[1],
    right[2] - left[2],
  );
}

function subtract3(left: Vec3, right: Vec3): Vec3 {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  ];
}

function dot3(left: Vec3, right: Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function length3(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function angleBetween(left: Vec3, right: Vec3): number {
  const denominator = length3(left) * length3(right);
  if (!(denominator > 1e-12)) return 0;
  const cosine = Math.max(-1, Math.min(1, dot3(left, right) / denominator));
  return Math.acos(cosine);
}

function magnitude3(values: Float64Array, body: number): number {
  const offset = body * 3;
  return Math.hypot(
    values[offset]!,
    values[offset + 1]!,
    values[offset + 2]!,
  );
}

const root: VisualLinkNetwork = {
  links: [{ key: "R", startKey: "R", endKey: "R" }],
};

// RED witness 1: an internal point-hinge projection must not change total
// linear momentum. All rigid sections have the same section mass, so the sum
// of section velocities is proportional to total momentum.
const hinge = createRigidSectionPhysics3D(root, {
  aspectRatio: 2 * Math.SQRT2,
  stiffness: 0,
  simulationSpeed: 1,
});
hinge.linearVelocities.fill(0);
const startBody = hinge.sectionBodyIndex(0, 0);
hinge.linearVelocities[startBody * 3] = 1;
const momentumBefore = sumVec3(hinge.linearVelocities);
hinge.projectHinges();
const momentumAfter = sumVec3(hinge.linearVelocities);
const hingeMomentumDelta = distance3(momentumBefore, momentumAfter);

// RED witness 2: a torque-free anisotropic rigid triangle with non-principal
// angular velocity must obey Euler's rigid-body equation. For I=(0.5,0.5,1)
// and omega=(1,0,1), alpha_y = +1 in the body frame before damping.
const gyro = createRigidSectionPhysics3D(root, {
  aspectRatio: 2 * Math.SQRT2,
  stiffness: 0,
  simulationSpeed: 1,
});
const gyroBody = gyro.sectionBodyIndex(0, 1);
const qOffset = gyroBody * 4;
gyro.orientations[qOffset] = 0;
gyro.orientations[qOffset + 1] = 0;
gyro.orientations[qOffset + 2] = 0;
gyro.orientations[qOffset + 3] = 1;
gyro.angularVelocities.fill(0);
const omegaOffset = gyroBody * 3;
gyro.angularVelocities[omegaOffset] = 1;
gyro.angularVelocities[omegaOffset + 1] = 0;
gyro.angularVelocities[omegaOffset + 2] = 1;
gyro.step();
const dt = RIGID_SECTION_BASE_TIME_STEP;
const angularDamping = Math.exp(-RIGID_SECTION_ANGULAR_DAMPING_RATE * dt);
const expectedGyroY = dt * angularDamping;
const actualGyroY = gyro.angularVelocities[omegaOffset + 1]!;

// Diagnostic 3: prove the current 100-octa self-incidence seed is an analytic
// circle and check whether the physical local potential already sees a bending
// moment at its free point-hinge endpoint.
const circular = createRigidSectionPhysics3D(root, {
  aspectRatio: 50 * Math.SQRT2,
  stiffness: 5,
  simulationSpeed: 0,
});
circular.evaluateForces();
const middle = circular.template.centerSection;
const turningAngles: number[] = [];
for (let local = 1; local < middle; local += 1) {
  const previous = readCenter(circular, local - 1);
  const current = readCenter(circular, local);
  const next = readCenter(circular, local + 1);
  turningAngles.push(
    angleBetween(
      subtract3(current, previous),
      subtract3(next, current),
    ),
  );
}
const turningMean = turningAngles.reduce((sum, value) => sum + value, 0)
  / turningAngles.length;
const turningVariance = turningAngles.reduce(
  (sum, value) => sum + (value - turningMean) ** 2,
  0,
) / turningAngles.length;
const turningStd = Math.sqrt(turningVariance);
const startTorque = magnitude3(
  circular.torques,
  circular.sectionBodyIndex(0, 0),
);
const endTorque = magnitude3(
  circular.torques,
  circular.sectionBodyIndex(0, circular.template.sectionCount - 1),
);

console.log(
  `[v0.5/#71 hinge conservation] before=${momentumBefore.map((v) => v.toFixed(6)).join(",")} `
  + `after=${momentumAfter.map((v) => v.toFixed(6)).join(",")} delta=${hingeMomentumDelta.toExponential(6)}`,
);
console.log(
  `[v0.5/#71 Euler gyro] actualOmegaY=${actualGyroY.toExponential(6)} `
  + `expectedFirstOrder=${expectedGyroY.toExponential(6)}`,
);
console.log(
  `[v0.5/#71 self seed] turningMean=${turningMean.toExponential(6)} `
  + `turningStd=${turningStd.toExponential(6)} startTorque=${startTorque.toExponential(6)} `
  + `endTorque=${endTorque.toExponential(6)}`,
);

assert(
  turningStd < 1e-5,
  `current self seed should reproduce the audited analytic-circle bias; std=${turningStd}`,
);
assert(
  startTorque > 1e-4 && endTorque > 1e-4,
  `the seeded circle should carry a nonzero free-end bending moment under v0.5 physics; start=${startTorque} end=${endTorque}`,
);

// These two assertions are intentionally RED on the current implementation.
assert(
  hingeMomentumDelta <= 1e-6,
  `hinge projection must conserve total linear momentum; delta=${hingeMomentumDelta}`,
);
assert(
  Math.abs(actualGyroY - expectedGyroY) <= 1e-3,
  `anisotropic torque-free rigid-body step must include Euler gyroscopic coupling; actual=${actualGyroY} expected=${expectedGyroY}`,
);
