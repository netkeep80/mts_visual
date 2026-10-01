import assert from "node:assert/strict";
import {
  createMechanicalRuntimeController,
} from "../browser/webgpu-witness/mechanical-runtime-controller.js";

function createUi() {
  const context = {
    configured: null,
    unconfigureCount: 0,
    configure(options) {
      this.configured = options;
    },
    unconfigure() {
      this.unconfigureCount += 1;
    },
    getCurrentTexture() {
      return {
        createView() {
          return { kind: "color-view" };
        },
      };
    },
  };
  const canvas = {
    clientWidth: 320,
    clientHeight: 180,
    width: 0,
    height: 0,
    getContext(kind) {
      assert.equal(kind, "webgpu");
      return context;
    },
  };
  return {
    context,
    ui: {
      canvas,
      autoRotate: { checked: false },
      pauseRender: { textContent: "" },
      renderCompute: { textContent: "" },
      renderTopology: { textContent: "" },
      renderZeroCopy: { textContent: "" },
      renderFrames: { textContent: "" },
      inspectGeometry: { disabled: false },
      geometryBody: { innerHTML: "" },
    },
  };
}

function createRaf() {
  let nextId = 1;
  const callbacks = new Map();
  const cancelled = [];
  return {
    request(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      cancelled.push(id);
      callbacks.delete(id);
    },
    run(id, now) {
      const callback = callbacks.get(id);
      assert.ok(callback, `missing RAF ${id}`);
      callbacks.delete(id);
      callback(now);
    },
    latestId() {
      return Math.max(0, ...callbacks.keys());
    },
    count() {
      return callbacks.size;
    },
    cancelled,
  };
}

function createFixture() {
  const events = [];
  const centerBuffer = {};
  const parameterBuffer = {};
  const detailIndexBuffer = {};
  const sectionFrameBuffer = {};
  let physicsSteps = 0;
  let shapeUpdates = 0;
  let rendererCalls = 0;
  let computeDestroyed = 0;
  let shapeDestroyed = 0;
  let rendererDestroyed = 0;
  let depthDestroyed = 0;
  const setterCalls = [];
  let centerMass = 1.5;
  let stretchStiffness = 2;
  let straighteningStiffness = 3;
  let nonlinearity = 4;
  let dampingRate = 0.5;
  let simulationSpeed = 2;

  const compute = {
    centerBuffer,
    topology: {
      linkCount: 2,
      keys: ["R", "O"],
      startIndices: new Uint32Array([0, 0]),
      endIndices: new Uint32Array([1, 1]),
    },
    get centerMass() {
      return centerMass;
    },
    get stretchStiffness() {
      return stretchStiffness;
    },
    get straighteningStiffness() {
      return straighteningStiffness;
    },
    get nonlinearity() {
      return nonlinearity;
    },
    async readBackState() {
      return {
        centers: new Float32Array([
          0, 0, 0,
          1, 0, 0,
        ]),
        velocities: new Float32Array(6),
      };
    },
    step() {
      physicsSteps += 1;
      return {
        computePasses: 2,
        dynamicStateUploadBytes: 0,
      };
    },
    snapshot() {
      return {
        centerBytes: 24,
        velocityBytes: 24,
        centerMass,
        stretchStiffness,
        straighteningStiffness,
        nonlinearity,
        dampingRate,
        simulationSpeed,
      };
    },
    setCenterMass(value) {
      centerMass = value;
      setterCalls.push(["centerMass", value]);
    },
    setStretchStiffness(value) {
      stretchStiffness = value;
      setterCalls.push(["stretch", value]);
    },
    setStraighteningStiffness(value) {
      straighteningStiffness = value;
      setterCalls.push(["straightening", value]);
    },
    setNonlinearity(value) {
      nonlinearity = value;
      setterCalls.push(["nonlinearity", value]);
    },
    setDampingRate(value) {
      dampingRate = value;
      setterCalls.push(["damping", value]);
    },
    setSimulationSpeed(value) {
      simulationSpeed = value;
      setterCalls.push(["speed", value]);
    },
    destroy() {
      computeDestroyed += 1;
      events.push("compute.destroy");
    },
  };

  const shape = {
    parameterBuffer,
    detailLinkIndexBuffer: detailIndexBuffer,
    sectionFrameBuffer,
    selectionControlBytes: 64,
    template: {
      octahedronCount: 32,
      diameter: 2,
      restLength: 10,
    },
    update() {
      shapeUpdates += 1;
      if (shapeUpdates === 1) {
        return {};
      }
      return {
        compactDispatches: 1,
        selectorDispatches: 0,
        detailDispatches: 1,
        computePasses: 2,
        dynamicStateUploadBytes: 0,
        detailedLinkCount: 2,
        selectionMode: "full-detail",
      };
    },
    snapshot() {
      return {
        octahedronCount: 32,
        detailedLinkCount: 2,
        detailCapacity: 2,
        compactDynamicStateBytes: 128,
        detailDynamicStateBytes: 256,
        sectionFrameBytes: 96,
        selectionMode: "full-detail",
        selectionControlBytes: 64,
      };
    },
    destroy() {
      shapeDestroyed += 1;
      events.push("shape.destroy");
    },
  };

  const renderer = {
    semanticCenterBuffer: centerBuffer,
    shapeParameterBuffer: parameterBuffer,
    shapeDetailLinkIndexBuffer: detailIndexBuffer,
    shapeSectionFrameBuffer: sectionFrameBuffer,
    snapshot() {
      return {
        sharedSemanticCenterBuffer: true,
        sharedShapeParameterBuffer: true,
        dynamicStateUploadBytesPerFrame: 0,
        rendererDynamicStateBytes: 0,
      };
    },
    render(options) {
      rendererCalls += 1;
      events.push(["render", options]);
      return {
        detailedLinkCount: 2,
        dynamicStateUploadBytes: 0,
        bufferCopies: 0,
        readbacks: 0,
        drawCalls: 2,
      };
    },
    destroy() {
      rendererDestroyed += 1;
      events.push("renderer.destroy");
    },
  };

  const device = {
    createTexture(options) {
      events.push(["createTexture", options]);
      return {
        createView() {
          return { kind: "depth-view" };
        },
        destroy() {
          depthDestroyed += 1;
          events.push("depth.destroy");
        },
      };
    },
  };

  return {
    compute,
    shape,
    renderer,
    device,
    events,
    setterCalls,
    counts() {
      return {
        physicsSteps,
        shapeUpdates,
        rendererCalls,
        computeDestroyed,
        shapeDestroyed,
        rendererDestroyed,
        depthDestroyed,
      };
    },
  };
}

