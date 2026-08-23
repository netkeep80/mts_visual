import {
  VisualGeometry3DError,
  dotVec3,
  type Physics3DState,
  type Point3D,
  type VisualLink,
  type VisualLinkNetwork,
} from "../src/index.js";
import {
  VISUAL_THREE_COLORS,
  buildVisualThreeSceneData,
} from "../src/three/index.js";

type CenterlineProbe = {
  readonly role: "start" | "end";
  readonly semanticOrientation: "outer-to-green" | "green-to-outer";
  readonly greenOutwardTangent: Point3D;
  readonly loop: boolean;
  readonly controlPoints: readonly Point3D[];
};

type NodeProbe = {
  readonly key: string;
  readonly position: Point3D;
  readonly label?: string;
  readonly tags?: readonly string[];
  readonly draggable: boolean;
};

type ArcProbe = {
  readonly linkKey: string;
  readonly role: "start" | "end";
  readonly semanticOrientation: "outer-to-green" | "green-to-outer";
  readonly colorFrom: number;
  readonly colorTo: number;
  readonly centerline: CenterlineProbe;
};

type SceneProbe = {
  readonly nodes: readonly NodeProbe[];
  readonly arcs: readonly ArcProbe[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V2f-A: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function deepSame(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function samePoint(actual: Point3D, expected: Point3D, message: string): void {
  same(actual.x, expected.x, `${message}.x`);
  same(actual.y, expected.y, `${message}.y`);
  same(actual.z, expected.z, `${message}.z`);
}

function finitePoint(value: Point3D): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function links(): VisualLink[] {
  return [
    { key: "R", startKey: "R", endKey: "R", label: "∞", tags: ["root"] },
    { key: "O", startKey: "O", endKey: "R" },
    { key: "C", startKey: "R", endKey: "C" },
    { key: "L", startKey: "O", endKey: "C" },
    { key: "U", startKey: "C", endKey: "O" },
    { key: "X", startKey: "L", endKey: "U", tags: ["link-of-links"] },
  ];
}

const positionByKey: Readonly<Record<string, Point3D>> = Object.freeze({
  R: Object.freeze({ x: 0, y: 0, z: 0 }),
  O: Object.freeze({ x: -2, y: 1, z: 0.5 }),
  C: Object.freeze({ x: 2, y: -1, z: -0.5 }),
  L: Object.freeze({ x: -1, y: 2, z: 1.5 }),
  U: Object.freeze({ x: 1, y: -2, z: -1.5 }),
  X: Object.freeze({ x: 0.5, y: 0.75, z: 2.5 }),
});

function state(order = ["R", "O", "C", "L", "U", "X"]): Physics3DState {
  return {
    positions: order.map((key) => ({ key, point: positionByKey[key]! })),
    velocities: order.map((key) => ({ key, vector: { x: 0, y: 0, z: 0 } })),
  };
}

function node(scene: SceneProbe, key: string): NodeProbe {
  const result = scene.nodes.find((candidate: NodeProbe) => candidate.key === key);
  assert(result !== undefined, `missing node ${key}`);
  return result;
}

function arc(scene: SceneProbe, key: string, role: "start" | "end"): ArcProbe {
  const result = scene.arcs.find(
    (candidate: ArcProbe) => candidate.linkKey === key && candidate.role === role,
  );
  assert(result !== undefined, `missing ${role} arc ${key}`);
  return result;
}

function allFinite(centerline: CenterlineProbe): boolean {
  return centerline.controlPoints.every((value: Point3D) => finitePoint(value))
    && finitePoint(centerline.greenOutwardTangent);
}

const network: VisualLinkNetwork = { links: links() };
const initial = state();
const inputBefore = JSON.stringify({ network, initial });
const scene = buildVisualThreeSceneData(network, initial) as SceneProbe;

same(JSON.stringify(scene.nodes.map((value: NodeProbe) => value.key)), JSON.stringify(["C", "L", "O", "R", "U", "X"]), "normalized node order");
same(scene.nodes.length, 6, "one represented center per Link");
same(scene.arcs.length, 12, "two graphical arcs per represented Link");
same(JSON.stringify({ network, initial }), inputBefore, "scene projection does not mutate inputs");

const root = node(scene, "R");
same(root.draggable, true, "R remains draggable");
same(root.label, "∞", "root label remains presentation metadata");
same(root.tags?.join(","), "root", "root tag remains presentation metadata");
samePoint(root.position, positionByKey.R!, "root position unchanged by metadata");

for (const linkKey of ["C", "L", "O", "R", "U", "X"]) {
  const start = arc(scene, linkKey, "start");
  const end = arc(scene, linkKey, "end");
  same(start.role, "start", `${linkKey} start role`);
  same(start.semanticOrientation, "outer-to-green", `${linkKey} start orientation`);
  same(start.colorFrom, VISUAL_THREE_COLORS.startOuter, `${linkKey} start RED`);
  same(start.colorTo, VISUAL_THREE_COLORS.center, `${linkKey} start GREEN`);
  same(end.role, "end", `${linkKey} end role`);
  same(end.semanticOrientation, "green-to-outer", `${linkKey} end orientation`);
  same(end.colorFrom, VISUAL_THREE_COLORS.center, `${linkKey} end GREEN`);
  same(end.colorTo, VISUAL_THREE_COLORS.endOuter, `${linkKey} end BLUE`);
  assert(allFinite(start.centerline), `${linkKey} start centerline finite`);
  assert(allFinite(end.centerline), `${linkKey} end centerline finite`);
  assert(
    Math.abs(dotVec3(start.centerline.greenOutwardTangent, end.centerline.greenOutwardTangent) + 1) < 1e-10,
    `${linkKey} arcs leave GREEN center at 180 degrees`,
  );
}

const startSelf = arc(scene, "O", "start");
same(startSelf.centerline.loop, true, "start self-link remains a finite loop");
const endSelf = arc(scene, "C", "end");
same(endSelf.centerline.loop, true, "end self-link remains a finite loop");
const rootStart = arc(scene, "R", "start");
const rootEnd = arc(scene, "R", "end");
same(rootStart.centerline.loop, true, "double-self start loop visible");
same(rootEnd.centerline.loop, true, "double-self end loop visible");
assert(
  JSON.stringify(rootStart.centerline.controlPoints) !== JSON.stringify(rootEnd.centerline.controlPoints),
  "double-self loops are geometrically distinct",
);

const xStart = arc(scene, "X", "start");
const xEnd = arc(scene, "X", "end");
samePoint(xStart.centerline.controlPoints[0]!, positionByKey.L!, "link-of-links start anchors represented L center");
samePoint(xStart.centerline.controlPoints.at(-1)!, positionByKey.X!, "link-of-links start reaches X center");
samePoint(xEnd.centerline.controlPoints[0]!, positionByKey.X!, "link-of-links end leaves X center");
samePoint(xEnd.centerline.controlPoints.at(-1)!, positionByKey.U!, "link-of-links end anchors represented U center");

const reversedNetwork: VisualLinkNetwork = { links: links().reverse() };
const reversed = buildVisualThreeSceneData(
  reversedNetwork,
  state(["X", "U", "R", "O", "L", "C"]),
) as SceneProbe;
deepSame(reversed, scene, "input order does not alter deterministic scene projection");

assert(Object.isFrozen(scene), "scene snapshot frozen");
assert(Object.isFrozen(scene.nodes), "scene node list frozen");
assert(Object.isFrozen(scene.arcs), "scene arc list frozen");
assert(Object.isFrozen(root), "scene node frozen");
assert(Object.isFrozen(root.position), "scene node position detached/frozen");
assert(Object.isFrozen(root.tags), "scene node metadata detached/frozen");
assert(Object.isFrozen(rootStart.centerline), "V2c centerline remains frozen");
assert(Object.isFrozen(rootStart.centerline.controlPoints), "V2c control points remain frozen");

try {
  buildVisualThreeSceneData(network, {
    positions: initial.positions.filter((entry) => entry.key !== "X"),
    velocities: initial.velocities,
  });
  throw new Error("missing position must reject");
} catch (error) {
  assert(error instanceof VisualGeometry3DError, "missing position rejects through V2c geometry boundary");
  same(error.code, "missing-position", "missing position error code preserved");
}
