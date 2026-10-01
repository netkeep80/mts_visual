import assert from "node:assert/strict";
import {
  createMechanicalInteractionController,
} from "../browser/webgpu-witness/mechanical-interaction-controller.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
  }

  toggle(name, force) {
    if (force === true) {
      this.values.add(name);
      return true;
    }
    if (force === false) {
      this.values.delete(name);
      return false;
    }
    if (this.values.has(name)) {
      this.values.delete(name);
      return false;
    }
    this.values.add(name);
    return true;
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeCanvas {
  constructor() {
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.captured = new Set();
    this.rect = {
      left: 0,
      top: 0,
      width: 400,
      height: 300,
    };
  }

  addEventListener(type, handler, options = {}) {
    const list = this.listeners.get(type) ?? [];
    list.push({ handler, options });
    this.listeners.set(type, list);
    options.signal?.addEventListener(
      "abort",
      () => this.removeEventListener(type, handler),
      { once: true },
    );
  }

  removeEventListener(type, handler) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((entry) => entry.handler !== handler),
    );
  }

  listenerCount(type) {
    return (this.listeners.get(type) ?? []).length;
  }

  setPointerCapture(pointerId) {
    this.captured.add(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.captured.delete(pointerId);
  }

  getBoundingClientRect() {
    return { ...this.rect };
  }

  async dispatch(type, overrides = {}) {
    const event = {
      type,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      button: 0,
      shiftKey: false,
      deltaY: 0,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...overrides,
    };
    for (const { handler } of [
      ...(this.listeners.get(type) ?? []),
    ]) {
      await handler(event);
    }
    return event;
  }
}

