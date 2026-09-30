import {
  Document2DError,
  buildDocument2DGeometry,
  document2DCenterTangentsAreAntiparallel,
  layoutDocument2D,
  serializeDocument2DSvg,
  type Document2DErrorCode,
  type Document2DPose,
  type VisualLinkNetwork,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`document2d: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function near(actual: number, expected: number, message: string, epsilon = 1e-8): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} !~= ${expected}`);
}

function expectCode(effect: () => unknown, code: Document2DErrorCode, message: string): void {
  try {
    effect();
  } catch (error) {
    assert(error instanceof Document2DError, `${message}: wrong error type`);
    same(error.code, code, `${message}: wrong code`);
    return;
  }
  throw new Error(`document2d: ${message}: expected rejection`);
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

const rootBasisOnly: VisualLinkNetwork = {
  links: basis.links.filter((link) => link.key !== "X"),
};

const rootBasisLayout = layoutDocument2D(rootBasisOnly, {
  profile: "article",
  strategy: "auto",
});
same(rootBasisLayout.metrics.qualityAfter.crossings, 0, "R/O/C/L/U auto layout must reach zero crossings");
assert(rootBasisLayout.metrics.zeroCrossingFound, "R/O/C/L/U must report zero-crossing witness");
assert(rootBasisLayout.metrics.seedCandidates > 3, "small-network search must evaluate more than the three base families");
assert(rootBasisLayout.metrics.seedVariant.includes(":"), "selected deterministic seed variant is reported");

const reversedRootBasis: VisualLinkNetwork = {
  links: [...rootBasisOnly.links].reverse(),
};
same(
  JSON.stringify(layoutDocument2D(reversedRootBasis, {
    profile: "article",
    strategy: "auto",
  })),
  JSON.stringify(rootBasisLayout),
  "R/O/C/L/U zero-crossing layout is input-order stable",
);

const article = layoutDocument2D(basis, {
  profile: "article",
  strategy: "auto",
  rootKey: "R",
});
assert(Object.isFrozen(article), "layout frozen");
assert(Object.isFrozen(article.poses), "poses frozen");
assert(Object.isFrozen(article.links), "link geometry frozen");
assert(Object.isFrozen(article.labels), "labels frozen");
same(article.poses.length, basis.links.length, "one pose per Link");
same(article.links.length, basis.links.length, "one continuous geometry per Link");
same(article.labels.length, basis.links.length, "one deterministic label per Link");
assert(article.bounds.width > 0 && article.bounds.height > 0, "positive publication bounds");
assert(
  article.metrics.qualityAfter.crossings <= article.metrics.qualityBefore.crossings,
  "optimizer never worsens crossing primary objective",
);
assert(
  article.metrics.qualityAfter.score <= article.metrics.qualityBefore.score + 1e-8
    || article.metrics.qualityAfter.crossings < article.metrics.qualityBefore.crossings
    || article.metrics.qualityAfter.centerOverlaps < article.metrics.qualityBefore.centerOverlaps
    || article.metrics.qualityAfter.labelOverlaps < article.metrics.qualityBefore.labelOverlaps,
  "optimizer accepts only lexicographic quality improvements",
);

for (const link of article.links) {
  same(link.segments.length, 2, `${link.key}: exactly START and END cubic legs`);
  assert(document2DCenterTangentsAreAntiparallel(link), `${link.key}: outward CENTER tangents are 180 degrees`);
  const first = link.segments[0]!;
  const second = link.segments[1]!;
  near(first.p3.x, link.center.x, `${link.key}: START leg reaches center x`);
  near(first.p3.y, link.center.y, `${link.key}: START leg reaches center y`);
  near(second.p0.x, link.center.x, `${link.key}: END leg leaves center x`);
  near(second.p0.y, link.center.y, `${link.key}: END leg leaves center y`);

  const incoming = {
    x: first.p3.x - first.p2.x,
    y: first.p3.y - first.p2.y,
  };
  const outgoing = {
    x: second.p1.x - second.p0.x,
    y: second.p1.y - second.p0.y,
  };
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  assert(Math.abs(cross) <= 1e-7 && dot > 0, `${link.key}: oriented path is C1 through CENTER`);
  assert(
    [first.p0, first.p1, first.p2, first.p3, second.p0, second.p1, second.p2, second.p3]
      .every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    `${link.key}: finite cubic geometry`,
  );
}

const root = article.links.find((link) => link.key === "R")!;
assert(root.startKey === "R" && root.endKey === "R", "double self-incidence retained");
const rootPoints = root.segments.flatMap((segment) => [segment.p0, segment.p1, segment.p2, segment.p3]);
const rootExtent = Math.max(
  Math.max(...rootPoints.map((point) => point.x)) - Math.min(...rootPoints.map((point) => point.x)),
  Math.max(...rootPoints.map((point) => point.y)) - Math.min(...rootPoints.map((point) => point.y)),
);
assert(rootExtent > 10, "double self-incidence remains visibly finite");

const o = article.links.find((link) => link.key === "O")!;
assert(o.startKey === "O", "START-self preserved");
assert(
  Math.hypot(o.segments[0]!.p1.x - o.center.x, o.segments[0]!.p1.y - o.center.y) > 10,
  "START-self has finite lobe",
);
const c = article.links.find((link) => link.key === "C")!;
assert(c.endKey === "C", "END-self preserved");
assert(
  Math.hypot(c.segments[1]!.p2.x - c.center.x, c.segments[1]!.p2.y - c.center.y) > 10,
  "END-self has finite lobe",
);

const repeated = layoutDocument2D(basis, {
  profile: "article",
  strategy: "auto",
  rootKey: "R",
});
same(JSON.stringify(repeated), JSON.stringify(article), "repeated auto layout is byte-stable JSON");

const reversed: VisualLinkNetwork = { links: [...basis.links].reverse() };
same(
  JSON.stringify(layoutDocument2D(reversed, {
    profile: "article",
    strategy: "auto",
    rootKey: "R",
  })),
  JSON.stringify(article),
  "normalized input order does not affect Document layout",
);

for (const strategy of ["canonical", "radial", "layered"] as const) {
  const current = layoutDocument2D(basis, {
    strategy,
    rootKey: "R",
    optimizerPasses: 1,
    optimizerEvaluations: 20,
  });
  same(current.strategy, strategy, `${strategy}: explicit strategy retained`);
  assert(current.poses.every((pose) => [pose.x, pose.y, pose.theta].every(Number.isFinite)), `${strategy}: finite poses`);
}

for (const profile of ["formal", "article", "debug"] as const) {
  const current = layoutDocument2D(basis, {
    profile,
    strategy: "layered",
    rootKey: "R",
    optimizerPasses: 0,
  });
  same(current.profile, profile, `${profile}: profile retained`);
  const svg = serializeDocument2DSvg(basis, current);
  same((svg.match(/data-role="document-link"/g) ?? []).length, basis.links.length, `${profile}: one SVG group per Link`);
  same((svg.match(/data-role="document-link-path"/g) ?? []).length, basis.links.length, `${profile}: one SVG path per Link`);
  same((svg.match(/data-role="document-center"/g) ?? []).length, basis.links.length, `${profile}: one CENTER marker per Link`);
  same((svg.match(/data-role="document-label"/g) ?? []).length, basis.links.length, `${profile}: one label per Link`);
  if (profile === "debug") {
    same((svg.match(/data-role="document-debug-role"/g) ?? []).length, basis.links.length, "debug roles present");
  }
  assert(!/<script/i.test(svg), `${profile}: no script element`);
}

const hostile: VisualLinkNetwork = {
  links: [
    { key: "<R>", startKey: "<R>", endKey: "<R>", label: '<script>&"' },
  ],
};
const hostileSvg = serializeDocument2DSvg(hostile, layoutDocument2D(hostile, {
  strategy: "canonical",
  optimizerPasses: 0,
}));
assert(!hostileSvg.includes('<script>&"'), "hostile label is not injected raw");
assert(hostileSvg.includes("&lt;script&gt;&amp;&quot;"), "hostile label XML escaped");

const poses: Document2DPose[] = [
  { key: "A", x: 0, y: 0, theta: 0 },
  { key: "B", x: -100, y: 20, theta: 0.3 },
  { key: "C", x: 110, y: -15, theta: -0.7 },
];
const manualNetwork: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "B", endKey: "C" },
    { key: "B", startKey: "B", endKey: "A" },
    { key: "C", startKey: "A", endKey: "C" },
  ],
};
const manual = buildDocument2DGeometry(manualNetwork, poses);
for (const link of manual) {
  assert(document2DCenterTangentsAreAntiparallel(link), `manual ${link.key}: exact 180-degree outward tangent`);
}
const a = manual.find((link) => link.key === "A")!;
near(a.startTangent.x, -1, "theta=0 START outward tangent x");
near(a.startTangent.y, 0, "theta=0 START outward tangent y");
near(a.endTangent.x, 1, "theta=0 END outward tangent x");
near(a.endTangent.y, 0, "theta=0 END outward tangent y");

expectCode(
  () => layoutDocument2D(basis, { rootKey: "missing" }),
  "unknown-root",
  "unknown root fails closed",
);
expectCode(
  () => layoutDocument2D(basis, { spacing: 0 }),
  "invalid-option",
  "invalid spacing fails closed",
);
expectCode(
  () => buildDocument2DGeometry(manualNetwork, poses.slice(0, 2)),
  "layout-network-mismatch",
  "missing pose fails closed",
);
