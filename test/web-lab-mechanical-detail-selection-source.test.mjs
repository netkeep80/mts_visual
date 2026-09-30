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
  'policy: "cached-frustum-priority/v1"',
  "webgpu.selectMonolithicLinkDetail3D({",
  "detailCapacity: shapeSnapshot.detailCapacity",
  "selectedLink: selectedMechanicalLinkIndex(state)",
  "hoveredLink: state.hoveredCenterLink",
  "state.shape.setDetailLinkIndices(selection.indices)",
  "scheduleMechanicalDetailSelection(",
  '"shared-selection"',
  '"hover-priority"',
  '"camera-interaction"',
  '"camera-zoom"',
  '"auto-rotate"',
  "centerCacheRevision",
  "culledLinkCount:",
  "visibleCandidateCount:",
  "selectedPinned:",
  "hoveredPinned:",
]) {
  assert(app.includes(needle), `missing Mechanical detail-selection contract: ${needle}`);
}

assert(
  app.includes("detailCapacity: Math.min(")
    && app.includes("MECHANICAL_DETAIL_SLOT_BUDGET"),
  "Mechanical Web Lab must bound detail allocation independently of total Link count",
);

assert(
  app.includes("if (!sameDetailIndices(previous, selection.indices))"),
  "detail index buffer must upload only when the selected slot mapping changes",
);

assert(
  app.includes("detailSelectionIndexUploadBytes"),
  "diagnostics must separate detail-selection control uploads",
);

assert(
  app.includes("detailSelectionGlobalsUploadBytes"),
  "diagnostics must expose shape-global control upload bytes",
);

assert(
  app.includes("state.centerCacheRevision += 1"),
  "interaction-triggered center readback must version the cached visibility source",
);

assert(
  app.includes("clearTimeout(state.detailSelectionTimer)"),
  "Mechanical disposal must clear a pending detail-selection timer",
);

assert(
  !app.includes("detailCapacity: linkCount"),
  "Web Lab must not force all semantic Links into full detail",
);

console.log("Mechanical dynamic detail-selection source contract: PASS");
