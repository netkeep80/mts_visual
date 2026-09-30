import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`web-lab-resource-cycle-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const [app, html] = await Promise.all([
  readFile(join(repoRoot, "browser", "webgpu-witness", "app.js"), "utf8"),
  readFile(join(repoRoot, "browser", "webgpu-witness", "index.html"), "utf8"),
]);

assert(html.includes('id="lab-run-cycle-test"'), "cycle-test button must be shipped");
assert(html.includes('id="lab-cycle-status"'), "cycle-test status must be shipped");
assert(app.includes("function runLabResourceCycleSelfTest(iterations = 2)"), "real resource-cycle self-test exists");
assert(app.includes("function verifyRealLabModeResources("), "mode-specific resource verifier exists");
assert(app.includes("function realLabResourceSnapshot()"), "real resource snapshot exists");

const expectedSequence = [
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
  app.includes(`const LAB_RESOURCE_CYCLE = Object.freeze([\n  ${expectedSequence},\n]);`),
  "resource-cycle sequence must cover all five modes and return through 2D modes",
);

for (const resource of [
  "activeAbortScopes",
  "activeClassicRenderers",
  "activeMechanicalRenderers",
  "activeRafOwners",
  "mechanicalContextConfigured",
]) {
  assert(app.includes(resource), `missing resource ledger field: ${resource}`);
}

assert(
  app.includes("snapshot.sceneIdentity !== originalScene || selectedScene() !== originalScene"),
  "self-test must require exact input object identity",
);
assert(
  app.includes("snapshot.selectedKey !== originalSelectedKey"),
  "self-test must preserve selected Link presentation state",
);
assert(
  app.includes('ui.structuralViewport.querySelectorAll("svg").length'),
  "Structural real SVG root is counted",
);
assert(
  app.includes('ui.blueprintViewport.querySelectorAll("svg").length'),
  "Blueprint real SVG root is counted",
);
assert(
  app.includes('ui.documentViewport.querySelectorAll("svg").length'),
  "Document real SVG root is counted",
);
assert(
  app.includes("ui.classicViewport.childElementCount"),
  "Classic real DOM renderer surface is counted",
);
assert(
  app.includes("labResourceLedger.mechanicalContextConfigured = true"),
  "Mechanical configure state is instrumented",
);
assert(
  app.includes("labResourceLedger.mechanicalContextConfigured = false"),
  "Mechanical unconfigure state is instrumented",
);
assert(
  app.includes('addLabResource("activeMechanicalRenderers")')
    && app.includes('removeLabResource("activeMechanicalRenderers")'),
  "Mechanical renderer ownership is balanced",
);
assert(
  app.includes('addLabResource("activeClassicRenderers")')
    && app.includes('removeLabResource("activeClassicRenderers")'),
  "Classic renderer ownership is balanced",
);
assert(
  app.includes('addLabResource("activeAbortScopes")')
    && app.includes('removeLabResource("activeAbortScopes")'),
  "listener scopes are balanced",
);
assert(
  app.includes("await activateLabMode(originalMode)"),
  "self-test restores the original renderer even after failure",
);

console.log("web lab real resource-cycle source contract: PASS");
