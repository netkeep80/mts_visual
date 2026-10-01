import assert from "node:assert/strict";
import {
  createLabCycleSelfTestController,
} from "../browser/webgpu-witness/lab-cycle-selftest-controller.js";
import {
  LAB_REAL_CYCLE,
  LAB_REAL_CYCLE_REPEATS,
} from "../browser/webgpu-witness/lab-resource-model.js";

function fakeUi() {
  return {
    visualizationMode: { value: "classic-3d" },
    scene: { value: "fixture" },
    labRunCycleTest: { disabled: false },
    labCycleStatus: { textContent: "" },
  };
}

function auditFor(modeId, ledger) {
  return {
    ledger: {
      generation: ledger.generation,
      mounts: ledger.mounts,
      disposals: ledger.disposals,
      activeMode: modeId,
      activeRendererOwners:
        modeId === "mechanical-3d" ? 1 : 1,
      listenerScopes: 1,
      resizeObservers: modeId === "classic-3d" ? 1 : 0,
      svgRoots: [
        "structural-2d",
        "blueprint-2d",
        "document-2d",
      ].includes(modeId) ? 1 : 0,
      threeRenderers: modeId === "classic-3d" ? 1 : 0,
      mechanicalRenderers:
        modeId === "mechanical-3d" ? 1 : 0,
      rafOwners: [
        "classic-3d",
        "mechanical-3d",
      ].includes(modeId) ? 1 : 0,
      webgpuConfigured:
        modeId === "mechanical-3d" ? 1 : 0,
    },
    actual: {},
  };
}

function controllerFixture({
  cycle = LAB_REAL_CYCLE,
  repeats = LAB_REAL_CYCLE_REPEATS,
  linkCount = 2,
  webGpuDevice = true,
  activateBehavior = null,
  manifestBehavior = null,
  selectedKeyBehavior = null,
  auditBehavior = null,
  mountDelta = 1,
  disposalDelta = 1,
} = {}) {
  const ui = fakeUi();
  const scene = {
    id: "fixture",
    network: {
      links: Array.from(
        { length: linkCount },
        (_, index) => ({ key: String(index) }),
      ),
    },
  };
  let activeMode = "classic-3d";
  let selectedKey = "R";
  let manifest = "manifest-v1";
  const ledger = {
    generation: 10,
    mounts: 20,
    disposals: 19,
  };
  const activations = [];
  const logs = [];
  const finalAudits = [];
  let yieldCount = 0;
  let manifestCalls = 0;
  let selectedKeyCalls = 0;
  let auditCalls = 0;

  async function activateMode(modeId) {
    activations.push(modeId);
    activeMode = modeId;
    ledger.generation += 1;
    ledger.mounts += mountDelta;
    ledger.disposals += disposalDelta;
    if (activateBehavior) {
      await activateBehavior({
        modeId,
        activations,
        ledger,
        ui,
        scene,
      });
    }
  }

  function sceneManifestText() {
    manifestCalls += 1;
    if (manifestBehavior) {
      return manifestBehavior({
        calls: manifestCalls,
        value: manifest,
        setValue: (value) => {
          manifest = value;
        },
      });
    }
    return manifest;
  }

  function getSelectedKey() {
    selectedKeyCalls += 1;
    if (selectedKeyBehavior) {
      return selectedKeyBehavior({
        calls: selectedKeyCalls,
        value: selectedKey,
        setValue: (value) => {
          selectedKey = value;
        },
      });
    }
    return selectedKey;
  }

  function assertModeResources(modeId) {
    auditCalls += 1;
    if (auditBehavior) {
      return auditBehavior({
        modeId,
        calls: auditCalls,
        ledger,
      });
    }
    return auditFor(modeId, ledger);
  }

  const controller = createLabCycleSelfTestController({
    ui,
    cycle,
    repeats,
    getActiveMode: () => activeMode,
    activateMode,
    getSelectedScene: () => scene,
    sceneManifestText,
    getSelectedKey,
    getResourceLedger: () => ledger,
    assertModeResources,
    hasWebGpuDevice: () => webGpuDevice,
    renderResourceAudit: (report) => {
      finalAudits.push(report);
    },
    log: (message) => {
      logs.push(message);
    },
    yieldTick: async () => {
      yieldCount += 1;
    },
  });

  return {
    controller,
    ui,
    scene,
    ledger,
    activations,
    logs,
    finalAudits,
    getYieldCount: () => yieldCount,
  };
}

