import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`web-lab-benchmark-source: ${message}`);
  }
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const benchmark = await readFile(
  join(repoRoot, "browser", "webgpu-witness", "benchmark.js"),
  "utf8",
);
const app = await readFile(
  join(repoRoot, "browser", "webgpu-witness", "app.js"),
  "utf8",
);
const html = await readFile(
  join(repoRoot, "browser", "webgpu-witness", "index.html"),
  "utf8",
);

for (const id of [
  "mechanical-benchmark-panel",
  "benchmark-links",
  "benchmark-profile",
  "benchmark-seed",
  "benchmark-octa",
  "benchmark-detail",
  "benchmark-warmup",
  "benchmark-samples",
  "benchmark-render",
  "benchmark-run",
  "benchmark-stop",
  "benchmark-copy",
  "benchmark-download",
  "benchmark-status",
  "benchmark-progress",
  "benchmark-result",
  "benchmark-canvas",
]) {
  assert(html.includes(`id="${id}"`), `missing benchmark UI id: ${id}`);
}

for (const needle of [
  "createMonolithicLinkBenchmarkTopology3D",
  "createMonolithicLinkWebGpuComputeFromTopology3D",
  "createMonolithicLinkWebGpuShape3D",
  "createMonolithicLinkWebGpuZeroCopyRenderer3D",
  "planMonolithicLinkWebGpuCapacity3D",
  "detailCapacity: requestedDetailCapacity",
  "includeRenderer: renderEnabled",
  "queue.onSubmittedWorkDone()",
  "summarizeMonolithicLinkBenchmarkSamples3D",
  '"CAPACITY_BLOCKED"',
  '"RUNTIME_FAILED"',
  '"PASS"',
  "timestampQuerySupported",
  "timestampQueryUsed: false",
  'config.resourceIsolation ?? "separate-device"',
]) {
  assert(
    benchmark.includes(needle),
    `missing benchmark production/evidence contract: ${needle}`,
  );
}

assert(
  benchmark.includes("adapter.requestDevice()"),
  "benchmark must use an isolated WebGPU device",
);
assert(
  !benchmark.includes("readBackState("),
  "measured benchmark iterations must not read semantic CENTER state back to CPU",
);
assert(
  !benchmark.includes("selectMonolithicLinkDetail3D("),
  "benchmark must not use the P2b CPU O(N) detail selector",
);
assert(
  !benchmark.includes("VisualLinkNetwork"),
  "benchmark runner must not materialize presentation-network objects",
);

assert(
  app.includes('params.get("benchmark") !== "mechanical"'),
  "URL auto-run must require explicit benchmark=mechanical opt-in",
);
assert(
  app.includes("applyBenchmarkQuery(startupParams)"),
  "startup must support URL-addressable benchmark opt-in",
);
assert(
  !app.includes('ui.benchmarkLinks.value = "1000000";'),
  "ordinary page load must not force the 1M preset",
);
assert(
  app.includes("linkCount <= 100_000 ? 20 : 1"),
  "runs <=100k must require at least 20 measured samples",
);
assert(
  app.includes("benchmarkStopRequested = true"),
  "Stop/pagehide must prevent another benchmark sample",
);
assert(
  app.includes("if (benchmarkRunning)")
    && app.includes("state.raf = requestAnimationFrame(frame)")
    && app.includes("await device.queue.onSubmittedWorkDone()")
    && app.includes('"separate-device+interactive-mechanical-suspended"'),
  "benchmark must suspend and drain the interactive Mechanical GPU pipeline",
);
assert(
  benchmark.includes("samples.physics.length < sampleCount")
    && benchmark.includes('"USER_STOPPED_BEFORE_REQUESTED_SAMPLE_COUNT"'),
  "stopped partial runs must not be reported as PASS",
);
assert(
  app.includes("downloadBenchmarkEvidence"),
  "benchmark evidence must be downloadable",
);
assert(
  app.includes("benchmarkEvidenceText"),
  "benchmark evidence must be copyable",
);

assert(
  html.includes('<option value="1000000">1 000 000</option>'),
  "1M must be an explicit selectable preset",
);
assert(
  html.includes('id="benchmark-links"')
    && html.includes('value="100000" selected'),
  "ordinary UI must default below 1M",
);

console.log("Web Lab real WebGPU benchmark source contract: PASS");