const { ui, context } = createUi();
const raf = createRaf();
const fixture = createFixture();
const statuses = [];
const detailCalls = [];
const interactionCalls = [];
const logs = [];
let benchmarkRunning = false;
let diagnosticsUpdates = 0;
let overallUpdates = 0;
let nowValue = 1000;
const physics = {
  octahedra: 32,
  aspectRatio: 10,
  nodeMass: 1.5,
  longitudinalStiffness: 2,
  transverseStiffness: 3,
  nonlinearity: 4,
  linearDampingRate: 0.5,
  simulationSpeed: 2,
};
const scene = {
  label: "test scene",
  network: {
    links: [
      { key: "R", startKey: "R", endKey: "O" },
      { key: "O", startKey: "R", endKey: "O" },
    ],
  },
};

const interactionController = {
  mount(state) {
    interactionCalls.push(["mount", state]);
    return () => {
      interactionCalls.push(["cleanup", state]);
    };
  },
  applyCenterDrag() {
    return null;
  },
  clearCenterInteraction(state) {
    interactionCalls.push(["clear", state]);
    return true;
  },
};

const detailSelectionController = {
  refresh(state, reason) {
    detailCalls.push(["refresh", state, reason]);
  },
  schedule(state, reason, delay) {
    detailCalls.push(["schedule", state, reason, delay]);
    return true;
  },
  cancel(state) {
    detailCalls.push(["cancel", state]);
    return true;
  },
};

