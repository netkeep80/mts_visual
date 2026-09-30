import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition, message) {
  if (!condition) throw new Error(`compact-monolithic-init-source: ${message}`);
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const compute = await readFile(
  join(repoRoot, "src", "webgpu", "monolithic-link-compute.ts"),
  "utf8",
);
const benchmark = await readFile(
  join(repoRoot, "src", "webgpu", "monolithic-link-benchmark.ts"),
  "utf8",
);

const initializationRegion = compute.slice(
  0,
  compute.indexOf("function maxDelta"),
);
assert(
  !initializationRegion.includes("createMonolithicLinkSpringPhysics3D("),
  "WebGPU initialization must not allocate a full CPU spring-physics mirror",
);
assert(
  compute.slice(compute.indexOf("function maxDelta")).includes(
    "createMonolithicLinkSpringPhysics3D(",
  ),
  "CPU physics remains available below the initialization boundary as the differential oracle",
);
assert(
  compute.includes("createMonolithicLinkWebGpuComputeFromTopology3D"),
  "typed-topology production compute factory is missing",
);
assert(
  compute.includes("createMonolithicLinkSemanticCenterSeed3D"),
  "GPU initialization must use the compact CENTER-only seed",
);
assert(
  compute.includes("buildReverseIncidence(topology)"),
  "compact and presentation paths must share production reverse-incidence construction",
);
assert(
  compute.includes("packedTopologyData(topology, reverse)"),
  "compact and presentation paths must share production packed topology",
);

for (const forbidden of [
  "VisualLink[]",
  "Array.from({ length: linkCount }",
  "key:",
  "startKey:",
  "endKey:",
]) {
  assert(
    !benchmark.includes(forbidden),
    `compact benchmark generator must not materialize presentation objects: ${forbidden}`,
  );
}

assert(
  benchmark.includes("new Uint32Array(linkCount)"),
  "benchmark topology must use typed START/END arrays",
);
assert(
  benchmark.includes("inputTopologyBytes:"),
  "benchmark topology must report its exact compact input footprint",
);

console.log("compact monolithic benchmark initialization source contract: PASS");
