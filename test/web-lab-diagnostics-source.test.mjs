import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`web-lab-diagnostics-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const [app, html] = await Promise.all([
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "app.js"),
    "utf8",
  ),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "index.html"),
    "utf8",
  ),
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
  "shared diagnostics/selection must delegate to the executable model",
);

for (const wiring of [
  'from "./structural-2d-controller.js"',
  "structural2DController.diagnosticDetail(selectedScene())",
  'from "./blueprint-2d-controller.js"',
  "blueprint2DController.diagnosticDetail(selectedScene())",
  'from "./document-2d-controller.js"',
  "document2DController.diagnosticDetail(selectedScene())",
  'from "./classic-3d-controller.js"',
  "classic3DController.diagnosticDetail(selectedScene())",
  'from "./mechanical-runtime-controller.js"',
  ".diagnosticDetail(selectedScene())",
]) {
  assert(app.includes(wiring), `missing diagnostic controller wiring: ${wiring}`);
}

assert(
  app.includes("selectedVisualKey = validateSelectedLinkKey(scene, key)")
    && app.includes("selectedVisualKey = reconcileSelectedLinkKey("),
  "shared selected Link state must use executable validation/reconciliation",
);

console.log("web lab diagnostics/provenance source boundary: PASS");
