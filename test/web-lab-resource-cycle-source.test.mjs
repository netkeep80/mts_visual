import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`web-lab-resource-cycle: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const app = await readFile(
  join(repoRoot, "browser", "webgpu-witness", "app.js"),
  "utf8",
);
const html = await readFile(
  join(repoRoot, "browser", "webgpu-witness", "index.html"),
  "utf8",
);

for (const id of [
  "lab-run-cycle-test",
  "lab-cycle-status",
  "lab-resource-audit",
]) {
  assert(html.includes(`id="${id}"`), `missing shipped self-test UI id: ${id}`);
}

for (const symbol of [
  "LAB_REAL_CYCLE",
  "labResourceLedger",
  "claimLabResources",
  "releaseLabResources",
  "labResourceAuditSnapshot",
  "assertRealModeResources",
  "runLabModeCycleSelfTest",
]) {
  assert(app.includes(symbol), `missing resource-cycle implementation: ${symbol}`);
}

const orderedModes = [
  '"structural-2d"',
  '"blueprint-2d"',
  '"document-2d"',
  '"classic-3d"',
  '"mechanical-3d"',
  '"classic-3d"',
  '"document-2d"',
  '"blueprint-2d"',
  '"structural-2d"',
].join(",\n  ");
assert(
  app.includes(orderedModes),
  "real self-test must ship the accepted forward/back five-mode sequence",
);

assert(
  app.includes("await activateLabMode(modeId);"),
  "real cycle must use the production lifecycle activation path",
);
assert(
  app.includes("selectedScene() === scene"),
  "real cycle must preserve exact input scene identity",
);
assert(
  app.includes("sceneInputManifestText(scene) === originalManifest"),
  "real cycle must preserve exact input manifest bytes",
);
assert(
  app.includes("selectedVisualKey === originalSelectedKey"),
  "real cycle must preserve shared selection",
);

for (const resource of [
  "activeRendererOwners",
  "listenerScopes",
  "resizeObservers",
  "svgRoots",
  "threeRenderers",
  "mechanicalRenderers",
  "rafOwners",
  "webgpuConfigured",
]) {
  assert(app.includes(resource), `missing lab-owned resource counter: ${resource}`);
}

assert(
  app.includes("threeVisual.getVisualThreeRendererSnapshot"),
  "Classic resource acceptance must inspect the actual Three mount registry",
);
assert(
  app.includes('ui.structuralViewport.querySelectorAll("svg").length'),
  "Structural actual DOM root must be checked",
);
assert(
  app.includes('ui.blueprintViewport.querySelectorAll("svg").length'),
  "Blueprint actual DOM root must be checked",
);
assert(
  app.includes('ui.documentViewport.querySelectorAll("svg").length'),
  "Document actual DOM root must be checked",
);
assert(
  app.includes("renderState !== null"),
  "Mechanical actual renderer state must be checked",
);
assert(
  app.includes("labResourceLedger.webgpuConfigured === 0"),
  "leaving Mechanical must assert configured-WebGPU ownership is zero",
);
assert(
  app.includes("releaseLabResources(modeId);"),
  "every renderer cleanup must release the lab-owned resource ledger",
);

console.log("web lab real resource-cycle source contract: PASS");
