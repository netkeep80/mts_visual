import {
  BlueprintInteractionError,
  blueprintScreenToWorld,
  blueprintWorldToScreen,
  buildBlueprintGeometry,
  buildBlueprintSvgScene,
  createBlueprintInitialPositions,
  createBlueprintViewport,
  fitBlueprintViewport,
  moveBlueprintPosition,
  panBlueprintViewport,
  zoomBlueprintViewport,
  type BlueprintInteractionErrorCode,
  type BlueprintPosition,
  type VisualLink,
  type VisualLinkNetwork,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V2b: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function near(actual: number, expected: number, message: string, epsilon = 1e-9): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} !~= ${expected}`);
}

function expectCode(effect: () => unknown, code: BlueprintInteractionErrorCode, message: string): void {
  try {
    effect();
  } catch (error) {
    assert(error instanceof BlueprintInteractionError, `${message}: wrong error type`);
    same(error.code, code, `${message}: wrong error code`);
    return;
  }
  throw new Error(`@mts/visual V2b: ${message}: expected rejection`);
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

const identity = createBlueprintViewport();
assert(Object.isFrozen(identity), "viewport snapshot is immutable");
same(identity.scale, 1, "identity scale");
same(identity.panX, 0, "identity panX");
same(identity.panY, 0, "identity panY");
const identityPoint = blueprintWorldToScreen(identity, { x: 12.5, y: -8.25 });
near(identityPoint.x, 12.5, "identity world->screen x");
near(identityPoint.y, -8.25, "identity world->screen y");

const viewport = createBlueprintViewport(2.5, 17, -31);
const world = { x: -12.25, y: 9.75 };
const screen = blueprintWorldToScreen(viewport, world);
const roundTrip = blueprintScreenToWorld(viewport, screen);
near(roundTrip.x, world.x, "world->screen->world x");
near(roundTrip.y, world.y, "world->screen->world y");
assert(Object.isFrozen(screen) && Object.isFrozen(roundTrip), "converted points are immutable snapshots");

const bounds = Object.freeze({ minX: -50, minY: -25, maxX: 50, maxY: 25, width: 100, height: 50 });
const fitted = fitBlueprintViewport(bounds, 400, 200, { padding: 20, minScale: 0.1, maxScale: 20 });
near(fitted.scale, 3.2, "fit uses limiting dimension");
near(fitted.panX, 200, "fit centers x");
near(fitted.panY, 100, "fit centers y");
const fittedCenter = blueprintWorldToScreen(fitted, { x: 0, y: 0 });
near(fittedCenter.x, 200, "bounds center maps to screen center x");
near(fittedCenter.y, 100, "bounds center maps to screen center y");

same(fitBlueprintViewport(bounds, 1000, 1000, { maxScale: 2 }).scale, 2, "fit maxScale clamp");
same(fitBlueprintViewport(bounds, 20, 20, { minScale: 1 }).scale, 1, "fit minScale clamp");

const panned = panBlueprintViewport(viewport, 5, -7);
same(panned.scale, viewport.scale, "pan preserves scale exactly");
same(panned.panX, 22, "pan changes panX");
same(panned.panY, -38, "pan changes panY");

const anchor = { x: 123, y: 77 };
const beforeAnchor = blueprintScreenToWorld(viewport, anchor);
const zoomed = zoomBlueprintViewport(viewport, 2, anchor);
const afterAnchor = blueprintScreenToWorld(zoomed, anchor);
near(afterAnchor.x, beforeAnchor.x, "zoom preserves anchor world x");
near(afterAnchor.y, beforeAnchor.y, "zoom preserves anchor world y");
near(zoomed.scale, 5, "zoom factor applied");

const clampedZoom = zoomBlueprintViewport(viewport, 1000, anchor, { maxScale: 4 });
same(clampedZoom.scale, 4, "zoom scale clamp applied");
const afterClampedAnchor = blueprintScreenToWorld(clampedZoom, anchor);
near(afterClampedAnchor.x, beforeAnchor.x, "clamped zoom preserves anchor world x");
near(afterClampedAnchor.y, beforeAnchor.y, "clamped zoom preserves anchor world y");

const zoomForward = zoomBlueprintViewport(viewport, 1.5, anchor);
const zoomBack = zoomBlueprintViewport(zoomForward, 1 / 1.5, anchor);
near(zoomBack.scale, viewport.scale, "inverse zoom restores scale");
near(zoomBack.panX, viewport.panX, "inverse zoom restores panX");
near(zoomBack.panY, viewport.panY, "inverse zoom restores panY");

const basis: VisualLinkNetwork = { links: basisLinks() };
const positions = createBlueprintInitialPositions(basis);
const topologyBefore = JSON.stringify(basis.links.map(({ key, startKey, endKey }) => ({ key, startKey, endKey })));
const positionsBefore = JSON.stringify(positions);
const moved = moveBlueprintPosition(positions, "X", { x: 777, y: -333 });
assert(Object.isFrozen(moved), "moved position list is immutable");
assert(moved.every(Object.isFrozen), "moved position rows are immutable");
const movedX = moved.find((position) => position.key === "X");
assert(movedX !== undefined, "moved X exists");
same(movedX.point.x, 777, "X presentation x moved");
same(movedX.point.y, -333, "X presentation y moved");
for (const original of positions) {
  if (original.key === "X") continue;
  const current = moved.find((position) => position.key === original.key);
  assert(current !== undefined, `unchanged ${original.key} exists`);
  same(current.point.x, original.point.x, `${original.key} x unchanged`);
  same(current.point.y, original.point.y, `${original.key} y unchanged`);
}
same(JSON.stringify(positions), positionsBefore, "move does not mutate source positions");

const movedGeometry = buildBlueprintGeometry(basis, moved);
const movedScene = buildBlueprintSvgScene(basis, movedGeometry);
same(movedScene.links.length, 6, "moved positions rebuild V1/V2a stack");
const topologyAfter = JSON.stringify(basis.links.map(({ key, startKey, endKey }) => ({ key, startKey, endKey })));
same(topologyAfter, topologyBefore, "interaction cannot mutate semantic topology");
const xLink = basis.links.find((link) => link.key === "X");
assert(xLink !== undefined, "semantic X remains present");
same(xLink.startKey, "L", "X start pole unchanged after move");
same(xLink.endKey, "U", "X end pole unchanged after move");

expectCode(() => createBlueprintViewport(0, 0, 0), "invalid-viewport", "zero scale");
expectCode(() => createBlueprintViewport(-1, 0, 0), "invalid-viewport", "negative scale");
expectCode(() => createBlueprintViewport(Number.NaN, 0, 0), "invalid-viewport", "NaN scale");
expectCode(() => createBlueprintViewport(1, Number.POSITIVE_INFINITY, 0), "invalid-viewport", "infinite pan");
expectCode(() => fitBlueprintViewport(bounds, 0, 100), "invalid-screen-size", "zero screen width");
expectCode(() => fitBlueprintViewport(bounds, 100, -1), "invalid-screen-size", "negative screen height");
expectCode(() => fitBlueprintViewport(bounds, 100, Number.NaN), "invalid-screen-size", "NaN screen height");
expectCode(() => fitBlueprintViewport(bounds, 100, 100, { padding: -1 }), "invalid-padding", "negative padding");
expectCode(() => fitBlueprintViewport(bounds, 100, 100, { padding: 50 }), "invalid-padding", "padding consumes viewport");
expectCode(() => fitBlueprintViewport(bounds, 100, 100, { minScale: 2, maxScale: 1 }), "invalid-scale-limit", "inverted scale limits");
expectCode(() => zoomBlueprintViewport(viewport, 0, anchor), "invalid-zoom-factor", "zero zoom factor");
expectCode(() => zoomBlueprintViewport(viewport, -2, anchor), "invalid-zoom-factor", "negative zoom factor");
expectCode(() => zoomBlueprintViewport(viewport, Number.NaN, anchor), "invalid-zoom-factor", "NaN zoom factor");
expectCode(() => panBlueprintViewport(viewport, Number.POSITIVE_INFINITY, 0), "non-finite-pan", "infinite pan delta");
expectCode(() => blueprintWorldToScreen(viewport, { x: Number.NaN, y: 0 }), "non-finite-point", "NaN world point");
expectCode(() => blueprintScreenToWorld(viewport, { x: 0, y: Number.NEGATIVE_INFINITY }), "non-finite-point", "infinite screen point");
expectCode(() => moveBlueprintPosition(positions, "missing", { x: 0, y: 0 }), "missing-position", "missing position key");
expectCode(
  () => moveBlueprintPosition([...positions, positions[0]!], "X", { x: 0, y: 0 }),
  "duplicate-position",
  "duplicate position key",
);
expectCode(
  () => moveBlueprintPosition(positions, "X", { x: Number.POSITIVE_INFINITY, y: 0 }),
  "non-finite-point",
  "non-finite moved point",
);

const explicitPositions: readonly BlueprintPosition[] = Object.freeze([
  Object.freeze({ key: "R", point: Object.freeze({ x: 0, y: 0 }) }),
]);
const movedRoot = moveBlueprintPosition(explicitPositions, "R", { x: 10, y: 20 });
same(movedRoot[0]!.point.x, 10, "generic interaction layer does not hard-code root pinning");
