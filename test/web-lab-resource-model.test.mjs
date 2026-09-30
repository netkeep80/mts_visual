import assert from "node:assert/strict";
import {
  LAB_REAL_CYCLE,
  LAB_REAL_CYCLE_REPEATS,
  LAB_RESOURCE_FIELDS,
  assertLabResourceAudit,
  claimLabResourceLedger,
  createLabResourceLedger,
  labResourceProfileForMode,
  releaseLabResourceLedger,
  snapshotLabResourceLedger,
} from "../browser/webgpu-witness/lab-resource-model.js";

const zeroProfile = {
  activeRendererOwners: 0,
  listenerScopes: 0,
  resizeObservers: 0,
  svgRoots: 0,
  threeRenderers: 0,
  mechanicalRenderers: 0,
  rafOwners: 0,
  webgpuConfigured: 0,
};

assert.deepEqual(
  [...LAB_REAL_CYCLE],
  [
    "structural-2d",
    "blueprint-2d",
    "document-2d",
    "classic-3d",
    "mechanical-3d",
    "classic-3d",
    "document-2d",
    "blueprint-2d",
    "structural-2d",
  ],
);
assert.equal(LAB_REAL_CYCLE_REPEATS, 2);
assert.deepEqual(
  [...LAB_RESOURCE_FIELDS],
  [
    "activeRendererOwners",
    "listenerScopes",
    "resizeObservers",
    "svgRoots",
    "threeRenderers",
    "mechanicalRenderers",
    "rafOwners",
    "webgpuConfigured",
  ],
);

const fresh = createLabResourceLedger();
assert.deepEqual(fresh, {
  generation: 0,
  mounts: 0,
  disposals: 0,
  activeMode: null,
  ...zeroProfile,
});

for (const modeId of [
  "structural-2d",
  "blueprint-2d",
  "document-2d",
]) {
  assert.deepEqual(
    labResourceProfileForMode(modeId),
    {
      activeRendererOwners: 1,
      listenerScopes: 1,
      resizeObservers: 0,
      svgRoots: 1,
      threeRenderers: 0,
      mechanicalRenderers: 0,
      rafOwners: 0,
      webgpuConfigured: 0,
    },
  );
}

assert.deepEqual(
  labResourceProfileForMode("classic-3d"),
  {
    activeRendererOwners: 1,
    listenerScopes: 1,
    resizeObservers: 1,
    svgRoots: 0,
    threeRenderers: 1,
    mechanicalRenderers: 0,
    rafOwners: 1,
    webgpuConfigured: 0,
  },
);

assert.deepEqual(
  labResourceProfileForMode("mechanical-3d"),
  {
    activeRendererOwners: 1,
    listenerScopes: 1,
    resizeObservers: 0,
    svgRoots: 0,
    threeRenderers: 0,
    mechanicalRenderers: 1,
    rafOwners: 1,
    webgpuConfigured: 1,
  },
);

assert.deepEqual(
  labResourceProfileForMode("mechanical-3d", { mounted: false }),
  zeroProfile,
);
assert.deepEqual(
  labResourceProfileForMode("unknown-mode"),
  zeroProfile,
);

{
  const ledger = createLabResourceLedger();
  claimLabResourceLedger(ledger, "structural-2d");
  assert.equal(ledger.generation, 1);
  assert.equal(ledger.mounts, 1);
  assert.equal(ledger.disposals, 0);
  assert.equal(ledger.activeMode, "structural-2d");
  assert.equal(ledger.activeRendererOwners, 1);
  assert.equal(ledger.svgRoots, 1);

  const frozen = snapshotLabResourceLedger(ledger);
  assert.equal(Object.isFrozen(frozen), true);
  assert.deepEqual(frozen, ledger);

  const beforeWrongRelease = { ...ledger };
  assert.equal(
    releaseLabResourceLedger(ledger, "blueprint-2d"),
    false,
  );
  assert.deepEqual(ledger, beforeWrongRelease);

  assert.equal(
    releaseLabResourceLedger(ledger, "structural-2d"),
    true,
  );
  assert.deepEqual(ledger, {
    generation: 1,
    mounts: 1,
    disposals: 1,
    activeMode: null,
    ...zeroProfile,
  });

  claimLabResourceLedger(
    ledger,
    "mechanical-3d",
    { mounted: false },
  );
  assert.equal(ledger.generation, 2);
  assert.equal(ledger.mounts, 2);
  assert.equal(ledger.activeMode, "mechanical-3d");
  assert.deepEqual(
    Object.fromEntries(
      LAB_RESOURCE_FIELDS.map((field) => [field, ledger[field]]),
    ),
    zeroProfile,
  );
}

