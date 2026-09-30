import {
  benchmarkEvidenceFileName,
  createBenchmarkConfig,
  parseMechanicalBenchmarkQuery,
  serializeBenchmarkEvidence,
} from "./benchmark-ui-model.js";

const PROGRESS_LABELS = Object.freeze({
  device: "устройство",
  topology: "топология",
  "compute-create": "compute init",
  "shape-create": "shape init",
  "renderer-create": "renderer init",
  warmup: "warmup",
  samples: "samples",
  done: "завершение",
});

function errorText(error) {
  return error instanceof Error
    ? error.stack ?? error.message
    : String(error);
}

export function createBenchmarkUiController({
  ui,
  selectedPhysics,
  getAdapter,
  getInteractiveDevice,
  isMechanicalMounted,
  runBenchmark,
  webgpu,
  buildInfo,
  copyText,
  downloadTextFile,
  log = () => {},
}) {
  let running = false;
  let stopRequested = false;
  let evidence = null;
  let mounted = false;
  const listeners = [];

  function listen(element, type, handler) {
    element.addEventListener(type, handler);
    listeners.push({ element, type, handler });
  }

  function selectedConfig() {
    return createBenchmarkConfig(
      {
        linkCount: ui.benchmarkLinks.value,
        topologyProfile: ui.benchmarkProfile.value,
        seed: ui.benchmarkSeed.value,
        octahedra: ui.benchmarkOcta.value,
        detailProfile: ui.benchmarkDetail.value,
        warmupCount: ui.benchmarkWarmup.value,
        sampleCount: ui.benchmarkSamples.value,
        renderEnabled: ui.benchmarkRender.checked,
      },
      selectedPhysics(),
    );
  }

  function progress(event) {
    const total = Math.max(1, event.total ?? 1);
    const completed = Math.max(0, event.completed ?? 0);
    ui.benchmarkProgress.max = total;
    ui.benchmarkProgress.value = Math.min(total, completed);
    ui.benchmarkStatus.textContent =
      `${PROGRESS_LABELS[event.phase] ?? event.phase} · ${completed}/${total}`;
  }

  function renderEvidence(nextEvidence) {
    evidence = nextEvidence;
    ui.benchmarkResult.textContent = JSON.stringify(nextEvidence, null, 2);
    ui.benchmarkCopy.disabled = false;
    ui.benchmarkDownload.disabled = false;

    if (nextEvidence.status === "PASS") {
      const physicsMedian =
        nextEvidence.stages.physics?.medianMs?.toFixed(3) ?? "—";
      const shapeMedian =
        nextEvidence.stages.shape?.medianMs?.toFixed(3) ?? "—";
      ui.benchmarkStatus.textContent =
        `PASS · samples=${nextEvidence.sampleCountCompleted} · physics median=${physicsMedian} ms · shape median=${shapeMedian} ms`;
      ui.benchmarkStatus.className = "lab-mode-status ok";
      return;
    }

    if (nextEvidence.status === "CAPACITY_BLOCKED") {
      ui.benchmarkStatus.textContent =
        `CAPACITY_BLOCKED · ${nextEvidence.capacityBlockReason}`;
      ui.benchmarkStatus.className = "lab-mode-status warn";
      return;
    }

    ui.benchmarkStatus.textContent =
      `RUNTIME_FAILED · ${nextEvidence.error ?? "неизвестная ошибка"}`;
    ui.benchmarkStatus.className = "lab-mode-status fail";
  }

  function renderRunnerError(error) {
    ui.benchmarkStatus.textContent =
      `RUNTIME_FAILED · ${error instanceof Error ? error.message : String(error)}`;
    ui.benchmarkStatus.className = "lab-mode-status fail";
    ui.benchmarkResult.textContent =
      `benchmark runner error:\n${errorText(error)}`;
  }

  async function run() {
    if (running) return null;

    const adapter = getAdapter();
    if (!adapter) {
      throw new Error("WebGPU adapter недоступен");
    }

    const config = selectedConfig();
    running = true;
    stopRequested = false;
    evidence = null;
    ui.benchmarkRun.disabled = true;
    ui.benchmarkStop.disabled = false;
    ui.benchmarkCopy.disabled = true;
    ui.benchmarkDownload.disabled = true;
    ui.benchmarkResult.textContent = "evidence: benchmark выполняется…";
    ui.benchmarkProgress.max = 1;
    ui.benchmarkProgress.value = 0;
    ui.benchmarkStatus.className = "lab-mode-status";
    log(
      `benchmark start: Links=${config.linkCount}, topology=${config.topologyProfile}, octa=${config.octahedra}, detail=${config.detailProfile}, render=${config.renderEnabled}, warmup=${config.warmupCount}, samples=${config.sampleCount}`,
    );

    try {
      const interactiveMechanicalSuspended =
        Boolean(isMechanicalMounted());
      const interactiveDevice = getInteractiveDevice();
      if (
        interactiveMechanicalSuspended
        && typeof interactiveDevice?.queue?.onSubmittedWorkDone === "function"
      ) {
        ui.benchmarkStatus.textContent =
          "изоляция benchmark · ожидание завершения интерактивной GPU queue";
        await interactiveDevice.queue.onSubmittedWorkDone();
      }

      const nextEvidence = await runBenchmark({
        adapter,
        webgpu,
        buildInfo,
        canvas: ui.benchmarkCanvas,
        config: {
          ...config,
          resourceIsolation: interactiveMechanicalSuspended
            ? "separate-device+interactive-mechanical-suspended"
            : "separate-device",
        },
        onProgress: progress,
        shouldStop: () => stopRequested,
      });
      renderEvidence(nextEvidence);
      log(
        `benchmark result: ${nextEvidence.status} · Links=${nextEvidence.linkCount} · detail=${nextEvidence.effectiveDetailCapacity} · samples=${nextEvidence.sampleCountCompleted}`,
      );
      return nextEvidence;
    } catch (error) {
      renderRunnerError(error);
      throw error;
    } finally {
      running = false;
      ui.benchmarkRun.disabled = false;
      ui.benchmarkStop.disabled = true;
    }
  }

  function requestStop({ announce = true } = {}) {
    if (!running) return false;
    stopRequested = true;
    if (announce) {
      ui.benchmarkStop.disabled = true;
      ui.benchmarkStatus.textContent =
        "остановка после текущего warmup/sample…";
      log("benchmark: запрошена остановка после текущего sample");
    }
    return true;
  }

  async function copyEvidence() {
    const text = serializeBenchmarkEvidence(evidence);
    await copyText(text);
    ui.benchmarkStatus.textContent =
      `${evidence.status} · JSON скопирован`;
  }

  function downloadEvidence() {
    const text = serializeBenchmarkEvidence(evidence);
    downloadTextFile(
      text,
      benchmarkEvidenceFileName(evidence, buildInfo.mainSha),
      "application/json;charset=utf-8",
    );
  }

  function applyQuery(params) {
    const query = parseMechanicalBenchmarkQuery(
      params,
      ui.benchmarkLinks.value,
    );
    if (!query.requested) return false;

    const values = query.values;
    if (values.linkCount !== undefined) {
      ui.benchmarkLinks.value = String(values.linkCount);
    }
    if (values.topologyProfile !== undefined) {
      ui.benchmarkProfile.value = values.topologyProfile;
    }
    if (values.detailProfile !== undefined) {
      ui.benchmarkDetail.value = values.detailProfile;
    }
    if (values.octahedra !== undefined) {
      ui.benchmarkOcta.value = String(values.octahedra);
    }
    if (values.seed !== undefined) {
      ui.benchmarkSeed.value = String(values.seed);
    }
    if (values.warmupCount !== undefined) {
      ui.benchmarkWarmup.value = String(values.warmupCount);
    }
    if (values.sampleCount !== undefined) {
      ui.benchmarkSamples.value = String(values.sampleCount);
    }
    ui.benchmarkRender.checked = values.renderEnabled;
    return true;
  }

  function mount() {
    if (mounted) return;
    mounted = true;

    listen(ui.benchmarkRun, "click", () => {
      run().catch((error) => {
        log(`ОШИБКА benchmark runner — ${errorText(error)}`);
      });
    });
    listen(ui.benchmarkStop, "click", () => {
      requestStop();
    });
    listen(ui.benchmarkCopy, "click", () => {
      copyEvidence().catch((error) => {
        log(
          `ОШИБКА копирования benchmark evidence — ${errorText(error)}`,
        );
      });
    });
    listen(ui.benchmarkDownload, "click", () => {
      try {
        downloadEvidence();
      } catch (error) {
        log(
          `ОШИБКА сохранения benchmark evidence — ${errorText(error)}`,
        );
      }
    });
    listen(ui.benchmarkDetail, "change", () => {
      if (ui.benchmarkDetail.value === "semantic") {
        ui.benchmarkRender.checked = false;
      }
    });
  }

  function dispose() {
    for (const { element, type, handler } of listeners.splice(0)) {
      element.removeEventListener(type, handler);
    }
    mounted = false;
  }

  return Object.freeze({
    applyQuery,
    copyEvidence,
    dispose,
    downloadEvidence,
    evidence: () => evidence,
    isRunning: () => running,
    mount,
    requestStop,
    run,
    shouldStop: () => stopRequested,
  });
}
