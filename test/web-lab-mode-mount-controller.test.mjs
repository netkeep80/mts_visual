import assert from "node:assert/strict";
import {
  createLabModeMountController,
} from "../browser/webgpu-witness/lab-mode-mount-controller.js";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

function fakeElement() {
  return {
    hidden: false,
    classList: new FakeClassList(),
  };
}

function fakeUi() {
  return {
    mechanicalControls: fakeElement(),
    structuralControls: fakeElement(),
    blueprintControls: fakeElement(),
    documentControls: fakeElement(),
    classicControls: fakeElement(),
    canvas: fakeElement(),
    structuralViewport: fakeElement(),
    blueprintViewport: fakeElement(),
    documentViewport: fakeElement(),
    classicViewport: fakeElement(),
    modePlaceholder: fakeElement(),
    mechanicalCameraHint: fakeElement(),
    mechanicalRenderDiagnostics: fakeElement(),
    structuralRenderDiagnostics: fakeElement(),
    documentRenderDiagnostics: fakeElement(),
    classicRenderDiagnostics: fakeElement(),
    mechanicalGeometryPanel: fakeElement(),
    liveLab: fakeElement(),
  };
}

function controllerFixture({
  failMount = null,
  failCleanup = null,
} = {}) {
  const ui = fakeUi();
  const events = [];

  function mountFor(modeId) {
    return async () => {
      events.push(`mount:${modeId}`);
      if (failMount === modeId) {
        throw new Error(`mount-failure:${modeId}`);
      }
      return async () => {
        events.push(`cleanup:${modeId}`);
        if (failCleanup === modeId) {
          throw new Error(`cleanup-failure:${modeId}`);
        }
      };
    };
  }

  const controller = createLabModeMountController({
    ui,
    mountMechanical: mountFor("mechanical-3d"),
    mountStructural: mountFor("structural-2d"),
    mountBlueprint: mountFor("blueprint-2d"),
    mountDocument: mountFor("document-2d"),
    mountClassic: mountFor("classic-3d"),
    mountPlaceholder: async (modeId) => {
      events.push(`mount:placeholder:${modeId}`);
      if (failMount === modeId) {
        throw new Error(`mount-failure:${modeId}`);
      }
      return async () => {
        events.push(`cleanup:placeholder:${modeId}`);
        if (failCleanup === modeId) {
          throw new Error(`cleanup-failure:${modeId}`);
        }
      };
    },
    claimResources: (modeId) => {
      events.push(`claim:${modeId}`);
    },
    releaseResources: (modeId) => {
      events.push(`release:${modeId}`);
    },
  });

  return { controller, ui, events };
}

const SURFACES = Object.freeze({
  "structural-2d": {
    controls: "structuralControls",
    viewport: "structuralViewport",
    diagnostics: "structuralRenderDiagnostics",
  },
  "blueprint-2d": {
    controls: "blueprintControls",
    viewport: "blueprintViewport",
    diagnostics: null,
  },
  "document-2d": {
    controls: "documentControls",
    viewport: "documentViewport",
    diagnostics: "documentRenderDiagnostics",
  },
  "classic-3d": {
    controls: "classicControls",
    viewport: "classicViewport",
    diagnostics: "classicRenderDiagnostics",
  },
  "mechanical-3d": {
    controls: "mechanicalControls",
    viewport: "canvas",
    diagnostics: "mechanicalRenderDiagnostics",
  },
});

const CONTROL_FIELDS = Object.freeze([
  "mechanicalControls",
  "structuralControls",
  "blueprintControls",
  "documentControls",
  "classicControls",
]);

const VIEWPORT_FIELDS = Object.freeze([
  "canvas",
  "structuralViewport",
  "blueprintViewport",
  "documentViewport",
  "classicViewport",
]);