{
  const fixture = controllerFixture();
  const report = await fixture.controller.run();
  const expectedCycle = [
    ...LAB_REAL_CYCLE,
    ...LAB_REAL_CYCLE,
  ];

  assert.equal(report.status, "PASS");
  assert.equal(report.steps.length, 18);
  assert.deepEqual(
    fixture.activations.slice(0, 18),
    expectedCycle,
  );
  assert.equal(
    fixture.activations.at(-1),
    "classic-3d",
    "original active mode must be restored after PASS",
  );
  assert.equal(fixture.activations.length, 19);
  assert.equal(fixture.getYieldCount(), 18);
  assert.equal(fixture.ui.visualizationMode.value, "classic-3d");
  assert.equal(fixture.ui.labRunCycleTest.disabled, false);
  assert.equal(fixture.controller.isRunning(), false);
  assert.match(
    fixture.ui.labCycleStatus.textContent,
    /^PASS · 18 переходов · WebGPU проверен$/,
  );
  assert.equal(fixture.finalAudits.length, 1);
  assert.deepEqual(fixture.finalAudits[0], report);
  assert.match(fixture.logs.join("\n"), /mode-cycle self-test: PASS/);
}

{
  const fixture = controllerFixture({
    cycle: ["mechanical-3d"],
    repeats: 1,
    webGpuDevice: false,
  });
  const report = await fixture.controller.run();
  assert.equal(report.status, "PASS");
  assert.equal(report.steps.length, 1);
  assert.equal(
    fixture.ui.labCycleStatus.textContent,
    "PASS · 1 переходов · Mechanical без WebGPU device",
  );
}

{
  let releaseActivation;
  const gate = new Promise((resolve) => {
    releaseActivation = resolve;
  });
  let firstActivation = true;
  const fixture = controllerFixture({
    cycle: ["structural-2d"],
    repeats: 1,
    activateBehavior: async () => {
      if (!firstActivation) return;
      firstActivation = false;
      await gate;
    },
  });

  const first = fixture.controller.run();
  assert.equal(fixture.controller.isRunning(), true);
  assert.equal(fixture.ui.labRunCycleTest.disabled, true);
  assert.equal(await fixture.controller.run(), null);

  releaseActivation();
  const report = await first;
  assert.equal(report.status, "PASS");
  assert.equal(fixture.controller.isRunning(), false);
  assert.equal(fixture.ui.labRunCycleTest.disabled, false);
}

{
  const fixture = controllerFixture({ linkCount: 65 });
  await assert.rejects(
    () => fixture.controller.run(),
    /ограничен 64 Links/,
  );
  assert.deepEqual(fixture.activations, []);
  assert.equal(fixture.controller.isRunning(), false);
  assert.equal(fixture.ui.labRunCycleTest.disabled, false);
  assert.equal(fixture.finalAudits.length, 0);
}

{
  let firstCycleActivation = true;
  const fixture = controllerFixture({
    cycle: ["structural-2d"],
    repeats: 1,
    activateBehavior: async ({ ui }) => {
      if (!firstCycleActivation) return;
      firstCycleActivation = false;
      ui.scene.value = "mutated-scene";
    },
  });

  await assert.rejects(
    () => fixture.controller.run(),
    /scene selector changed/,
  );
  assert.equal(fixture.ui.visualizationMode.value, "classic-3d");
  assert.equal(fixture.ui.labRunCycleTest.disabled, false);
  assert.equal(fixture.controller.isRunning(), false);
  assert.equal(fixture.activations.at(-1), "classic-3d");
  assert.equal(fixture.finalAudits[0].status, "FAIL");
  assert.match(
    fixture.finalAudits[0].error,
    /scene selector changed/,
  );
}

