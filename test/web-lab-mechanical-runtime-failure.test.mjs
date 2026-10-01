import assert from "node:assert/strict";
import {
  createMechanicalRuntimeController,
} from "../browser/webgpu-witness/mechanical-runtime-controller.js";

function makeUi() {
  const context = {
    unconfigureCount: 0,
    configure() {},
    unconfigure() {
      this.unconfigureCount += 1;
    },
    getCurrentTexture() {
      return {
        createView() {
          return {};
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

function makeFixture({ badStep = false } = {}) {
  const centerBuffer = {};
  const parameterBuffer = {};
  const detailLinkIndexBuffer = {};
  const sectionFrameBuffer = {};
  const counts = {
    computeDestroy: 0,
    shapeDestroy: 0,
    rendererDestroy: 0,
    depthDestroy: 0,
    interactionCleanup: 0,
    cancelRaf: 0,
  };

  const compute = {
    centerBuffer,
    topology: {
      linkCount: 1,
      keys: ["R"],
      startIndices: new Uint32Array([0]),
      endIndices: new Uint32Array([0]),
    },
    centerMass: 1,
    stretchStiffness: 1,
    straighteningStiffness: 1,
    nonlinearity: 0,
    dampingRate: 0.5,
    simulationSpeed: 1,
    step() {
      return {
        computePasses: badStep ? 1 : 2,
        dynamicStateUploadBytes: 0,
      };
    },
    snapshot() {
      return {
        centerBytes: 12,
        velocityBytes: 12,
        centerMass: 1,
        stretchStiffness: 1,
        straighteningStiffness: 1,
        nonlinearity: 0,
        dampingRate: 0.5,
        simulationSpeed: 1,
      };
    },
    setCenterMass() {},
    setStretchStiffness() {},
    setStraighteningStiffness() {},
    setNonlinearity() {},
    setDampingRate() {},
    setSimulationSpeed() {},
    destroy() {
      counts.computeDestroy += 1;
    },
  };

  let updateCount = 0;
  const shape = {
    parameterBuffer,
    detailLinkIndexBuffer,
    sectionFrameBuffer,
    template: {
      octahedronCount: 32,
      diameter: 2,
      restLength: 10,
    },
    update() {
      updateCount += 1;
      if (updateCount === 1) return {};
      return {
        compactDispatches: 1,
        selectorDispatches: 0,
        detailDispatches: 1,
        computePasses: 2,
        dynamicStateUploadBytes: 0,
        detailedLinkCount: 1,
        selectionMode: "full-detail",
      };
    },
    snapshot() {
      return {
        octahedronCount: 32,
        detailedLinkCount: 1,
        detailCapacity: 1,
        compactDynamicStateBytes: 64,
        detailDynamicStateBytes: 64,
        sectionFrameBytes: 64,
        selectionMode: "full-detail",
        selectionControlBytes: 64,
      };
    },
    destroy() {
      counts.shapeDestroy += 1;
    },
  };

  const renderer = {
    semanticCenterBuffer: centerBuffer,
    shapeParameterBuffer: parameterBuffer,
    shapeDetailLinkIndexBuffer: detailLinkIndexBuffer,
    shapeSectionFrameBuffer: sectionFrameBuffer,
    snapshot() {
      return {
        sharedSemanticCenterBuffer: true,
        sharedShapeParameterBuffer: true,
        dynamicStateUploadBytesPerFrame: 0,
        rendererDynamicStateBytes: 0,
      };
    },
    render() {
      return {
        detailedLinkCount: 1,
        dynamicStateUploadBytes: 0,
        bufferCopies: 0,
        readbacks: 0,
        drawCalls: 2,
      };
    },
    destroy() {
      counts.rendererDestroy += 1;
    },
  };

  const device = {
    createTexture() {
      return {
        createView() {
          return {};
        },
        destroy() {
          counts.depthDestroy += 1;
        },
      };
    },
  };

  return {
    compute,
    shape,
    renderer,
    device,
    counts,
  };
}

const scene = {
  label: "failure-test",
  network: {
    links: [
      {
        key: "R",
        startKey: "R",
        endKey: "R",
      },
    ],
  },
};
const physics = {
  octahedra: 32,
  aspectRatio: 10,
  nodeMass: 1,
  longitudinalStiffness: 1,
  transverseStiffness: 1,
  nonlinearity: 0,
  linearDampingRate: 0.5,
  simulationSpeed: 1,
};

function makeController({
  fixture,
  ui,
  context,
  failRenderer = false,
  logs = [],
  rafBox = {},
}) {
  return createMechanicalRuntimeController({
    ui,
    webgpu: {
      async createMonolithicLinkWebGpuCompute3D() {
        return fixture.compute;
      },
      async createMonolithicLinkWebGpuShape3D() {
        return fixture.shape;
      },
      async createMonolithicLinkWebGpuZeroCopyRenderer3D() {
        if (failRenderer) {
          throw new Error("renderer-create-failure");
        }
        return fixture.renderer;
      },
    },
    core: {
      createMonolithicLinkSpringPhysics3D() {
        return {
          semanticCenter() {
            return [0, 0, 0];
          },
        };
      },
      evaluateMonolithicLinkSpring3D() {
        return { energy: 0 };
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
    interactionController: {
      mount() {
        return () => {
          fixture.counts.interactionCleanup += 1;
        };
      },
      applyCenterDrag() {
        return null;
      },
      clearCenterInteraction() {
        return true;
      },
    },
    detailSelectionController: {
      refresh() {},
      schedule() {
        return true;
      },
      cancel() {
        return true;
      },
    },
    benchmarkIsRunning: () => false,
    resetCamera(camera, distance) {
      camera.yaw = -0.8;
      camera.pitch = 0.38;
      camera.distance = distance;
      camera.defaultDistance = distance;
      camera.minDistance = 2;
      camera.maxDistance = distance * 20;
      camera.target = [0, 0, 0];
    },
    createViewProjection() {
      return new Float32Array([1, 0, 0, 1]);
    },
    setStatus() {},
    uiStatus: {
      unavailable: "НЕДОСТУПНО",
      error: "ОШИБКА",
    },
    updateOverall() {},
    updateDiagnostics() {},
    equationForNetworkLink() {
      return "R→R";
    },
    fmt(value) {
      return String(value);
    },
    log(message) {
      logs.push(message);
    },
    requestAnimationFrameFn(callback) {
      rafBox.callback = callback;
      return 77;
    },
    cancelAnimationFrameFn(handle) {
      assert.equal(handle, 77);
      fixture.counts.cancelRaf += 1;
    },
    nowFn() {
      return 1000;
    },
    gpuRenderAttachmentUsage: 0x10,
  });
}

// Partial mount failure must release every resource already created.
{
  const fixture = makeFixture();
  const { ui, context } = makeUi();
  const controller = makeController({
    fixture,
    ui,
    context,
    failRenderer: true,
  });

  await assert.rejects(
    controller.mount(),
    /renderer-create-failure/,
  );
  assert.equal(controller.isMounted(), false);
  assert.equal(controller.didRenderPass(), false);
  assert.equal(context.unconfigureCount, 1);
  assert.equal(fixture.counts.shapeDestroy, 1);
  assert.equal(fixture.counts.computeDestroy, 1);
  assert.equal(fixture.counts.rendererDestroy, 0);
}

// A frame invariant failure must report and tear down the live mount.
{
  const fixture = makeFixture({ badStep: true });
  const { ui, context } = makeUi();
  const logs = [];
  const rafBox = {};
  const controller = makeController({
    fixture,
    ui,
    context,
    logs,
    rafBox,
  });

  await controller.mount();
  assert.equal(controller.isMounted(), true);
  assert.equal(typeof rafBox.callback, "function");

  rafBox.callback(1016);

  assert.equal(controller.isMounted(), false);
  assert.equal(controller.didRenderPass(), false);
  assert.equal(context.unconfigureCount, 1);
  assert.equal(fixture.counts.rendererDestroy, 1);
  assert.equal(fixture.counts.shapeDestroy, 1);
  assert.equal(fixture.counts.computeDestroy, 1);
  assert.equal(fixture.counts.interactionCleanup, 1);
  assert.equal(fixture.counts.cancelRaf, 1);
  assert.ok(
    logs.some((message) =>
      message.includes("ОШИБКА монолитного рендера")
      && message.includes("нарушен инвариант монолитной физики"),
    ),
  );
}

console.log(
  "Mechanical runtime failure-path executable contract: PASS",
);
