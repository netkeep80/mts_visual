function addListener(registry, element, type, handler, options) {
  element.addEventListener(type, handler, options);
  registry.push({ element, type, handler, options });
}

function removeListeners(registry) {
  for (const { element, type, handler, options } of registry.splice(0)) {
    element.removeEventListener(type, handler, options);
  }
}

function errorText(error) {
  return error instanceof Error
    ? error.stack ?? error.message
    : String(error);
}

export function createClassic3DController({
  ui,
  core,
  threeVisual,
  getSelectedScene,
  setSelectedKey,
  updateSharedDiagnostics,
  controlNumber,
  formatNumber,
  requestRemount,
  setIntervalFn,
  clearIntervalFn,
  scheduleFrame,
  isFullscreen,
  requestFullscreen,
  exitFullscreen,
  log = () => {},
}) {
  let state = null;
  let controlsMounted = false;
  const controlListeners = [];

  function selectedOptions() {
    return Object.freeze({
      charge: controlNumber(
        ui.classicCharge,
        "отталкивание центров",
        0,
        3,
      ),
      restLength: controlNumber(
        ui.classicRestLength,
        "длина покоя Classic",
        0.25,
        8,
      ),
      springStiffness: controlNumber(
        ui.classicStiffness,
        "жёсткость пружин Classic",
        0,
        0.30,
      ),
      damping: controlNumber(
        ui.classicDamping,
        "затухание Classic",
        0.50,
        0.99,
      ),
      timeStep: controlNumber(
        ui.classicTimeStep,
        "шаг времени Classic",
        0.02,
        0.50,
      ),
    });
  }

  function refreshControlLabels() {
    const options = selectedOptions();
    ui.classicChargeValue.value =
      options.charge.toFixed(2);
    ui.classicRestLengthValue.value =
      options.restLength.toFixed(2);
    ui.classicStiffnessValue.value =
      options.springStiffness.toFixed(3);
    ui.classicDampingValue.value =
      options.damping.toFixed(2);
    ui.classicTimeStepValue.value =
      options.timeStep.toFixed(2);
  }

  function presentationNetwork(network) {
    return {
      links: network.links.map((link) => {
        const copy = { ...link };
        if (ui.classicLabels.checked) {
          copy.label = link.label ?? link.key;
        } else {
          delete copy.label;
        }
        return copy;
      }),
    };
  }

  function diagnosticDetail(scene = getSelectedScene()) {
    if (!state || state.scene !== scene) return null;

    const snapshot =
      core.snapshotLivePhysics3D(state.controller);
    const linkCount = state.controller.model.keys.length;
    return Object.freeze({
      tick: snapshot.tick,
      awake: snapshot.awake,
      maxVelocity: snapshot.maxVelocity,
      pinnedKeys: snapshot.pinnedKeys,
      springs: state.controller.model.springs.length,
      chargePairs: linkCount * (linkCount - 1) / 2,
    });
  }

  function updateDiagnostics(target = state) {
    if (!target) return;

    const snapshot =
      core.snapshotLivePhysics3D(target.controller);
    const linkCount = target.controller.model.keys.length;
    const chargePairs = linkCount * (linkCount - 1) / 2;

    ui.classicTick.textContent =
      `${snapshot.tick} · ${snapshot.awake ? "активен" : "покой"}`;
    ui.classicEvaluations.textContent =
      `${target.controller.model.springs.length} / ${chargePairs}`;
    ui.classicMaxVelocity.textContent =
      formatNumber(snapshot.maxVelocity);
    ui.classicPinned.textContent =
      String(snapshot.pinnedKeys.length);

    updateSharedDiagnostics();
  }

  function applyPhysicsControls() {
    refreshControlLabels();
    if (!state) return;

    const options = selectedOptions();
    state.options = options;
    core.setLivePhysics3DOptions(
      state.controller,
      options,
    );
    if (!state.paused) {
      threeVisual.setVisualThreeLivePaused(
        ui.classicViewport,
        false,
      );
    }
    updateDiagnostics(state);
  }

  function fit() {
    if (!state) return false;
    threeVisual.fitVisualThreeRenderer(
      ui.classicViewport,
    );
    return true;
  }

  function togglePause() {
    if (!state) return false;

    state.paused = !state.paused;
    threeVisual.setVisualThreeLivePaused(
      ui.classicViewport,
      state.paused,
    );
    ui.classicPause.textContent =
      state.paused ? "Продолжить" : "Пауза";
    updateDiagnostics(state);
    return true;
  }

  function remount(reason, errorPrefix) {
    if (!state) return;
    Promise.resolve()
      .then(() => requestRemount())
      .catch((error) => {
        log(
          `${errorPrefix} — ${errorText(error)}`,
        );
      });
  }

  async function toggleFullscreen() {
    try {
      if (isFullscreen()) await exitFullscreen();
      else await requestFullscreen();
    } catch (error) {
      log(
        `ОШИБКА полноэкранного режима Classic 3D — ${errorText(error)}`,
      );
    }
  }

  function handleFullscreenChange(active) {
    ui.classicFullscreen.textContent = active
      ? "Выйти из полноэкранного режима"
      : "На весь экран";
    if (state) {
      scheduleFrame(() => {
        fit();
      });
    }
  }

  function mount() {
    const scene = getSelectedScene();
    const network = presentationNetwork(scene.network);
    const options = selectedOptions();
    const initialState =
      core.createInitialPhysics3DState(
        network,
        { radius: 3 },
      );
    const physicsController =
      core.createLivePhysics3D(
        network,
        initialState,
        options,
      );

    const target = {
      scene,
      network,
      controller: physicsController,
      options,
      paused: false,
      diagnosticsTimer: null,
      cleaned: false,
    };
    state = target;

    refreshControlLabels();
    ui.classicPause.textContent = "Пауза";

    threeVisual.createVisualThreeLiveRenderer(
      ui.classicViewport,
      network,
      physicsController,
      {
        samples: 18,
        nodeRadius: 0.13,
        onActivateKey: (key) => {
          setSelectedKey(key);
          log(`Classic 3D: выбрана связь ${key}`);
        },
      },
    );

    target.diagnosticsTimer = setIntervalFn(
      () => {
        if (state === target && !target.cleaned) {
          updateDiagnostics(target);
        }
      },
      200,
    );
    updateDiagnostics(target);

    log(
      `Classic 3D запущен: сцена=${scene.label}, связей=${network.links.length}, пружин=${physicsController.model.springs.length}, пар отталкивания=${network.links.length * (network.links.length - 1) / 2}`,
    );

    return () => {
      if (target.cleaned) return;
      target.cleaned = true;
      if (target.diagnosticsTimer !== null) {
        clearIntervalFn(target.diagnosticsTimer);
        target.diagnosticsTimer = null;
      }
      threeVisual.destroyVisualThreeRenderer(
        ui.classicViewport,
      );
      ui.classicViewport.replaceChildren();
      if (state === target) state = null;
    };
  }

  function mountControls() {
    if (controlsMounted) return;
    controlsMounted = true;

    for (const control of [
      ui.classicCharge,
      ui.classicRestLength,
      ui.classicStiffness,
      ui.classicDamping,
      ui.classicTimeStep,
    ]) {
      addListener(
        controlListeners,
        control,
        "input",
        applyPhysicsControls,
      );
    }

    addListener(
      controlListeners,
      ui.classicLabels,
      "change",
      () => {
        remount(
          "labels",
          "ОШИБКА обновления подписей Classic 3D",
        );
      },
    );

    addListener(
      controlListeners,
      ui.classicPause,
      "click",
      togglePause,
    );

    addListener(
      controlListeners,
      ui.classicReset,
      "click",
      () => {
        remount(
          "reset",
          "ОШИБКА сброса Classic 3D",
        );
      },
    );

    addListener(
      controlListeners,
      ui.classicFit,
      "click",
      fit,
    );

    addListener(
      controlListeners,
      ui.classicFullscreen,
      "click",
      () => {
        void toggleFullscreen();
      },
    );
  }

  function disposeControls() {
    removeListeners(controlListeners);
    controlsMounted = false;
  }

  return Object.freeze({
    applyPhysicsControls,
    diagnosticDetail,
    disposeControls,
    fit,
    handleFullscreenChange,
    isMounted: () => state !== null,
    mount,
    mountControls,
    state: () => state,
    toggleFullscreen,
    togglePause,
    updateDiagnostics,
  });
}
