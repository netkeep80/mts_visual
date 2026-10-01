import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`mechanical-lifecycle-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const app = await readFile(
  join(repoRoot, "browser", "webgpu-witness", "app.js"),
  "utf8",
);

assert(
  app.includes('from "./mechanical-runtime-controller.js"')
    && app.includes("createMechanicalRuntimeController({")
    && app.includes("mountMechanical: () =>")
    && app.includes("mechanicalRuntimeController.mount()"),
  "Mechanical lifecycle must delegate to the runtime controller",
);
assert(
  app.includes('activateLabMode("mechanical-3d")'),
  "Mechanical remounts must route through the shared mode lifecycle",
);

for (const superseded of [
  "async function startRender()",
  "function stopRender()",
  "let renderState =",
  "let renderPass =",
]) {
  assert(
    !app.includes(superseded),
    `superseded Mechanical runtime must stay deleted from app.js: ${superseded}`,
  );
}

console.log("mechanical lifecycle source boundary: PASS");
