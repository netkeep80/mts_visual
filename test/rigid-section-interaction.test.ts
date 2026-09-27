import {
  RIGID_SECTION_CENTER_ICOSAHEDRON_FACES,
  RIGID_SECTION_CENTER_ICOSAHEDRON_VERTEX_COUNT,
  RIGID_SECTION_END_CONE_VERTEX_COUNT,
  pickRigidSectionCenterIcosahedra3D,
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

assert(
  RIGID_SECTION_CENTER_ICOSAHEDRON_FACES.length === 20,
  "CENTER marker is a 20-face regular icosahedron",
);
assert(
  RIGID_SECTION_CENTER_ICOSAHEDRON_VERTEX_COUNT === 60,
  "solid CENTER icosahedron renders 60 triangle-list vertices",
);
assert(
  RIGID_SECTION_END_CONE_VERTEX_COUNT === 18,
  "six-sided END cone renders exactly six side triangles",
);

const worldCenters = [
  [0, 0, 0] as const,
  [0, 0, -6] as const,
  [8, 0, 0] as const,
];
assert(
  pickRigidSectionCenterIcosahedra3D(
    [0, 0, 8],
    [0, 0, -1],
    worldCenters,
    2,
  ) === 0,
  "world-space ray selects nearest visible CENTER icosahedron",
);
assert(
  pickRigidSectionCenterIcosahedra3D(
    [8, 0, 8],
    [0, 0, -1],
    worldCenters,
    2,
  ) === 2,
  "world-space picking follows marker position instead of screen-space pixels",
);
assert(
  pickRigidSectionCenterIcosahedra3D(
    [0, 0, 8],
    [1, 0, 0],
    worldCenters,
    2,
  ) === -1,
  "ray missing every CENTER icosahedron returns no selection",
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
