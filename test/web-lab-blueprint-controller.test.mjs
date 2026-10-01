import assert from "node:assert/strict";
import {
  createBlueprint2DController,
} from "../browser/webgpu-witness/blueprint-2d-controller.js";

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
    this.clientWidth = 900;
    this.clientHeight = 600;
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

  replaceChildren() {}
}

class FakeCenter {
  constructor(key) {
    this.key = key;
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    if (name === "data-link-key") return this.key;
    return this.attributes.get(name) ?? null;
  }
}

class FakeSvg {
  constructor() {
    this.attributes = new Map();
    this.centers = [
      new FakeCenter("A"),
      new FakeCenter("B"),
      new FakeCenter("C"),
    ];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  querySelectorAll(selector) {
    assert.equal(selector, '[data-role="blueprint-center"]');
    return this.centers;
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

  replaceChildren() {
    this.svg = null;
    this._innerHTML = "";
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
    blueprintViewport: new FakeViewport(),
    blueprintSpacing: new FakeElement({ value: "96" }),
    blueprintSpacingValue: new FakeElement(),
    blueprintLoopRadius: new FakeElement({ value: "28" }),
    blueprintLoopRadiusValue: new FakeElement(),
    blueprintClearance: new FakeElement({ value: "0.12" }),
    blueprintClearanceValue: new FakeElement(),
    blueprintLabels: new FakeElement({ checked: true }),
    blueprintFit: new FakeElement(),
    blueprintReset: new FakeElement(),
    blueprintExport: new FakeElement(),
  };
}

const sourceLinks = [
  { key: "A", startKey: "B", endKey: "C", label: "Alpha" },
  { key: "B", startKey: "C", endKey: "A" },
  { key: "C", startKey: "A", endKey: "B" },
];
const scene = {
  id: "fixture",
  label: "Fixture",
  network: { links: sourceLinks },
};

const initialCalls = [];
const geometryCalls = [];
const svgSceneCalls = [];
const serializeCalls = [];
const fitCalls = [];
const screenCalls = [];
const moveCalls = [];
const panCalls = [];
const zoomCalls = [];
let positionGeneration = 0;

const core = {
  createBlueprintInitialPositions(network, options) {
    positionGeneration += 1;
    initialCalls.push({ network, options });
    return network.links.map((link, index) => ({
      key: link.key,
      x: index * options.spacing,
      y: positionGeneration,
    }));
  },

  buildBlueprintGeometry(network, positions, options) {
    geometryCalls.push({ network, positions, options });
    return {
      network,
      positions,
      options,
      bounds: { minX: 0, minY: 0, maxX: 300, maxY: 200 },
    };
  },

  buildBlueprintSvgScene(network, geometry, options) {
    svgSceneCalls.push({ network, geometry, options });
    return {
      network,
      geometry,
      options,
      bounds: { minX: -20, minY: -10, maxX: 320, maxY: 210 },
    };
  },

  serializeBlueprintSvg(svgScene) {
    serializeCalls.push(svgScene);
    return "<svg></svg>";
  },

  fitBlueprintViewport(bounds, width, height, options) {
    fitCalls.push({ bounds, width, height, options });
    return { scale: 2, panX: 20, panY: 10 };
  },

  blueprintScreenToWorld(viewport, point) {
    screenCalls.push({ viewport, point });
    return { x: point.x / viewport.scale, y: point.y / viewport.scale };
  },

  moveBlueprintPosition(positions, key, world) {
    moveCalls.push({ positions, key, world });
    return positions.map((position) =>
      position.key === key
        ? { ...position, x: world.x, y: world.y }
        : position
    );
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
    return { ...viewport, scale: viewport.scale * factor };
  },
};

const ui = createUi();
const selectedKeys = [];
const downloads = [];
const logs = [];
const controlReads = [];
let diagnosticsUpdates = 0;

const controller = createBlueprint2DController({
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
  log: (message) => logs.push(message),
});

controller.mountControls();
controller.mountControls();
assert.equal(ui.blueprintSpacing.listenerCount("input"), 1);
assert.equal(ui.blueprintLoopRadius.listenerCount("input"), 1);
assert.equal(ui.blueprintClearance.listenerCount("input"), 1);
assert.equal(ui.blueprintLabels.listenerCount("change"), 1);
assert.equal(ui.blueprintFit.listenerCount("click"), 1);
assert.equal(ui.blueprintReset.listenerCount("click"), 1);
assert.equal(ui.blueprintExport.listenerCount("click"), 1);

const sourceSnapshot = JSON.stringify(scene.network);
const cleanup = controller.mount();
assert.equal(controller.isMounted(), true);
assert.equal(controller.state().scene, scene);
assert.equal(initialCalls.length, 1);
assert.equal(initialCalls[0].network, scene.network);
assert.deepEqual(initialCalls[0].options, { spacing: 96 });
assert.equal(ui.blueprintSpacingValue.value, "96");
assert.equal(ui.blueprintLoopRadiusValue.value, "28");
assert.equal(ui.blueprintClearanceValue.value, "0.12");
assert.equal(geometryCalls.length, 1);
assert.deepEqual(geometryCalls[0].options, {
  spacing: 96,
  loopRadius: 28,
  startOffsetFraction: 0.12,
  endOffsetFraction: 0.12,
});
assert.equal(geometryCalls[0].network.links[0].label, "Alpha");
assert.equal(geometryCalls[0].network.links[1].label, "B");
assert.equal(geometryCalls[0].network.links[2].label, "C");
assert.equal(JSON.stringify(scene.network), sourceSnapshot);
assert.equal(svgSceneCalls.length, 1);
assert.deepEqual(svgSceneCalls[0].options, { padding: 36 });
assert.equal(serializeCalls.length, 1);
assert.equal(fitCalls.length, 1);
assert.deepEqual(fitCalls[0].options, {
  padding: 28,
  minScale: 0.05,
  maxScale: 12,
});
assert.equal(
  ui.blueprintViewport.svg.getAttribute("aria-label"),
  "Blueprint 2D: Fixture",
);
for (const center of ui.blueprintViewport.svg.centers) {
  assert.equal(center.getAttribute("tabindex"), "0");
}
assert.equal(
  ui.blueprintViewport.svg.getAttribute("viewBox"),
  "-10 -5 450 300",
);
assert.equal(
  ui.blueprintViewport.svg.getAttribute("preserveAspectRatio"),
  "none",
);
assert.equal(diagnosticsUpdates, 1);

const detail = controller.diagnosticDetail(scene);
assert.deepEqual(detail, {
  positions: 3,
  bounds: controller.state().svgScene.bounds,
  viewport: controller.state().viewport,
});
assert.equal(controller.diagnosticDetail({ ...scene }), null);

const initialBeforeFit = initialCalls.length;
const geometryBeforeFit = geometryCalls.length;
ui.blueprintFit.fire("click");
assert.equal(initialCalls.length, initialBeforeFit);
assert.equal(geometryCalls.length, geometryBeforeFit);
assert.equal(fitCalls.length, 2);

const positionsBeforeLoop = controller.state().positions;
ui.blueprintLoopRadius.value = "35";
ui.blueprintLoopRadius.fire("input");
assert.equal(initialCalls.length, initialBeforeFit);
assert.equal(controller.state().positions, positionsBeforeLoop);
assert.equal(geometryCalls.at(-1).options.loopRadius, 35);

ui.blueprintClearance.value = "0.2";
ui.blueprintClearance.fire("input");
assert.equal(initialCalls.length, initialBeforeFit);
assert.equal(controller.state().positions, positionsBeforeLoop);
assert.equal(
  geometryCalls.at(-1).options.startOffsetFraction,
  0.2,
);
assert.equal(
  geometryCalls.at(-1).options.endOffsetFraction,
  0.2,
);

ui.blueprintLabels.checked = false;
ui.blueprintLabels.fire("change");
assert.ok(
  geometryCalls.at(-1).network.links.every(
    (link) => !("label" in link),
  ),
);
assert.equal(JSON.stringify(scene.network), sourceSnapshot);

ui.blueprintSpacing.value = "120";
ui.blueprintSpacing.fire("input");
assert.equal(initialCalls.length, initialBeforeFit + 1);
assert.deepEqual(initialCalls.at(-1).options, { spacing: 120 });
assert.equal(ui.blueprintSpacingValue.value, "120");

const beforeReset = initialCalls.length;
ui.blueprintReset.fire("click");
assert.equal(initialCalls.length, beforeReset + 1);
assert.deepEqual(initialCalls.at(-1).options, { spacing: 120 });

ui.blueprintLabels.checked = true;

const centerTarget = {
  closest(selector) {
    assert.equal(selector, '[data-role="blueprint-center"]');
    return {
      getAttribute(name) {
        assert.equal(name, "data-link-key");
        return "B";
      },
    };
  },
};
let downPrevented = false;
ui.blueprintViewport.fire("pointerdown", {
  button: 0,
  pointerId: 9,
  clientX: 100,
  clientY: 120,
  target: centerTarget,
  preventDefault() {
    downPrevented = true;
  },
});
assert.equal(downPrevented, true);
assert.deepEqual(selectedKeys, ["B"]);
assert.equal(controller.state().dragKey, "B");
assert.equal(
  ui.blueprintViewport.classList.contains("dragging"),
  true,
);

const initialBeforeDrag = initialCalls.length;
let dragPrevented = false;
ui.blueprintViewport.fire("pointermove", {
  pointerId: 9,
  clientX: 210,
  clientY: 220,
  preventDefault() {
    dragPrevented = true;
  },
});
assert.equal(dragPrevented, true);
assert.equal(screenCalls.length, 1);
assert.deepEqual(screenCalls[0].point, { x: 200, y: 200 });
assert.equal(moveCalls.length, 1);
assert.equal(moveCalls[0].key, "B");
assert.equal(initialCalls.length, initialBeforeDrag);
assert.ok(
  controller.state().positions.some(
    (position) => position.key === "B" && position.x === 100,
  ),
);

ui.blueprintViewport.fire("pointerup", { pointerId: 9 });
assert.equal(controller.state().dragKey, null);
assert.equal(
  ui.blueprintViewport.classList.contains("dragging"),
  false,
);

const backgroundTarget = {
  closest() {
    return null;
  },
};
ui.blueprintViewport.fire("pointerdown", {
  button: 0,
  pointerId: 10,
  clientX: 50,
  clientY: 60,
  target: backgroundTarget,
});
ui.blueprintViewport.fire("pointermove", {
  pointerId: 10,
  clientX: 65,
  clientY: 80,
});
assert.equal(panCalls.length, 1);
assert.equal(panCalls[0].dx, 15);
assert.equal(panCalls[0].dy, 20);
ui.blueprintViewport.fire("pointercancel", { pointerId: 10 });

let wheelPrevented = false;
ui.blueprintViewport.fire("wheel", {
  deltaY: -100,
  clientX: 210,
  clientY: 220,
  preventDefault() {
    wheelPrevented = true;
  },
});
assert.equal(wheelPrevented, true);
assert.equal(zoomCalls.length, 1);
assert.deepEqual(zoomCalls[0].point, { x: 200, y: 200 });
assert.deepEqual(zoomCalls[0].options, {
  minScale: 0.05,
  maxScale: 20,
});

ui.blueprintExport.fire("click");
assert.equal(downloads.length, 1);
assert.equal(
  downloads[0].filename,
  "mts-visual-blueprint-fixture-1234567890ab.svg",
);
assert.equal(
  downloads[0].type,
  "image/svg+xml;charset=utf-8",
);
assert.match(downloads[0].text, /<svg/);
assert.match(logs.at(-1), /связей=3/);

const initialBeforeCleanup = initialCalls.length;
cleanup();
cleanup();
assert.equal(controller.isMounted(), false);
assert.equal(controller.state(), null);
assert.equal(ui.blueprintViewport.svg, null);
assert.equal(ui.blueprintViewport.listenerCount("pointerdown"), 0);
assert.equal(ui.blueprintViewport.listenerCount("pointermove"), 0);
assert.equal(ui.blueprintViewport.listenerCount("pointerup"), 0);
assert.equal(ui.blueprintViewport.listenerCount("pointercancel"), 0);
assert.equal(ui.blueprintViewport.listenerCount("wheel"), 0);
assert.equal(controller.diagnosticDetail(scene), null);

ui.blueprintReset.fire("click");
assert.equal(initialCalls.length, initialBeforeCleanup);

controller.disposeControls();
assert.equal(ui.blueprintSpacing.listenerCount("input"), 0);
assert.equal(ui.blueprintLoopRadius.listenerCount("input"), 0);
assert.equal(ui.blueprintClearance.listenerCount("input"), 0);
assert.equal(ui.blueprintLabels.listenerCount("change"), 0);
assert.equal(ui.blueprintFit.listenerCount("click"), 0);
assert.equal(ui.blueprintReset.listenerCount("click"), 0);
assert.equal(ui.blueprintExport.listenerCount("click"), 0);

assert.ok(
  controlReads.some(
    (entry) =>
      entry.label === "шаг Blueprint"
      && entry.minimum === 48
      && entry.maximum === 220,
  ),
);
assert.ok(
  controlReads.some(
    (entry) =>
      entry.label === "радиус самопетли Blueprint"
      && entry.minimum === 12
      && entry.maximum === 100,
  ),
);
assert.ok(
  controlReads.some(
    (entry) =>
      entry.label === "отступ концов Blueprint"
      && entry.minimum === 0
      && entry.maximum === 0.30,
  ),
);

console.log("Blueprint 2D browser controller executable contract: PASS");
