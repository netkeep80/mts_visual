import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`web-lab-diagnostics-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const [app, html] = await Promise.all([
  readFile(join(repoRoot, "browser", "webgpu-witness", "app.js"), "utf8"),
  readFile(join(repoRoot, "browser", "webgpu-witness", "index.html"), "utf8"),
]);

for (const id of [
  "lab-copy-diagnostics",
  "lab-diagnostic-mode",
  "lab-diagnostic-input",
  "lab-diagnostic-links",
  "lab-diagnostic-selected",
  "lab-diagnostic-version",
  "lab-diagnostic-sha",
  "lab-diagnostic-detail",
  "document-manifest",
  "document-digest",
]) {
  assert(html.includes(`id="${id}"`), `missing diagnostic/provenance control: ${id}`);
}

assert(app.includes("function sharedDiagnosticSnapshot()"), "shared diagnostic envelope exists");

for (const needle of [
  "detailedLinkCount: shape.detailedLinkCount",
  "detailCapacity: shape.detailCapacity",
  "compactDynamicStateBytes: shape.compactDynamicStateBytes",
  "detailDynamicStateBytes: shape.detailDynamicStateBytes",
  'policy: "cached-frustum-priority/v1"',
  "culledLinkCount:",
  "visibleCandidateCount:",
  "selectedPinned:",
  "hoveredPinned:",
  "renderer.shapeDetailLinkIndexBuffer",
  "renderer.shapeSectionFrameBuffer",
  "shapeStats.compactDispatches !== 1",
  "shapeStats.detailDispatches !== expectedDetailDispatches",
  "shapeStats.computePasses !== expectedShapePasses",
  "const hasDetail = stats.detailedLinkCount > 0",
]) {
  assert(
    app.includes(needle),
    `Mechanical bounded-detail runtime contract missing: ${needle}`,
  );
}
assert(
  !app.includes("shapeStats.computePasses !== 1"),
  "Mechanical lab must not retain the obsolete one-pass shape invariant",
);
for (const fn of [
  "structuralDiagnosticDetail",
  "blueprintDiagnosticDetail",
  "documentDiagnosticDetail",
  "classicDiagnosticDetail",
  "mechanicalDiagnosticDetail",
]) {
  assert(app.includes(`function ${fn}()`), `missing mode diagnostic adapter: ${fn}`);
}

assert(app.includes("function setSelectedVisualKey(key)"), "shared selected Link state exists");
assert(app.includes('[data-role="structural-node"]'), "Structural selection participates");
assert(app.includes('[data-role="blueprint-center"]'), "Blueprint selection participates");
assert(app.includes('[data-role="document-link"]'), "Document selection participates");
assert(app.includes("setSelectedVisualKey(state.centerDrag.key)"), "Mechanical selection participates");
assert(app.includes("onActivateKey: (key) =>"), "Classic activation callback exists");
assert(app.includes("setSelectedVisualKey(key);"), "Classic/shared selection callback is wired");

assert(
  app.includes('globalThis.crypto.subtle.digest("SHA-256", bytes)'),
  "Document browser digest must use Web Crypto SHA-256",
);
assert(
  app.includes("core.createDocument2DRenderManifest({"),
  "browser provenance must reuse the core render-manifest contract",
);
assert(
  app.includes("rendererSha: String(buildInfo.mainSha)"),
  "browser provenance must record exact build SHA",
);
assert(
  app.includes("inputDigest = await sha256Text(inputText)"),
  "browser provenance must hash exact input manifest text",
);
assert(
  app.includes("const outputDigest = state.outputDigest ?? await sha256Text(state.svgText)"),
  "browser provenance must hash exact SVG text",
);
assert(!app.includes('outputDigest: "unknown"'), "fake output digest is forbidden");
assert(!app.includes('rendererSha: "unknown"'), "fake renderer SHA is forbidden");

console.log("web lab shared diagnostics/provenance source contract: PASS");