function createTimers() {
  let nextId = 1;
  const entries = new Map();
  return {
    set(callback, milliseconds) {
      const id = nextId;
      nextId += 1;
      entries.set(id, { callback, milliseconds });
      return id;
    },
    clear(id) {
      entries.delete(id);
    },
    size() {
      return entries.size;
    },
    delays() {
      return [...entries.values()].map(
        (entry) => entry.milliseconds,
      );
    },
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createState() {
  const writes = [];
  let readCount = 0;
  const state = {
    camera: {
      yaw: 0,
      pitch: 0,
      distance: 10,
      defaultDistance: 10,
      minDistance: 2,
      maxDistance: 20,
      target: [0, 0, 0],
    },
    shape: {
      template: {
        diameter: 2,
      },
    },
    compute: {
      topology: {
        linkCount: 2,
        keys: ["R", "O"],
      },
      centerMass: 1.25,
      stretchStiffness: 2.5,
      straighteningStiffness: 3.75,
      simulationSpeed: 4,
      async readBackState() {
        readCount += 1;
        return {
          centers: new Float32Array([
            0, 0, 0,
            1, 0, 0,
          ]),
        };
      },
      writeCenterOverrides(overrides) {
        writes.push(overrides);
        return {
          centerBytes: 12,
          velocityBytes: 12,
        };
      },
    },
    centerDrag: null,
    hoveredCenterLink: -1,
    semanticCenterCache: [
      [0, 0, 0],
      [1, 0, 0],
    ],
    centerCacheRevision: 0,
  };
  return {
    state,
    writes,
    readCount: () => readCount,
  };
}

function near(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} ~= ${expected}`,
  );
}

const canvas = new FakeCanvas();
const timers = createTimers();
const showCenterMarkers = { checked: true };
const scheduleCalls = [];
const selectedKeys = [];
const pickCalls = [];
const dragDeltaCalls = [];
const statuses = [];
const logs = [];
let currentState = null;

const controller =
  createMechanicalInteractionController({
    canvas,
    showCenterMarkers,
    getMarkerControls: () => ({
      centerMarkerScale: 0.5,
    }),
    isStateCurrent: (state) =>
      currentState === state,
    scheduleDetailSelection:
      (state, reason, delay) => {
        scheduleCalls.push({
          state,
          reason,
          delay,
        });
      },
    setSelectedKey: (key) => {
      selectedKeys.push(key);
    },
    pickCenterIcosahedra3D:
      (origin, direction, centers, radius) => {
        pickCalls.push({
          origin,
          direction,
          centers,
          radius,
        });
        return 1;
      },
    screenDragDelta3D:
      (
        right,
        up,
        depth,
        viewportHeight,
        dx,
        dy,
      ) => {
        dragDeltaCalls.push({
          right,
          up,
          depth,
          viewportHeight,
          dx,
          dy,
        });
        return [dx * 0.1, dy * 0.1, 0];
      },
    setComputeStatus: (text, tone) => {
      statuses.push({ text, tone });
    },
    setTimeoutFn:
      (callback, milliseconds) =>
        timers.set(callback, milliseconds),
    clearTimeoutFn:
      (id) => timers.clear(id),
    log: (message) => logs.push(message),
  });

const first = createState();
currentState = first.state;
const cleanup = controller.mount(first.state);

for (const type of [
  "contextmenu",
  "pointerdown",
  "pointermove",
  "pointerleave",
  "pointerup",
  "pointercancel",
  "wheel",
]) {
  assert.equal(
    canvas.listenerCount(type),
    1,
    `missing mounted listener: ${type}`,
  );
}

await canvas.dispatch("pointerdown", {
  pointerId: 7,
  clientX: 100,
  clientY: 100,
  button: 0,
});
assert.equal(
  canvas.classList.contains("dragging"),
  true,
);
await canvas.dispatch("pointermove", {
  pointerId: 7,
  clientX: 110,
  clientY: 1100,
});
near(first.state.camera.yaw, -0.06);
near(
  first.state.camera.pitch,
  -Math.PI * 0.48,
);
assert.equal(
  scheduleCalls.at(-1).reason,
  "camera-interaction",
);
await canvas.dispatch("pointerup", {
  pointerId: 7,
});
assert.equal(
  canvas.classList.contains("dragging"),
  false,
);

first.state.camera.yaw = 0;
first.state.camera.pitch = 0;
first.state.camera.target = [0, 0, 0];
first.state.camera.distance = 10;
await canvas.dispatch("pointerdown", {
  pointerId: 8,
  clientX: 0,
  clientY: 0,
  button: 2,
});
await canvas.dispatch("pointermove", {
  pointerId: 8,
  clientX: 100,
  clientY: 50,
});
near(first.state.camera.target[0], 0);
near(first.state.camera.target[1], 0.75);
near(first.state.camera.target[2], 1.5);
assert.equal(
  scheduleCalls.at(-1).reason,
  "camera-interaction",
);
await canvas.dispatch("pointerup", {
  pointerId: 8,
});

first.state.camera.distance = 10;
const wheelEvent = await canvas.dispatch(
  "wheel",
  { deltaY: 10000 },
);
assert.equal(wheelEvent.defaultPrevented, true);
assert.equal(first.state.camera.distance, 20);
assert.equal(
  scheduleCalls.at(-1).reason,
  "camera-zoom",
);

await canvas.dispatch("pointermove", {
  clientX: 200,
  clientY: 150,
});
assert.equal(timers.size(), 1);
assert.deepEqual(timers.delays(), [35]);
assert.equal(first.readCount(), 0);
await timers.runNext();
assert.equal(first.readCount(), 1);
assert.equal(first.state.centerCacheRevision, 1);
assert.equal(first.state.hoveredCenterLink, 1);
assert.equal(
  canvas.classList.contains("center-hover"),
  true,
);
assert.equal(pickCalls.length, 1);
assert.equal(pickCalls[0].radius, 1);
assert.equal(
  scheduleCalls.at(-1).reason,
  "hover-priority",
);
assert.equal(
  scheduleCalls.at(-1).delay,
  0,
);

await canvas.dispatch("pointerdown", {
  pointerId: 9,
  clientX: 200,
  clientY: 150,
  button: 0,
});
assert.equal(first.state.centerDrag.linkIndex, 1);
assert.equal(first.state.centerDrag.key, "O");
assert.deepEqual(selectedKeys, ["O"]);
assert.equal(statuses.at(-1).tone, "warn");

await canvas.dispatch("pointermove", {
  pointerId: 9,
  clientX: 210,
  clientY: 155,
});
assert.equal(dragDeltaCalls.length, 1);
assert.equal(dragDeltaCalls[0].viewportHeight, 300);
assert.equal(dragDeltaCalls[0].dx, 10);
assert.equal(dragDeltaCalls[0].dy, 5);
assert.deepEqual(
  first.state.centerDrag.target,
  [2, 0.5, 0],
);

const dragStats =
  controller.applyCenterDrag(first.state);
assert.deepEqual(dragStats, {
  centerBytes: 12,
  velocityBytes: 12,
});
assert.deepEqual(first.writes, [[{
  linkIndex: 1,
  position: [2, 0.5, 0],
  velocity: [0, 0, 0],
}]]);

await canvas.dispatch("pointerup", {
  pointerId: 9,
});
assert.equal(first.state.centerDrag, null);
assert.equal(first.state.hoveredCenterLink, 1);
assert.equal(statuses.at(-1).tone, "ok");
assert.equal(
  logs.some((entry) =>
    entry.includes(
      "перетаскивание CENTER завершено: O",
    )),
  true,
);

showCenterMarkers.checked = false;
assert.equal(
  controller.clearCenterInteraction(first.state),
  true,
);
assert.equal(first.state.centerDrag, null);
assert.equal(first.state.hoveredCenterLink, -1);
assert.equal(
  canvas.classList.contains("center-hover"),
  false,
);
showCenterMarkers.checked = true;

const staleRead = deferred();
first.state.compute.readBackState = () => {
  return staleRead.promise;
};
await canvas.dispatch("pointermove", {
  clientX: 250,
  clientY: 150,
});
assert.equal(timers.size(), 1);
const hoverRun = timers.runNext();
await Promise.resolve();
await canvas.dispatch("pointerdown", {
  pointerId: 10,
  clientX: 250,
  clientY: 150,
  button: 0,
});
staleRead.resolve({
  centers: new Float32Array([
    9, 9, 9,
    8, 8, 8,
  ]),
});
await hoverRun;
assert.equal(
  first.state.centerCacheRevision,
  1,
  "stale hover readback must not publish",
);
await canvas.dispatch("pointerup", {
  pointerId: 10,
});

await canvas.dispatch("pointermove", {
  clientX: 50,
  clientY: 50,
});
assert.equal(timers.size(), 1);
cleanup();
cleanup();
assert.equal(timers.size(), 0);
assert.equal(first.state.centerDrag, null);
assert.equal(first.state.hoveredCenterLink, -1);
assert.equal(
  canvas.classList.contains("dragging"),
  false,
);
assert.equal(
  canvas.classList.contains("center-hover"),
  false,
);
for (const type of [
  "contextmenu",
  "pointerdown",
  "pointermove",
  "pointerleave",
  "pointerup",
  "pointercancel",
  "wheel",
]) {
  assert.equal(
    canvas.listenerCount(type),
    0,
    `listener leaked after cleanup: ${type}`,
  );
}

assert.equal(
  controller.applyCenterDrag(first.state),
  null,
);

console.log(
  "Mechanical interaction controller executable contract: PASS",
);
