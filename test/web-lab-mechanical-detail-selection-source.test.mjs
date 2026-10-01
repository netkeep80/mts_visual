import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`mechanical-detail-selection-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const [app, cameraModel] = await Promise.all([
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "app.js"),
    "utf8",
  ),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "mechanical-camera-model.js"),
    "utf8",
  ),
]);

assert(
  app.includes('from "./mechanical-camera-model.js"')
    && app.includes("return createViewProjection(")
    && app.includes("return projectMechanicalWorldToClient({")
    && app.includes("return createPointerWorldRay({"),
  "Mechanical camera/projection behavior must delegate to the executable camera model",
);
for (const legacyFunction of [
  "function normalize3(",
  "function cross(",
  "function dot(",
  "function lookAt(",
  "function perspective(",
  "function multiply4(",
  "function transformPoint4(",
  "function clamp(",
  "function cameraEye(",
  "function resetCamera(",
  "function cameraBasis(",
  "function panCamera(",
]) {
  assert(
    !app.includes(legacyFunction),
    `Mechanical camera math must not remain duplicated in app.js: ${legacyFunction}`,
  );
}
for (const exportedPrimitive of [
  "export function normalize3(",
  "export function cross3(",
  "export function dot3(",
  "export function lookAt4(",
  "export function perspective4(",
  "export function multiply4(",
  "export function transformPoint4(",
  "export function cameraEye(",
  "export function cameraBasis(",
  "export function createViewProjection(",
  "export function projectWorldToClient(",
  "export function pointerWorldRay(",
]) {
  assert(
    cameraModel.includes(exportedPrimitive),
    `camera model missing exported primitive: ${exportedPrimitive}`,
  );
}

for (const needle of [
  "const MECHANICAL_DETAIL_SLOT_BUDGET = 4096",
  '"gpu-partition-frustum/v1"',
  '"full-detail-identity/v1"',
  "state.shape.setGpuDetailSelectionView({",
  "viewProjection,",
  "selectedLink: priorityLink",
  "frustumMargin: MECHANICAL_DETAIL_FRUSTUM_MARGIN",
  "shapeStats.selectorDispatches",
  "shapeStats.selectionMode === \"gpu-partition\"",
  "scheduleMechanicalDetailSelection(",
  '"shared-selection"',
  '"hover-priority"',
  '"camera-interaction"',
  '"camera-zoom"',
  '"auto-rotate"',
  "detailSelectionControlUploadBytes",
  "selectionControlUploadBytes",
  "liveCenterSource:",
  '"semantic-center-buffer"',
  "culledLinkCount:",
  "selectedPinned:",
  "hoveredPinned:",
]) {
  assert(app.includes(needle), `missing Mechanical GPU detail-selection contract: ${needle}`);
}

assert(
  app.includes("detailCapacity: Math.min(")
    && app.includes("MECHANICAL_DETAIL_SLOT_BUDGET"),
  "Mechanical Web Lab must bound detail allocation independently of total Link count",
);

assert(
  app.includes("shapeSnapshot.detailCapacity < linkCount"),
  "GPU selector must be used only when semantic Link count exceeds detail capacity",
);

assert(
  app.includes("sameMechanicalGpuSelectionView("),
  "identical camera/priority control state must avoid redundant uniform writes",
);

assert(
  !app.includes("webgpu.selectMonolithicLinkDetail3D({"),
  "production bounded Mechanical mode must not perform the P2b CPU O(N) selector scan",
);

assert(
  !app.includes("state.shape.setDetailLinkIndices(selection.indices)"),
  "production camera selection must not upload CPU-generated detail index lists",
);

assert(
  app.includes("detailSelectionIndexUploadBytes"),
  "diagnostics must preserve explicit detail-index upload accounting",
);
assert(
  app.includes("detailSelectionGlobalsUploadBytes"),
  "diagnostics must expose shape-global control upload bytes",
);
assert(
  app.includes("detailSelectionControlUploadBytes"),
  "diagnostics must expose fixed GPU selector uniform upload bytes",
);

assert(
  app.includes("clearTimeout(state.detailSelectionTimer)"),
  "Mechanical disposal must clear a pending detail-selection timer",
);

assert(
  !app.includes("detailCapacity: linkCount"),
  "Web Lab must not force all semantic Links into full detail",
);

console.log("Mechanical GPU detail-selection source contract: PASS");
