import assert from "node:assert/strict";
import {
  createStructural2DController,
} from "../browser/webgpu-witness/structural-2d-controller.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor({ value = "", checked = false } = {}) {
    this.value = value;
    this.checked = checked;
    this.textContent = "";
    this.clientWidth = 800;
    this.clientHeight = 600;
    this.children = [];
    this.listeners = new Map();
    this.classList = new FakeClassList();
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
      handler({
        type,
        target: this,
        preventDefault() {},
        ...event,
      });
    }
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

class FakeSvg {
  constructor() {
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

class FakeViewport extends FakeElement {
  constructor() {
    super();
    this.svg = null;
    this.captured = [];
    this._innerHTML = "";
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.svg = String(value).includes("<svg")
      ? new FakeSvg()
      : null;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector(selector) {
    return selector === "svg" ? this.svg : null;
  }

  replaceChildren(...children) {
    super.replaceChildren(...children);
    if (children.length === 0) {
      this.svg = null;
      this._innerHTML = "";
    }
  }

  getBoundingClientRect() {
    return { left: 10, top: 20 };
  }

  setPointerCapture(pointerId) {
    this.captured.push(pointerId);
  }
}

function createUi() {
  return {
    structuralViewport: new FakeViewport(),
    structuralRoot: new FakeElement(),
    structuralSpacing: new FakeElement({ value: "120" }),
    structuralSpacingValue: new FakeElement(),
    structuralNodeSpacing: new FakeElement({ value: "72" }),
    structuralNodeSpacingValue: new FakeElement(),
    structuralOptimize: new FakeElement({ checked: true }),
    structuralFit: new FakeElement(),
    structuralReset: new FakeElement(),
    structuralExport: new FakeElement(),
    structuralComponents: new FakeElement(),
    structuralCrossings: new FakeElement(),
    structuralOptimizer: new FakeElement(),
    structuralLinkCount: new FakeElement(),
  };
}

const scene = Object.freeze({
  id: "fixture",
  label: "Fixture",
  hints: Object.freeze({ rootKey: "B" }),
  network: Object.freeze({
    links: Object.freeze([
      Object.freeze({ key: "C", startKey: "A", endKey: "B" }),
      Object.freeze({ key: "A", startKey: "B", endKey: "C" }),
      Object.freeze({ key: "B", startKey: "C", endKey: "A" }),
    ]),
  }),
});

const layoutCalls = [];
const serializeCalls = [];
const fitCalls = [];
const panCalls = [];
const zoomCalls = [];
let layoutGeneration = 0;

const core = {
  layoutStructural2D(network, options) {
    layoutGeneration += 1;
    layoutCalls.push({ network, options });
    return {
      generation: layoutGeneration,
      components: [{ id: 1 }, { id: 2 }],
      positions: [
        { key: "A", depth: 0 },
        { key: "B", depth: 2 },
        { key: "C", depth: 1 },
      ],
      metrics: {
        crossingsBefore: 7,
        crossingsAfter: 2,
        evaluations: 33,
        passes: 4,
      },
      bounds: {
        minX: -10,
        minY: -20,
        maxX: 300,
        maxY: 200,
      },
    };
  },

  serializeStructural2DSvg(network, layout) {
    serializeCalls.push({ network, layout });
    return `<svg data-generation="${layout.generation}"></svg>`;
  },

  fitBlueprintViewport(bounds, width, height, options) {
    fitCalls.push({ bounds, width, height, options });
    return { scale: 2, panX: 10, panY: 20 };
  },

  panBlueprintViewport(viewport, dx, dy) {
    panCalls.push({ viewport, dx, dy });
    return {
      ...viewport,
      panX: viewport.panX + dx,
      panY: viewport.panY + dy,
    };
  },

  zoomBlueprintViewport(viewport, factor, point, options) {
    zoomCalls.push({ viewport, factor, point, options });
    return {
      ...viewport,
      scale: viewport.scale * factor,
    };
  },
};

const ui = createUi();
const selectedKeys = [];
const downloads = [];
const logs = [];
let diagnosticsUpdates = 0;
const controlReads = [];

const controller = createStructural2DController({
  ui,
  core,
  getSelectedScene: () => scene,
  setSelectedKey: (key) => selectedKeys.push(key),
  updateSharedDiagnostics: () => {
    diagnosticsUpdates += 1;
  },
  controlNumber(control, label, minimum, maximum) {
    controlReads.push({ control, label, minimum, maximum });
    return Number(control.value);
  },
  downloadTextFile(text, filename, type) {
    downloads.push({ text, filename, type });
  },
  buildInfo: {
    mainSha: "1234567890abcdef1234567890abcdef12345678",
  },
  createOption: () => new FakeElement(),
  log: (message) => logs.push(message),
});

controller.mountControls();
controller.mountControls();

assert.equal(ui.structuralSpacing.listenerCount("input"), 1);
assert.equal(ui.structuralNodeSpacing.listenerCount("input"), 1);
assert.equal(ui.structuralRoot.listenerCount("change"), 1);
assert.equal(ui.structuralOptimize.listenerCount("change"), 1);
assert.equal(ui.structuralFit.listenerCount("click"), 1);
assert.equal(ui.structuralReset.listenerCount("click"), 1);
assert.equal(ui.structuralExport.listenerCount("click"), 1);

const cleanup = controller.mount();
assert.equal(controller.isMounted(), true);
assert.equal(controller.state().scene, scene);
assert.deepEqual(
  ui.structuralRoot.children.map((option) => option.value),
  ["", "A", "B", "C"],
);
assert.equal(
  ui.structuralRoot.children[0].textContent,
  "Без явного корня",
);
assert.equal(ui.structuralRoot.value, "B");
assert.equal(layoutCalls.length, 1);
assert.equal(layoutCalls[0].network, scene.network);
assert.deepEqual(layoutCalls[0].options, {
  rootKey: "B",
  layerSpacing: 120,
  minimumNodeSpacing: 72,
  optimizeCrossings: true,
  crossingPasses: 5,
  crossingEvaluations: 240,
});
assert.equal(ui.structuralSpacingValue.value, "120");
assert.equal(ui.structuralNodeSpacingValue.value, "72");
assert.equal(ui.structuralComponents.textContent, "2 / 3");
assert.equal(ui.structuralCrossings.textContent, "7 → 2");
assert.equal(
  ui.structuralOptimizer.textContent,
  "33 проверок · 4 проходов",
);
assert.equal(ui.structuralLinkCount.textContent, "3");
assert.equal(diagnosticsUpdates, 1);
assert.equal(fitCalls.length, 1);
assert.deepEqual(fitCalls[0], {
  bounds: controller.state().layout.bounds,
  width: 800,
  height: 600,
  options: { padding: 30, minScale: 0.05, maxScale: 16 },
});
assert.equal(
  ui.structuralViewport.svg.getAttribute("aria-label"),
  "Structural 2D: Fixture",
);
assert.equal(
  ui.structuralViewport.svg.getAttribute("viewBox"),
  "-5 -10 400 300",
);
assert.equal(
  ui.structuralViewport.svg.getAttribute("preserveAspectRatio"),
  "none",
);

const detail = controller.diagnosticDetail(scene);
assert.deepEqual(detail, {
  scc: 2,
  layers: 3,
  crossingsBefore: 7,
  crossingsAfter: 2,
  evaluations: 33,
  passes: 4,
  bounds: controller.state().layout.bounds,
});
assert.equal(
  controller.diagnosticDetail({ ...scene }),
  null,
);

const layoutBeforeFit = layoutCalls.length;
ui.structuralFit.fire("click");
assert.equal(layoutCalls.length, layoutBeforeFit);
assert.equal(fitCalls.length, 2);

ui.structuralSpacing.value = "140";
ui.structuralSpacing.fire("input");
assert.equal(layoutCalls.length, layoutBeforeFit + 1);
assert.equal(
  layoutCalls.at(-1).options.layerSpacing,
  140,
);
assert.equal(ui.structuralSpacingValue.value, "140");
assert.equal(fitCalls.length, 3);

ui.structuralNodeSpacing.value = "80";
ui.structuralNodeSpacing.fire("input");
assert.equal(
  layoutCalls.at(-1).options.minimumNodeSpacing,
  80,
);

ui.structuralRoot.value = "A";
ui.structuralRoot.fire("change");
assert.equal(layoutCalls.at(-1).options.rootKey, "A");

ui.structuralOptimize.checked = false;
ui.structuralOptimize.fire("change");
assert.equal(
  layoutCalls.at(-1).options.optimizeCrossings,
  false,
);

const beforeReset = layoutCalls.length;
ui.structuralReset.fire("click");
assert.equal(layoutCalls.length, beforeReset + 1);

const nodeTarget = {
  closest(selector) {
    assert.equal(selector, '[data-role="structural-node"]');
    return {
      getAttribute(name) {
        assert.equal(name, "data-link-key");
        return "C";
      },
    };
  },
};
let pointerDownPrevented = false;
ui.structuralViewport.fire("pointerdown", {
  button: 0,
  pointerId: 7,
  clientX: 100,
  clientY: 120,
  target: nodeTarget,
  preventDefault() {
    pointerDownPrevented = true;
  },
});
assert.equal(pointerDownPrevented, true);
assert.deepEqual(selectedKeys, ["C"]);
assert.equal(
  ui.structuralViewport.classList.contains("dragging"),
  true,
);
assert.deepEqual(ui.structuralViewport.captured, [7]);

let movePrevented = false;
ui.structuralViewport.fire("pointermove", {
  pointerId: 7,
  clientX: 112,
  clientY: 132,
  preventDefault() {
    movePrevented = true;
  },
});
assert.equal(movePrevented, true);
assert.equal(panCalls.length, 1);
assert.equal(panCalls[0].dx, 12);
assert.equal(panCalls[0].dy, 12);

ui.structuralViewport.fire("pointerup", {
  pointerId: 7,
});
assert.equal(
  ui.structuralViewport.classList.contains("dragging"),
  false,
);

let wheelPrevented = false;
ui.structuralViewport.fire("wheel", {
  deltaY: -100,
  clientX: 210,
  clientY: 220,
  preventDefault() {
    wheelPrevented = true;
  },
});
assert.equal(wheelPrevented, true);
assert.equal(zoomCalls.length, 1);
assert.ok(zoomCalls[0].factor > 1);
assert.deepEqual(zoomCalls[0].point, {
  x: 200,
  y: 200,
});
assert.deepEqual(zoomCalls[0].options, {
  minScale: 0.05,
  maxScale: 24,
});

ui.structuralExport.fire("click");
assert.equal(downloads.length, 1);
assert.equal(
  downloads[0].filename,
  "mts-visual-structural-fixture-1234567890ab.svg",
);
assert.equal(
  downloads[0].type,
  "image/svg+xml;charset=utf-8",
);
assert.match(downloads[0].text, /<svg/);
assert.match(logs.at(-1), /пересечения=2/);

const renderCountBeforeCleanup = layoutCalls.length;
cleanup();
cleanup();
assert.equal(controller.isMounted(), false);
assert.equal(controller.state(), null);
assert.equal(ui.structuralViewport.svg, null);
assert.equal(
  ui.structuralViewport.classList.contains("dragging"),
  false,
);
assert.equal(ui.structuralViewport.listenerCount("pointerdown"), 0);
assert.equal(ui.structuralViewport.listenerCount("pointermove"), 0);
assert.equal(ui.structuralViewport.listenerCount("pointerup"), 0);
assert.equal(ui.structuralViewport.listenerCount("pointercancel"), 0);
assert.equal(ui.structuralViewport.listenerCount("wheel"), 0);
assert.equal(controller.diagnosticDetail(scene), null);

ui.structuralReset.fire("click");
assert.equal(layoutCalls.length, renderCountBeforeCleanup);

controller.disposeControls();
assert.equal(ui.structuralSpacing.listenerCount("input"), 0);
assert.equal(ui.structuralNodeSpacing.listenerCount("input"), 0);
assert.equal(ui.structuralRoot.listenerCount("change"), 0);
assert.equal(ui.structuralOptimize.listenerCount("change"), 0);
assert.equal(ui.structuralFit.listenerCount("click"), 0);
assert.equal(ui.structuralReset.listenerCount("click"), 0);
assert.equal(ui.structuralExport.listenerCount("click"), 0);

assert.ok(
  controlReads.some(
    (entry) =>
      entry.label === "шаг структурных слоёв"
      && entry.minimum === 64
      && entry.maximum === 240,
  ),
);
assert.ok(
  controlReads.some(
    (entry) =>
      entry.label === "минимальное расстояние Structural"
      && entry.minimum === 36
      && entry.maximum === 160,
  ),
);

console.log("Structural 2D browser controller executable contract: PASS");
