function addListener(registry, element, type, handler, options) {
  element.addEventListener(type, handler, options);
  registry.push({ element, type, handler, options });
}

function removeListeners(registry) {
  for (const { element, type, handler, options } of registry.splice(0)) {
    element.removeEventListener(type, handler, options);
  }
}

export function createBlueprint2DController({
  ui,
  core,
  getSelectedScene,
  setSelectedKey,
  updateSharedDiagnostics,
  controlNumber,
  downloadTextFile,
  buildInfo,
  log = () => {},
}) {
  let state = null;
  let controlsMounted = false;
  const controlListeners = [];

  function selectedOptions() {
    const spacing = controlNumber(
      ui.blueprintSpacing,
      "шаг Blueprint",
      48,
      220,
    );
    const loopRadius = controlNumber(
      ui.blueprintLoopRadius,
      "радиус самопетли Blueprint",
      12,
      100,
    );
    const clearance = controlNumber(
      ui.blueprintClearance,
      "отступ концов Blueprint",
      0,
      0.30,
    );
    return Object.freeze({
      spacing,
      loopRadius,
      clearance,
    });
  }

  function refreshControlLabels() {
    const options = selectedOptions();
    ui.blueprintSpacingValue.value =
      options.spacing.toFixed(0);
    ui.blueprintLoopRadiusValue.value =
      options.loopRadius.toFixed(0);
    ui.blueprintClearanceValue.value =
      options.clearance.toFixed(2);
  }

  function presentationNetwork(network) {
    return {
      links: network.links.map((link) => {
        const copy = { ...link };
        if (ui.blueprintLabels.checked) {
          copy.label = link.label ?? link.key;
        } else {
          delete copy.label;
        }
        return copy;
      }),
    };
  }

  function viewportSize() {
    return {
      width: Math.max(1, ui.blueprintViewport.clientWidth),
      height: Math.max(1, ui.blueprintViewport.clientHeight),
    };
  }

  function applyViewport(target = state) {
    if (!target?.viewport) return;
    const svg = ui.blueprintViewport.querySelector("svg");
    if (!svg) return;

    const { width, height } = viewportSize();
    const { scale, panX, panY } = target.viewport;
    svg.setAttribute(
      "viewBox",
      [
        -panX / scale,
        -panY / scale,
        width / scale,
        height / scale,
      ]
        .map((value) => Number(value.toFixed(9)))
        .join(" "),
    );
    svg.setAttribute("preserveAspectRatio", "none");
  }

  function fit(target = state) {
    if (!target?.svgScene) return;
    const { width, height } = viewportSize();
    target.viewport = core.fitBlueprintViewport(
      target.svgScene.bounds,
      width,
      height,
      { padding: 28, minScale: 0.05, maxScale: 12 },
    );
    applyViewport(target);
  }

  function render(target = state, { fit: shouldFit = false } = {}) {
    if (!target) return;

    const options = selectedOptions();
    const network = presentationNetwork(target.sourceNetwork);

    target.geometry = core.buildBlueprintGeometry(
      network,
      target.positions,
      {
        spacing: options.spacing,
        loopRadius: options.loopRadius,
        startOffsetFraction: options.clearance,
        endOffsetFraction: options.clearance,
      },
    );
    target.svgScene = core.buildBlueprintSvgScene(
      network,
      target.geometry,
      { padding: 36 },
    );

    ui.blueprintViewport.innerHTML =
      core.serializeBlueprintSvg(target.svgScene);
    const svg = ui.blueprintViewport.querySelector("svg");
    if (!svg) {
      throw new Error("Blueprint renderer не создал SVG");
    }

    svg.setAttribute(
      "aria-label",
      `Blueprint 2D: ${target.scene.label}`,
    );
    svg
      .querySelectorAll('[data-role="blueprint-center"]')
      .forEach((center) => {
        center.setAttribute("tabindex", "0");
      });

    if (shouldFit || !target.viewport) fit(target);
    else applyViewport(target);

    updateSharedDiagnostics();
  }

  function resetPositions(target = state) {
    if (!target) return;
    const options = selectedOptions();
    target.positions = core.createBlueprintInitialPositions(
      target.sourceNetwork,
      { spacing: options.spacing },
    );
    render(target, { fit: true });
  }

  function pointerPoint(event) {
    const rect = ui.blueprintViewport.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function exportSvg() {
    if (!state?.svgScene) return false;

    const text = core.serializeBlueprintSvg(state.svgScene);
    downloadTextFile(
      text,
      `mts-visual-blueprint-${state.scene.id}-${String(buildInfo.mainSha).slice(0, 12)}.svg`,
      "image/svg+xml;charset=utf-8",
    );
    log(
      `Blueprint SVG сохранён: сцена=${state.scene.label}, связей=${state.sourceNetwork.links.length}`,
    );
    return true;
  }

  function diagnosticDetail(scene = getSelectedScene()) {
    if (!state?.svgScene || state.scene !== scene) return null;
    return Object.freeze({
      positions: state.positions.length,
      bounds: state.svgScene.bounds,
      viewport: state.viewport,
    });
  }

  function mount() {
    const scene = getSelectedScene();
    const options = selectedOptions();
    const target = {
      scene,
      sourceNetwork: scene.network,
      positions: core.createBlueprintInitialPositions(
        scene.network,
        { spacing: options.spacing },
      ),
      viewport: null,
      geometry: null,
      svgScene: null,
      dragKey: null,
      panPointer: null,
      pointerId: null,
      listeners: [],
      cleaned: false,
    };
    state = target;

    refreshControlLabels();
    render(target, { fit: true });

    addListener(
      target.listeners,
      ui.blueprintViewport,
      "pointerdown",
      (event) => {
        if (event.button !== 0) return;

        const center = event.target.closest?.(
          '[data-role="blueprint-center"]',
        );
        target.pointerId = event.pointerId;
        ui.blueprintViewport.setPointerCapture?.(
          event.pointerId,
        );
        ui.blueprintViewport.classList.add("dragging");

        if (center) {
          target.dragKey = center.getAttribute(
            "data-link-key",
          );
          if (target.dragKey) {
            setSelectedKey(target.dragKey);
          }
          target.panPointer = null;
        } else {
          target.dragKey = null;
          target.panPointer = {
            x: event.clientX,
            y: event.clientY,
          };
        }
        event.preventDefault();
      },
    );

    addListener(
      target.listeners,
      ui.blueprintViewport,
      "pointermove",
      (event) => {
        if (target.pointerId !== event.pointerId) return;

        if (target.dragKey) {
          const world = core.blueprintScreenToWorld(
            target.viewport,
            pointerPoint(event),
          );
          target.positions = core.moveBlueprintPosition(
            target.positions,
            target.dragKey,
            world,
          );
          render(target);
          event.preventDefault();
          return;
        }

        if (target.panPointer) {
          const dx = event.clientX - target.panPointer.x;
          const dy = event.clientY - target.panPointer.y;
          target.panPointer = {
            x: event.clientX,
            y: event.clientY,
          };
          target.viewport = core.panBlueprintViewport(
            target.viewport,
            dx,
            dy,
          );
          applyViewport(target);
          event.preventDefault();
        }
      },
    );

    const finishPointer = (event) => {
      if (target.pointerId !== event.pointerId) return;
      target.pointerId = null;
      target.dragKey = null;
      target.panPointer = null;
      ui.blueprintViewport.classList.remove("dragging");
    };
    addListener(
      target.listeners,
      ui.blueprintViewport,
      "pointerup",
      finishPointer,
    );
    addListener(
      target.listeners,
      ui.blueprintViewport,
      "pointercancel",
      finishPointer,
    );

    addListener(
      target.listeners,
      ui.blueprintViewport,
      "wheel",
      (event) => {
        const factor = Math.exp(-event.deltaY * 0.001);
        target.viewport = core.zoomBlueprintViewport(
          target.viewport,
          factor,
          pointerPoint(event),
          { minScale: 0.05, maxScale: 20 },
        );
        applyViewport(target);
        event.preventDefault();
      },
      { passive: false },
    );

    log(
      `Blueprint 2D запущен: сцена=${scene.label}, связей=${scene.network.links.length}`,
    );

    return () => {
      if (target.cleaned) return;
      target.cleaned = true;
      removeListeners(target.listeners);
      ui.blueprintViewport.classList.remove("dragging");
      ui.blueprintViewport.replaceChildren();
      if (state === target) state = null;
    };
  }

  function mountControls() {
    if (controlsMounted) return;
    controlsMounted = true;

    for (const control of [
      ui.blueprintSpacing,
      ui.blueprintLoopRadius,
      ui.blueprintClearance,
    ]) {
      addListener(
        controlListeners,
        control,
        "input",
        () => {
          refreshControlLabels();
          if (!state) return;

          if (control === ui.blueprintSpacing) {
            state.positions =
              core.createBlueprintInitialPositions(
                state.sourceNetwork,
                { spacing: selectedOptions().spacing },
              );
            render(state, { fit: true });
          } else {
            render(state);
          }
        },
      );
    }

    addListener(
      controlListeners,
      ui.blueprintLabels,
      "change",
      () => {
        if (state) render(state);
      },
    );

    addListener(
      controlListeners,
      ui.blueprintFit,
      "click",
      () => {
        if (state) fit(state);
      },
    );

    addListener(
      controlListeners,
      ui.blueprintReset,
      "click",
      () => {
        resetPositions();
      },
    );

    addListener(
      controlListeners,
      ui.blueprintExport,
      "click",
      () => {
        exportSvg();
      },
    );
  }

  function disposeControls() {
    removeListeners(controlListeners);
    controlsMounted = false;
  }

  return Object.freeze({
    diagnosticDetail,
    disposeControls,
    exportSvg,
    fit,
    isMounted: () => state !== null,
    mount,
    mountControls,
    render: (options) => render(state, options),
    resetPositions: () => resetPositions(state),
    state: () => state,
  });
}
