import assert from "node:assert/strict";
import {
  cameraBasis,
  cameraEye,
  clamp,
  createViewProjection,
  cross3,
  dot3,
  lookAt4,
  multiply4,
  normalize3,
  panCamera,
  perspective4,
  pointerWorldRay,
  projectWorldToClient,
  resetCamera,
  transformPoint4,
} from "../browser/webgpu-witness/mechanical-camera-model.js";

function near(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} ~= ${expected} (eps=${epsilon})`,
  );
}

function nearVector(actual, expected, epsilon = 1e-9) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    near(actual[index], expected[index], epsilon);
  }
}

function identity4() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

const sourceVector = [3, 4, 0];
assert.deepEqual(
  normalize3(sourceVector),
  [0.6, 0.8, 0],
);
assert.deepEqual(sourceVector, [3, 4, 0]);
assert.deepEqual(normalize3([0, 0, 0]), [0, 0, 0]);

assert.deepEqual(
  cross3([1, 0, 0], [0, 1, 0]),
  [0, 0, 1],
);
assert.equal(dot3([1, 2, 3], [4, 5, 6]), 32);
assert.equal(dot3([1, 0, 0], [0, 1, 0]), 0);

const lookAt = lookAt4(
  [0, 0, 5],
  [0, 0, 0],
  [0, 1, 0],
);
assert.equal(lookAt.length, 16);
for (const value of lookAt) {
  assert.equal(Number.isFinite(value), true);
}
near(lookAt[12], 0);
near(lookAt[13], 0);
near(lookAt[14], -5);

const perspective = perspective4(
  Math.PI / 2,
  2,
  1,
  11,
);
near(perspective[0], 0.5, 1e-7);
near(perspective[5], 1, 1e-7);
near(perspective[10], -1.2, 1e-7);
near(perspective[11], -1, 1e-7);
near(perspective[14], -2.2, 1e-7);

const identity = identity4();
const arbitrary = new Float32Array([
  1, 2, 3, 4,
  5, 6, 7, 8,
  9, 10, 11, 12,
  13, 14, 15, 16,
]);
assert.deepEqual(
  [...multiply4(identity, arbitrary)],
  [...arbitrary],
);
assert.deepEqual(
  [...multiply4(arbitrary, identity)],
  [...arbitrary],
);
assert.deepEqual(
  transformPoint4(identity, [2, 3, 4]),
  [2, 3, 4, 1],
);

assert.equal(clamp(-1, 0, 10), 0);
assert.equal(clamp(7, 0, 10), 7);
assert.equal(clamp(20, 0, 10), 10);

const axisCamera = {
  yaw: 0,
  pitch: 0,
  distance: 10,
  defaultDistance: 10,
  minDistance: 2,
  maxDistance: 200,
  target: [0, 0, 0],
};
nearVector(cameraEye(axisCamera), [10, 0, 0]);

const rotatedCamera = {
  ...axisCamera,
  yaw: Math.PI / 2,
  target: [0, 0, 0],
};
nearVector(
  cameraEye(rotatedCamera),
  [0, 0, 10],
  1e-9,
);

const resetTarget = {
  yaw: 9,
  pitch: -9,
  distance: 1,
  defaultDistance: 1,
  minDistance: 1,
  maxDistance: 1,
  target: [4, 5, 6],
};
resetCamera(resetTarget, 50);
near(resetTarget.yaw, -0.8);
near(resetTarget.pitch, 0.38);
near(resetTarget.distance, 50);
near(resetTarget.defaultDistance, 50);
near(resetTarget.minDistance, 4);
near(resetTarget.maxDistance, 1000);
assert.deepEqual(resetTarget.target, [0, 0, 0]);

const basis = cameraBasis(axisCamera);
nearVector(basis.eye, [10, 0, 0]);
nearVector(basis.forward, [-1, 0, 0]);
nearVector(basis.right, [0, 0, -1]);
nearVector(basis.up, [0, 1, 0]);
near(dot3(basis.forward, basis.right), 0);
near(dot3(basis.forward, basis.up), 0);
near(dot3(basis.right, basis.up), 0);

const panTarget = {
  ...axisCamera,
  target: [0, 0, 0],
};
panCamera(panTarget, 100, 50);
nearVector(
  panTarget.target,
  [0, 0.75, 1.5],
  1e-12,
);
near(panTarget.yaw, 0);
near(panTarget.pitch, 0);
near(panTarget.distance, 10);

const cameraSnapshot = {
  ...axisCamera,
  target: [...axisCamera.target],
};
const viewProjectionA = createViewProjection(
  axisCamera,
  800,
  600,
);
const viewProjectionB = createViewProjection(
  axisCamera,
  800,
  600,
);
assert.deepEqual(
  [...viewProjectionA],
  [...viewProjectionB],
);
assert.deepEqual(axisCamera, cameraSnapshot);
for (const value of viewProjectionA) {
  assert.equal(Number.isFinite(value), true);
}

const viewProjectionWide = createViewProjection(
  axisCamera,
  1600,
  600,
);
assert.notEqual(
  viewProjectionA[0],
  viewProjectionWide[0],
);

const rect = {
  left: 100,
  top: 50,
  width: 400,
  height: 300,
};
const projectedCenter = projectWorldToClient({
  camera: axisCamera,
  world: [0, 0, 0],
  framebufferWidth: 800,
  framebufferHeight: 600,
  rect,
});
assert.notEqual(projectedCenter, null);
nearVector(projectedCenter, [300, 200], 1e-6);

assert.equal(
  projectWorldToClient({
    camera: axisCamera,
    world: [20, 0, 0],
    framebufferWidth: 800,
    framebufferHeight: 600,
    rect,
  }),
  null,
);

const centerRay = pointerWorldRay({
  camera: axisCamera,
  clientX: 300,
  clientY: 200,
  rect,
});
nearVector(centerRay.origin, [10, 0, 0]);
nearVector(centerRay.direction, [-1, 0, 0], 1e-12);
near(
  Math.hypot(...centerRay.direction),
  1,
  1e-12,
);

const cornerRay = pointerWorldRay({
  camera: axisCamera,
  clientX: 500,
  clientY: 50,
  rect,
});
assert.equal(
  cornerRay.direction.every(Number.isFinite),
  true,
);
near(
  Math.hypot(...cornerRay.direction),
  1,
  1e-12,
);
assert.notDeepEqual(
  cornerRay.direction,
  centerRay.direction,
);

const degenerateRectRay = pointerWorldRay({
  camera: axisCamera,
  clientX: 0,
  clientY: 0,
  rect: {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  },
});
assert.equal(
  degenerateRectRay.direction.every(Number.isFinite),
  true,
);
near(
  Math.hypot(...degenerateRectRay.direction),
  1,
  1e-12,
);

console.log(
  "Mechanical camera math executable contract: PASS",
);
