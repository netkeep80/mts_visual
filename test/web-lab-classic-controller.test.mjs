import assert from "node:assert/strict";
import {
  createClassic3DController,
} from "../browser/webgpu-witness/classic-3d-controller.js";

class FakeElement {
  constructor({ value = "", checked = false } = {}) {
    this.value = value;
    this.checked = checked;
    this.textContent = "";
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

  fire(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ type, target: this, ...event });
    }
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }

  replaceChildren() {}
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createUi() {
  return {
    classicCharge: new FakeElement({ value: "0.8" }),
    classicChargeValue: new FakeElement(),
    classicRestLength: new FakeElement({ value: "2.0" }),
    classicRestLengthValue: new FakeElement(),
    classicStiffness: new FakeElement({ value: "0.1" }),
    classicStiffnessValue: new FakeElement(),
    classicDamping: new FakeElement({ value: "0.9" }),
    classicDampingValue: new FakeElement(),
    classicTimeStep: new FakeElement({ value: "0.12" }),
    classicTimeStepValue: new FakeElement(),
    classicLabels: new FakeElement({ checked: true }),
    classicPause: new FakeElement(),
    classicReset: new FakeElement(),
    classicFit: new FakeElement(),
    classicFullscreen: new FakeElement(),
    classicViewport: new FakeElement(),
    viewportShell: new FakeElement(),
    classicTick: new FakeElement(),
    classicEvaluations: new FakeElement(),
    classicMaxVelocity: new FakeElement(),
    classicPinned: new FakeElement(),
  };
}

const sourceNetwork = {
  links: [
    { key: "A", startKey: "B", endKey: "C", label: "Alpha" },
    { key: "B", startKey: "C", endKey: "A" },
    { key: "C", startKey: "A", endKey: "B" },
  ],
};
const scene = {
  id: "classic-fixture",
  label: "Classic Fixture",
  network: sourceNetwork,
};
const sourceSnapshot = JSON.stringify(sourceNetwork);

const initialCalls = [];
const liveCalls = [];
const setOptionCalls = [];
let snapshotState = {
  tick: 7,
  awake: true,
  maxVelocity: 0.125,
  pinnedKeys: ["A"],
};

const core = {
  createInitialPhysics3DState(network, options) {
    initialCalls.push({ network, options });
    return { network, radius: options.radius };
  },

  createLivePhysics3D(network, initialState, options) {
    liveCalls.push({ network, initialState, options });
    return {
      model: {
        keys: network.links.map((link) => link.key),
        springs: [{}, {}],
      },
      options,
    };
  },

  setLivePhysics3DOptions(controller, options) {
    setOptionCalls.push({ controller, options });
    controller.options = options;
  },

  snapshotLivePhysics3D() {
    return {
      ...snapshotState,
      pinnedKeys: [...snapshotState.pinnedKeys],
    };
  },
};

const rendererCalls = [];
const pauseCalls = [];
let destroyCalls = 0;
let fitCalls = 0;

const threeVisual = {
  createVisualThreeLiveRenderer(viewport, network, controller, options) {
    rendererCalls.push({ viewport, network, controller, options });
    return { mounted: true };
  },

  destroyVisualThreeRenderer(viewport) {
    assert.equal(viewport, ui.classicViewport);
    destroyCalls += 1;
  },

  setVisualThreeLivePaused(viewport, paused) {
    pauseCalls.push({ viewport, paused });
  },

  fitVisualThreeRenderer(viewport) {
    assert.equal(viewport, ui.classicViewport);
    fitCalls += 1;
  },
};

const ui = createUi();
const selectedKeys = [];
const controlReads = [];
const logs = [];
const intervals = new Map();
const clearedIntervals = [];
const scheduledFrames = [];
const remountCalls = [];
let nextTimer = 1;
let diagnosticsUpdates = 0;
let fullscreen = false;
let requestFullscreenCalls = 0;
let exitFullscreenCalls = 0;

