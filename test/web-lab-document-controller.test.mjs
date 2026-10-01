import assert from "node:assert/strict";
import {
  createDocument2DController,
} from "../browser/webgpu-witness/document-2d-controller.js";

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createUi() {
  return {
    documentViewport: new FakeViewport(),
    documentProfile: new FakeElement({ value: "article" }),
    documentStrategy: new FakeElement({ value: "canonical" }),
    documentRoot: new FakeElement(),
    documentFit: new FakeElement(),
    documentReset: new FakeElement(),
    documentExport: new FakeElement(),
    documentManifest: new FakeElement(),
    documentSeed: new FakeElement(),
    documentCrossings: new FakeElement(),
    documentOverlaps: new FakeElement(),
    documentOptimizer: new FakeElement(),
    documentDigest: new FakeElement(),
  };
}

const scene = Object.freeze({
  id: "fixture",
  label: "Fixture",
  hints: Object.freeze({ rootKey: "B" }),
  sourceRepository: "netkeep80/source",
  sourceSha: "abcdef1234567890",
  network: Object.freeze({
    links: Object.freeze([
      Object.freeze({ key: "C", startKey: "A", endKey: "B" }),
      Object.freeze({ key: "A", startKey: "B", endKey: "C" }),
      Object.freeze({ key: "B", startKey: "C", endKey: "A" }),
    ]),
  }),
});

let layoutGeneration = 0;
const layoutCalls = [];
const serializeCalls = [];
const fitCalls = [];
const panCalls = [];
const zoomCalls = [];
const manifestCalls = [];

