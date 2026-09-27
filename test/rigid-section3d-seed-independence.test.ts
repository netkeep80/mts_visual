import {
  createRigidSectionPhysics3D,
  rigidSectionHingeError3D,
  rigidSectionPotentialEnergy3D,
  type RigidSectionPhysics3D,
  type Vec3,
} from "../src/rigid-section3d.js";
import type { VisualLinkNetwork } from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual v0.5/#71 seed audit: ${message}`);
}

function bodyCenter(
  controller: RigidSectionPhysics3D,
  local: number,
): Vec3 {
  const body = controller.sectionBodyIndex(0, local);
  const offset = body * 3;
  return [
    controller.centers[offset]!,
    controller.centers[offset + 1]!,
    controller.centers[offset + 2]!,
  ];
}

function distance3(left: Vec3, right: Vec3): number {
  return Math.hypot(
    right[0] - left[0],
    right[1] - left[1],
    right[2] - left[2],
  );
}

function sampledSignature(controller: RigidSectionPhysics3D): number[] {
  const samples: Vec3[] = [];
  const last = controller.template.sectionCount - 1;
  for (let local = 0; local <= last; local += 10) {
    samples.push(bodyCenter(controller, local));
  }
  if (last % 10 !== 0) samples.push(bodyCenter(controller, last));

  const result: number[] = [];
  for (let left = 0; left < samples.length; left += 1) {
    for (let right = left + 1; right < samples.length; right += 1) {
      result.push(distance3(samples[left]!, samples[right]!));
    }
  }
  return result;
}

function rmsSignatureDelta(left: readonly number[], right: readonly number[]): number {
  assert(left.length === right.length, "signature lengths match");
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index]! - right[index]!;
    sum += delta * delta;
  }
  return Math.sqrt(sum / Math.max(1, left.length));
}

function maxSpeed(controller: RigidSectionPhysics3D): number {
  let maximum = 0;
  for (let offset = 0; offset < controller.linearVelocities.length; offset += 3) {
    maximum = Math.max(
      maximum,
      Math.hypot(
        controller.linearVelocities[offset]!,
        controller.linearVelocities[offset + 1]!,
        controller.linearVelocities[offset + 2]!,
      ),
    );
  }
  for (let offset = 0; offset < controller.angularVelocities.length; offset += 3) {
    maximum = Math.max(
      maximum,
      Math.hypot(
        controller.angularVelocities[offset]!,
        controller.angularVelocities[offset + 1]!,
        controller.angularVelocities[offset + 2]!,
      ),
    );
  }
  return maximum;
}

function perturb(
  controller: RigidSectionPhysics3D,
  variant: 1 | 2,
): void {
  const middle = controller.template.centerSection;
  const last = controller.template.sectionCount - 1;
  const amplitude = controller.template.diameter * (variant === 1 ? 0.85 : 1.15);

  for (let local = 1; local < last; local += 1) {
    if (local === middle) continue;
    const halfU = local < middle
      ? local / middle
      : (local - middle) / (last - middle);
    const envelope = Math.sin(Math.PI * halfU);
    const phase = local * 0.6180339887498948;
    const body = controller.sectionBodyIndex(0, local);
    const offset = body * 3;

    if (variant === 1) {
      controller.centers[offset] =
        controller.centers[offset]! + amplitude * envelope * Math.sin(phase * 1.7);
      controller.centers[offset + 1] =
        controller.centers[offset + 1]! + amplitude * 0.7 * envelope * Math.cos(phase * 1.13);
      controller.centers[offset + 2] =
        controller.centers[offset + 2]! + amplitude * 0.35 * envelope * Math.sin(phase * 0.73);
    } else {
      const handed = local < middle ? -1 : 1;
      controller.centers[offset] =
        controller.centers[offset]! + handed * amplitude * 0.55 * envelope * Math.cos(phase * 1.31);
      controller.centers[offset + 1] =
        controller.centers[offset + 1]! + amplitude * envelope * Math.sin(phase * 0.91 + 0.4);
      controller.centers[offset + 2] =
        controller.centers[offset + 2]! - handed * amplitude * 0.8 * envelope * Math.cos(phase * 0.67);
    }
  }

  controller.linearVelocities.fill(0);
  controller.angularVelocities.fill(0);
  controller.projectHinges();
}

const root: VisualLinkNetwork = {
  links: [{ key: "R", startKey: "R", endKey: "R" }],
};

const options = {
  aspectRatio: 50 * Math.SQRT2,
  stiffness: 5,
  simulationSpeed: 2,
} as const;

