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

export function createDocument2DController({
  ui,
  core,
  getSelectedScene,
  setSelectedKey,
  updateSharedDiagnostics,
  sceneInputManifestText,
  sha256Text,
  downloadTextFile,
  buildInfo,
  createOption,
  log = () => {},
}) {
  let state = null;
  let controlsMounted = false;
  const controlListeners = [];

  function isCurrent(target, generation = target?.digestGeneration) {
    return Boolean(
      target
      && state === target
      && !target.cleaned
      && target.digestGeneration === generation,
    );
  }

  function selectedOptions() {
    const rootKey = ui.documentRoot.value || undefined;
    return Object.freeze({
      profile: ui.documentProfile.value,
      strategy: ui.documentStrategy.value,
      ...(rootKey === undefined ? {} : { rootKey }),
    });
  }

  function refreshRootOptions(network) {
    const previous = ui.documentRoot.value;
    ui.documentRoot.replaceChildren();

    const none = createOption();
    none.value = "";
    none.textContent = "Без явного корня";
    ui.documentRoot.appendChild(none);

    for (
      const link of [...network.links]
        .sort((left, right) => left.key.localeCompare(right.key))
    ) {
      const option = createOption();
      option.value = link.key;
      option.textContent = link.key;
      ui.documentRoot.appendChild(option);
    }

    ui.documentRoot.value = network.links.some(
      (link) => link.key === previous,
    )
      ? previous
      : "";
  }

  function viewportSize() {
    return {
      width: Math.max(1, ui.documentViewport.clientWidth),
      height: Math.max(1, ui.documentViewport.clientHeight),
    };
  }

  function applyViewport(target = state) {
    if (!target?.viewport) return;
    const svg = ui.documentViewport.querySelector("svg");
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
      { padding: 28, minScale: 0.05, maxScale: 16 },
    );
    applyViewport(target);
  }

  function updateDiagnostics(target) {
    const before = target.layout.metrics.qualityBefore;
    const after = target.layout.metrics.qualityAfter;

    ui.documentSeed.textContent =
      `${target.layout.metrics.seedStrategy} · ${target.layout.metrics.seedVariant} · ${target.layout.metrics.seedCandidates} кандидатов`;
    ui.documentCrossings.textContent =
      `${before.crossings} → ${after.crossings}`
      + (
        target.layout.metrics.zeroCrossingFound
          ? " · найден 0-crossing"
          : ""
      );
    ui.documentOverlaps.textContent =
      `центры ${after.centerOverlaps} · подписи ${after.labelOverlaps}`;
    ui.documentOptimizer.textContent =
      `${target.layout.metrics.optimizerEvaluations} проверок · ${target.layout.metrics.optimizerPasses} проходов`;
    ui.documentDigest.textContent = target.outputDigest
      ? target.outputDigest.slice(0, 16) + "…"
      : target.digestError
        ? "недоступен"
        : "вычисляется…";

    updateSharedDiagnostics();
  }

  function scheduleDigest(target, svgText, generation) {
    Promise.resolve()
      .then(() => sha256Text(svgText))
      .then((digest) => {
        if (!isCurrent(target, generation)) return;
        target.outputDigest = digest;
        target.digestError = null;
        updateDiagnostics(target);
      })
      .catch((error) => {
        if (!isCurrent(target, generation)) return;
        target.outputDigest = null;
        target.digestError = error;
        updateDiagnostics(target);
        log(
          `ОШИБКА SHA-256 Document SVG — ${errorText(error)}`,
        );
      });
  }

  function render(target = state, { fit: shouldFit = false } = {}) {
    if (!target) return;

    target.options = selectedOptions();
    target.layout = core.layoutDocument2D(
      target.network,
      target.options,
    );
    target.svgText = core.serializeDocument2DSvg(
      target.network,
      target.layout,
    );
    target.outputDigest = null;
    target.digestError = null;
    target.digestGeneration += 1;
    const generation = target.digestGeneration;
    const svgText = target.svgText;

    ui.documentViewport.innerHTML = svgText;
    const svg = ui.documentViewport.querySelector("svg");
    if (!svg) {
      throw new Error("Document 2D renderer не создал SVG");
    }
    svg.setAttribute(
      "aria-label",
      `Document 2D: ${target.scene.label} · ${target.layout.profile}`,
    );

    updateDiagnostics(target);
    if (shouldFit || !target.viewport) fit(target);
    else applyViewport(target);

    scheduleDigest(target, svgText, generation);
  }

  function pointerPoint(event) {
    const rect = ui.documentViewport.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function svgFilename(target = state) {
    if (!target?.layout) {
      throw new Error("Document 2D ещё не отрендерен");
    }
    return (
      `mts-visual-document-${target.scene.id}-`
      + `${target.layout.profile}-`
      + `${String(buildInfo.mainSha).slice(0, 12)}.svg`
    );
  }

  function exportSvg() {
    if (!state?.layout || !state.svgText) return false;

    downloadTextFile(
      state.svgText,
      svgFilename(state),
      "image/svg+xml;charset=utf-8",
    );
    log(
      `Document SVG сохранён: сцена=${state.scene.label}, профиль=${state.layout.profile}, seed=${state.layout.metrics.seedStrategy}, качество=${state.layout.metrics.qualityAfter.score}`,
    );
    return true;
  }

  async function createManifest(target = state) {
    if (!target?.layout || !target.svgText) {
      throw new Error("Document 2D ещё не отрендерен");
    }

    const snapshot = Object.freeze({
      scene: target.scene,
      layout: target.layout,
      options: target.options,
      svgText: target.svgText,
      generation: target.digestGeneration,
      cachedOutputDigest: target.outputDigest,
    });

    const inputText = sceneInputManifestText(snapshot.scene);
    const inputDigest = await sha256Text(inputText);
    const outputDigest =
      snapshot.cachedOutputDigest
      ?? await sha256Text(snapshot.svgText);

    if (isCurrent(target, snapshot.generation)) {
      target.outputDigest = outputDigest;
      target.digestError = null;
      updateDiagnostics(target);
    }

    return core.createDocument2DRenderManifest({
      inputPath: `browser:${snapshot.scene.id}.json`,
      inputDigest,
      ...(snapshot.scene.sourceRepository === undefined
        ? {}
        : { sourceRepository: snapshot.scene.sourceRepository }),
      ...(snapshot.scene.sourceSha === undefined
        ? {}
        : { sourceSha: snapshot.scene.sourceSha }),
      rendererVersion: String(buildInfo.version),
      rendererSha: String(buildInfo.mainSha),
      profile: snapshot.layout.profile,
      layoutOptions: {
        strategy: snapshot.options.strategy,
        rootKey: snapshot.options.rootKey ?? null,
      },
      seedStrategy: snapshot.layout.metrics.seedStrategy,
      quality: snapshot.layout.metrics.qualityAfter,
      outputPath:
        `browser:mts-visual-document-${snapshot.scene.id}-`
        + `${snapshot.layout.profile}-`
        + `${String(buildInfo.mainSha).slice(0, 12)}.svg`,
      outputDigest,
    });
  }

  async function exportManifest() {
    const target = state;
    if (!target) return false;

    const filename = svgFilename(target).replace(
      /\.svg$/,
      ".manifest.json",
    );
    const manifest = await createManifest(target);
    const text = JSON.stringify(manifest, null, 2) + "\n";

    downloadTextFile(
      text,
      filename,
      "application/json;charset=utf-8",
    );
    log(
      `Document manifest сохранён: outputDigest=${manifest.outputDigest}, renderer=${manifest.rendererSha.slice(0, 12)}`,
    );
    return true;
  }

  function diagnosticDetail(scene = getSelectedScene()) {
    if (!state?.layout || state.scene !== scene) return null;

    const quality = state.layout.metrics.qualityAfter;
    return Object.freeze({
      profile: state.layout.profile,
      requestedStrategy: state.options?.strategy ?? null,
      seedStrategy: state.layout.metrics.seedStrategy,
      seedCandidates: state.layout.metrics.seedCandidates,
      crossings: quality.crossings,
      centerOverlaps: quality.centerOverlaps,
      labelOverlaps: quality.labelOverlaps,
      evaluations: state.layout.metrics.optimizerEvaluations,
      passes: state.layout.metrics.optimizerPasses,
      svgSha256: state.outputDigest ?? null,
      bounds: state.layout.bounds,
    });
  }

  function mount() {
    const scene = getSelectedScene();
    refreshRootOptions(scene.network);
    ui.documentRoot.value = scene.hints?.rootKey ?? "";

    const target = {
      scene,
      network: scene.network,
      options: null,
      layout: null,
      svgText: null,
      outputDigest: null,
      digestError: null,
      digestGeneration: 0,
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
      ui.documentViewport,
      "pointerdown",
      (event) => {
        if (event.button !== 0) return;

        const linkGroup = event.target.closest?.(
          '[data-role="document-link"]',
        );
        const key = linkGroup?.getAttribute(
          "data-link-key",
        );
        if (key) setSelectedKey(key);

        target.pointerId = event.pointerId;
        target.panPointer = {
          x: event.clientX,
          y: event.clientY,
        };
        ui.documentViewport.setPointerCapture?.(
          event.pointerId,
        );
        ui.documentViewport.classList.add("dragging");
        event.preventDefault();
      },
    );

    addListener(
      target.listeners,
      ui.documentViewport,
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
      ui.documentViewport.classList.remove("dragging");
    };
    addListener(
      target.listeners,
      ui.documentViewport,
      "pointerup",
      finishPointer,
    );
    addListener(
      target.listeners,
      ui.documentViewport,
      "pointercancel",
      finishPointer,
    );

    addListener(
      target.listeners,
      ui.documentViewport,
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
      `Document 2D запущен: сцена=${scene.label}, профиль=${target.layout.profile}, seed=${target.layout.metrics.seedStrategy}, пересечения=${target.layout.metrics.qualityBefore.crossings}→${target.layout.metrics.qualityAfter.crossings}`,
    );

    return () => {
      if (target.cleaned) return;
      target.cleaned = true;
      target.digestGeneration += 1;
      removeListeners(target.listeners);
      ui.documentViewport.classList.remove("dragging");
      ui.documentViewport.replaceChildren();
      if (state === target) state = null;
    };
  }

  function mountControls() {
    if (controlsMounted) return;
    controlsMounted = true;

    for (const control of [
      ui.documentProfile,
      ui.documentStrategy,
      ui.documentRoot,
    ]) {
      addListener(
        controlListeners,
        control,
        "change",
        () => {
          if (state) render(state, { fit: true });
        },
      );
    }

    addListener(
      controlListeners,
      ui.documentFit,
      "click",
      () => {
        if (state) fit(state);
      },
    );

    addListener(
      controlListeners,
      ui.documentReset,
      "click",
      () => {
        if (state) render(state, { fit: true });
      },
    );

    addListener(
      controlListeners,
      ui.documentExport,
      "click",
      () => {
        exportSvg();
      },
    );

    addListener(
      controlListeners,
      ui.documentManifest,
      "click",
      () => {
        exportManifest().catch((error) => {
          ui.documentDigest.textContent = "ошибка";
          log(
            `ОШИБКА экспорта Document manifest — ${errorText(error)}`,
          );
        });
      },
    );
  }

  function disposeControls() {
    removeListeners(controlListeners);
    controlsMounted = false;
  }

  return Object.freeze({
    createManifest,
    diagnosticDetail,
    disposeControls,
    exportManifest,
    exportSvg,
    fit,
    isMounted: () => state !== null,
    mount,
    mountControls,
    render: (options) => render(state, options),
    state: () => state,
  });
}