const core = {
  layoutDocument2D(network, options) {
    layoutGeneration += 1;
    layoutCalls.push({ network, options });
    return {
      generation: layoutGeneration,
      profile: options.profile,
      bounds: {
        minX: -30,
        minY: -20,
        maxX: 330,
        maxY: 220,
      },
      metrics: {
        seedStrategy: `${options.strategy}-seed`,
        seedVariant: `variant-${layoutGeneration}`,
        seedCandidates: 4,
        zeroCrossingFound: true,
        optimizerEvaluations: 77,
        optimizerPasses: 6,
        qualityBefore: {
          crossings: 9,
          centerOverlaps: 3,
          labelOverlaps: 2,
          score: 99,
        },
        qualityAfter: {
          crossings: 1,
          centerOverlaps: 0,
          labelOverlaps: 1,
          score: 7,
        },
      },
    };
  },

  serializeDocument2DSvg(network, layout) {
    serializeCalls.push({ network, layout });
    return `<svg data-generation="${layout.generation}"></svg>`;
  },

  fitBlueprintViewport(bounds, width, height, options) {
    fitCalls.push({ bounds, width, height, options });
    return { scale: 2, panX: 20, panY: 10 };
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

  createDocument2DRenderManifest(args) {
    manifestCalls.push(args);
    return Object.freeze({
      schemaVersion: 1,
      ...args,
    });
  },
};

const ui = createUi();
const selectedKeys = [];
const downloads = [];
const logs = [];
const hashCalls = [];
let diagnosticsUpdates = 0;

function sha256Text(text) {
  const request = deferred();
  hashCalls.push({ text, request });
  return request.promise;
}

const controller = createDocument2DController({
  ui,
  core,
  getSelectedScene: () => scene,
  setSelectedKey: (key) => selectedKeys.push(key),
  updateSharedDiagnostics: () => {
    diagnosticsUpdates += 1;
  },
  sceneInputManifestText: (targetScene) =>
    `manifest:${targetScene.id}\n`,
  sha256Text,
  downloadTextFile(text, filename, type) {
    downloads.push({ text, filename, type });
  },
  buildInfo: {
    version: "0.6.0",
    mainSha: "1234567890abcdef1234567890abcdef12345678",
  },
  createOption: () => new FakeElement(),
  log: (message) => logs.push(message),
});

controller.mountControls();
controller.mountControls();
assert.equal(ui.documentProfile.listenerCount("change"), 1);
assert.equal(ui.documentStrategy.listenerCount("change"), 1);
assert.equal(ui.documentRoot.listenerCount("change"), 1);
assert.equal(ui.documentFit.listenerCount("click"), 1);
assert.equal(ui.documentReset.listenerCount("click"), 1);
assert.equal(ui.documentExport.listenerCount("click"), 1);
assert.equal(ui.documentManifest.listenerCount("click"), 1);

const cleanup = controller.mount();
assert.equal(controller.isMounted(), true);
assert.equal(controller.state().scene, scene);
assert.deepEqual(
  ui.documentRoot.children.map((option) => option.value),
  ["", "A", "B", "C"],
);
assert.equal(
  ui.documentRoot.children[0].textContent,
  "Без явного корня",
);
assert.equal(ui.documentRoot.value, "B");
assert.equal(layoutCalls.length, 1);
assert.equal(layoutCalls[0].network, scene.network);
assert.deepEqual(layoutCalls[0].options, {
  profile: "article",
  strategy: "canonical",
  rootKey: "B",
});
assert.equal(serializeCalls.length, 1);
assert.equal(
  ui.documentViewport.svg.getAttribute("aria-label"),
  "Document 2D: Fixture · article",
);
assert.equal(ui.documentSeed.textContent, "canonical-seed · variant-1 · 4 кандидатов");
assert.equal(ui.documentCrossings.textContent, "9 → 1 · найден 0-crossing");
assert.equal(ui.documentOverlaps.textContent, "центры 0 · подписи 1");
assert.equal(ui.documentOptimizer.textContent, "77 проверок · 6 проходов");
assert.equal(ui.documentDigest.textContent, "вычисляется…");
assert.equal(fitCalls.length, 1);
assert.deepEqual(fitCalls[0].options, {
  padding: 28,
  minScale: 0.05,
  maxScale: 16,
});
assert.equal(
  ui.documentViewport.svg.getAttribute("viewBox"),
  "-10 -5 450 300",
);
assert.equal(
  ui.documentViewport.svg.getAttribute("preserveAspectRatio"),
  "none",
);
assert.equal(diagnosticsUpdates, 1);

await flushMicrotasks();
assert.equal(hashCalls.length, 1);
assert.equal(hashCalls[0].text, controller.state().svgText);
hashCalls[0].request.resolve("1111111111111111-current");
await flushMicrotasks();
assert.equal(
  controller.state().outputDigest,
  "1111111111111111-current",
);
assert.equal(controller.state().digestError, null);
assert.equal(ui.documentDigest.textContent, "1111111111111111…");

assert.deepEqual(controller.diagnosticDetail(scene), {
  profile: "article",
  requestedStrategy: "canonical",
  seedStrategy: "canonical-seed",
  seedCandidates: 4,
  crossings: 1,
  centerOverlaps: 0,
  labelOverlaps: 1,
  evaluations: 77,
  passes: 6,
  svgSha256: "1111111111111111-current",
  bounds: controller.state().layout.bounds,
});
assert.equal(controller.diagnosticDetail({ ...scene }), null);

const layoutsBeforeFit = layoutCalls.length;
ui.documentFit.fire("click");
assert.equal(layoutCalls.length, layoutsBeforeFit);
assert.equal(fitCalls.length, 2);

// Two renders in succession: the older digest must never overwrite the newer render.
ui.documentProfile.value = "compact";
ui.documentProfile.fire("change");
await flushMicrotasks();
const staleHash = hashCalls.at(-1);
assert.equal(controller.state().digestGeneration, 2);
assert.equal(controller.state().outputDigest, null);

ui.documentStrategy.value = "balanced";
ui.documentStrategy.fire("change");
await flushMicrotasks();
const currentHash = hashCalls.at(-1);
assert.notEqual(currentHash, staleHash);
assert.equal(controller.state().digestGeneration, 3);

staleHash.request.resolve("2222222222222222-stale");
await flushMicrotasks();
assert.equal(controller.state().outputDigest, null);

currentHash.request.resolve("3333333333333333-current");
await flushMicrotasks();
assert.equal(
  controller.state().outputDigest,
  "3333333333333333-current",
);
assert.equal(ui.documentDigest.textContent, "3333333333333333…");

// A current digest failure is visible; stale failures are ignored by the same generation guard.
ui.documentRoot.value = "A";
ui.documentRoot.fire("change");
await flushMicrotasks();
const failedHash = hashCalls.at(-1);
failedHash.request.reject(new Error("synthetic-digest-failure"));
await flushMicrotasks();
assert.equal(controller.state().outputDigest, null);
assert.match(
  String(controller.state().digestError?.message),
  /synthetic-digest-failure/,
);
assert.equal(ui.documentDigest.textContent, "недоступен");
assert.match(logs.at(-1), /ОШИБКА SHA-256 Document SVG/);

// Selection, pan and zoom stay on the canonical shared viewport helpers.
const linkTarget = {
  closest(selector) {
    assert.equal(selector, '[data-role="document-link"]');
    return {
      getAttribute(name) {
        assert.equal(name, "data-link-key");
        return "C";
      },
    };
  },
};
let downPrevented = false;
ui.documentViewport.fire("pointerdown", {
  button: 0,
  pointerId: 7,
  clientX: 100,
  clientY: 120,
  target: linkTarget,
  preventDefault() {
    downPrevented = true;
  },
});
assert.equal(downPrevented, true);
assert.deepEqual(selectedKeys, ["C"]);
assert.equal(
  ui.documentViewport.classList.contains("dragging"),
  true,
);

let movePrevented = false;
ui.documentViewport.fire("pointermove", {
  pointerId: 7,
  clientX: 115,
  clientY: 140,
  preventDefault() {
    movePrevented = true;
  },
});
assert.equal(movePrevented, true);
assert.equal(panCalls.length, 1);
assert.equal(panCalls[0].dx, 15);
assert.equal(panCalls[0].dy, 20);
ui.documentViewport.fire("pointerup", { pointerId: 7 });
assert.equal(
  ui.documentViewport.classList.contains("dragging"),
  false,
);

let wheelPrevented = false;
ui.documentViewport.fire("wheel", {
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
  maxScale: 24,
});

// Render again and establish a current cached digest for export/provenance.
ui.documentReset.fire("click");
await flushMicrotasks();
const exportHash = hashCalls.at(-1);
exportHash.request.resolve("5555555555555555-output");
await flushMicrotasks();
assert.equal(
  controller.state().outputDigest,
  "5555555555555555-output",
);

ui.documentExport.fire("click");
assert.equal(downloads.length, 1);
assert.equal(
  downloads[0].filename,
  "mts-visual-document-fixture-compact-1234567890ab.svg",
);
assert.equal(
  downloads[0].type,
  "image/svg+xml;charset=utf-8",
);
assert.equal(downloads[0].text, controller.state().svgText);

// Cached outputDigest means manifest creation hashes only the exact input text.
const hashCountBeforeManifest = hashCalls.length;
const manifestPromise = controller.createManifest();
await flushMicrotasks();
assert.equal(hashCalls.length, hashCountBeforeManifest + 1);
assert.equal(hashCalls.at(-1).text, "manifest:fixture\n");
hashCalls.at(-1).request.resolve("input-digest-exact");
const manifest = await manifestPromise;
assert.equal(hashCalls.length, hashCountBeforeManifest + 1);
assert.equal(manifestCalls.length, 1);
assert.deepEqual(manifestCalls[0], {
  inputPath: "browser:fixture.json",
  inputDigest: "input-digest-exact",
  sourceRepository: "netkeep80/source",
  sourceSha: "abcdef1234567890",
  rendererVersion: "0.6.0",
  rendererSha: "1234567890abcdef1234567890abcdef12345678",
  profile: "compact",
  layoutOptions: {
    strategy: "balanced",
    rootKey: "A",
  },
  seedStrategy: "balanced-seed",
  quality: controller.state().layout.metrics.qualityAfter,
  outputPath:
    "browser:mts-visual-document-fixture-compact-1234567890ab.svg",
  outputDigest: "5555555555555555-output",
});

// Manifest export uses stable pretty JSON + newline and the same exact provenance filename.
const exportManifestPromise = controller.exportManifest();
await flushMicrotasks();
const manifestInputHash = hashCalls.at(-1);
assert.equal(manifestInputHash.text, "manifest:fixture\n");
manifestInputHash.request.resolve("input-digest-export");
await exportManifestPromise;
assert.equal(downloads.length, 2);
assert.equal(
  downloads[1].filename,
  "mts-visual-document-fixture-compact-1234567890ab.manifest.json",
);
assert.equal(
  downloads[1].type,
  "application/json;charset=utf-8",
);
assert.ok(downloads[1].text.endsWith("\n"));
assert.equal(
  JSON.parse(downloads[1].text).outputDigest,
  "5555555555555555-output",
);

// A pending render digest after cleanup must not mutate disposed state.
ui.documentProfile.value = "article";
ui.documentProfile.fire("change");
await flushMicrotasks();
const disposedTarget = controller.state();
const lateHash = hashCalls.at(-1);
assert.equal(disposedTarget.outputDigest, null);
const generationBeforeCleanup = disposedTarget.digestGeneration;

cleanup();
cleanup();
assert.equal(controller.isMounted(), false);
assert.equal(controller.state(), null);
assert.ok(disposedTarget.digestGeneration > generationBeforeCleanup);
assert.equal(ui.documentViewport.svg, null);
assert.equal(ui.documentViewport.listenerCount("pointerdown"), 0);
assert.equal(ui.documentViewport.listenerCount("pointermove"), 0);
assert.equal(ui.documentViewport.listenerCount("pointerup"), 0);
assert.equal(ui.documentViewport.listenerCount("pointercancel"), 0);
assert.equal(ui.documentViewport.listenerCount("wheel"), 0);

lateHash.request.resolve("late-digest-must-be-ignored");
await flushMicrotasks();
assert.equal(disposedTarget.outputDigest, null);
assert.equal(disposedTarget.digestError, null);
assert.equal(controller.diagnosticDetail(scene), null);

controller.disposeControls();
assert.equal(ui.documentProfile.listenerCount("change"), 0);
assert.equal(ui.documentStrategy.listenerCount("change"), 0);
assert.equal(ui.documentRoot.listenerCount("change"), 0);
assert.equal(ui.documentFit.listenerCount("click"), 0);
assert.equal(ui.documentReset.listenerCount("click"), 0);
assert.equal(ui.documentExport.listenerCount("click"), 0);
assert.equal(ui.documentManifest.listenerCount("click"), 0);

console.log("Document 2D browser controller executable contract: PASS");