function actualFor(modeId, { mechanicalAvailable = true } = {}) {
  const actual = {
    structuralState: false,
    blueprintState: false,
    documentState: false,
    classicState: false,
    mechanicalState: false,
    structuralSvgRoots: 0,
    blueprintSvgRoots: 0,
    documentSvgRoots: 0,
    classicThreeMounted: false,
    classicCanvasRoots: 0,
    mechanicalCanvasConfigured: false,
  };

  if (modeId === "structural-2d") {
    actual.structuralState = true;
    actual.structuralSvgRoots = 1;
  } else if (modeId === "blueprint-2d") {
    actual.blueprintState = true;
    actual.blueprintSvgRoots = 1;
  } else if (modeId === "document-2d") {
    actual.documentState = true;
    actual.documentSvgRoots = 1;
  } else if (modeId === "classic-3d") {
    actual.classicState = true;
    actual.classicThreeMounted = true;
    actual.classicCanvasRoots = 1;
  } else if (modeId === "mechanical-3d" && mechanicalAvailable) {
    actual.mechanicalState = true;
    actual.mechanicalCanvasConfigured = true;
  }

  return actual;
}

function validAudit(modeId, { mechanicalAvailable = true } = {}) {
  const ledger = createLabResourceLedger();
  claimLabResourceLedger(
    ledger,
    modeId,
    {
      mounted:
        modeId !== "mechanical-3d"
        || mechanicalAvailable,
    },
  );
  return {
    ledger: snapshotLabResourceLedger(ledger),
    actual: Object.freeze(
      actualFor(modeId, { mechanicalAvailable }),
    ),
  };
}

for (const modeId of [
  "structural-2d",
  "blueprint-2d",
  "document-2d",
  "classic-3d",
  "mechanical-3d",
]) {
  assert.doesNotThrow(() => {
    assertLabResourceAudit({
      modeId,
      audit: validAudit(modeId),
      mechanicalAvailable: true,
    });
  });
}

assert.doesNotThrow(() => {
  assertLabResourceAudit({
    modeId: "mechanical-3d",
    audit: validAudit(
      "mechanical-3d",
      { mechanicalAvailable: false },
    ),
    mechanicalAvailable: false,
  });
});

{
  const audit = validAudit("structural-2d");
  const bad = {
    ...audit,
    actual: {
      ...audit.actual,
      blueprintState: true,
    },
  };
  assert.throws(
    () => assertLabResourceAudit({
      modeId: "structural-2d",
      audit: bad,
      mechanicalAvailable: true,
    }),
    /stale state from blueprint-2d/,
  );
}

{
  const audit = validAudit("document-2d");
  const bad = {
    ...audit,
    actual: {
      ...audit.actual,
      documentSvgRoots: 2,
    },
  };
  assert.throws(
    () => assertLabResourceAudit({
      modeId: "document-2d",
      audit: bad,
      mechanicalAvailable: true,
    }),
    /documentSvgRoots=2, expected=1/,
  );
}

{
  const audit = validAudit("classic-3d");
  const bad = {
    ...audit,
    actual: {
      ...audit.actual,
      classicThreeMounted: false,
    },
  };
  assert.throws(
    () => assertLabResourceAudit({
      modeId: "classic-3d",
      audit: bad,
      mechanicalAvailable: true,
    }),
    /Classic Three mount leak\/missing mount/,
  );
}

{
  const audit = validAudit("structural-2d");
  const bad = {
    ...audit,
    actual: {
      ...audit.actual,
      classicCanvasRoots: 1,
    },
  };
  assert.throws(
    () => assertLabResourceAudit({
      modeId: "structural-2d",
      audit: bad,
      mechanicalAvailable: true,
    }),
    /Classic canvas root leak\/missing root/,
  );
}

{
  const audit = validAudit("mechanical-3d");
  const bad = {
    ...audit,
    ledger: {
      ...audit.ledger,
      webgpuConfigured: 0,
    },
  };
  assert.throws(
    () => assertLabResourceAudit({
      modeId: "mechanical-3d",
      audit: bad,
      mechanicalAvailable: true,
    }),
    /Mechanical must own configured WebGPU canvas/,
  );
}

{
  const audit = validAudit(
    "mechanical-3d",
    { mechanicalAvailable: false },
  );
  const bad = {
    ...audit,
    ledger: {
      ...audit.ledger,
      activeRendererOwners: 1,
    },
  };
  assert.throws(
    () => assertLabResourceAudit({
      modeId: "mechanical-3d",
      audit: bad,
      mechanicalAvailable: false,
    }),
    /Mechanical unavailable must not claim resource owner/,
  );
}

{
  const audit = validAudit("blueprint-2d");
  const bad = {
    ...audit,
    ledger: {
      ...audit.ledger,
      activeMode: "document-2d",
    },
  };
  assert.throws(
    () => assertLabResourceAudit({
      modeId: "blueprint-2d",
      audit: bad,
      mechanicalAvailable: true,
    }),
    /ledger activeMode=document-2d, expected=blueprint-2d/,
  );
}

console.log("Web Lab resource ledger executable contract: PASS");
