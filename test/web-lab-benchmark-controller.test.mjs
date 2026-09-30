import assert from "node:assert/strict";
import {
  createBenchmarkUiController,
} from "../browser/webgpu-witness/benchmark-ui-controller.js";

class FakeControl {
  constructor({ value = "", checked = false } = {}) {
    this.value = value;
    this.checked = checked;
    this.disabled = false;
    this.textContent = "";
    this.className = "";
    this.max = 0;
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? new Set();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  fire(type) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ type, target: this });
    }
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function benchmarkUi() {
  return {
    benchmarkLinks: new FakeControl({ value: "100000" }),
    benchmarkProfile: new FakeControl({ value: "mixed" }),
    benchmarkSeed: new FakeControl({ value: "1" }),
    benchmarkOcta: new FakeControl({ value: "64" }),
    benchmarkDetail: new FakeControl({ value: "detail-4096" }),
    benchmarkWarmup: new FakeControl({ value: "5" }),
    benchmarkSamples: new FakeControl({ value: "20" }),
    benchmarkRender: new FakeControl({ checked: false }),
    benchmarkRun: new FakeControl(),
    benchmarkStop: new FakeControl(),
    benchmarkCopy: new FakeControl(),
    benchmarkDownload: new FakeControl(),
    benchmarkStatus: new FakeControl(),
    benchmarkProgress: new FakeControl(),
    benchmarkResult: new FakeControl(),
    benchmarkCanvas: { id: "benchmark-canvas" },
  };
}

const physics = Object.freeze({
  longitudinalStiffness: 12,
  transverseStiffness: 3,
  nonlinearity: 0.4,
  nodeMass: 2,
  linearDampingRate: 0.5,
  simulationSpeed: 10,
});

function passEvidence(overrides = {}) {
  return {
    status: "PASS",
    linkCount: 100_000,
    effectiveDetailCapacity: 4096,
    sampleCountCompleted: 20,
    stages: {
      physics: { medianMs: 1.25 },
      shape: { medianMs: 2.5 },
    },
    ...overrides,
  };
}

function controllerFixture({
  mechanicalMounted = false,
  runBenchmark,
  adapter = {},
} = {}) {
  const ui = benchmarkUi();
  const events = [];
  const copies = [];
  const downloads = [];
  const logs = [];
  const device = {
    queue: {
      async onSubmittedWorkDone() {
        events.push("drain");
      },
    },
  };

  let controller = null;
  const runtime = runBenchmark ?? (async (options) => {
    events.push("runtime");
    assert.equal(controller.isRunning(), true);
    assert.equal(options.shouldStop(), false);
    assert.equal(
      options.config.resourceIsolation,
      mechanicalMounted
        ? "separate-device+interactive-mechanical-suspended"
        : "separate-device",
    );
    options.onProgress({ phase: "samples", completed: 3, total: 20 });
    return passEvidence();
  });

  controller = createBenchmarkUiController({
    ui,
    selectedPhysics: () => physics,
    getAdapter: () => adapter,
    getInteractiveDevice: () => device,
    isMechanicalMounted: () => mechanicalMounted,
    runBenchmark: runtime,
    webgpu: { marker: "webgpu" },
    buildInfo: {
      version: "0.6.0",
      mainSha: "1234567890abcdef1234567890abcdef12345678",
    },
    copyText: async (text) => {
      copies.push(text);
    },
    downloadTextFile: (text, filename, type) => {
      downloads.push({ text, filename, type });
    },
    log: (message) => {
      logs.push(message);
    },
  });

  return {
    controller,
    ui,
    events,
    copies,
    downloads,
    logs,
  };
}

{
  const fixture = controllerFixture({ mechanicalMounted: true });
  const { controller, ui, events, copies, downloads } = fixture;

  assert.equal(controller.isRunning(), false);
  assert.equal(controller.shouldStop(), false);
  await assert.rejects(
    () => controller.copyEvidence(),
    /ещё не создан/,
  );
  assert.throws(
    () => controller.downloadEvidence(),
    /ещё не создан/,
  );

  const evidence = await controller.run();
  assert.equal(evidence.status, "PASS");
  assert.deepEqual(events, ["drain", "runtime"]);
  assert.equal(controller.isRunning(), false);
  assert.equal(ui.benchmarkRun.disabled, false);
  assert.equal(ui.benchmarkStop.disabled, true);
  assert.equal(ui.benchmarkCopy.disabled, false);
  assert.equal(ui.benchmarkDownload.disabled, false);
  assert.equal(ui.benchmarkProgress.max, 20);
  assert.equal(ui.benchmarkProgress.value, 3);
  assert.match(ui.benchmarkStatus.textContent, /^PASS · samples=20/);
  assert.equal(ui.benchmarkStatus.className, "lab-mode-status ok");

  await controller.copyEvidence();
  assert.equal(copies.length, 1);
  assert.deepEqual(JSON.parse(copies[0]), evidence);
  assert.match(ui.benchmarkStatus.textContent, /JSON скопирован$/);

  controller.downloadEvidence();
  assert.equal(downloads.length, 1);
  assert.equal(
    downloads[0].type,
    "application/json;charset=utf-8",
  );
  assert.match(
    downloads[0].filename,
    /^mts-visual-mechanical-benchmark-100000-1234567890ab-/,
  );
}