const controllers = [
  createRigidSectionPhysics3D(root, options),
  createRigidSectionPhysics3D(root, options),
  createRigidSectionPhysics3D(root, options),
] as const;

perturb(controllers[1], 1);
perturb(controllers[2], 2);

const initialSignatures = controllers.map(sampledSignature);
const initialPairwiseMax = Math.max(
  rmsSignatureDelta(initialSignatures[0]!, initialSignatures[1]!),
  rmsSignatureDelta(initialSignatures[0]!, initialSignatures[2]!),
  rmsSignatureDelta(initialSignatures[1]!, initialSignatures[2]!),
);

for (let index = 0; index < controllers.length; index += 1) {
  assert(
    rigidSectionHingeError3D(controllers[index]!) <= 2e-6,
    `seed ${index} starts constraint-valid`,
  );
}

const checkpoints = [0, 1000, 3000, 6000, 12000, 20000, 40000, 60000, 100000, 120000] as const;
const report: string[] = [];
for (let step = 0; step <= checkpoints.at(-1)!; step += 1) {
  if (checkpoints.includes(step as (typeof checkpoints)[number])) {
    const signatures = controllers.map(sampledSignature);
    const energies = controllers.map(rigidSectionPotentialEnergy3D);
    const speeds = controllers.map(maxSpeed);
    report.push(
      `step=${step} `
      + `energy=[${energies.map((v) => v.toExponential(5)).join(",")}] `
      + `speed=[${speeds.map((v) => v.toExponential(4)).join(",")}] `
      + `d01=${rmsSignatureDelta(signatures[0]!, signatures[1]!).toExponential(5)} `
      + `d02=${rmsSignatureDelta(signatures[0]!, signatures[2]!).toExponential(5)} `
      + `d12=${rmsSignatureDelta(signatures[1]!, signatures[2]!).toExponential(5)}`,
    );
  }
  if (step === checkpoints.at(-1)!) break;
  for (const controller of controllers) controller.step();
}

for (let index = 0; index < controllers.length; index += 1) {
  assert(controllers[index]!.centers.every(Number.isFinite), `seed ${index} centers remain finite`);
  assert(controllers[index]!.orientations.every(Number.isFinite), `seed ${index} orientations remain finite`);
  assert(
    rigidSectionHingeError3D(controllers[index]!) <= 2e-5,
    `seed ${index} preserves hinge constraints`,
  );
}

const finalSignatures = controllers.map(sampledSignature);
const finalPairwise = [
  rmsSignatureDelta(finalSignatures[0]!, finalSignatures[1]!),
  rmsSignatureDelta(finalSignatures[0]!, finalSignatures[2]!),
  rmsSignatureDelta(finalSignatures[1]!, finalSignatures[2]!),
];
const finalPairwiseMax = Math.max(...finalPairwise);
const finalEnergies = controllers.map(rigidSectionPotentialEnergy3D);
const finalEnergySpread =
  Math.max(...finalEnergies) - Math.min(...finalEnergies);
const finalMaxSpeed = Math.max(...controllers.map(maxSpeed));

assert(
  initialPairwiseMax > controllers[0]!.template.diameter * 0.5,
  `three seeds begin substantially different: initial max signature delta=${initialPairwiseMax}`,
);
assert(
  finalPairwiseMax <= controllers[0]!.template.diameter * 0.02,
  `long damped relaxation converges to the same practical centerline attractor within 2% diameter: final max signature delta=${finalPairwiseMax}`,
);
assert(
  finalPairwiseMax <= initialPairwiseMax * 0.04,
  `seed dependence contracts by at least 25x: initial=${initialPairwiseMax} final=${finalPairwiseMax}`,
);
assert(
  finalEnergySpread <= 0.003,
  `independent seeds converge to the same low-energy band: spread=${finalEnergySpread}`,
);
assert(
  finalMaxSpeed <= 0.001,
  `120k-step witness is in the damped settling regime: max speed=${finalMaxSpeed}`,
);

console.log(
  "[v0.5 #71 seed-independence] PASS "
  + `initialMax=${initialPairwiseMax.toExponential(5)} `
  + `final=[${finalPairwise.map((value) => value.toExponential(5)).join(",")}] `
  + `energy=[${finalEnergies.map((value) => value.toExponential(5)).join(",")}] `
  + `energySpread=${finalEnergySpread.toExponential(5)} `
  + `maxSpeed=${finalMaxSpeed.toExponential(5)} | `
  + report.join(" | "),
);
