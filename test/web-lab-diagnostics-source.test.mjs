import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`web-lab-diagnostics-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const [app, structuralController, blueprintController, documentController, classicController, mechanicalInteractionController, mechanicalRuntimeController, html] = await Promise.all([
  readFile(join(repoRoot, "browser", "webgpu-witness", "app.js"), "utf8"),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "structural-2d-controller.js"),
    "utf8",
  ),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "blueprint-2d-controller.js"),
    "utf8",
  ),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "document-2d-controller.js"),
    "utf8",
  ),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "classic-3d-controller.js"),
    "utf8",
  ),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "mechanical-interaction-controller.js"),
    "utf8",
  ),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "mechanical-runtime-controller.js"),
    "utf8",
  ),
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

assert(
  app.includes('from "./lab-diagnostics-model.js"')
    && app.includes("createSharedDiagnosticEnvelope")
    && app.includes("projectSharedDiagnosticDisplay")
    && app.includes("serializeSharedDiagnosticSnapshot")
    && app.includes("validateSelectedLinkKey")
    && app.includes("reconcileSelectedLinkKey"),
  "shared diagnostic envelope/selection behavior must delegate to the executable diagnostics model",
);

for (const needle of [
  "detailedLinkCount:",
  "detailCapacity:",
  "compactDynamicStateBytes:",
  "detailDynamicStateBytes:",
  '"gpu-partition-frustum/v1"',
  '"full-detail-identity/v1"',
  "selectionMode:",
  "selectorControlBytes:",
  "selectionControlUploadBytes:",
  "culledLinkCount:",
  "visibleCandidateCount:",
  "selectedPinned:",
  "hoveredPinned:",
  "shapeStats.compactDispatches !== 1",
  "shapeStats.selectorDispatches",
  "shapeStats.detailDispatches",
  "expectedDetailDispatches",
  "expectedShapePasses",
  "const hasDetail =",
]) {
  assert(
    mechanicalRuntimeController.includes(needle),
    `Mechanical bounded-detail runtime contract missing from controller: ${needle}`,
  );
}
assert(
  app.includes('from "./mechanical-runtime-controller.js"')
    && app.includes("mechanicalRuntimeController")
    && app.includes(".diagnosticDetail(selectedScene())"),
  "Mechanical diagnostics must delegate to the runtime controller",
);
assert(
  !mechanicalRuntimeController.includes("shapeStats.computePasses !== 1"),
  "Mechanical lab must not retain the obsolete one-pass shape invariant",
);
assert(
  app.includes('from "./structural-2d-controller.js"')
    && app.includes("createStructural2DController")
    && app.includes("structural2DController.diagnosticDetail(selectedScene())"),
  "Structural diagnostics must delegate to the per-mode controller",
);
assert(
  app.includes('from "./blueprint-2d-controller.js"')
    && app.includes("createBlueprint2DController")
    && app.includes("blueprint2DController.diagnosticDetail(selectedScene())"),
  "Blueprint diagnostics must delegate to the per-mode controller",
);
assert(
  app.includes('from "./document-2d-controller.js"')
    && app.includes("createDocument2DController")
    && app.includes("document2DController.diagnosticDetail(selectedScene())"),
  "Document diagnostics must delegate to the per-mode controller",
);
assert(
  app.includes('from "./classic-3d-controller.js"')
    && app.includes("createClassic3DController")
    && app.includes("classic3DController.diagnosticDetail(selectedScene())"),
  "Classic diagnostics must delegate to the per-mode controller",
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

assert(
  app.includes("selectedVisualKey = validateSelectedLinkKey(scene, key)")
    && app.includes("selectedVisualKey = reconcileSelectedLinkKey("),
  "shared selected Link state must use executable validation/reconciliation",
);
assert(
  structuralController.includes('[data-role="structural-node"]')
    && structuralController.includes("setSelectedKey(key)"),
  "Structural selection participates through the Structural controller",
);
assert(
  blueprintController.includes('[data-role="blueprint-center"]')
    && blueprintController.includes("setSelectedKey(target.dragKey)"),
  "Blueprint selection participates through the Blueprint controller",
);
assert(
  documentController.includes('[data-role="document-link"]')
    && documentController.includes("setSelectedKey(key)"),
  "Document selection participates through the Document controller",
);
assert(
  app.includes("setSelectedKey: (key) =>")
    && app.includes("setSelectedVisualKey(key)")
    && mechanicalInteractionController.includes("setSelectedKey(state.centerDrag.key)"),
  "Mechanical selection participates through the Mechanical interaction controller",
);
assert(
  classicController.includes("onActivateKey: (key) =>")
    && classicController.includes("setSelectedKey(key)"),
  "Classic activation callback participates through the Classic controller",
);

assert(
  app.includes('globalThis.crypto.subtle.digest("SHA-256", bytes)'),
  "Document browser digest must use Web Crypto SHA-256",
);
assert(
  documentController.includes("core.createDocument2DRenderManifest({"),
  "browser provenance must reuse the core render-manifest contract",
);
assert(
  documentController.includes("rendererSha: String(buildInfo.mainSha)"),
  "browser provenance must record exact build SHA",
);
assert(
  documentController.includes("const inputDigest = await sha256Text(inputText)"),
  "browser provenance must hash exact input manifest text",
);
assert(
  documentController.includes("snapshot.cachedOutputDigest")
    && documentController.includes("await sha256Text(snapshot.svgText)"),
  "browser provenance must reuse or hash the exact rendered SVG text",
);
assert(
  documentController.includes("target.digestGeneration === generation")
    && documentController.includes("state === target")
    && documentController.includes("!target.cleaned"),
  "Document digest updates must be guarded against stale render/dispose completion",
);
assert(
  !documentController.includes('outputDigest: "unknown"'),
  "fake output digest is forbidden",
);
assert(
  !documentController.includes('rendererSha: "unknown"'),
  "fake renderer SHA is forbidden",
);

console.log("web lab shared diagnostics/provenance source contract: PASS");