{
  let runtimeOptions = null;
  let releaseRuntime;
  const gate = new Promise((resolve) => {
    releaseRuntime = resolve;
  });
  const fixture = controllerFixture({
    runBenchmark: async (options) => {
      runtimeOptions = options;
      await gate;
      return passEvidence();
    },
  });
  const { controller, ui } = fixture;

  const first = controller.run();
  assert.equal(controller.isRunning(), true);
  assert.equal(ui.benchmarkRun.disabled, true);
  assert.equal(ui.benchmarkStop.disabled, false);

  assert.equal(await controller.run(), null);
  assert.equal(controller.requestStop(), true);
  assert.equal(controller.shouldStop(), true);
  assert.equal(runtimeOptions.shouldStop(), true);
  assert.equal(ui.benchmarkStop.disabled, true);
  assert.match(ui.benchmarkStatus.textContent, /^остановка/);

  releaseRuntime();
  await first;
  assert.equal(controller.isRunning(), false);
  assert.equal(ui.benchmarkRun.disabled, false);
  assert.equal(ui.benchmarkStop.disabled, true);
  assert.equal(controller.requestStop(), false);
}

for (const [evidence, expectedClass, expectedText] of [
  [
    passEvidence({
      status: "CAPACITY_BLOCKED",
      capacityBlockReason: "maxBufferSize",
    }),
    "lab-mode-status warn",
    /^CAPACITY_BLOCKED · maxBufferSize$/,
  ],
  [
    passEvidence({
      status: "RUNTIME_FAILED",
      error: "device-lost",
    }),
    "lab-mode-status fail",
    /^RUNTIME_FAILED · device-lost$/,
  ],
]) {
  const fixture = controllerFixture({
    runBenchmark: async () => evidence,
  });
  await fixture.controller.run();
  assert.equal(fixture.ui.benchmarkStatus.className, expectedClass);
  assert.match(fixture.ui.benchmarkStatus.textContent, expectedText);
}

{
  const fixture = controllerFixture({
    runBenchmark: async () => {
      throw new Error("synthetic-runtime-failure");
    },
  });
  await assert.rejects(
    () => fixture.controller.run(),
    /synthetic-runtime-failure/,
  );
  assert.equal(fixture.controller.isRunning(), false);
  assert.equal(fixture.ui.benchmarkRun.disabled, false);
  assert.equal(fixture.ui.benchmarkStop.disabled, true);
  assert.equal(
    fixture.ui.benchmarkStatus.className,
    "lab-mode-status fail",
  );
  assert.match(
    fixture.ui.benchmarkResult.textContent,
    /synthetic-runtime-failure/,
  );
}

{
  const fixture = controllerFixture({ adapter: null });
  await assert.rejects(
    () => fixture.controller.run(),
    /WebGPU adapter недоступен/,
  );
  assert.equal(fixture.controller.isRunning(), false);
}

{
  const fixture = controllerFixture();
  const { controller, ui } = fixture;

  assert.equal(
    controller.applyQuery(
      new URLSearchParams(
        "benchmark=mechanical&links=1000000&profile=branching&detail=1024&octa=128&seed=7&warmup=6&samples=2&render=1",
      ),
    ),
    true,
  );
  assert.equal(ui.benchmarkLinks.value, "1000000");
  assert.equal(ui.benchmarkProfile.value, "branching");
  assert.equal(ui.benchmarkDetail.value, "detail-1024");
  assert.equal(ui.benchmarkOcta.value, "128");
  assert.equal(ui.benchmarkSeed.value, "7");
  assert.equal(ui.benchmarkWarmup.value, "6");
  assert.equal(ui.benchmarkSamples.value, "2");
  assert.equal(ui.benchmarkRender.checked, true);

  assert.equal(
    controller.applyQuery(new URLSearchParams("links=1000000")),
    false,
  );

  controller.mount();
  assert.equal(ui.benchmarkRun.listenerCount("click"), 1);
  assert.equal(ui.benchmarkStop.listenerCount("click"), 1);
  assert.equal(ui.benchmarkCopy.listenerCount("click"), 1);
  assert.equal(ui.benchmarkDownload.listenerCount("click"), 1);
  assert.equal(ui.benchmarkDetail.listenerCount("change"), 1);

  ui.benchmarkRender.checked = true;
  ui.benchmarkDetail.value = "semantic";
  ui.benchmarkDetail.fire("change");
  assert.equal(ui.benchmarkRender.checked, false);

  controller.dispose();
  assert.equal(ui.benchmarkRun.listenerCount("click"), 0);
  assert.equal(ui.benchmarkStop.listenerCount("click"), 0);
  assert.equal(ui.benchmarkCopy.listenerCount("click"), 0);
  assert.equal(ui.benchmarkDownload.listenerCount("click"), 0);
  assert.equal(ui.benchmarkDetail.listenerCount("change"), 0);
}

console.log("Web Lab benchmark UI controller executable contract: PASS");