const controller =
  createMechanicalRuntimeController({
    ui,
    webgpu: {
      async createMonolithicLinkWebGpuCompute3D(
        device,
        network,
        options,
      ) {
        assert.equal(device, fixture.device);
        assert.equal(network, scene.network);
        assert.deepEqual(options, {
          aspectRatio: 10,
          stretchStiffness: 2,
          straighteningStiffness: 3,
          nonlinearity: 4,
          centerMass: 1.5,
          dampingRate: 0.5,
          simulationSpeed: 2,
        });
        fixture.events.push("compute.create");
        return fixture.compute;
      },
      async createMonolithicLinkWebGpuShape3D(
        device,
        compute,
        aspectRatio,
        options,
      ) {
        assert.equal(device, fixture.device);
        assert.equal(compute, fixture.compute);
        assert.equal(aspectRatio, 10);
        assert.deepEqual(options, {
          detailCapacity: 2,
        });
        fixture.events.push("shape.create");
        return fixture.shape;
      },
      async createMonolithicLinkWebGpuZeroCopyRenderer3D(
        device,
        compute,
        shape,
        options,
      ) {
        assert.equal(device, fixture.device);
        assert.equal(compute, fixture.compute);
        assert.equal(shape, fixture.shape);
        assert.deepEqual(options, {
          colorFormat: "rgba8unorm",
          depthFormat: "depth24plus",
        });
        fixture.events.push("renderer.create");
        return fixture.renderer;
      },
    },
    core: {
      createMonolithicLinkSpringPhysics3D() {
        return {
          semanticCenter(index) {
            return [index, index + 1, index + 2];
          },
        };
      },
      evaluateMonolithicLinkSpring3D() {
        return { energy: 5 };
      },
    },
    getDevice: () => fixture.device,
    getScene: () => scene,
    getPhysics: () => physics,
    getRenderStyle: () => ({
      wireframe: false,
      smoothNormals: true,
    }),
    getMarkerControls: () => ({
      showCenterMarkers: false,
      showEndCones: true,
      centerMarkerScale: 1,
      endConeScale: 1,
    }),
    getPreferredCanvasFormat: () => "rgba8unorm",
    detailSlotBudget: 4096,
    autoRotateIntervalMs: 250,
    interactionController,
    detailSelectionController,
    benchmarkIsRunning: () => benchmarkRunning,
    resetCamera(camera, distance) {
      camera.yaw = -0.8;
      camera.pitch = 0.38;
      camera.distance = distance;
      camera.defaultDistance = distance;
      camera.minDistance = Math.max(2, distance * 0.08);
      camera.maxDistance = distance * 20;
      camera.target = [0, 0, 0];
    },
    createViewProjection() {
      return new Float32Array([1, 0, 0, 1]);
    },
    setStatus(element, text, tone) {
      element.textContent = text;
      statuses.push([element, text, tone]);
    },
    uiStatus: {
      unavailable: "НЕДОСТУПНО",
      error: "ОШИБКА",
    },
    updateOverall() {
      overallUpdates += 1;
    },
    updateDiagnostics() {
      diagnosticsUpdates += 1;
    },
    markDifferentialStale() {},
    equationForNetworkLink(link) {
      return `${link.startKey}→${link.endKey}`;
    },
    fmt(value) {
      return Number(value).toFixed(3);
    },
    log(message) {
      logs.push(message);
    },
    requestAnimationFrameFn:
      (callback) => raf.request(callback),
    cancelAnimationFrameFn:
      (handle) => raf.cancel(handle),
    nowFn: () => nowValue,
    gpuRenderAttachmentUsage: 0x10,
  });

const cleanup = await controller.mount();
assert.equal(typeof cleanup, "function");
assert.equal(controller.isMounted(), true);
assert.equal(controller.didRenderPass(), true);
assert.equal(context.configured.format, "rgba8unorm");
assert.equal(context.configured.alphaMode, "opaque");
assert.deepEqual(
  fixture.events.slice(0, 3),
  ["compute.create", "shape.create", "renderer.create"],
);
assert.equal(interactionCalls[0][0], "mount");
assert.equal(detailCalls[0][0], "refresh");
assert.equal(detailCalls[0][2], "initial-camera");
assert.equal(ui.pauseRender.textContent, "Пауза");
assert.equal(overallUpdates, 1);

const mounted = controller.state();
assert.ok(mounted);
assert.equal(mounted.frames, 0);
assert.equal(mounted.steps, 0);
assert.equal(mounted.shapeUpdates, 0);
assert.deepEqual(mounted.initialSemanticCenters, [
  [0, 1, 2],
  [1, 2, 3],
]);
assert.equal(mounted.linkIndexByKey.get("O"), 1);
assert.equal(raf.count(), 1);

const firstRaf = mounted.raf;
raf.run(firstRaf, 1016);
assert.equal(fixture.counts().physicsSteps, 1);
assert.equal(mounted.steps, 1);
assert.equal(mounted.shapeUpdates, 1);
assert.equal(mounted.frames, 1);
assert.equal(fixture.counts().rendererCalls, 1);
assert.equal(raf.count(), 1);
assert.equal(
  fixture.events.some(
    (event) =>
      Array.isArray(event)
      && event[0] === "createTexture"
      && event[1].format === "depth24plus",
  ),
  true,
);

