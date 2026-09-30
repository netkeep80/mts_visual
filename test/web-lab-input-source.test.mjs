import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`web-lab-input-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const [app, html] = await Promise.all([
  readFile(join(repoRoot, "browser", "webgpu-witness", "app.js"), "utf8"),
  readFile(join(repoRoot, "browser", "webgpu-witness", "index.html"), "utf8"),
]);

assert(app.includes("core.VISUAL_LAB_FIXTURE_DEFINITIONS"), "scene selector must use core fixture registry");
assert(app.includes("core.visualLabFixture(id)"), "built-in scenes must use cached core fixture snapshots");
assert(app.includes("core.parseDocument2DInputManifest(raw)"), "JSON import must reuse versioned manifest parser");
assert(app.includes("core.normalizeVisualLinkNetwork(parsed.network)"), "imported network must be normalized once");
assert(app.includes('const IMPORTED_SCENE_ID = "__imported__";'), "imported scene has one explicit identity");
assert(app.includes("fixtureSceneCache"), "built-in fixture scene identity must be cached");
assert(!app.includes("function hubHeavyNetwork(count)"), "browser must not own hub fixture generation");
assert(!app.includes("function classicSeparationNetwork()"), "browser must not own Classic fixture topology");
assert(!app.includes('case "hub-64"'), "browser scene selection must not hardcode fixture switch cases");
assert(app.includes('ui.structuralRoot.value = scene.hints?.rootKey ?? "";'), "Structural uses explicit fixture root hint");
assert(app.includes('ui.documentRoot.value = scene.hints?.rootKey ?? "";'), "Document uses explicit fixture root hint");

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
