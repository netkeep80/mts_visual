function addListener(registry, element, type, handler, options) {
  element.addEventListener(type, handler, options);
  registry.push({ element, type, handler, options });
}

function removeListeners(registry) {
  for (const { element, type, handler, options } of registry.splice(0)) {
    element.removeEventListener(type, handler, options);
  }
}

function maxStructuralDepth(layout) {
  return layout.positions.reduce(
    (maximum, position) => Math.max(maximum, position.depth),
    0,
  );
}

export function createStructural2DController({
  ui,
  core,
  getSelectedScene,
  setSelectedKey,
  updateSharedDiagnostics,
  controlNumber,
  downloadTextFile,
  buildInfo,
  createOption,
  log = () => {},
}) {
  let state = null;
  let controlsMounted = false;
  const controlListeners = [];

  function selectedOptions() {
    const rootKey = ui.structuralRoot.value || undefined;
    return Object.freeze({
      ...(rootKey === undefined ? {} : { rootKey }),
      layerSpacing: controlNumber(
        ui.structuralSpacing,
        "шаг структурных слоёв",
        64,
        240,
      ),
      minimumNodeSpacing: controlNumber(
        ui.structuralNodeSpacing,
        "минимальное расстояние Structural",
        36,
        160,
      ),
      optimizeCrossings: ui.structuralOptimize.checked,
      crossingPasses: 5,
      crossingEvaluations: 240,
    });
  }

  function refreshControlLabels() {
    const options = selectedOptions();
    ui.structuralSpacingValue.value =
      options.layerSpacing.toFixed(0);
    ui.structuralNodeSpacingValue.value =
      options.minimumNodeSpacing.toFixed(0);
  }

  function refreshRootOptions(network) {
    const previous = ui.structuralRoot.value;
    ui.structuralRoot.replaceChildren();

    const none = createOption();
    none.value = "";
    none.textContent = "Без явного корня";
    ui.structuralRoot.appendChild(none);

    for (
      const link of [...network.links]
        .sort((left, right) => left.key.localeCompare(right.key))
    ) {
      const option = createOption();
      option.value = link.key;
      option.textContent = link.key;
      ui.structuralRoot.appendChild(option);
    }

    ui.structuralRoot.value = network.links.some(
      (link) => link.key === previous,
    )
      ? previous
      : "";
  }

  function viewportSize() {
    return {
      width: Math.max(1, ui.structuralViewport.clientWidth),
      height: Math.max(1, ui.structuralViewport.clientHeight),
    };
  }

  function applyViewport(target = state) {
    if (!target?.viewport) return;
    const svg = ui.structuralViewport.querySelector("svg");
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
    if (!target?.layout) return;
    const { width, height } = viewportSize();
    target.viewport = core.fitBlueprintViewport(
      target.layout.bounds,
      width,
      height,
      { padding: 30, minScale: 0.05, maxScale: 16 },
    );
    applyViewport(target);
  }

  function updateDiagnostics(target) {
    const maxDepth = maxStructuralDepth(target.layout);
    ui.structuralComponents.textContent =
      `${target.layout.components.length} / ${maxDepth + 1}`;
    ui.structuralCrossings.textContent =
      `${target.layout.metrics.crossingsBefore} → ${target.layout.metrics.crossingsAfter}`;
    ui.structuralOptimizer.textContent =
      `${target.layout.metrics.evaluations} проверок · ${target.layout.metrics.passes} проходов`;
    ui.structuralLinkCount.textContent =
      String(target.network.links.length);
    updateSharedDiagnostics();
  }

  function render(target = state, { fit: shouldFit = false } = {}) {
    if (!target) return;

    target.options = selectedOptions();
    target.layout = core.layoutStructural2D(
      target.network,
      target.options,
    );
    ui.structuralViewport.innerHTML =
      core.serializeStructural2DSvg(
        target.network,
        target.layout,
      );

    const svg = ui.structuralViewport.querySelector("svg");
    if (!svg) {
      throw new Error("Structural 2D renderer не создал SVG");
    }
    svg.setAttribute(
      "aria-label",
      `Structural 2D: ${target.scene.label}`,
    );

    updateDiagnostics(target);
    if (shouldFit || !target.viewport) fit(target);
    else applyViewport(target);
  }

  function pointerPoint(event) {
    const rect =
      ui.structuralViewport.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function exportSvg() {
    if (!state?.layout) return false;

    const text = core.serializeStructural2DSvg(
      state.network,
      state.layout,
    );
    downloadTextFile(
      text,
      `mts-visual-structural-${state.scene.id}-${String(buildInfo.mainSha).slice(0, 12)}.svg`,
      "image/svg+xml;charset=utf-8",
    );
    log(
      `Structural SVG сохранён: сцена=${state.scene.label}, пересечения=${state.layout.metrics.crossingsAfter}`,
    );
    return true;
  }

  function diagnosticDetail(scene = getSelectedScene()) {
    if (!state?.layout || state.scene !== scene) return null;

    const maxDepth = maxStructuralDepth(state.layout);
    return Object.freeze({
      scc: state.layout.components.length,
      layers: maxDepth + 1,
      crossingsBefore: state.layout.metrics.crossingsBefore,
      crossingsAfter: state.layout.metrics.crossingsAfter,
      evaluations: state.layout.metrics.evaluations,
      passes: state.layout.metrics.passes,
      bounds: state.layout.bounds,
    });
  }

  function mount() {
    const scene = getSelectedScene();
    refreshRootOptions(scene.network);
    ui.structuralRoot.value = scene.hints?.rootKey ?? "";
    refreshControlLabels();

    const target = {
      scene,
      network: scene.network,
      options: null,
      layout: null,
      viewport: null,
      pointerId: null,
      panPointer: null,
      listeners: [],
      cleaned: false,
    };
    state = target;
    render(target, { fit: true });

    addListener(
      target.listeners,
      ui.structuralViewport,
      "pointerdown",
      (event) => {
        if (event.button !== 0) return;

        const node = event.target.closest?.(
          '[data-role="structural-node"]',
        );
        const key = node?.getAttribute("data-link-key");
        if (key) setSelectedKey(key);

        target.pointerId = event.pointerId;
        target.panPointer = {
          x: event.clientX,
          y: event.clientY,
        };
        ui.structuralViewport.setPointerCapture?.(
          event.pointerId,
        );
        ui.structuralViewport.classList.add("dragging");
        event.preventDefault();
      },
    );

    addListener(
      target.listeners,
      ui.structuralViewport,
      "pointermove",
      (event) => {
        if (
          target.pointerId !== event.pointerId
          || !target.panPointer
        ) {
          return;
        }

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
      },
    );

    const finishPointer = (event) => {
      if (target.pointerId !== event.pointerId) return;
      target.pointerId = null;
      target.panPointer = null;
      ui.structuralViewport.classList.remove("dragging");
    };
    addListener(
      target.listeners,
      ui.structuralViewport,
      "pointerup",
      finishPointer,
    );
    addListener(
      target.listeners,
      ui.structuralViewport,
      "pointercancel",
      finishPointer,
    );

    addListener(
      target.listeners,
      ui.structuralViewport,
      "wheel",
      (event) => {
        const factor = Math.exp(-event.deltaY * 0.001);
        target.viewport = core.zoomBlueprintViewport(
          target.viewport,
          factor,
          pointerPoint(event),
          { minScale: 0.05, maxScale: 24 },
        );
        applyViewport(target);
        event.preventDefault();
      },
      { passive: false },
    );

    log(
      `Structural 2D запущен: сцена=${scene.label}, SCC=${target.layout.components.length}, пересечения=${target.layout.metrics.crossingsBefore}→${target.layout.metrics.crossingsAfter}`,
    );

    return () => {
      if (target.cleaned) return;
      target.cleaned = true;
      removeListeners(target.listeners);
      ui.structuralViewport.classList.remove("dragging");
      ui.structuralViewport.replaceChildren();
      if (state === target) state = null;
    };
  }

  function mountControls() {
    if (controlsMounted) return;
    controlsMounted = true;

    for (const control of [
      ui.structuralSpacing,
      ui.structuralNodeSpacing,
    ]) {
      addListener(
        controlListeners,
        control,
        "input",
        () => {
          refreshControlLabels();
          if (state) render(state, { fit: true });
        },
      );
    }

    addListener(
      controlListeners,
      ui.structuralRoot,
      "change",
      () => {
        if (state) render(state, { fit: true });
      },
    );

    addListener(
      controlListeners,
      ui.structuralOptimize,
      "change",
      () => {
        if (state) render(state, { fit: true });
      },
    );

    addListener(
      controlListeners,
      ui.structuralFit,
      "click",
      () => {
        if (state) fit(state);
      },
    );

    addListener(
      controlListeners,
      ui.structuralReset,
      "click",
      () => {
        if (state) render(state, { fit: true });
      },
    );

    addListener(
      controlListeners,
      ui.structuralExport,
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
    state: () => state,
  });
}
