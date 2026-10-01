import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`mechanical-detail-selection-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const [app, cameraModel, interactionController, detailSelectionController] = await Promise.all([
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "app.js"),
    "utf8",
  ),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "mechanical-camera-model.js"),
    "utf8",
  ),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "mechanical-interaction-controller.js"),
    "utf8",
  ),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "mechanical-detail-selection-controller.js"),
    "utf8",
  ),
]);

assert(
  app.includes('from "./mechanical-camera-model.js"')
    && app.includes("return createViewProjection(")
    && app.includes("return projectMechanicalWorldToClient({"),
  "Mechanical render projection behavior must delegate to the executable camera model",
);
assert(
  interactionController.includes('from "./mechanical-camera-model.js"')
    && interactionController.includes("pointerWorldRay({")
    && interactionController.includes("cameraBasis(state.camera)")
    && interactionController.includes("panCamera(state.camera, dx, dy)")
    && interactionController.includes("clamp("),
  "Mechanical interaction camera behavior must delegate to the executable camera model",
);
assert(
  app.includes('from "./mechanical-interaction-controller.js"')
    && app.includes("createMechanicalInteractionController({")
    && app.includes("mechanicalInteractionController.mount(state)")
    && app.includes("mechanicalInteractionController.applyCenterDrag(state)")
    && app.includes(".clearCenterInteraction(renderState)"),
  "Mechanical stateful interaction ownership must delegate to the executable interaction controller",
);
for (const legacyInteraction of [
  "function installCameraControls(",
  "function pointerWorldRay(",
  "function pickCenterIcosahedron(",
  "function moveCenterDragTarget(",
  "function applyCenterDrag(",
]) {
  assert(
    !app.includes(legacyInteraction),
    `Mechanical interaction implementation must not remain duplicated in app.js: ${legacyInteraction}`,
  );
}
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

assert(
  app.includes('from "./mechanical-detail-selection-controller.js"')
    && app.includes("createMechanicalDetailSelectionController({")
    && app.includes("frustumMargin:")
    && app.includes("MECHANICAL_DETAIL_FRUSTUM_MARGIN")
    && app.includes("defaultDelay:")
    && app.includes("MECHANICAL_DETAIL_CAMERA_DEBOUNCE_MS")
    && app.includes("mechanicalDetailSelectionController.refresh(")
    && app.includes("mechanicalDetailSelectionController.schedule(")
    && app.includes("mechanicalDetailSelectionController.cancel(state)"),
  "Mechanical GPU detail-selection ownership must delegate to the executable controller",
);
for (const legacyDetailFunction of [
  "function selectedMechanicalLinkIndex(",
  "function sameMechanicalGpuSelectionView(",
  "function refreshMechanicalDetailSelection(",
  "function scheduleMechanicalDetailSelection(",
]) {
  assert(
    !app.includes(legacyDetailFunction),
    `Mechanical detail-selection implementation must not remain duplicated in app.js: ${legacyDetailFunction}`,
  );
}

for (const needle of [
  "const MECHANICAL_DETAIL_SLOT_BUDGET = 4096",
  "shapeStats.selectorDispatches",
  "shapeStats.selectionMode === \"gpu-partition\"",
  '"shared-selection"',
  '"auto-rotate"',
  "detailSelectionControlUploadBytes",
  "liveCenterSource:",
  '"semantic-center-buffer"',
  "culledLinkCount:",
  "selectedPinned:",
  "hoveredPinned:",
]) {
  assert(app.includes(needle), `missing Mechanical browser integration contract: ${needle}`);
}

for (const needle of [
  '"gpu-partition-frustum/v1"',
  '"full-detail-identity/v1"',
  "state.shape.setGpuDetailSelectionView({",
  "viewProjection,",
  "selectedLink: priorityLink",
  "shapeSnapshot.detailCapacity < linkCount",
  "sameMechanicalGpuSelectionView(",
  "indexUploadBytes",
  "globalsUploadBytes",
  "selectionControlUploadBytes",
  "clearTimeoutFn(",
]) {
  assert(
    detailSelectionController.includes(needle),
    `missing Mechanical detail-selection controller contract: ${needle}`,
  );
}

for (const reason of [
  '"hover-priority"',
  '"camera-interaction"',
  '"camera-zoom"',
]) {
  assert(
    interactionController.includes(reason),
    `Mechanical interaction controller missing detail-selection reason: ${reason}`,
  );
}
assert(
  interactionController.includes("state.compute.readBackState()")
    && interactionController.includes("Interaction-triggered readback only.")
    && interactionController.includes("setTimeoutFn(")
    && interactionController.includes("runHoverPick")
    && interactionController.includes("state.compute.writeCenterOverrides(["),
  "CENTER hover/drag interaction must own readback/debounce/override behavior",
);

assert(
  app.includes("detailCapacity: Math.min(")
    && app.includes("MECHANICAL_DETAIL_SLOT_BUDGET"),
  "Mechanical Web Lab must bound detail allocation independently of total Link count",
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
  app.includes("mechanicalDetailSelectionController.cancel(state)"),
  "Mechanical disposal must delegate pending detail-selection timer cleanup",
);

assert(
  !app.includes("detailCapacity: linkCount"),
  "Web Lab must not force all semantic Links into full detail",
);

console.log("Mechanical GPU detail-selection source contract: PASS");
