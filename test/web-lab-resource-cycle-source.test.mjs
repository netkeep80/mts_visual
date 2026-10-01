import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`web-lab-resource-cycle: ${message}`);
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
assert(
  app.includes('LAB_SELF_TEST_CONTRACT = "five-mode-resource-cycle/v1"')
    && app.includes('LAB_SELF_TEST_QUERY = "mode-cycle"')
    && app.includes("const startupParams = new URLSearchParams(window.location.search)")
    && app.includes('startupParams.get("selftest")'),
  "browser self-test must remain URL-addressable with an explicit contract",
);
assert(
  app.includes('from "./lab-cycle-selftest-controller.js"')
    && app.includes("createLabCycleSelfTestController")
    && app.includes("return labCycleSelfTestController.run()"),
  "browser self-test behavior must delegate to the executable controller",
);

for (const wiring of [
  'from "./structural-2d-controller.js"',
  "structuralState: structural2DController.isMounted()",
  'from "./blueprint-2d-controller.js"',
  "blueprintState: blueprint2DController.isMounted()",
  'from "./document-2d-controller.js"',
  "documentState: document2DController.isMounted()",
  'from "./classic-3d-controller.js"',
  "classicState: classic3DController.isMounted()",
  'from "./mechanical-runtime-controller.js"',
  "mechanicalState:",
  "mechanicalRuntimeController.isMounted()",
  'from "./lab-mode-mount-controller.js"',
  "createLabModeMountController",
  "mount: mountLabMode",
]) {
  assert(app.includes(wiring), `missing five-mode lifecycle wiring: ${wiring}`);
}

assert(
  app.includes('ui.structuralViewport.querySelectorAll("svg").length')
    && app.includes('ui.blueprintViewport.querySelectorAll("svg").length')
    && app.includes('ui.documentViewport.querySelectorAll("svg").length')
    && app.includes("threeVisual.getVisualThreeRendererSnapshot"),
  "resource audit must inspect the actual mounted browser surfaces",
);

console.log("web lab resource-cycle source boundary: PASS");