for (const [modeId, surface] of Object.entries(SURFACES)) {
  const { controller, ui } = controllerFixture();
  controller.applyVisibility(modeId);

  for (const field of CONTROL_FIELDS) {
    assert.equal(
      ui[field].hidden,
      field !== surface.controls,
      `${modeId}: control visibility mismatch for ${field}`,
    );
  }
  for (const field of VIEWPORT_FIELDS) {
    assert.equal(
      ui[field].hidden,
      field !== surface.viewport,
      `${modeId}: viewport visibility mismatch for ${field}`,
    );
  }

  assert.equal(ui.modePlaceholder.hidden, true);
  assert.equal(
    ui.liveLab.classList.contains("placeholder-mode"),
    false,
  );

  assert.equal(
    ui.mechanicalCameraHint.hidden,
    modeId !== "mechanical-3d",
  );
  assert.equal(
    ui.mechanicalGeometryPanel.hidden,
    modeId !== "mechanical-3d",
  );
  assert.equal(
    ui.mechanicalRenderDiagnostics.hidden,
    modeId !== "mechanical-3d",
  );
  assert.equal(
    ui.structuralRenderDiagnostics.hidden,
    modeId !== "structural-2d",
  );
  assert.equal(
    ui.documentRenderDiagnostics.hidden,
    modeId !== "document-2d",
  );
  assert.equal(
    ui.classicRenderDiagnostics.hidden,
    modeId !== "classic-3d",
  );
}

{
  const { controller, ui } = controllerFixture();
  controller.applyVisibility("future-mode");
  for (const field of [...CONTROL_FIELDS, ...VIEWPORT_FIELDS]) {
    assert.equal(ui[field].hidden, true);
  }
  assert.equal(ui.modePlaceholder.hidden, false);
  assert.equal(
    ui.liveLab.classList.contains("placeholder-mode"),
    true,
  );
  assert.equal(ui.mechanicalCameraHint.hidden, true);
  assert.equal(ui.mechanicalGeometryPanel.hidden, true);
}

for (const modeId of Object.keys(SURFACES)) {
  const { controller, events } = controllerFixture();
  const cleanup = await controller.mount(modeId);
  assert.deepEqual(
    events,
    [`mount:${modeId}`, `claim:${modeId}`],
    `${modeId}: mount must complete before resource claim`,
  );

  assert.equal(await cleanup(), true);
  assert.deepEqual(
    events,
    [
      `mount:${modeId}`,
      `claim:${modeId}`,
      `cleanup:${modeId}`,
      `release:${modeId}`,
    ],
  );

  assert.equal(await cleanup(), false);
  assert.equal(events.length, 4);
}

{
  const { controller, events } = controllerFixture();
  const cleanup = await controller.mount("future-mode");
  assert.deepEqual(events, [
    "mount:placeholder:future-mode",
    "claim:future-mode",
  ]);
  assert.equal(await cleanup(), true);
  assert.deepEqual(events, [
    "mount:placeholder:future-mode",
    "claim:future-mode",
    "cleanup:placeholder:future-mode",
    "release:future-mode",
  ]);
}

{
  const { controller, events } = controllerFixture({
    failMount: "structural-2d",
  });
  await assert.rejects(
    () => controller.mount("structural-2d"),
    /mount-failure:structural-2d/,
  );
  assert.deepEqual(events, ["mount:structural-2d"]);
}

{
  const { controller, events } = controllerFixture({
    failCleanup: "mechanical-3d",
  });
  const cleanup = await controller.mount("mechanical-3d");
  await assert.rejects(
    () => cleanup(),
    /cleanup-failure:mechanical-3d/,
  );
  assert.deepEqual(events, [
    "mount:mechanical-3d",
    "claim:mechanical-3d",
    "cleanup:mechanical-3d",
    "release:mechanical-3d",
  ]);
  assert.equal(await cleanup(), false);
  assert.equal(events.length, 4);
}

console.log("Web Lab mode mount controller executable contract: PASS");
