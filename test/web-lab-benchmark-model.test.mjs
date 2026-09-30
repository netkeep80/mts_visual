import assert from "node:assert/strict";
import {
  BENCHMARK_DETAIL_PROFILES,
  BENCHMARK_LINK_COUNTS,
  BENCHMARK_OCTAHEDRA,
  BENCHMARK_TOPOLOGY_PROFILES,
  benchmarkEvidenceFileName,
  createBenchmarkConfig,
  minimumBenchmarkSamples,
  normalizeBenchmarkDetailQuery,
  parseMechanicalBenchmarkQuery,
  serializeBenchmarkEvidence,
} from "../browser/webgpu-witness/benchmark-ui-model.js";

const noOptIn = parseMechanicalBenchmarkQuery(
  new URLSearchParams("links=1000000&samples=1"),
  100_000,
);
assert.equal(noOptIn.requested, false);
assert.deepEqual(noOptIn.values, {});

const full = parseMechanicalBenchmarkQuery(
  new URLSearchParams(
    "benchmark=mechanical&links=100000&profile=mixed&detail=4096&octa=64&seed=42&warmup=5&samples=20&render=true",
  ),
  10_000,
);
assert.equal(full.requested, true);
assert.deepEqual(full.values, {
  linkCount: 100_000,
  topologyProfile: "mixed",
  detailProfile: "detail-4096",
  octahedra: 64,
  seed: 42,
  warmupCount: 5,
  sampleCount: 20,
  renderEnabled: true,
});

const million = parseMechanicalBenchmarkQuery(
  new URLSearchParams(
    "benchmark=mechanical&links=1000000&detail=0&samples=1",
  ),
  100_000,
);
assert.deepEqual(million.values, {
  linkCount: 1_000_000,
  detailProfile: "semantic",
  seed: 0,
  sampleCount: 1,
  renderEnabled: false,
});

const rejected = parseMechanicalBenchmarkQuery(
  new URLSearchParams(
    "benchmark=mechanical&links=999&profile=unknown&detail=bad&octa=7&seed=-1&warmup=4&samples=19&render=0",
  ),
  100_000,
);
assert.deepEqual(rejected.values, {
  renderEnabled: false,
});

assert.equal(minimumBenchmarkSamples(1_000), 20);
assert.equal(minimumBenchmarkSamples(100_000), 20);
assert.equal(minimumBenchmarkSamples(1_000_000), 1);
assert.equal(normalizeBenchmarkDetailQuery("0"), "semantic");
assert.equal(normalizeBenchmarkDetailQuery("256"), "detail-256");
assert.equal(normalizeBenchmarkDetailQuery("full"), "full-detail");
assert.equal(normalizeBenchmarkDetailQuery("detail-1024"), "detail-1024");
assert.equal(normalizeBenchmarkDetailQuery("invalid"), null);
assert.equal(normalizeBenchmarkDetailQuery(null), null);

assert.deepEqual(
  [...BENCHMARK_LINK_COUNTS],
  [1_000, 10_000, 100_000, 1_000_000],
);
assert.deepEqual([...BENCHMARK_OCTAHEDRA], [16, 32, 64, 128]);
assert.deepEqual(
  [...BENCHMARK_TOPOLOGY_PROFILES],
  ["chain", "hub-heavy", "mixed", "self-incidence", "branching"],
);
assert.deepEqual(
  [...BENCHMARK_DETAIL_PROFILES],
  ["semantic", "detail-256", "detail-1024", "detail-4096", "full-detail"],
);

const physics = {
  longitudinalStiffness: 12,
  transverseStiffness: 3,
  nonlinearity: 0.4,
  nodeMass: 2,
  linearDampingRate: 0.5,
  simulationSpeed: 10,
};

const semanticConfig = createBenchmarkConfig(
  {
    linkCount: "100000",
    topologyProfile: "chain",
    seed: "7",
    octahedra: "64",
    detailProfile: "semantic",
    warmupCount: "5",
    sampleCount: "20",
    renderEnabled: true,
  },
  physics,
);
assert.equal(semanticConfig.renderEnabled, false);
assert.deepEqual(semanticConfig.physics, {
  stretchStiffness: 12,
  straighteningStiffness: 3,
  nonlinearity: 0.4,
  centerMass: 2,
  dampingRate: 0.5,
  simulationSpeed: 10,
});

const millionConfig = createBenchmarkConfig(
  {
    linkCount: "1000000",
    topologyProfile: "branching",
    seed: "1",
    octahedra: "128",
    detailProfile: "detail-4096",
    warmupCount: "5",
    sampleCount: "1",
    renderEnabled: true,
  },
  physics,
);
assert.equal(millionConfig.sampleCount, 1);
assert.equal(millionConfig.renderEnabled, true);

assert.throws(
  () => createBenchmarkConfig(
    {
      linkCount: "100000",
      topologyProfile: "mixed",
      seed: "1",
      octahedra: "64",
      detailProfile: "detail-4096",
      warmupCount: "5",
      sampleCount: "19",
      renderEnabled: false,
    },
    physics,
  ),
  /samples/,
);

const evidence = {
  status: "PASS",
  linkCount: 100_000,
  sampleCountCompleted: 20,
  stages: { physics: { medianMs: 1.25 } },
};
assert.deepEqual(
  JSON.parse(serializeBenchmarkEvidence(evidence)),
  evidence,
);
assert.throws(
  () => serializeBenchmarkEvidence(null),
  /ещё не создан/,
);
assert.equal(
  benchmarkEvidenceFileName(
    evidence,
    "1234567890abcdef1234567890abcdef12345678",
    new Date("2026-10-01T12:34:56.789Z"),
  ),
  "mts-visual-mechanical-benchmark-100000-1234567890ab-2026-10-01T12-34-56-789Z.json",
);

console.log("Web Lab benchmark UI model executable contract: PASS");
