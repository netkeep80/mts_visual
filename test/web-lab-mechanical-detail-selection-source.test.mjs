import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`mechanical-detail-selection-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const app = await readFile(
  join(repoRoot, "browser", "webgpu-witness", "app.js"),
  "utf8",
);

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
