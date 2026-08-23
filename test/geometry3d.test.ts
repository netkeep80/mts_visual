import type { VisualLinkNetwork } from "../src/index.js";
import {
  VisualGeometry3DError,
  buildVisualGeometry3D,
  centerlinePoint3D,
  dotVec3,
  sampleCenterline3D,
} from "../src/geometry3d.js";

type Point3D = Readonly<{ x: number; y: number; z: number }>;
type VisualPosition3D = Readonly<{ key: string; point: Point3D }>;
type GeometryErrorCode =
  | "missing-position"
  | "extra-position"
  | "duplicate-position"
  | "non-finite-position";

type CenterlineProbe = Readonly<{
  role: "start" | "end";
  semanticOrientation: "outer-to-green" | "green-to-outer";
  greenOutwardTangent: Point3D;
  loop: boolean;
  controlPoints: readonly Point3D[];
}>;

type LinkGeometryProbe = Readonly<{
  key: string;
  start: CenterlineProbe;
  end: CenterlineProbe;
}>;

type VisualGeometry3DProbe = Readonly<{
  links: readonly LinkGeometryProbe[];
}>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V2c: ${message}`);
}

function approx(actual: number, expected: number, message: string, epsilon = 1e-9): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} != ${expected}`);
}

function samePoint(actual: Point3D, expected: Point3D, message: string): void {
  approx(actual.x, expected.x, `${message}.x`);
  approx(actual.y, expected.y, `${message}.y`);
  approx(actual.z, expected.z, `${message}.z`);
}

function finitePoint(point: Point3D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

function linkByKey(geometry: VisualGeometry3DProbe, key: string): LinkGeometryProbe {
  const link = geometry.links.find((candidate: LinkGeometryProbe) => candidate.key === key);
  assert(link !== undefined, `missing geometry for ${key}`);
  return link;
}

function position(key: string, x: number, y: number, z: number): VisualPosition3D {
  return { key, point: { x, y, z } };
}

function expectCode(effect: () => unknown, code: GeometryErrorCode, message: string): void {
  try {
    effect();
  } catch (error) {
    assert(error instanceof VisualGeometry3DError, `${message}: wrong error type`);
    const coded = error as { readonly code?: unknown };
    assert(coded.code === code, `${message}: ${String(coded.code)} !== ${code}`);
    return;
  }
  throw new Error(`@mts/visual V2c: ${message}: expected rejection`);
}

const ordinaryNetwork: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "A" },
    { key: "B", startKey: "B", endKey: "B" },
    { key: "X", startKey: "A", endKey: "B" },
  ],
};
const ordinaryPositions: VisualPosition3D[] = [
  position("A", 2, 1, 3),
  position("B", -1, 4, 2),
  position("X", 0, 0, 0),
];
const ordinaryTopologyBefore = JSON.stringify(ordinaryNetwork);
const ordinaryPositionsBefore = JSON.stringify(ordinaryPositions);
const ordinary = buildVisualGeometry3D(ordinaryNetwork, ordinaryPositions) as VisualGeometry3DProbe;
const x = linkByKey(ordinary, "X");

samePoint(centerlinePoint3D(x.start, 0), ordinaryPositions[0]!.point, "start arc begins at start Link center");
samePoint(centerlinePoint3D(x.start, 1), ordinaryPositions[2]!.point, "start arc ends at GREEN center");
samePoint(centerlinePoint3D(x.end, 0), ordinaryPositions[2]!.point, "end arc begins at GREEN center");
samePoint(centerlinePoint3D(x.end, 1), ordinaryPositions[1]!.point, "end arc ends at end Link center");
assert(x.start.role === "start", "start role preserved");
assert(x.start.semanticOrientation === "outer-to-green", "start orientation is RED-to-GREEN capable");
assert(x.end.role === "end", "end role preserved");
assert(x.end.semanticOrientation === "green-to-outer", "end orientation is GREEN-to-BLUE capable");
approx(dotVec3(x.start.greenOutwardTangent, x.end.greenOutwardTangent), -1, "GREEN tangents are 180 degrees");
assert(centerlinePoint3D(x.start, 0).z === 3, "ordinary non-coplanar z coordinate is preserved");
assert(JSON.stringify(ordinaryNetwork) === ordinaryTopologyBefore, "geometry cannot mutate visual topology");
assert(JSON.stringify(ordinaryPositions) === ordinaryPositionsBefore, "geometry cannot mutate caller positions");

const reordered = buildVisualGeometry3D(
  { links: [...ordinaryNetwork.links].reverse() },
  [...ordinaryPositions].reverse(),
) as VisualGeometry3DProbe;
assert(JSON.stringify(reordered) === JSON.stringify(ordinary), "input order does not alter normalized 3D geometry");

