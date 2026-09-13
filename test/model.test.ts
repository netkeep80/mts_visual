import "./blueprint-geometry.test.js";
import "./blueprint-svg.test.js";
import "./blueprint-interaction.test.js";
import "./geometry3d.test.js";
import "./physics3d.test.js";
import "./live-physics3d.test.js";
import "./three-scene.test.js";
import "./three-renderer.test.js";
import "./three-live-topology.test.js";
import "./three-controls.test.js";
import "./presentation.test.js";
import "./three-presentation.test.js";
import "./three-labels.test.js";

import {
  VisualNetworkError,
  blueprintSegmentsAreC1,
  buildBlueprintGeometry,
  createBlueprintInitialPositions,
  normalizeVisualLinkNetwork,
  validateVisualLinkNetwork,
  type BlueprintGeometry,
  type BlueprintPosition,
  type Point2D,
  type VisualLink,
  type VisualLinkNetwork,
  type VisualNetworkErrorCode,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V0: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function near(left: Point2D, right: Point2D, epsilon = 1e-8): boolean {
  return Math.abs(left.x - right.x) <= epsilon && Math.abs(left.y - right.y) <= epsilon;
}

function blueprintLink(geometry: BlueprintGeometry, key: string) {
  const link = geometry.links.find((candidate) => candidate.key === key);
  assert(link !== undefined, `missing blueprint geometry for ${key}`);
  return link;
}

function blueprintPoint(positions: readonly BlueprintPosition[], key: string): Point2D {
  const position = positions.find((candidate) => candidate.key === key);
  assert(position !== undefined, `missing blueprint position for ${key}`);
  return position.point;
}

function expectCode(effect: () => unknown, code: VisualNetworkErrorCode, message: string): void {
  try {
    effect();
  } catch (error) {
    assert(error instanceof VisualNetworkError, `${message}: wrong error type`);
    same(error.code, code, `${message}: wrong error code`);
    return;
  }
  throw new Error(`@mts/visual V0: ${message}: expected rejection`);
}

function basisLinks(): VisualLink[] {
  return [
    { key: "R", startKey: "R", endKey: "R", label: "∞", tags: ["root"] },
    { key: "O", startKey: "O", endKey: "R" },
    { key: "C", startKey: "R", endKey: "C" },
    { key: "L", startKey: "O", endKey: "C" },
    { key: "U", startKey: "C", endKey: "O" },
    { key: "X", startKey: "L", endKey: "U", tags: ["link-of-links"] },
  ];
}

const basis: VisualLinkNetwork = { links: basisLinks() };
validateVisualLinkNetwork(basis);

const normalized = normalizeVisualLinkNetwork(basis);
same(normalized.links.length, 6, "all links preserved");
same(normalized.links.map((link) => link.key).join(","), "C,L,O,R,U,X", "stable key order");

const root = normalized.links.find((link) => link.key === "R");
assert(root !== undefined, "root presentation retained");
same(root.startKey, "R", "self-link start retained");
same(root.endKey, "R", "self-link end retained");
same(root.label, "∞", "presentation label retained");
same(root.tags?.join(","), "root", "presentation tags retained");

const linkOfLinks = normalized.links.find((link) => link.key === "X");
assert(linkOfLinks !== undefined, "link-of-links retained");
same(linkOfLinks.startKey, "L", "link-of-links start retained");
same(linkOfLinks.endKey, "U", "link-of-links end retained");

const reordered: VisualLinkNetwork = { links: [...basisLinks()].reverse() };
const normalizedReordered = normalizeVisualLinkNetwork(reordered);
const topology = (network: VisualLinkNetwork): string =>
  JSON.stringify(network.links.map(({ key, startKey, endKey }) => ({ key, startKey, endKey })));
same(topology(normalizedReordered), topology(normalized), "input order does not alter normalized topology");

const relabeled: VisualLinkNetwork = {
  links: basisLinks().map((link) =>
    link.key === "X" ? { ...link, label: "display only", tags: ["selected", "debug"] } : link,
  ),
};
same(topology(normalizeVisualLinkNetwork(relabeled)), topology(normalized), "metadata does not alter topology");

expectCode(
  () => validateVisualLinkNetwork({ links: [...basisLinks(), { key: "R", startKey: "R", endKey: "R" }] }),
  "duplicate-key",
  "duplicate visual key",
);
expectCode(
  () => validateVisualLinkNetwork({ links: [{ key: "   ", startKey: "   ", endKey: "   " }] }),
  "empty-key",
  "blank visual key",
);
expectCode(
  () => validateVisualLinkNetwork({ links: [...basisLinks(), { key: "Y", startKey: "missing", endKey: "R" }] }),
  "missing-start",
  "missing start reference",
);
expectCode(
  () => validateVisualLinkNetwork({ links: [...basisLinks(), { key: "Y", startKey: "R", endKey: "missing" }] }),
  "missing-end",
  "missing end reference",
);
expectCode(
  () =>
    validateVisualLinkNetwork({
      links: [...basisLinks(), { key: "Y", startKey: "missing", endKey: "R", label: "missing", tags: ["missing"] }],
    }),
  "missing-start",
  "metadata cannot repair invalid topology",
);
expectCode(
  () => validateVisualLinkNetwork({ links: [...basisLinks(), { key: "Y", startKey: " ", endKey: "R" }] }),
  "empty-start",
  "blank start reference",
);
expectCode(
  () => validateVisualLinkNetwork({ links: [...basisLinks(), { key: "Y", startKey: "R", endKey: "\t" }] }),
  "empty-end",
  "blank end reference",
);

assert(Object.isFrozen(normalized), "normalized network is immutable presentation snapshot");
assert(Object.isFrozen(normalized.links), "normalized link list is immutable presentation snapshot");

// M4a conformance: semantic anchors stay exact while the rendered path may clear
// START/END markers away from those centers. This is presentation only.
const blueprintTopologyBefore = JSON.stringify(basis);
const blueprintPositions = createBlueprintInitialPositions(basis);
const clearanced = buildBlueprintGeometry(basis, blueprintPositions, {
  startOffsetFraction: 0.10,
  endOffsetFraction: 0.16,
});
const clearancedOrdinary = blueprintLink(clearanced, "L");
const ordinaryFirst = clearancedOrdinary.segments[0]!;
const ordinaryLast = clearancedOrdinary.segments.at(-1)!;
assert(near(clearancedOrdinary.startAnchor, blueprintPoint(blueprintPositions, "O")), "semantic START anchor stays exact");
assert(near(clearancedOrdinary.endAnchor, blueprintPoint(blueprintPositions, "C")), "semantic END anchor stays exact");
assert(!near(ordinaryFirst.p0, clearancedOrdinary.startAnchor), "rendered START clears its semantic anchor");
assert(!near(ordinaryLast.p3, clearancedOrdinary.endAnchor), "rendered END clears its semantic anchor");
assert(blueprintSegmentsAreC1(clearancedOrdinary.segments), "clearanced ordinary path remains C1");
assert(
  clearancedOrdinary.segments.some((segment, index) => {
    const next = clearancedOrdinary.segments[index + 1];
    return next !== undefined && near(segment.p3, clearancedOrdinary.center) && near(next.p0, clearancedOrdinary.center);
  }),
  "semantic center remains an interior continuous join after marker clearance",
);

const clearancedRoot = blueprintLink(clearanced, "R");
const rootFirst = clearancedRoot.segments[0]!;
const rootLast = clearancedRoot.segments.at(-1)!;
assert(!near(rootFirst.p0, clearancedRoot.startAnchor), "full self-link START marker can clear its own center");
assert(!near(rootLast.p3, clearancedRoot.endAnchor), "full self-link END marker can clear its own center");
assert(
  clearancedRoot.segments.some((segment, index) => {
    const next = clearancedRoot.segments[index + 1];
    return next !== undefined && near(segment.p3, clearancedRoot.center) && near(next.p0, clearancedRoot.center);
  }),
  "full self-link keeps semantic center on the clearanced path",
);
assert(blueprintSegmentsAreC1(clearancedRoot.segments), "clearanced full self-link remains C1 through every join");
assert(JSON.stringify(basis) === blueprintTopologyBefore, "marker clearance cannot mutate VisualLinkNetwork topology");

const movedBlueprintPositions = blueprintPositions.map((position) => position.key === "O"
  ? { key: position.key, point: { x: position.point.x - 73, y: position.point.y + 41 } }
  : position);
const movedClearanced = buildBlueprintGeometry(basis, movedBlueprintPositions, {
  startOffsetFraction: 0.10,
  endOffsetFraction: 0.16,
});
const movedOrdinary = blueprintLink(movedClearanced, "L");
assert(near(movedOrdinary.startAnchor, blueprintPoint(movedBlueprintPositions, "O")), "moved referenced center repins dependent START");
assert(!near(movedOrdinary.startAnchor, clearancedOrdinary.startAnchor), "dependent START actually moves with referenced center");
assert(near(movedOrdinary.center, clearancedOrdinary.center), "moving referenced START does not move represented Link center");
assert(near(movedOrdinary.endAnchor, clearancedOrdinary.endAnchor), "moving referenced START does not move END anchor");
assert(blueprintSegmentsAreC1(movedOrdinary.segments), "repinned clearanced path remains C1");
