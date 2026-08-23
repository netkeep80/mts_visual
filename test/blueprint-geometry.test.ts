import {
  VisualNetworkError,
  type VisualLink,
  type VisualLinkNetwork,
} from "../src/index.js";
import {
  BlueprintGeometryError,
  blueprintGeometryIsFinite,
  blueprintSegmentsAreC1,
  buildBlueprintGeometry,
  createBlueprintInitialPositions,
  type BlueprintGeometry,
  type BlueprintPosition,
  type Point2D,
} from "../src/blueprint-geometry.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V1: ${message}`);
}

function near(left: Point2D, right: Point2D, epsilon = 1e-8): boolean {
  return Math.abs(left.x - right.x) <= epsilon && Math.abs(left.y - right.y) <= epsilon;
}

function basisLinks(): VisualLink[] {
  return [
    { key: "R", startKey: "R", endKey: "R" },
    { key: "O", startKey: "O", endKey: "R" },
    { key: "C", startKey: "R", endKey: "C" },
    { key: "L", startKey: "O", endKey: "C" },
    { key: "U", startKey: "C", endKey: "O" },
    { key: "X", startKey: "L", endKey: "U" },
  ];
}

function byLink(geometry: BlueprintGeometry, key: string) {
  const link = geometry.links.find((candidate) => candidate.key === key);
  assert(link !== undefined, `missing geometry for ${key}`);
  return link;
}

function byPosition(positions: readonly BlueprintPosition[], key: string): Point2D {
  const position = positions.find((candidate) => candidate.key === key);
  assert(position !== undefined, `missing position for ${key}`);
  return position.point;
}

function geometrySnapshot(geometry: BlueprintGeometry): string {
  return JSON.stringify({
    positions: geometry.positions,
    links: geometry.links.map(({ key, startKey, endKey, center, segments }) => ({
      key,
      startKey,
      endKey,
      center,
      segments,
    })),
  });
}

function expectBlueprintCode(effect: () => unknown, code: BlueprintGeometryError["code"], message: string): void {
  try {
    effect();
  } catch (error) {
    assert(error instanceof BlueprintGeometryError, `${message}: wrong error type`);
    assert(error.code === code, `${message}: ${error.code} !== ${code}`);
    return;
  }
  throw new Error(`@mts/visual V1: ${message}: expected rejection`);
}

const network: VisualLinkNetwork = { links: basisLinks() };
const originalTopology = JSON.stringify(network);
const positions = createBlueprintInitialPositions(network);
const geometry = buildBlueprintGeometry(network);

assert(positions.length === 6, "deterministic positions cover every Link");
assert(blueprintGeometryIsFinite(geometry), "basis geometry is finite");
assert(geometry.links.length === 6, "one geometry object exists per Link");

for (const link of geometry.links) {
  assert(link.segments.length > 0, `${link.key} has a visible path`);
  assert(near(link.segments[0]!.p0, link.startAnchor), `${link.key} starts at start(Link)`);
  assert(near(link.segments.at(-1)!.p3, link.endAnchor), `${link.key} ends at end(Link)`);
  assert(blueprintSegmentsAreC1(link.segments), `${link.key} path is C1`);
}

const root = byLink(geometry, "R");
assert(near(root.startAnchor, root.center), "root self-link starts at own center");
assert(near(root.endAnchor, root.center), "root self-link returns to own center");
const rootPoints = root.segments.flatMap((segment) => [segment.p0, segment.p1, segment.p2, segment.p3]);
const rootWidth = Math.max(...rootPoints.map((point) => point.x)) - Math.min(...rootPoints.map((point) => point.x));
const rootHeight = Math.max(...rootPoints.map((point) => point.y)) - Math.min(...rootPoints.map((point) => point.y));
assert(rootWidth > 1 || rootHeight > 1, "root self-link has nonzero visible extent");
assert(blueprintSegmentsAreC1(root.segments), "root loop is C1 including closure");

const open = byLink(geometry, "O");
assert(near(open.startAnchor, open.center), "O=O->R preserves self-start anchor");
assert(open.segments.length >= 3, "self-start receives a finite detour instead of zero leg");

const close = byLink(geometry, "C");
assert(near(close.endAnchor, close.center), "C=R->C preserves self-end anchor");
assert(close.segments.length >= 3, "self-end receives a finite detour instead of zero leg");

const ordinary = byLink(geometry, "L");
assert(ordinary.segments.length === 2, "ordinary Link is one two-leg continuous path through its center");
assert(near(ordinary.segments[0]!.p3, ordinary.center), "ordinary path reaches Link center");
assert(near(ordinary.segments[1]!.p0, ordinary.center), "ordinary path leaves same Link center");

const linkOfLinks = byLink(geometry, "X");
assert(near(linkOfLinks.startAnchor, byPosition(geometry.positions, "L")), "link-of-links anchors start to L center");
assert(near(linkOfLinks.endAnchor, byPosition(geometry.positions, "U")), "link-of-links anchors end to U center");

const reordered: VisualLinkNetwork = { links: [...basisLinks()].reverse() };
assert(
  geometrySnapshot(buildBlueprintGeometry(reordered)) === geometrySnapshot(geometry),
  "normalized topology gives deterministic geometry independent of record order",
);

const movedPositions = positions.map((position) => position.key === "X"
  ? { key: position.key, point: { x: position.point.x + 240, y: position.point.y - 120 } }
  : position);
const moved = buildBlueprintGeometry(network, movedPositions);
assert(!near(byLink(moved, "X").center, byLink(geometry, "X").center), "presentation center override changes geometry");
assert(JSON.stringify(network) === originalTopology, "geometry and position overrides do not mutate semantic topology DTO");
assert(byLink(moved, "X").startKey === "L" && byLink(moved, "X").endKey === "U", "coordinates cannot rewrite poles");

try {
  buildBlueprintGeometry({ links: [{ key: "A", startKey: "missing", endKey: "A" }] });
  throw new Error("invalid VisualLinkNetwork should reject");
} catch (error) {
  assert(error instanceof VisualNetworkError, "invalid topology rejects through V0 validator");
}

expectBlueprintCode(
  () => buildBlueprintGeometry(network, positions.filter((position) => position.key !== "X")),
  "missing-position",
  "missing explicit position",
);
expectBlueprintCode(
  () => buildBlueprintGeometry(network, positions.map((position) => position.key === "X"
    ? { key: "X", point: { x: Number.NaN, y: 0 } }
    : position)),
  "non-finite-position",
  "NaN explicit position",
);
expectBlueprintCode(
  () => buildBlueprintGeometry(network, [...positions, { key: "foreign", point: { x: 0, y: 0 } }]),
  "unknown-position",
  "unknown explicit position",
);
expectBlueprintCode(
  () => buildBlueprintGeometry(network, [...positions, positions[0]!]),
  "duplicate-position",
  "duplicate explicit position",
);
expectBlueprintCode(
  () => buildBlueprintGeometry(network, undefined, { loopRadius: 0 }),
  "invalid-option",
  "zero loop radius",
);

assert(Object.isFrozen(geometry), "geometry snapshot is immutable");
assert(Object.isFrozen(geometry.positions), "position list is immutable");
assert(Object.isFrozen(root.segments), "segment list is immutable");
