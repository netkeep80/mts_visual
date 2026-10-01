import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`mechanical-lifecycle-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const [app, runtime] = await Promise.all([
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "app.js"),
    "utf8",
  ),
  readFile(
    join(repoRoot, "browser", "webgpu-witness", "mechanical-runtime-controller.js"),
    "utf8",
  ),
]);

assert(
  app.includes('from "./mechanical-runtime-controller.js"')
    && app.includes("createMechanicalRuntimeController({")
    && app.includes("mountMechanical: () =>")
    && app.includes("mechanicalRuntimeController.mount()"),
  "Mechanical lifecycle must delegate to the runtime controller",
);
for (const legacy of [
  "async function startRender()",
  "function stopRender()",
  "let renderState =",
  "let renderPass =",
]) {
  assert(
    !app.includes(legacy),
    `superseded Mechanical runtime must be deleted from app.js: ${legacy}`,
  );
}
assert(
  app.includes('activateLabMode("mechanical-3d")'),
  "Mechanical remounts must route through activateLabMode",
);
assert(
  runtime.includes("target.context.unconfigure?.()"),
  "normal Mechanical disposal must unconfigure the WebGPU canvas context",
);
assert(
  runtime.includes("context?.unconfigure?.()"),
  "failed Mechanical mount must unconfigure the WebGPU canvas context",
);
assert(
  runtime.includes("updateOverall();")
    && runtime.includes("dispose();")
    && runtime.includes("ОШИБКА монолитного рендера"),
  "runtime frame failure must immediately report and dispose Mechanical resources",
);
assert(
  runtime.includes("cancelAnimationFrameFn(target.raf)")
    && runtime.includes("detailSelectionController.cancel(target)")
    && runtime.includes("target.cleanupCameraControls?.()")
    && runtime.includes("target.renderer.destroy()")
    && runtime.includes("target.shape.destroy()")
    && runtime.includes("target.compute.destroy()"),
  "runtime controller must own bounded Mechanical teardown",
);

console.log("mechanical lifecycle source contract: PASS");
