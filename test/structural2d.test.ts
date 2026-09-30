import {
  Structural2DError,
  layoutStructural2D,
  serializeStructural2DSvg,
  type Structural2DErrorCode,
  type VisualLinkNetwork,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`structural2d: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function expectCode(
  effect: () => unknown,
  code: Structural2DErrorCode,
  message: string,
): void {
  try {
    effect();
  } catch (error) {
    assert(error instanceof Structural2DError, `${message}: wrong error type`);
    same(error.code, code, `${message}: wrong code`);
    return;
  }
  throw new Error(`structural2d: ${message}: expected rejection`);
}

const basis: VisualLinkNetwork = {
  links: [
    { key: "R", startKey: "R", endKey: "R", label: "ROOT" },
    { key: "O", startKey: "O", endKey: "R" },
    { key: "C", startKey: "R", endKey: "C" },
    { key: "L", startKey: "O", endKey: "C" },
    { key: "U", startKey: "C", endKey: "O" },
    { key: "X", startKey: "L", endKey: "U", label: "link of links" },
  ],
};

const layout = layoutStructural2D(basis, { rootKey: "R" });
assert(Object.isFrozen(layout), "layout snapshot frozen");
assert(Object.isFrozen(layout.positions), "positions frozen");
assert(Object.isFrozen(layout.components), "components frozen");
assert(Object.isFrozen(layout.arcs), "arcs frozen");
same(layout.positions.length, basis.links.length, "one position per Link");
same(layout.arcs.length, basis.links.length * 2, "two role arcs per Link");
assert(layout.bounds.width > 0 && layout.bounds.height > 0, "positive finite bounds");
assert(layout.metrics.crossingsAfter <= layout.metrics.crossingsBefore, "optimizer never worsens crossings");

const root = layout.positions.find((position) => position.key === "R");
assert(root !== undefined, "explicit root exists");
same(root.point.x, 0, "explicit root x");
same(root.point.y, 0, "explicit root y");
const rootComponent = layout.components.find((component) => component.members.includes("R"));
assert(rootComponent?.root === true, "explicit root component marked only as presentation root");

for (const arc of layout.arcs) {
  assert(arc.points.length >= 2, `${arc.id}: sampled path`);
  assert(
    arc.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    `${arc.id}: finite path`,
  );
}
same(layout.arcs.filter((arc) => arc.role === "start").length, basis.links.length, "START role count");
same(layout.arcs.filter((arc) => arc.role === "end").length, basis.links.length, "END role count");

const rootSelfArcs = layout.arcs.filter((arc) => arc.linkKey === "R");
same(rootSelfArcs.length, 2, "double self-incidence has two role arcs");
assert(rootSelfArcs.every((arc) => arc.sourceKey === "R" && arc.targetKey === "R"), "root self endpoints");
assert(rootSelfArcs.every((arc) => arc.points.length > 8), "root self loops are finite sampled loops");

const reversed: VisualLinkNetwork = { links: [...basis.links].reverse() };
same(
  JSON.stringify(layoutStructural2D(reversed, { rootKey: "R" })),
  JSON.stringify(layout),
  "input order does not affect structural layout",
);
same(
  JSON.stringify(layoutStructural2D(basis, { rootKey: "R" })),
  JSON.stringify(layout),
  "repeated layout is exact deterministic",
);

const cycle: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "B", endKey: "B" },
    { key: "B", startKey: "A", endKey: "A" },
    { key: "C", startKey: "A", endKey: "B" },
  ],
};
const cycleLayout = layoutStructural2D(cycle);
const cycleComponent = cycleLayout.components.find((component) =>
  component.members.includes("A") && component.members.includes("B"));
assert(cycleComponent !== undefined, "recursive A/B SCC is detected");
same(cycleComponent.members.join(","), "A,B", "SCC member order stable");
const a = cycleLayout.positions.find((position) => position.key === "A")!;
const b = cycleLayout.positions.find((position) => position.key === "B")!;
same(a.componentId, b.componentId, "SCC members share component id");
same(a.depth, b.depth, "SCC members share structural depth");
assert(
  Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y) > 1,
  "recursive SCC members remain visually distinguishable",
);

const noRoot = layoutStructural2D(basis);
assert(noRoot.components.every((component) => component.root === false), "no root is inferred");
assert(
  noRoot.positions.some((position) => position.key === "R"),
  "root-looking key remains an ordinary structural key without hint",
);

const hostile: VisualLinkNetwork = {
  links: [
    { key: "<R>", startKey: "<R>", endKey: "<R>", label: '<script>&"' },
  ],
};
const hostileSvg = serializeStructural2DSvg(hostile, layoutStructural2D(hostile));
assert(!hostileSvg.includes('<script>&"'), "label is never injected raw");
assert(hostileSvg.includes("&lt;script&gt;&amp;&quot;"), "label is XML escaped");

const svg = serializeStructural2DSvg(basis, layout);
same((svg.match(/data-role="structural-node"/g) ?? []).length, basis.links.length, "one SVG node per Link");
same((svg.match(/data-role="structural-arc"/g) ?? []).length, basis.links.length * 2, "two SVG role arcs per Link");
same((svg.match(/data-arc-role="start"/g) ?? []).length, basis.links.length, "START SVG roles");
same((svg.match(/data-arc-role="end"/g) ?? []).length, basis.links.length, "END SVG roles");
assert(!/<script/i.test(svg), "serialized structural SVG contains no script");

expectCode(
  () => layoutStructural2D(basis, { rootKey: "missing" }),
  "unknown-root",
  "unknown explicit root",
);
expectCode(
  () => layoutStructural2D(basis, { layerSpacing: 0 }),
  "invalid-option",
  "invalid layer spacing",
);
