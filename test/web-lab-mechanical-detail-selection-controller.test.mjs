import assert from "node:assert/strict";
import {
  createMechanicalDetailSelectionController,
  sameMechanicalGpuSelectionView,
} from "../browser/webgpu-witness/mechanical-detail-selection-controller.js";

function createTimers() {
  let nextId = 1;
  const entries = new Map();
  const cleared = [];
  return {
    set(callback, milliseconds) {
      const id = nextId;
      nextId += 1;
      entries.set(id, { callback, milliseconds });
      return id;
    },
    clear(id) {
      if (entries.delete(id)) cleared.push(id);
    },
    size() {
      return entries.size;
    },
    delays() {
      return [...entries.values()].map(
        (entry) => entry.milliseconds,
      );
    },
    cleared,
    async runNext() {
      const first = entries.entries().next();
      if (first.done) return false;
      const [id, entry] = first.value;
      entries.delete(id);
      await entry.callback();
      return true;
    },
  };
}

function createState() {
  let snapshot = {
    detailCapacity: 3,
    detailedLinkCount: 3,
  };
  const selectorCalls = [];
  const selectorResults = [];
  const state = {
    compute: {
      topology: {
        linkCount: 3,
      },
    },
    shape: {
      snapshot() {
        return { ...snapshot };
      },
      setGpuDetailSelectionView(input) {
        selectorCalls.push(input);
        const next = selectorResults.shift();
        return next ?? {
          detailedLinkCount: 2,
          indexUploadBytes: 8,
          globalsUploadBytes: 16,
          selectionControlUploadBytes: 4,
        };
      },
    },
    linkIndexByKey: new Map([
      ["R", 0],
      ["O", 1],
      ["C", 2],
    ]),
    hoveredCenterLink: -1,
    detailSelectionTimer: null,
    detailSelection: null,
    detailSelectionView: null,
    detailSelectionUpdates: 0,
    detailSelectionIndexUploadBytes: 0,
    detailSelectionGlobalsUploadBytes: 0,
    detailSelectionControlUploadBytes: 0,
  };
  return {
    state,
    selectorCalls,
    selectorResults,
    setSnapshot(next) {
      snapshot = { ...next };
    },
  };
}

assert.equal(
  sameMechanicalGpuSelectionView(
    null,
    new Float32Array([1, 2]),
    0,
  ),
  false,
);
assert.equal(
  sameMechanicalGpuSelectionView(
    {
      priorityLink: 1,
      viewProjection: [1, 2, 3],
    },
    new Float32Array([1, 2, 3]),
    1,
  ),
  true,
);
assert.equal(
  sameMechanicalGpuSelectionView(
    {
      priorityLink: 1,
      viewProjection: [1, 2, 3],
    },
    new Float32Array([1, 2, 3]),
    2,
  ),
  false,
);
assert.equal(
  sameMechanicalGpuSelectionView(
    {
      priorityLink: 1,
      viewProjection: [1, 2, 3],
    },
    new Float32Array([1, 2, 4]),
    1,
  ),
  false,
);
assert.equal(
  sameMechanicalGpuSelectionView(
    {
      priorityLink: 1,
      viewProjection: [1, 2],
    },
    new Float32Array([1, 2, 3]),
    1,
  ),
  false,
);

const timers = createTimers();
const diagnostics = [];
const logs = [];
let selectedKey = null;
let currentState = null;
let viewProjection =
  new Float32Array([1, 2, 3, 4]);

const controller =
  createMechanicalDetailSelectionController({
    getSelectedKey: () => selectedKey,
    getViewProjection: () =>
      viewProjection,
    frustumMargin: 0.18,
    defaultDelay: 70,
    isStateCurrent: (state) =>
      currentState === state,
    updateDiagnostics: () => {
      diagnostics.push("updated");
    },
    setTimeoutFn:
      (callback, milliseconds) =>
        timers.set(callback, milliseconds),
    clearTimeoutFn:
      (id) => timers.clear(id),
    log: (message) => logs.push(message),
  });

const fixture = createState();
const { state } = fixture;
currentState = state;

assert.equal(controller.selectedLinkIndex(state), -1);
selectedKey = "O";
assert.equal(controller.selectedLinkIndex(state), 1);
selectedKey = "missing";
assert.equal(controller.selectedLinkIndex(state), -1);
selectedKey = null;

fixture.setSnapshot({
  detailCapacity: 3,
  detailedLinkCount: 3,
});
const fullResult =
  controller.refresh(state, "initial-camera");
assert.equal(fullResult, null);
assert.equal(fixture.selectorCalls.length, 0);
assert.equal(state.detailSelectionView, null);
assert.deepEqual(state.detailSelection, {
  policy: "full-detail-identity/v1",
  reason: "initial-camera",
  detailedLinkCount: 3,
  culledLinkCount: 0,
  visibleCandidateCount: null,
  selectedPinned: false,
  hoveredPinned: false,
  centerCacheRevision: null,
});
assert.equal(diagnostics.length, 1);

fixture.setSnapshot({
  detailCapacity: 2,
  detailedLinkCount: 2,
});
state.hoveredCenterLink = 1;
selectedKey = "C";
const boundedResult =
  controller.refresh(state, "shared-selection");
