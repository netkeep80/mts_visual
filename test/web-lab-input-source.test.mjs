import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`web-lab-input-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const [app, structuralController, documentController, html] = await Promise.all([
  readFile(join(repoRoot, "browser", "webgpu-witness", "app.js"), "utf8"),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "structural-2d-controller.js"),
    "utf8",
  ),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "document-2d-controller.js"),
    "utf8",
  ),
  readFile(join(repoRoot, "browser", "webgpu-witness", "index.html"), "utf8"),
]);

assert(app.includes("core.VISUAL_LAB_FIXTURE_DEFINITIONS"), "scene selector must use core fixture registry");
assert(app.includes("core.visualLabFixture(id)"), "built-in scenes must use cached core fixture snapshots");
assert(
  app.includes('from "./lab-input-model.js"')
    && app.includes("createImportedSceneFromText")
    && app.includes("createSceneInputManifest")
    && app.includes("serializeSceneInputManifest")
    && app.includes("parseManifest: core.parseDocument2DInputManifest")
    && app.includes("normalizeNetwork: core.normalizeVisualLinkNetwork"),
  "shared input behavior must delegate to the executable model with canonical core parser/normalizer injection",
);
assert(
  app.includes("IMPORTED_SCENE_ID"),
  "browser scene selector must use the imported identity exported by the shared input model",
);
assert(app.includes("fixtureSceneCache"), "built-in fixture scene identity must be cached");
assert(!app.includes("function hubHeavyNetwork(count)"), "browser must not own hub fixture generation");
assert(!app.includes("function classicSeparationNetwork()"), "browser must not own Classic fixture topology");
assert(!app.includes('case "hub-64"'), "browser scene selection must not hardcode fixture switch cases");
assert(
  app.includes('from "./structural-2d-controller.js"')
    && structuralController.includes('ui.structuralRoot.value = scene.hints?.rootKey ?? "";'),
  "Structural controller uses explicit fixture root hint",
);
assert(
  app.includes('from "./document-2d-controller.js"')
    && documentController.includes('ui.documentRoot.value = scene.hints?.rootKey ?? "";'),
  "Document controller uses explicit fixture root hint",
);

for (const id of [
  "lab-input-json",
  "lab-input-apply",
  "lab-input-file-button",
  "lab-input-file",
  "lab-input-copy",
  "lab-input-status",
]) {
  assert(html.includes(`id="${id}"`), `missing shared input control: ${id}`);
}
assert(
  /<select id="scene"[^>]*><\/select>/.test(html),
  "scene options must be generated from the core fixture registry",
);

console.log("web lab shared input source contract: PASS");
