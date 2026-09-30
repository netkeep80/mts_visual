export const LAB_REAL_CYCLE = Object.freeze([
  "structural-2d",
  "blueprint-2d",
  "document-2d",
  "classic-3d",
  "mechanical-3d",
  "classic-3d",
  "document-2d",
  "blueprint-2d",
  "structural-2d",
]);

export const LAB_REAL_CYCLE_REPEATS = 2;

export const LAB_RESOURCE_FIELDS = Object.freeze([
  "activeRendererOwners",
  "listenerScopes",
  "resizeObservers",
  "svgRoots",
  "threeRenderers",
  "mechanicalRenderers",
  "rafOwners",
  "webgpuConfigured",
]);

const ZERO_RESOURCE_PROFILE = Object.freeze({
  activeRendererOwners: 0,
  listenerScopes: 0,
  resizeObservers: 0,
  svgRoots: 0,
  threeRenderers: 0,
  mechanicalRenderers: 0,
  rafOwners: 0,
  webgpuConfigured: 0,
});

const MODE_RESOURCE_PROFILES = Object.freeze({
  "structural-2d": Object.freeze({
    activeRendererOwners: 1,
    listenerScopes: 1,
    resizeObservers: 0,
    svgRoots: 1,
    threeRenderers: 0,
    mechanicalRenderers: 0,
    rafOwners: 0,
    webgpuConfigured: 0,
  }),
  "blueprint-2d": Object.freeze({
    activeRendererOwners: 1,
    listenerScopes: 1,
    resizeObservers: 0,
    svgRoots: 1,
    threeRenderers: 0,
    mechanicalRenderers: 0,
    rafOwners: 0,
    webgpuConfigured: 0,
  }),
  "document-2d": Object.freeze({
    activeRendererOwners: 1,
    listenerScopes: 1,
    resizeObservers: 0,
    svgRoots: 1,
    threeRenderers: 0,
    mechanicalRenderers: 0,
    rafOwners: 0,
    webgpuConfigured: 0,
  }),
  "classic-3d": Object.freeze({
    activeRendererOwners: 1,
    listenerScopes: 1,
    resizeObservers: 1,
    svgRoots: 0,
    threeRenderers: 1,
    mechanicalRenderers: 0,
    rafOwners: 1,
    webgpuConfigured: 0,
  }),
  "mechanical-3d": Object.freeze({
    activeRendererOwners: 1,
    listenerScopes: 1,
    resizeObservers: 0,
    svgRoots: 0,
    threeRenderers: 0,
    mechanicalRenderers: 1,
    rafOwners: 1,
    webgpuConfigured: 1,
  }),
});

const MODE_STATE_FIELDS = Object.freeze({
  "structural-2d": "structuralState",
  "blueprint-2d": "blueprintState",
  "document-2d": "documentState",
  "classic-3d": "classicState",
  "mechanical-3d": "mechanicalState",
});

const SVG_ROOT_FIELDS = Object.freeze({
  "structural-2d": "structuralSvgRoots",
  "blueprint-2d": "blueprintSvgRoots",
  "document-2d": "documentSvgRoots",
});

function assertModeCycle(condition, message) {
  if (!condition) {
    throw new Error(`mode-cycle: ${message}`);
  }
}

export function createLabResourceLedger() {
  return {
    generation: 0,
    mounts: 0,
    disposals: 0,
    activeMode: null,
    ...ZERO_RESOURCE_PROFILE,
  };
}

export function labResourceProfileForMode(
  modeId,
  { mounted = true } = {},
) {
  if (!mounted) return ZERO_RESOURCE_PROFILE;
  return MODE_RESOURCE_PROFILES[modeId] ?? ZERO_RESOURCE_PROFILE;
}

export function claimLabResourceLedger(
  ledger,
  modeId,
  { mounted = true } = {},
) {
  const profile = labResourceProfileForMode(modeId, { mounted });
  ledger.generation += 1;
  ledger.mounts += 1;
  ledger.activeMode = modeId;
  Object.assign(ledger, profile);
  return ledger;
}

export function releaseLabResourceLedger(ledger, modeId) {
  if (ledger.activeMode !== modeId) return false;
  ledger.disposals += 1;
  ledger.activeMode = null;
  Object.assign(ledger, ZERO_RESOURCE_PROFILE);
  return true;
}

export function snapshotLabResourceLedger(ledger) {
  return Object.freeze({ ...ledger });
}

export function assertLabResourceAudit({
  modeId,
  audit,
  mechanicalAvailable,
}) {
  assertModeCycle(
    audit.ledger.activeMode === modeId,
    `ledger activeMode=${audit.ledger.activeMode}, expected=${modeId}`,
  );

  for (const [candidateMode, stateField] of Object.entries(
    MODE_STATE_FIELDS,
  )) {
    if (candidateMode === modeId) continue;
    assertModeCycle(
      !audit.actual[stateField],
      `${modeId}: stale state from ${candidateMode}`,
    );
  }

  const activeStateField = MODE_STATE_FIELDS[modeId];
  const activeMounted = activeStateField
    ? Boolean(audit.actual[activeStateField])
    : false;

  if (modeId === "mechanical-3d" && !mechanicalAvailable) {
    assertModeCycle(
      !activeMounted,
      "Mechanical without WebGPU device must not claim renderer state",
    );
    assertModeCycle(
      audit.ledger.activeRendererOwners === 0,
      "Mechanical unavailable must not claim resource owner",
    );
  } else {
    assertModeCycle(
      activeMounted,
      `${modeId}: active renderer state missing`,
    );
    assertModeCycle(
      audit.ledger.activeRendererOwners === 1,
      `${modeId}: expected exactly one resource owner`,
    );
  }

  const expectedSvgField = SVG_ROOT_FIELDS[modeId] ?? null;
  for (const field of [
    "structuralSvgRoots",
    "blueprintSvgRoots",
    "documentSvgRoots",
  ]) {
    const expected = field === expectedSvgField ? 1 : 0;
    assertModeCycle(
      audit.actual[field] === expected,
      `${modeId}: ${field}=${audit.actual[field]}, expected=${expected}`,
    );
  }

  assertModeCycle(
    audit.actual.classicThreeMounted === (modeId === "classic-3d"),
    `${modeId}: Classic Three mount leak/missing mount`,
  );
  assertModeCycle(
    audit.actual.classicCanvasRoots === (modeId === "classic-3d" ? 1 : 0),
    `${modeId}: Classic canvas root leak/missing root`,
  );

  if (modeId !== "mechanical-3d") {
    assertModeCycle(
      !audit.actual.mechanicalState,
      `${modeId}: Mechanical state leaked`,
    );
    assertModeCycle(
      audit.ledger.webgpuConfigured === 0,
      `${modeId}: WebGPU canvas still claimed configured`,
    );
    assertModeCycle(
      audit.ledger.mechanicalRenderers === 0,
      `${modeId}: Mechanical renderer ownership leaked`,
    );
  } else if (mechanicalAvailable) {
    assertModeCycle(
      audit.ledger.webgpuConfigured === 1,
      "Mechanical must own configured WebGPU canvas",
    );
    assertModeCycle(
      audit.ledger.mechanicalRenderers === 1,
      "Mechanical renderer ownership missing",
    );
  }

  return audit;
}
