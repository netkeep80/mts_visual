export const BENCHMARK_LINK_COUNTS = Object.freeze([
  1_000,
  10_000,
  100_000,
  1_000_000,
]);

export const BENCHMARK_OCTAHEDRA = Object.freeze([16, 32, 64, 128]);

export const BENCHMARK_TOPOLOGY_PROFILES = Object.freeze([
  "chain",
  "hub-heavy",
  "mixed",
  "self-incidence",
  "branching",
]);

export const BENCHMARK_DETAIL_PROFILES = Object.freeze([
  "semantic",
  "detail-256",
  "detail-1024",
  "detail-4096",
  "full-detail",
]);

function integerValue(value, label, minimum, maximum) {
  const number = Number(value);
  if (
    !Number.isSafeInteger(number)
    || number < minimum
    || number > maximum
  ) {
    throw new Error(
      `недопустимое значение benchmark «${label}»: ${String(value)}`,
    );
  }
  return number;
}

export function minimumBenchmarkSamples(linkCount) {
  const value = integerValue(
    linkCount,
    "число Links",
    1,
    1_000_000,
  );
  return value <= 100_000 ? 20 : 1;
}

export function normalizeBenchmarkDetailQuery(value) {
  if (value === null) return null;
  if (BENCHMARK_DETAIL_PROFILES.includes(value)) return value;
  const aliases = {
    "0": "semantic",
    "256": "detail-256",
    "1024": "detail-1024",
    "4096": "detail-4096",
    full: "full-detail",
  };
  return aliases[value] ?? null;
}

export function createBenchmarkConfig(values, physics) {
  const linkCount = integerValue(
    values.linkCount,
    "число Links",
    1,
    1_000_000,
  );
  if (!BENCHMARK_LINK_COUNTS.includes(linkCount)) {
    throw new Error(
      `неподдерживаемое число Links benchmark: ${linkCount}`,
    );
  }

  const topologyProfile = values.topologyProfile;
  if (!BENCHMARK_TOPOLOGY_PROFILES.includes(topologyProfile)) {
    throw new Error(
      `неподдерживаемый профиль topology: ${topologyProfile}`,
    );
  }

  const octahedra = integerValue(
    values.octahedra,
    "октаэдры",
    2,
    128,
  );
  if (!BENCHMARK_OCTAHEDRA.includes(octahedra)) {
    throw new Error(
      `неподдерживаемое число октаэдров benchmark: ${octahedra}`,
    );
  }

  const detailProfile = values.detailProfile;
  if (!BENCHMARK_DETAIL_PROFILES.includes(detailProfile)) {
    throw new Error(
      `неподдерживаемый detail profile: ${detailProfile}`,
    );
  }

  const warmupCount = integerValue(
    values.warmupCount,
    "warmup",
    5,
    100,
  );
  const sampleCount = integerValue(
    values.sampleCount,
    "samples",
    minimumBenchmarkSamples(linkCount),
    200,
  );
  const seed = integerValue(
    values.seed,
    "seed",
    0,
    0xffff_ffff,
  );

  return Object.freeze({
    linkCount,
    topologyProfile,
    seed,
    octahedra,
    detailProfile,
    warmupCount,
    sampleCount,
    renderEnabled:
      Boolean(values.renderEnabled)
      && detailProfile !== "semantic",
    physics: Object.freeze({
      stretchStiffness: physics.longitudinalStiffness,
      straighteningStiffness: physics.transverseStiffness,
      nonlinearity: physics.nonlinearity,
      centerMass: physics.nodeMass,
      dampingRate: physics.linearDampingRate,
      simulationSpeed: physics.simulationSpeed,
    }),
  });
}

function validIntegerQuery(value, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number)
    && number >= minimum
    && number <= maximum
    ? number
    : null;
}

export function parseMechanicalBenchmarkQuery(
  params,
  currentLinkCount,
) {
  if (params.get("benchmark") !== "mechanical") {
    return Object.freeze({
      requested: false,
      values: Object.freeze({}),
    });
  }

  const values = {};
  const links = validIntegerQuery(
    params.get("links"),
    1,
    1_000_000,
  );
  if (
    links !== null
    && BENCHMARK_LINK_COUNTS.includes(links)
  ) {
    values.linkCount = links;
  }

  const topologyProfile = params.get("profile");
  if (BENCHMARK_TOPOLOGY_PROFILES.includes(topologyProfile)) {
    values.topologyProfile = topologyProfile;
  }

  const detailProfile =
    normalizeBenchmarkDetailQuery(params.get("detail"));
  if (detailProfile !== null) {
    values.detailProfile = detailProfile;
  }

  const octahedra = validIntegerQuery(
    params.get("octa"),
    2,
    128,
  );
  if (
    octahedra !== null
    && BENCHMARK_OCTAHEDRA.includes(octahedra)
  ) {
    values.octahedra = octahedra;
  }

  const seed = validIntegerQuery(
    params.get("seed"),
    0,
    0xffff_ffff,
  );
  if (seed !== null) values.seed = seed;

  const warmupCount = validIntegerQuery(
    params.get("warmup"),
    5,
    100,
  );
  if (warmupCount !== null) values.warmupCount = warmupCount;

  const selectedLinkCount =
    values.linkCount
    ?? validIntegerQuery(currentLinkCount, 1, 1_000_000);
  const sampleCount = validIntegerQuery(
    params.get("samples"),
    1,
    200,
  );
  if (
    selectedLinkCount !== null
    && sampleCount !== null
    && sampleCount >= minimumBenchmarkSamples(selectedLinkCount)
  ) {
    values.sampleCount = sampleCount;
  }

  values.renderEnabled =
    params.get("render") === "1"
    || params.get("render") === "true";

  return Object.freeze({
    requested: true,
    values: Object.freeze(values),
  });
}

export function serializeBenchmarkEvidence(evidence) {
  if (!evidence) {
    throw new Error("benchmark evidence ещё не создан");
  }
  return JSON.stringify(evidence, null, 2);
}

export function benchmarkEvidenceFileName(
  evidence,
  buildSha,
  createdAt = new Date(),
) {
  if (!evidence) {
    throw new Error("benchmark evidence ещё не создан");
  }
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-");
  return `mts-visual-mechanical-benchmark-${evidence.linkCount}-${String(buildSha).slice(0, 12)}-${stamp}.json`;
}