const controller = createClassic3DController({
  ui,
  core,
  threeVisual,
  getSelectedScene: () => scene,
  setSelectedKey: (key) => selectedKeys.push(key),
  updateSharedDiagnostics: () => {
    diagnosticsUpdates += 1;
  },
  controlNumber(control, label, minimum, maximum) {
    controlReads.push({ control, label, minimum, maximum });
    return Number(control.value);
  },
  formatNumber: (value) => `fmt:${value}`,
  requestRemount: async () => {
    remountCalls.push("classic-3d");
  },
  setIntervalFn(callback, milliseconds) {
    const id = nextTimer++;
    intervals.set(id, { callback, milliseconds });
    return id;
  },
  clearIntervalFn(id) {
    clearedIntervals.push(id);
    intervals.delete(id);
  },
  scheduleFrame(callback) {
    scheduledFrames.push(callback);
  },
  isFullscreen: () => fullscreen,
  requestFullscreen: async () => {
    requestFullscreenCalls += 1;
    fullscreen = true;
  },
  exitFullscreen: async () => {
    exitFullscreenCalls += 1;
    fullscreen = false;
  },
  log: (message) => logs.push(message),
});

controller.mountControls();
controller.mountControls();

for (const control of [
  ui.classicCharge,
  ui.classicRestLength,
  ui.classicStiffness,
  ui.classicDamping,
  ui.classicTimeStep,
]) {
  assert.equal(control.listenerCount("input"), 1);
}
assert.equal(ui.classicLabels.listenerCount("change"), 1);
assert.equal(ui.classicPause.listenerCount("click"), 1);
assert.equal(ui.classicReset.listenerCount("click"), 1);
assert.equal(ui.classicFit.listenerCount("click"), 1);
assert.equal(ui.classicFullscreen.listenerCount("click"), 1);

const cleanup = controller.mount();

assert.equal(controller.isMounted(), true);
assert.equal(controller.state().scene, scene);
assert.equal(initialCalls.length, 1);
assert.deepEqual(initialCalls[0].options, { radius: 3 });
assert.notEqual(initialCalls[0].network, sourceNetwork);
assert.equal(JSON.stringify(sourceNetwork), sourceSnapshot);

assert.equal(liveCalls.length, 1);
assert.deepEqual(liveCalls[0].options, {
  charge: 0.8,
  restLength: 2,
  springStiffness: 0.1,
  damping: 0.9,
  timeStep: 0.12,
});
assert.equal(
  liveCalls[0].network.links[0].label,
  "Alpha",
);
assert.equal(
  liveCalls[0].network.links[1].label,
  "B",
);
assert.equal(
  liveCalls[0].network.links[2].label,
  "C",
);
assert.equal(JSON.stringify(sourceNetwork), sourceSnapshot);

assert.equal(rendererCalls.length, 1);
assert.equal(
  rendererCalls[0].viewport,
  ui.classicViewport,
);
assert.deepEqual(
  {
    samples: rendererCalls[0].options.samples,
    nodeRadius: rendererCalls[0].options.nodeRadius,
  },
  { samples: 18, nodeRadius: 0.13 },
);

rendererCalls[0].options.onActivateKey("B");
assert.deepEqual(selectedKeys, ["B"]);
assert.match(logs.at(-1), /выбрана связь B/);

assert.equal(ui.classicChargeValue.value, "0.80");
assert.equal(ui.classicRestLengthValue.value, "2.00");
assert.equal(ui.classicStiffnessValue.value, "0.100");
assert.equal(ui.classicDampingValue.value, "0.90");
assert.equal(ui.classicTimeStepValue.value, "0.12");
assert.equal(ui.classicPause.textContent, "Пауза");

assert.equal(intervals.size, 1);
const [timerId, timer] = [...intervals.entries()][0];
assert.equal(timer.milliseconds, 200);

assert.equal(ui.classicTick.textContent, "7 · активен");
assert.equal(ui.classicEvaluations.textContent, "2 / 3");
assert.equal(ui.classicMaxVelocity.textContent, "fmt:0.125");
assert.equal(ui.classicPinned.textContent, "1");

assert.deepEqual(controller.diagnosticDetail(scene), {
  tick: 7,
  awake: true,
  maxVelocity: 0.125,
  pinnedKeys: ["A"],
  springs: 2,
  chargePairs: 3,
});
assert.equal(controller.diagnosticDetail({ ...scene }), null);

const diagnosticsBeforeTimer = diagnosticsUpdates;
snapshotState = {
  tick: 8,
  awake: false,
  maxVelocity: 0.25,
  pinnedKeys: ["A", "C"],
};
timer.callback();
assert.equal(diagnosticsUpdates, diagnosticsBeforeTimer + 1);
assert.equal(ui.classicTick.textContent, "8 · покой");
assert.equal(ui.classicPinned.textContent, "2");