{
  const fixture = controllerFixture({
    cycle: ["structural-2d"],
    repeats: 1,
    manifestBehavior: ({ calls }) =>
      calls === 1 ? "manifest-v1" : "manifest-v2",
  });

  await assert.rejects(
    () => fixture.controller.run(),
    /input manifest changed/,
  );
  assert.equal(fixture.ui.labRunCycleTest.disabled, false);
  assert.equal(fixture.finalAudits[0].status, "FAIL");
}

{
  const fixture = controllerFixture({
    cycle: ["structural-2d"],
    repeats: 1,
    selectedKeyBehavior: ({ calls }) =>
      calls === 1 ? "R" : "O",
  });

  await assert.rejects(
    () => fixture.controller.run(),
    /selected Link changed/,
  );
  assert.equal(fixture.ui.labRunCycleTest.disabled, false);
  assert.equal(fixture.finalAudits[0].status, "FAIL");
}

{
  const fixture = controllerFixture({
    cycle: ["structural-2d"],
    repeats: 1,
    mountDelta: 0,
  });

  await assert.rejects(
    () => fixture.controller.run(),
    /mount count delta=0, expected=1/,
  );
  assert.equal(fixture.ui.labRunCycleTest.disabled, false);
  assert.equal(fixture.activations.at(-1), "classic-3d");
}

{
  const fixture = controllerFixture({
    cycle: ["structural-2d"],
    repeats: 1,
    disposalDelta: 0,
  });

  await assert.rejects(
    () => fixture.controller.run(),
    /dispose count before restore=0, expected=1/,
  );
  assert.equal(fixture.ui.labRunCycleTest.disabled, false);
  assert.equal(fixture.activations.at(-1), "classic-3d");
}

{
  const fixture = controllerFixture({
    cycle: ["structural-2d", "blueprint-2d"],
    repeats: 1,
    auditBehavior: ({ modeId, calls, ledger }) => {
      if (calls === 2) {
        throw new Error("synthetic-audit-failure");
      }
      return auditFor(modeId, ledger);
    },
  });

  await assert.rejects(
    () => fixture.controller.run(),
    /synthetic-audit-failure/,
  );
  assert.equal(fixture.finalAudits[0].status, "FAIL");
  assert.equal(fixture.finalAudits[0].steps.length, 1);
  assert.equal(fixture.activations.at(-1), "classic-3d");
  assert.equal(fixture.ui.labRunCycleTest.disabled, false);
  assert.equal(fixture.controller.isRunning(), false);
}

{
  const ui = fakeUi();
  const scene = {
    id: "fixture",
    network: { links: [{ key: "R" }] },
  };
  const controller = createLabCycleSelfTestController({
    ui,
    cycle: ["structural-2d"],
    repeats: 1,
    getActiveMode: () => "classic-3d",
    activateMode: async () => {
      throw new Error("must-not-activate");
    },
    getSelectedScene: () => scene,
    sceneManifestText: () => {
      throw new Error("manifest-capture-failure");
    },
    getSelectedKey: () => "R",
    getResourceLedger: () => ({
      mounts: 0,
      disposals: 0,
    }),
    assertModeResources: () => {
      throw new Error("must-not-audit");
    },
    hasWebGpuDevice: () => true,
    renderResourceAudit: () => {
      throw new Error("must-not-render-audit");
    },
  });

  await assert.rejects(
    () => controller.run(),
    /manifest-capture-failure/,
  );
  assert.equal(controller.isRunning(), false);
  assert.equal(ui.labRunCycleTest.disabled, false);
}

console.log("Web Lab cycle self-test controller executable contract: PASS");
