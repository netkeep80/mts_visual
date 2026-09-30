import {
  selectMonolithicLinkDetail3D,
} from "../src/webgpu/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`@mts/visual detail-selection: ${message}`);
  }
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
  );
}

const identity = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

const centers = Object.freeze([
  Object.freeze([0, 0, 0]),
  Object.freeze([0.8, 0, 0]),
  Object.freeze([2, 0, 0]),
  Object.freeze([0, 0.5, 0]),
  Object.freeze([-2, 0, 0]),
]);

const centerAt = (index: number): readonly number[] => centers[index]!;

const bounded = selectMonolithicLinkDetail3D({
  linkCount: centers.length,
  detailCapacity: 2,
  viewProjection: identity,
  centerAt,
  frustumMargin: 0,
});
same(bounded.indices, [0, 3], "bounded selector chooses the two best visible centers");
same(bounded.visibleCandidateCount, 3, "bounded selector visible candidate count");
same(bounded.culledLinkCount, 3, "bounded selector culled count");
assert(!bounded.selectedIncluded, "no selected Link is reported when none is requested");
assert(!bounded.hoveredIncluded, "no hovered Link is reported when none is requested");

const selectedOffscreen = selectMonolithicLinkDetail3D({
  linkCount: centers.length,
  detailCapacity: 2,
  viewProjection: identity,
  centerAt,
  selectedLink: 4,
  frustumMargin: 0,
});
same(
  selectedOffscreen.indices,
  [4, 0],
  "selected off-screen Link is pinned before best visible candidate",
);
assert(selectedOffscreen.selectedIncluded, "selected Link is included");
assert(selectedOffscreen.selectedPinned, "selected Link reports pinned priority");
same(selectedOffscreen.culledLinkCount, 3, "selected bounded culled count");

const selectedAndHovered = selectMonolithicLinkDetail3D({
  linkCount: centers.length,
  detailCapacity: 2,
  viewProjection: identity,
  centerAt,
  selectedLink: 4,
  hoveredLink: 2,
  frustumMargin: 0,
});
same(
  selectedAndHovered.indices,
  [4, 2],
  "selected then hovered Links consume reserved detail slots deterministically",
);
assert(selectedAndHovered.hoveredIncluded, "hovered Link is included");
assert(selectedAndHovered.hoveredPinned, "hovered Link reports pinned priority");

const duplicatePriority = selectMonolithicLinkDetail3D({
  linkCount: centers.length,
  detailCapacity: 2,
  viewProjection: identity,
  centerAt,
  selectedLink: 4,
  hoveredLink: 4,
  frustumMargin: 0,
});
same(
  duplicatePriority.indices,
  [4, 0],
  "same selected/hovered Link consumes one slot only",
);

const fullDetail = selectMonolithicLinkDetail3D({
  linkCount: centers.length,
  detailCapacity: centers.length,
  viewProjection: identity,
  centerAt,
  selectedLink: 4,
  hoveredLink: 2,
  frustumMargin: 0,
});
same(
  fullDetail.indices,
  [0, 1, 2, 3, 4],
  "full-detail mode preserves semantic identity order",
);
same(fullDetail.visibleCandidateCount, 3, "full-detail visible count remains diagnostic");
same(fullDetail.culledLinkCount, 0, "full-detail mode culls nothing");
assert(!fullDetail.selectedPinned, "full-detail mode does not reorder for selection");
assert(!fullDetail.hoveredPinned, "full-detail mode does not reorder for hover");

const zeroCapacity = selectMonolithicLinkDetail3D({
  linkCount: centers.length,
  detailCapacity: 0,
  viewProjection: identity,
  centerAt,
  selectedLink: 4,
  hoveredLink: 2,
  frustumMargin: 0,
});
same(zeroCapacity.indices, [], "zero detail capacity yields no detail slots");
same(zeroCapacity.culledLinkCount, centers.length, "zero capacity culls all carriers");
assert(!zeroCapacity.selectedIncluded, "zero capacity cannot include selected Link");
assert(!zeroCapacity.hoveredIncluded, "zero capacity cannot include hovered Link");

const manyCenters = Array.from(
  { length: 10_000 },
  (_value, index) => Object.freeze([
    ((index % 101) - 50) / 40,
    ((Math.floor(index / 101) % 101) - 50) / 40,
    0,
  ]),
);
const many = selectMonolithicLinkDetail3D({
  linkCount: manyCenters.length,
  detailCapacity: 64,
  viewProjection: identity,
  centerAt: (index) => manyCenters[index]!,
  selectedLink: 9_999,
  frustumMargin: 0,
});
same(many.indices.length, 64, "large scan is bounded by detail capacity");
same(many.indices[0], 9_999, "large scan keeps selected Link in slot zero");
same(
  selectMonolithicLinkDetail3D({
    linkCount: manyCenters.length,
    detailCapacity: 64,
    viewProjection: identity,
    centerAt: (index) => manyCenters[index]!,
    selectedLink: 9_999,
    frustumMargin: 0,
  }).indices,
  many.indices,
  "large bounded selection is deterministic",
);

for (const invalid of [
  () => selectMonolithicLinkDetail3D({
    linkCount: -1,
    detailCapacity: 1,
    viewProjection: identity,
    centerAt,
  }),
  () => selectMonolithicLinkDetail3D({
    linkCount: centers.length,
    detailCapacity: 1,
    viewProjection: identity.slice(0, 15),
    centerAt,
  }),
  () => selectMonolithicLinkDetail3D({
    linkCount: centers.length,
    detailCapacity: 1,
    viewProjection: identity,
    centerAt,
    selectedLink: centers.length,
  }),
]) {
  try {
    invalid();
    throw new Error("invalid detail-selection input unexpectedly succeeded");
  } catch (error) {
    assert(
      String(error).includes("monolithic detail"),
      "invalid detail-selection input fails closed with stable diagnostic",
    );
  }
}

console.log(
  "[v0.6 #153 P2b detail selection] PASS · "
  + `visible=${bounded.visibleCandidateCount} · `
  + `large=10,000→${many.indices.length}`,
);