benchmarkRunning = true;
const benchmarkRaf = mounted.raf;
const stepsBeforeBenchmark =
  fixture.counts().physicsSteps;
raf.run(benchmarkRaf, 1032);
assert.equal(
  fixture.counts().physicsSteps,
  stepsBeforeBenchmark,
);
assert.equal(mounted.frames, 1);
benchmarkRunning = false;

assert.equal(controller.togglePause(), true);
assert.equal(ui.pauseRender.textContent, "Продолжить");
const pausedRaf = mounted.raf;
raf.run(pausedRaf, 1048);
assert.equal(
  fixture.counts().physicsSteps,
  stepsBeforeBenchmark,
);
assert.equal(mounted.frames, 2);
assert.equal(controller.togglePause(), false);
assert.equal(ui.pauseRender.textContent, "Пауза");

physics.nodeMass = 2.25;
physics.longitudinalStiffness = 4;
physics.transverseStiffness = 5;
physics.nonlinearity = 6;
physics.linearDampingRate = 0.75;
physics.simulationSpeed = 3;
assert.equal(controller.applyLivePhysics(), true);
assert.deepEqual(fixture.setterCalls, [
  ["centerMass", 2.25],
  ["stretch", 4],
  ["straightening", 5],
  ["nonlinearity", 6],
  ["damping", 0.75],
  ["speed", 3],
]);

assert.equal(
  controller.scheduleSelectedLink(scene),
  true,
);
assert.equal(
  detailCalls.at(-1)[2],
  "shared-selection",
);
assert.equal(
  controller.clearCenterInteraction(),
  true,
);
assert.equal(
  interactionCalls.at(-1)[0],
  "clear",
);

const diagnostic =
  controller.diagnosticDetail(scene);
assert.equal(diagnostic.linkCount, 2);
assert.equal(diagnostic.zeroCopy.sharedSemanticCenterBuffer, true);
assert.equal(diagnostic.detail.slotBudget, 4096);
assert.equal(
  controller.diagnosticDetail({
    ...scene,
  }),
  null,
);

assert.equal(controller.resetView(), true);
assert.equal(mounted.camera.yaw, -0.8);

const geometry =
  await controller.inspectGeometry();
assert.equal(geometry.linkCount, 2);
assert.equal(ui.inspectGeometry.disabled, false);
assert.equal(
  ui.geometryBody.innerHTML.includes("R→O"),
  true,
);

cleanup();
assert.equal(controller.isMounted(), false);
assert.equal(controller.didRenderPass(), false);
assert.equal(fixture.counts().rendererDestroyed, 1);
assert.equal(fixture.counts().shapeDestroyed, 1);
assert.equal(fixture.counts().computeDestroyed, 1);
assert.equal(context.unconfigureCount, 1);
assert.equal(interactionCalls.at(-1)[0], "cleanup");
assert.equal(controller.dispose(), false);

const { ui: unavailableUi } = createUi();
const unavailableController =
  createMechanicalRuntimeController({
    ui: unavailableUi,
    webgpu: {},
    core: {},
    getDevice: () => null,
    getScene: () => scene,
    getPhysics: () => physics,
    getRenderStyle: () => ({}),
    getMarkerControls: () => ({}),
    getPreferredCanvasFormat: () => "rgba8unorm",
    detailSlotBudget: 4096,
    autoRotateIntervalMs: 250,
    interactionController,
    detailSelectionController,
    benchmarkIsRunning: () => false,
    resetCamera() {},
    createViewProjection() {
      return new Float32Array(16);
    },
    setStatus(element, text) {
      element.textContent = text;
    },
    uiStatus: {
      unavailable: "НЕДОСТУПНО",
      error: "ОШИБКА",
    },
    updateOverall() {},
    updateDiagnostics() {},
    markDifferentialStale() {},
    equationForNetworkLink() {
      return "";
    },
    fmt(value) {
      return String(value);
    },
    log() {},
    requestAnimationFrameFn() {
      return 1;
    },
    cancelAnimationFrameFn() {},
    nowFn() {
      return 0;
    },
    gpuRenderAttachmentUsage: 0x10,
  });
const unavailableCleanup =
  await unavailableController.mount();
assert.equal(
  unavailableUi.renderCompute.textContent,
  "НЕДОСТУПНО",
);
assert.equal(unavailableController.isMounted(), false);
unavailableCleanup();

console.log(
  "Mechanical runtime controller executable contract: PASS",
);
