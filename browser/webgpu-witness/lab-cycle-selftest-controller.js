function assertCycle(condition, message) {
  if (!condition) {
    throw new Error(`mode-cycle: ${message}`);
  }
}

function errorText(error) {
  return error instanceof Error
    ? error.stack ?? error.message
    : String(error);
}

export function createLabCycleSelfTestController({
  ui,
  cycle,
  repeats,
  getActiveMode,
  activateMode,
  getSelectedScene,
  sceneManifestText,
  getSelectedKey,
  getResourceLedger,
  assertModeResources,
  hasWebGpuDevice,
  renderResourceAudit,
  log = () => {},
  yieldTick = () => new Promise((resolve) => setTimeout(resolve, 0)),
}) {
  let running = false;

  async function run() {
    if (running) return null;

    const scene = getSelectedScene();
    if (scene.network.links.length > 64) {
      throw new Error(
        "mode-cycle self-test ограничен 64 Links; выберите меньший fixture",
      );
    }

    const originalMode =
      getActiveMode() ?? ui.visualizationMode.value;
    const originalModeSelect = ui.visualizationMode.value;
    const originalSceneValue = ui.scene.value;
    const originalManifest = sceneManifestText(scene);
    const originalSelectedKey = getSelectedKey();
    const startLedger = getResourceLedger();
    const startMounts = startLedger.mounts;
    const startDisposals = startLedger.disposals;

    const report = [];
    let finalSelfTest = null;

    running = true;
    ui.labRunCycleTest.disabled = true;
    ui.labCycleStatus.textContent = "выполняется…";

    try {
      for (let iteration = 0; iteration < repeats; iteration += 1) {
        for (const modeId of cycle) {
          ui.visualizationMode.value = modeId;
          await activateMode(modeId);
          await yieldTick();

          assertCycle(
            ui.scene.value === originalSceneValue,
            `${modeId}: scene selector changed`,
          );
          assertCycle(
            sceneManifestText(scene) === originalManifest,
            `${modeId}: input manifest changed`,
          );
          assertCycle(
            getSelectedKey() === originalSelectedKey,
            `${modeId}: selected Link changed`,
          );

          const audit = assertModeResources(modeId, scene);
          report.push({
            iteration: iteration + 1,
            modeId,
            generation: audit.ledger.generation,
            owners: audit.ledger.activeRendererOwners,
            svgRoots: audit.ledger.svgRoots,
            threeRenderers: audit.ledger.threeRenderers,
            mechanicalRenderers: audit.ledger.mechanicalRenderers,
            webgpuConfigured: audit.ledger.webgpuConfigured,
          });
        }
      }

      const expectedActivations = cycle.length * repeats;
      const endLedger = getResourceLedger();
      assertCycle(
        endLedger.mounts - startMounts === expectedActivations,
        `mount count delta=${endLedger.mounts - startMounts}, expected=${expectedActivations}`,
      );
      assertCycle(
        endLedger.disposals - startDisposals === expectedActivations,
        `dispose count before restore=${endLedger.disposals - startDisposals}, expected=${expectedActivations}`,
      );

      ui.labCycleStatus.textContent = hasWebGpuDevice()
        ? `PASS · ${expectedActivations} переходов · WebGPU проверен`
        : `PASS · ${expectedActivations} переходов · Mechanical без WebGPU device`;
      log(
        `mode-cycle self-test: PASS · переходов=${expectedActivations} · input=${scene.id}`,
      );
      finalSelfTest = {
        status: "PASS",
        steps: report,
      };
    } catch (error) {
      ui.labCycleStatus.textContent =
        "FAIL · см. resource ledger";
      log(
        `mode-cycle self-test: FAIL — ${errorText(error)}`,
      );
      finalSelfTest = {
        status: "FAIL",
        error:
          error instanceof Error
            ? error.message
            : String(error),
        steps: report,
      };
      throw error;
    } finally {
      ui.visualizationMode.value = originalModeSelect;
      try {
        await activateMode(originalMode);
      } catch (restoreError) {
        log(
          `ОШИБКА восстановления режима после mode-cycle — ${errorText(restoreError)}`,
        );
      }
      running = false;
      ui.labRunCycleTest.disabled = false;
      renderResourceAudit(finalSelfTest);
    }

    return finalSelfTest;
  }

  return Object.freeze({
    isRunning: () => running,
    run,
  });
}
