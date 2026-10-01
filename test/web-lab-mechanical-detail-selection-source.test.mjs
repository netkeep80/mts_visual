import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`mechanical-detail-selection-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const [app, interactionController, runtimeController] = await Promise.all([
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "app.js"),
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
]);

assert(
  app.includes('from "./mechanical-camera-model.js"')
    && app.includes('from "./mechanical-interaction-controller.js"')
    && app.includes('from "./mechanical-detail-selection-controller.js"')
    && app.includes('from "./mechanical-runtime-controller.js"'),
  "Mechanical browser bootstrap must import the extracted controller/model boundaries",
);
assert(
  app.includes("createMechanicalInteractionController({")
    && app.includes("createMechanicalDetailSelectionController({")
    && app.includes("createMechanicalRuntimeController({")
    && app.includes("interactionController:")
    && app.includes("mechanicalInteractionController")
    && app.includes("detailSelectionController:")
    && app.includes("mechanicalDetailSelectionController"),
  "Mechanical runtime must receive the extracted interaction/detail controllers by injection",
);
assert(
  interactionController.includes('from "./mechanical-camera-model.js"'),
  "Mechanical interaction controller must depend on the camera model boundary",
);

for (const superseded of [
  "function installCameraControls(",
  "function pointerWorldRay(",
  "function pickCenterIcosahedron(",
  "function moveCenterDragTarget(",
  "function applyCenterDrag(",
  "function normalize3(",
  "function lookAt(",
  "function perspective(",
  "function refreshMechanicalDetailSelection(",
  "function scheduleMechanicalDetailSelection(",
]) {
  assert(
    !app.includes(superseded),
    `superseded Mechanical implementation must stay deleted from app.js: ${superseded}`,
  );
}

assert(
  !runtimeController.includes("webgpu.selectMonolithicLinkDetail3D({")
    && !app.includes("webgpu.selectMonolithicLinkDetail3D({"),
  "production Mechanical mode must not restore the CPU O(N) detail selector",
);
assert(
  !runtimeController.includes("detailCapacity: linkCount")
    && !app.includes("detailCapacity: linkCount"),
  "production Mechanical mode must not force all semantic Links into full detail",
);

console.log("Mechanical detail-selection source boundary: PASS");
