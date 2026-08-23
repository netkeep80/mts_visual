import {
  BlueprintSvgError,
  buildBlueprintGeometry,
  buildBlueprintSvgScene,
  serializeBlueprintSvg,
  type BlueprintGeometry,
  type BlueprintSvgErrorCode,
  type VisualLink,
  type VisualLinkNetwork,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V2a: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function expectCode(effect: () => unknown, code: BlueprintSvgErrorCode, message: string): void {
  try {
    effect();
  } catch (error) {
    assert(error instanceof BlueprintSvgError, `${message}: wrong error type`);
    same(error.code, code, `${message}: wrong error code`);
    return;
  }
  throw new Error(`@mts/visual V2a: ${message}: expected rejection`);
}

function basisLinks(): VisualLink[] {
  return [
    { key: "R", startKey: "R", endKey: "R", label: "∞" },
    { key: "O", startKey: "O", endKey: "R" },
    { key: "C", startKey: "R", endKey: "C" },
    { key: "L", startKey: "O", endKey: "C" },
    { key: "U", startKey: "C", endKey: "O" },
    { key: "X", startKey: "L", endKey: "U", label: "link of links" },
  ];
}

function numberText(value: number): string {
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return "0";
  return Number(value.toFixed(9)).toString();
}

const basis: VisualLinkNetwork = { links: basisLinks() };
const geometry = buildBlueprintGeometry(basis);
const scene = buildBlueprintSvgScene(basis, geometry);
same(scene.links.length, 6, "basis emits exactly one descriptor per Link");
same(scene.markers.length, 12, "basis emits start and end marker per Link");

const keys = scene.links.map((link) => link.key).join(",");
same(keys, "C,L,O,R,U,X", "scene follows normalized visual order");

const xGeometry = geometry.links.find((link) => link.key === "X");
const xScene = scene.links.find((link) => link.key === "X");
assert(xGeometry !== undefined && xScene !== undefined, "link-of-links scene exists");
const firstX = xGeometry.segments[0];
const lastX = xGeometry.segments.at(-1);
assert(firstX !== undefined && lastX !== undefined, "link-of-links has cubic geometry");
assert(
  xScene.d.startsWith(`M ${numberText(firstX.p0.x)} ${numberText(firstX.p0.y)} `),
  "path begins at V1 start anchor",
);
assert(
  xScene.d.endsWith(`${numberText(lastX.p3.x)} ${numberText(lastX.p3.y)}`),
  "path ends at V1 end anchor",
);
same(xScene.startKey, "L", "scene preserves start pole");
same(xScene.endKey, "U", "scene preserves end pole");

const root = scene.links.find((link) => link.key === "R");
assert(root !== undefined, "root scene exists");
same(root.d.split(" C ").length - 1, 2, "root self-link remains one two-segment cubic path");
assert(root.startMarkerId !== root.endMarkerId, "start/end marker IDs are distinct");
const rootStart = scene.markers.find((marker) => marker.id === root.startMarkerId);
const rootEnd = scene.markers.find((marker) => marker.id === root.endMarkerId);
assert(rootStart !== undefined && rootEnd !== undefined, "root endpoint markers exist");
same(rootStart.kind, "start", "start marker role retained");
same(rootEnd.kind, "end", "end marker role retained");
same(rootStart.color, root.color, "start marker shares Link color");
same(rootEnd.color, root.color, "end marker shares Link color");

assert(Number.isFinite(scene.bounds.minX), "finite minX");
assert(Number.isFinite(scene.bounds.minY), "finite minY");
assert(Number.isFinite(scene.bounds.maxX), "finite maxX");
assert(Number.isFinite(scene.bounds.maxY), "finite maxY");
assert(scene.bounds.width > 0, "positive view width");
assert(scene.bounds.height > 0, "positive view height");
assert(scene.viewBox.split(" ").length === 4, "viewBox has four scalar components");

const svg = serializeBlueprintSvg(scene);
same((svg.match(/data-role="blueprint-link-path"/g) ?? []).length, 6, "static SVG has one path element per Link");
same((svg.match(/data-role="blueprint-start-marker"/g) ?? []).length, 6, "static SVG has one start marker per Link");
same((svg.match(/data-role="blueprint-end-marker"/g) ?? []).length, 6, "static SVG has one end marker per Link");
assert(!/<script/i.test(svg), "static SVG has no script element");
assert(!/\son[a-z]+=/i.test(svg), "static SVG has no event handler attributes");

const reordered: VisualLinkNetwork = { links: [...basisLinks()].reverse() };
same(
  serializeBlueprintSvg(buildBlueprintSvgScene(reordered)),
  serializeBlueprintSvg(buildBlueprintSvgScene(basis)),
  "input order does not alter normalized static scene",
);

const hostileLabel = `<script>&"`;
const hostileNetwork: VisualLinkNetwork = {
  links: basisLinks().map((link) => link.key === "X" ? { ...link, label: hostileLabel } : link),
};
const hostileSvg = serializeBlueprintSvg(buildBlueprintSvgScene(hostileNetwork));
assert(!hostileSvg.includes(hostileLabel), "hostile label is never injected raw");
assert(hostileSvg.includes("&lt;script&gt;&amp;&quot;"), "hostile label is XML escaped");

const unusualKeys: VisualLinkNetwork = {
  links: [
    { key: "R", startKey: "R", endKey: "R" },
    { key: "a/b", startKey: "R", endKey: "R" },
    { key: "a?b", startKey: "R", endKey: "R" },
    { key: "<root>", startKey: "R", endKey: "R" },
    { key: `"quoted"`, startKey: "R", endKey: "R" },
    { key: "русский ключ", startKey: "R", endKey: "R" },
  ],
};
const unusualScene = buildBlueprintSvgScene(unusualKeys);
const allIds = unusualScene.links.flatMap((link) => [link.pathId, link.startMarkerId, link.endMarkerId]);
same(new Set(allIds).size, allIds.length, "encoded SVG IDs remain unique for adversarial keys");
assert(allIds.every((id) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(id)), "encoded SVG IDs are XML/DOM-safe ASCII");
assert(unusualScene.links.some((link) => link.key === "русский ключ"), "raw Unicode VisualKey remains separately preserved");

expectCode(() => buildBlueprintSvgScene(basis, geometry, { padding: -1 }), "invalid-padding", "negative padding");
expectCode(() => buildBlueprintSvgScene(basis, geometry, { padding: Number.NaN }), "invalid-padding", "NaN padding");
expectCode(() => buildBlueprintSvgScene(basis, geometry, { padding: Number.POSITIVE_INFINITY }), "invalid-padding", "infinite padding");

const missingGeometry: BlueprintGeometry = {
  positions: geometry.positions,
  links: geometry.links.slice(0, -1),
};
expectCode(
  () => buildBlueprintSvgScene(basis, missingGeometry),
  "geometry-count-mismatch",
  "missing geometry Link",
);

const extraGeometry: BlueprintGeometry = {
  positions: geometry.positions,
  links: [...geometry.links, geometry.links[0]!],
};
expectCode(
  () => buildBlueprintSvgScene(basis, extraGeometry),
  "geometry-count-mismatch",
  "extra geometry Link",
);

const keyMismatch: BlueprintGeometry = {
  positions: geometry.positions,
  links: geometry.links.map((link, index) => index === 0 ? { ...link, key: "not-declared" } : link),
};
expectCode(
  () => buildBlueprintSvgScene(basis, keyMismatch),
  "geometry-key-mismatch",
  "geometry key mismatch",
);

const poleMismatch: BlueprintGeometry = {
  positions: geometry.positions,
  links: geometry.links.map((link) => link.key === "X" ? { ...link, endKey: "R" } : link),
};
expectCode(
  () => buildBlueprintSvgScene(basis, poleMismatch),
  "geometry-pole-mismatch",
  "geometry pole mismatch",
);

const nonFiniteGeometry: BlueprintGeometry = {
  positions: geometry.positions,
  links: geometry.links.map((link) => link.key === "X"
    ? { ...link, center: { x: Number.POSITIVE_INFINITY, y: link.center.y } }
    : link),
};
expectCode(
  () => buildBlueprintSvgScene(basis, nonFiniteGeometry),
  "non-finite-geometry",
  "non-finite supplied geometry",
);

const emptyPathGeometry: BlueprintGeometry = {
  positions: geometry.positions,
  links: geometry.links.map((link) => link.key === "X" ? { ...link, segments: [] } : link),
};
expectCode(
  () => buildBlueprintSvgScene(basis, emptyPathGeometry),
  "empty-path",
  "empty supplied path",
);

const topologyBefore = JSON.stringify(basis.links.map(({ key, startKey, endKey }) => ({ key, startKey, endKey })));
buildBlueprintSvgScene(basis, undefined, { padding: 12 });
const topologyAfter = JSON.stringify(basis.links.map(({ key, startKey, endKey }) => ({ key, startKey, endKey })));
same(topologyAfter, topologyBefore, "scene construction cannot mutate semantic topology");
assert(Object.isFrozen(scene), "scene snapshot is frozen");
assert(Object.isFrozen(scene.links), "scene Link descriptors are frozen");
assert(Object.isFrozen(scene.markers), "scene marker descriptors are frozen");
assert(Object.isFrozen(scene.bounds), "scene bounds are frozen");
