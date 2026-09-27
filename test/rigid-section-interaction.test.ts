import {
  pickRigidSectionCenterScreen2D,
  rigidSectionScreenDragDelta3D,
} from "../src/webgpu/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual v0.5/#85 interaction: ${message}`);
}

function near(actual: number, expected: number, epsilon = 1e-9): void {
  assert(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

const projected = [
  [100, 100] as const,
  null,
  [112, 100] as const,
  [300, 300] as const,
];

assert(
  pickRigidSectionCenterScreen2D(projected, 109, 100, 24) === 2,
  "nearest CENTER wins inside the practical hit radius",
);
assert(
  pickRigidSectionCenterScreen2D(projected, 130, 100, 12) === -1,
  "point outside hit radius does not select a CENTER",
);
assert(
  pickRigidSectionCenterScreen2D(projected, 100, 100, 24) === 0,
  "exact CENTER hit remains deterministic",
);

const delta = rigidSectionScreenDragDelta3D(
  [1, 0, 0],
  [0, 1, 0],
  10,
  1000,
  50,
  -25,
);
const scale = 2 * 10 * Math.tan(Math.PI / 8) / 1000;
near(delta[0], 50 * scale);
near(delta[1], 25 * scale);
near(delta[2], 0);

const first = rigidSectionScreenDragDelta3D(
  [1, 0, 0],
  [0, 1, 0],
  10,
  1000,
  20,
  10,
);
const second = rigidSectionScreenDragDelta3D(
  [1, 0, 0],
  [0, 1, 0],
  10,
  1000,
  30,
  -35,
);
near(first[0] + second[0], delta[0]);
near(first[1] + second[1], delta[1]);

console.log("[v0.5 #85 rigid CENTER interaction] PASS");
