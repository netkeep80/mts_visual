import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`mechanical-lifecycle-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const appPath = join(repoRoot, "browser", "webgpu-witness", "app.js");
const source = await readFile(appPath, "utf8");

const startRenderCalls = source.match(/\bstartRender\(\)/g) ?? [];
assert(
  startRenderCalls.length === 2,
  `startRender must exist only as its definition and lifecycle mount call; found ${startRenderCalls.length}`,
);
assert(
  !source.includes("startRender().catch"),
  "UI handlers must not bypass the shared lifecycle with direct startRender().catch calls",
);
assert(
  source.includes('activateLabMode("mechanical-3d")'),
  "Mechanical remounts must route through activateLabMode",
);
assert(
  source.includes("state.context.unconfigure?.()"),
  "normal Mechanical disposal must unconfigure the WebGPU canvas context",
);
assert(
  source.includes("context?.unconfigure?.()"),
  "failed Mechanical mount must unconfigure the WebGPU canvas context",
);
assert(
  source.includes("stopRender();\n        return;"),
  "runtime frame failure must immediately dispose Mechanical resources",
);

console.log("mechanical lifecycle source contract: PASS");
