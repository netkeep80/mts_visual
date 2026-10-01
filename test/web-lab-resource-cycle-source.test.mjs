import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`web-lab-resource-cycle: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const [app, classicController] = await Promise.all([
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "app.js"),
    "utf8",
  ),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "classic-3d-controller.js"),
    "utf8",
  ),
]);
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

assert(
  app.includes('from "./lab-resource-model.js"')
    && app.includes("createLabResourceLedger")
    && app.includes("claimLabResourceLedger")
    && app.includes("releaseLabResourceLedger")
    && app.includes("assertLabResourceAudit"),
  "app must delegate resource accounting/invariants to the executable resource model",
);

for (const symbol of [
  "labResourceAuditSnapshot",
  "assertRealModeResources",
  "runLabModeCycleSelfTest",
]) {
  assert(app.includes(symbol), `missing resource-cycle browser wiring: ${symbol}`);
}

assert(
  app.includes('LAB_SELF_TEST_CONTRACT = "five-mode-resource-cycle/v1"'),
  "browser self-test contract version must be explicit",
);
assert(
  app.includes('LAB_SELF_TEST_QUERY = "mode-cycle"'),
  "browser self-test query token must be explicit",
);
assert(
  app.includes("const startupParams = new URLSearchParams(window.location.search)")
    && app.includes('startupParams.get("selftest")'),
  "browser self-test must be directly invocable through the page URL",
);
assert(
  app.includes('from "./lab-cycle-selftest-controller.js"')
    && app.includes("createLabCycleSelfTestController")
    && app.includes("activateMode: (modeId) => activateLabMode(modeId)")
    && app.includes("getSelectedScene: () => selectedScene()")
    && app.includes("sceneManifestText: (scene) => sceneInputManifestText(scene)")
    && app.includes("getSelectedKey: () => selectedVisualKey")
    && app.includes("return labCycleSelfTestController.run()"),
  "browser self-test must delegate behavior to the executable controller while driving production activateLabMode",
);

assert(
  app.includes('from "./structural-2d-controller.js"')
    && app.includes("createStructural2DController")
    && app.includes("mountStructural: () => mountStructural2D()")
    && app.includes("return structural2DController.mount()")
    && app.includes("structuralState: structural2DController.isMounted()"),
  "Structural mode ownership must delegate to the per-mode controller",
);

assert(
  app.includes('from "./blueprint-2d-controller.js"')
    && app.includes("createBlueprint2DController")
    && app.includes("mountBlueprint: () => mountBlueprint()")
    && app.includes("return blueprint2DController.mount()")
    && app.includes("blueprintState: blueprint2DController.isMounted()"),
  "Blueprint mode ownership must delegate to the per-mode controller",
);

assert(
  app.includes('from "./document-2d-controller.js"')
    && app.includes("createDocument2DController")
    && app.includes("mountDocument: () => mountDocument2D()")
    && app.includes("return document2DController.mount()")
    && app.includes("documentState: document2DController.isMounted()"),
  "Document mode ownership must delegate to the per-mode controller",
);

assert(
  app.includes('from "./classic-3d-controller.js"')
    && app.includes("createClassic3DController")
    && app.includes("mountClassic: () => mountClassic3D()")
    && app.includes("return classic3DController.mount()")
    && app.includes("classicState: classic3DController.isMounted()"),
  "Classic mode ownership must delegate to the per-mode controller",
);
assert(
  classicController.includes("threeVisual.createVisualThreeLiveRenderer")
    && classicController.includes("threeVisual.destroyVisualThreeRenderer"),
  "Classic controller must own the real Three renderer lifecycle",
);
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
  app.includes('from "./lab-mode-mount-controller.js"')
    && app.includes("createLabModeMountController")
    && app.includes("claimResources: claimLabResources")
    && app.includes("releaseResources: releaseLabResources")
    && app.includes("return labModeMountController.mount(modeId)")
    && app.includes("mount: mountLabMode"),
  "production lifecycle must delegate mode mounting and resource cleanup to the executable mount controller",
);

console.log("web lab real resource-cycle source contract: PASS");