assert.deepEqual(boundedResult, {
  detailedLinkCount: 2,
  indexUploadBytes: 8,
  globalsUploadBytes: 16,
  selectionControlUploadBytes: 4,
});
assert.equal(fixture.selectorCalls.length, 1);
assert.deepEqual(
  fixture.selectorCalls[0],
  {
    viewProjection,
    selectedLink: 2,
    frustumMargin: 0.18,
  },
);
assert.equal(state.detailSelectionUpdates, 1);
assert.equal(
  state.detailSelectionIndexUploadBytes,
  8,
);
assert.equal(
  state.detailSelectionGlobalsUploadBytes,
  16,
);
assert.equal(
  state.detailSelectionControlUploadBytes,
  4,
);
assert.deepEqual(
  state.detailSelectionView,
  {
    priorityLink: 2,
    viewProjection: [1, 2, 3, 4],
  },
);
assert.deepEqual(state.detailSelection, {
  policy: "gpu-partition-frustum/v1",
  reason: "shared-selection",
  detailedLinkCount: 2,
  culledLinkCount: 1,
  visibleCandidateCount: null,
  selectedPinned: true,
  hoveredPinned: false,
  centerCacheRevision: null,
});
assert.equal(diagnostics.length, 2);

const dedupResult =
  controller.refresh(
    state,
    "camera-interaction",
  );
assert.equal(dedupResult, null);
assert.equal(fixture.selectorCalls.length, 1);
assert.equal(
  state.detailSelection.reason,
  "camera-interaction",
);
assert.equal(state.detailSelectionUpdates, 1);
assert.equal(diagnostics.length, 3);

selectedKey = "missing";
fixture.selectorResults.push({
  detailedLinkCount: 1,
  indexUploadBytes: 2,
  globalsUploadBytes: 3,
  selectionControlUploadBytes: 5,
});
const hoverResult =
  controller.refresh(state, "hover-priority");
assert.equal(fixture.selectorCalls.length, 2);
assert.equal(
  fixture.selectorCalls.at(-1).selectedLink,
  1,
);
assert.deepEqual(hoverResult, {
  detailedLinkCount: 1,
  indexUploadBytes: 2,
  globalsUploadBytes: 3,
  selectionControlUploadBytes: 5,
});
assert.equal(state.detailSelectionUpdates, 2);
assert.equal(
  state.detailSelectionIndexUploadBytes,
  10,
);
assert.equal(
  state.detailSelectionGlobalsUploadBytes,
  19,
);
assert.equal(
  state.detailSelectionControlUploadBytes,
  9,
);
assert.equal(state.detailSelection.selectedPinned, false);
assert.equal(state.detailSelection.hoveredPinned, true);
assert.equal(state.detailSelection.culledLinkCount, 2);

selectedKey = "R";
viewProjection =
  new Float32Array([4, 3, 2, 1]);
controller.refresh(state, "shared-selection");
assert.equal(
  fixture.selectorCalls.at(-1).selectedLink,
  0,
);
assert.equal(state.detailSelection.selectedPinned, true);
assert.equal(state.detailSelection.hoveredPinned, false);

selectedKey = null;
state.hoveredCenterLink = -1;
viewProjection =
  new Float32Array([7, 8, 9, 10]);
controller.refresh(state, "camera-zoom");
assert.equal(
  fixture.selectorCalls.at(-1).selectedLink,
  -1,
);

const beforeStaleRefresh = diagnostics.length;
currentState = null;
assert.equal(
  controller.refresh(state, "stale"),
  null,
);
assert.equal(
  diagnostics.length,
  beforeStaleRefresh,
);
assert.equal(
  controller.schedule(
    state,
    "camera-interaction",
  ),
  false,
);
assert.equal(timers.size(), 0);

currentState = state;
assert.equal(
  controller.schedule(state, "camera-zoom"),
  true,
);
assert.equal(timers.size(), 1);
assert.deepEqual(timers.delays(), [70]);
const firstTimer = state.detailSelectionTimer;

assert.equal(
  controller.schedule(state, "auto-rotate", 0),
  true,
);
assert.equal(timers.size(), 1);
assert.deepEqual(timers.delays(), [0]);
assert.deepEqual(timers.cleared, [firstTimer]);

currentState = null;
const selectorCountBeforeStaleTimer =
  fixture.selectorCalls.length;
const diagnosticsBeforeStaleTimer =
  diagnostics.length;
await timers.runNext();
assert.equal(state.detailSelectionTimer, null);
assert.equal(
  fixture.selectorCalls.length,
  selectorCountBeforeStaleTimer,
);
assert.equal(
  diagnostics.length,
  diagnosticsBeforeStaleTimer,
);

currentState = state;
selectedKey = "O";
state.hoveredCenterLink = -1;
viewProjection =
  new Float32Array([10, 9, 8, 7]);
controller.schedule(
  state,
  "initial-camera",
  -20,
);
assert.deepEqual(timers.delays(), [0]);
await timers.runNext();
assert.equal(
  state.detailSelection.reason,
  "initial-camera",
);
assert.equal(
  fixture.selectorCalls.at(-1).selectedLink,
  1,
);

controller.schedule(state, "camera-zoom");
assert.equal(timers.size(), 1);
assert.equal(controller.cancel(state), true);
assert.equal(timers.size(), 0);
assert.equal(state.detailSelectionTimer, null);
assert.equal(controller.cancel(state), false);

fixture.state.shape.setGpuDetailSelectionView = () => {
  throw new Error("selector boom");
};
selectedKey = "C";
viewProjection =
  new Float32Array([11, 12, 13, 14]);
controller.schedule(state, "camera-interaction", 0);
await timers.runNext();
assert.equal(
  logs.some((message) =>
    message.includes(
      "ОШИБКА выбора detail-cache (camera-interaction) —",
    )
    && message.includes("selector boom")),
  true,
);

console.log(
  "Mechanical detail-selection controller executable contract: PASS",
);