const degenerate = buildVisualGeometry3D(
  ordinaryNetwork,
  [position("A", 0, 0, 0), position("B", 0, 0, 0), position("X", 0, 0, 0)],
) as VisualGeometry3DProbe;
const degenerateX = linkByKey(degenerate, "X");
for (const point of [...sampleCenterline3D(degenerateX.start, 24), ...sampleCenterline3D(degenerateX.end, 24)]) {
  assert(finitePoint(point), "coincident geometry remains finite");
}
approx(
  dotVec3(degenerateX.start.greenOutwardTangent, degenerateX.end.greenOutwardTangent),
  -1,
  "coincident geometry preserves GREEN 180 degrees",
);

const startSelfNetwork: VisualLinkNetwork = {
  links: [
    { key: "B", startKey: "B", endKey: "B" },
    { key: "X", startKey: "X", endKey: "B" },
  ],
};
const startSelf = linkByKey(
  buildVisualGeometry3D(startSelfNetwork, [position("B", 3, 1, 2), position("X", 0, 0, 0)]) as VisualGeometry3DProbe,
  "X",
);
assert(startSelf.start.loop === true, "start self-reference becomes a finite loop");
for (const point of sampleCenterline3D(startSelf.start, 32)) assert(finitePoint(point), "start self-loop finite");
approx(dotVec3(startSelf.start.greenOutwardTangent, startSelf.end.greenOutwardTangent), -1, "start self-loop 180 degrees");

const endSelfNetwork: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "A" },
    { key: "X", startKey: "A", endKey: "X" },
  ],
};
const endSelf = linkByKey(
  buildVisualGeometry3D(endSelfNetwork, [position("A", -2, 5, 1), position("X", 0, 0, 0)]) as VisualGeometry3DProbe,
  "X",
);
assert(endSelf.end.loop === true, "end self-reference becomes a finite loop");
for (const point of sampleCenterline3D(endSelf.end, 32)) assert(finitePoint(point), "end self-loop finite");
approx(dotVec3(endSelf.start.greenOutwardTangent, endSelf.end.greenOutwardTangent), -1, "end self-loop 180 degrees");

const rootNetwork: VisualLinkNetwork = { links: [{ key: "R", startKey: "R", endKey: "R" }] };
const root = linkByKey(
  buildVisualGeometry3D(rootNetwork, [position("R", 1, -2, 4)]) as VisualGeometry3DProbe,
  "R",
);
assert(root.start.loop === true && root.end.loop === true, "double self-link has two loops");
assert(JSON.stringify(root.start.controlPoints) !== JSON.stringify(root.end.controlPoints), "double self-loops are distinct");
for (const point of [...sampleCenterline3D(root.start, 32), ...sampleCenterline3D(root.end, 32)]) {
  assert(finitePoint(point), "double self-loop finite");
}
approx(dotVec3(root.start.greenOutwardTangent, root.end.greenOutwardTangent), -1, "double self-link 180 degrees");

const linkOfLinksNetwork: VisualLinkNetwork = {
  links: [
    { key: "L", startKey: "L", endKey: "L" },
    { key: "U", startKey: "U", endKey: "U" },
    { key: "X", startKey: "L", endKey: "U" },
  ],
};
const linkOfLinksPositions = [
  position("L", -3, 2, 1),
  position("U", 4, -1, 5),
  position("X", 0, 0, 2),
];
const linkOfLinks = linkByKey(
  buildVisualGeometry3D(linkOfLinksNetwork, linkOfLinksPositions) as VisualGeometry3DProbe,
  "X",
);
samePoint(centerlinePoint3D(linkOfLinks.start, 0), linkOfLinksPositions[0]!.point, "link-of-links start anchor");
samePoint(centerlinePoint3D(linkOfLinks.end, 1), linkOfLinksPositions[1]!.point, "link-of-links end anchor");

expectCode(
  () => buildVisualGeometry3D(ordinaryNetwork, ordinaryPositions.slice(0, 2)),
  "missing-position",
  "missing position",
);
expectCode(
  () => buildVisualGeometry3D(ordinaryNetwork, [...ordinaryPositions, position("EXTRA", 1, 2, 3)]),
  "extra-position",
  "extra position",
);
expectCode(
  () => buildVisualGeometry3D(ordinaryNetwork, [...ordinaryPositions, position("A", 9, 9, 9)]),
  "duplicate-position",
  "duplicate position",
);
expectCode(
  () => buildVisualGeometry3D(ordinaryNetwork, [ordinaryPositions[0]!, ordinaryPositions[1]!, position("X", Number.NaN, 0, 0)]),
  "non-finite-position",
  "NaN position",
);
expectCode(
  () => buildVisualGeometry3D(ordinaryNetwork, [ordinaryPositions[0]!, ordinaryPositions[1]!, position("X", 0, Number.POSITIVE_INFINITY, 0)]),
  "non-finite-position",
  "Infinity position",
);