ui.classicCharge.value = "1.1";
ui.classicCharge.fire("input");
assert.equal(setOptionCalls.length, 1);
assert.equal(setOptionCalls[0].options.charge, 1.1);
assert.deepEqual(pauseCalls.at(-1), {
  viewport: ui.classicViewport,
  paused: false,
});

const pauseCallsBeforePause = pauseCalls.length;
ui.classicPause.fire("click");
assert.equal(controller.state().paused, true);
assert.equal(ui.classicPause.textContent, "Продолжить");
assert.deepEqual(pauseCalls.at(-1), {
  viewport: ui.classicViewport,
  paused: true,
});

ui.classicRestLength.value = "3";
ui.classicRestLength.fire("input");
assert.equal(setOptionCalls.length, 2);
assert.equal(setOptionCalls.at(-1).options.restLength, 3);
assert.equal(
  pauseCalls.length,
  pauseCallsBeforePause + 1,
  "physics input while paused must not force renderer live",
);

ui.classicPause.fire("click");
assert.equal(controller.state().paused, false);
assert.equal(ui.classicPause.textContent, "Пауза");
assert.deepEqual(pauseCalls.at(-1), {
  viewport: ui.classicViewport,
  paused: false,
});

const fitBefore = fitCalls;
ui.classicFit.fire("click");
assert.equal(fitCalls, fitBefore + 1);

ui.classicLabels.fire("change");
ui.classicReset.fire("click");
await flushMicrotasks();
assert.deepEqual(remountCalls, ["classic-3d", "classic-3d"]);

controller.handleFullscreenChange(true);
assert.equal(
  ui.classicFullscreen.textContent,
  "Выйти из полноэкранного режима",
);
assert.equal(scheduledFrames.length, 1);
scheduledFrames.shift()();
assert.equal(fitCalls, fitBefore + 2);

controller.handleFullscreenChange(false);
assert.equal(ui.classicFullscreen.textContent, "На весь экран");
assert.equal(scheduledFrames.length, 1);
scheduledFrames.shift()();
assert.equal(fitCalls, fitBefore + 3);

await controller.toggleFullscreen();
assert.equal(requestFullscreenCalls, 1);
assert.equal(fullscreen, true);
await controller.toggleFullscreen();
assert.equal(exitFullscreenCalls, 1);
assert.equal(fullscreen, false);

assert.ok(
  controlReads.some(
    (entry) =>
      entry.label === "отталкивание центров"
      && entry.minimum === 0
      && entry.maximum === 3,
  ),
);
assert.ok(
  controlReads.some(
    (entry) =>
      entry.label === "длина покоя Classic"
      && entry.minimum === 0.25
      && entry.maximum === 8,
  ),
);

const diagnosticsBeforeCleanup = diagnosticsUpdates;
cleanup();
cleanup();
assert.equal(controller.isMounted(), false);
assert.equal(controller.state(), null);
assert.deepEqual(clearedIntervals, [timerId]);
assert.equal(destroyCalls, 1);
timer.callback();
assert.equal(diagnosticsUpdates, diagnosticsBeforeCleanup);
assert.equal(controller.diagnosticDetail(scene), null);

const remountBeforeUnmountedEvents = remountCalls.length;
ui.classicLabels.fire("change");
ui.classicReset.fire("click");
await flushMicrotasks();
assert.equal(remountCalls.length, remountBeforeUnmountedEvents);

// Labels-off remount preserves separate Link bodies while removing only presentation labels.
ui.classicLabels.checked = false;
const cleanupWithoutLabels = controller.mount();
assert.equal(rendererCalls.length, 2);
assert.equal(
  rendererCalls[1].network.links.length,
  sourceNetwork.links.length,
);
assert.ok(
  rendererCalls[1].network.links.every(
    (link) => !("label" in link),
  ),
);
assert.equal(JSON.stringify(sourceNetwork), sourceSnapshot);
cleanupWithoutLabels();

controller.disposeControls();
for (const control of [
  ui.classicCharge,
  ui.classicRestLength,
  ui.classicStiffness,
  ui.classicDamping,
  ui.classicTimeStep,
]) {
  assert.equal(control.listenerCount("input"), 0);
}
assert.equal(ui.classicLabels.listenerCount("change"), 0);
assert.equal(ui.classicPause.listenerCount("click"), 0);
assert.equal(ui.classicReset.listenerCount("click"), 0);
assert.equal(ui.classicFit.listenerCount("click"), 0);
assert.equal(ui.classicFullscreen.listenerCount("click"), 0);

console.log("Classic 3D browser controller executable contract: PASS");
