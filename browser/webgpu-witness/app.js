import { runMechanicalWebGpuBenchmark } from "./benchmark.js";
import { createBenchmarkUiController } from "./benchmark-ui-controller.js";
import { createLabModeMountController } from "./lab-mode-mount-controller.js";
import { createStructural2DController } from "./structural-2d-controller.js";
import { createBlueprint2DController } from "./blueprint-2d-controller.js";
import { createDocument2DController } from "./document-2d-controller.js";
import { createClassic3DController } from "./classic-3d-controller.js";
import {
  createViewProjection,
  resetCamera,
} from "./mechanical-camera-model.js";
import { createMechanicalInteractionController } from "./mechanical-interaction-controller.js";
import { createMechanicalDetailSelectionController } from "./mechanical-detail-selection-controller.js";
import { createMechanicalRuntimeController } from "./mechanical-runtime-controller.js";
import { createLabCycleSelfTestController } from "./lab-cycle-selftest-controller.js";
import {
  IMPORTED_SCENE_ID,
  createImportedSceneFromText,
  createSceneInputManifest,
  serializeSceneInputManifest,
} from "./lab-input-model.js";
import {
  createSharedDiagnosticSnapshot as createSharedDiagnosticEnvelope,
  projectSharedDiagnosticDisplay,
  reconcileSelectedLinkKey,
  serializeSharedDiagnosticSnapshot,
  validateSelectedLinkKey,
} from "./lab-diagnostics-model.js";
import {
  LAB_REAL_CYCLE,
  LAB_REAL_CYCLE_REPEATS,
  assertLabResourceAudit,
  claimLabResourceLedger,
  createLabResourceLedger,
  releaseLabResourceLedger,
  snapshotLabResourceLedger,
} from "./lab-resource-model.js";

const $ = (id) => document.getElementById(id);

const ui = {
  build: $("build"),
  webgpu: $("webgpu"),
  baseline: $("baseline"),
  overall: $("overall"),
  diffBody: $("diff-body"),
  rigidDiffBody: $("rigid-diff-body"),
  monolithicDiffBody: $("monolithic-diff-body"),
  rerun: $("rerun"),
  canvas: $("gpu-canvas"),
  visualizationMode: $("visualization-mode"),
  modeStatus: $("mode-status"),
  labCopyDiagnostics: $("lab-copy-diagnostics"),
  labRunCycleTest: $("lab-run-cycle-test"),
  labCycleStatus: $("lab-cycle-status"),
  labResourceAudit: $("lab-resource-audit"),
  benchmarkLinks: $("benchmark-links"),
  benchmarkProfile: $("benchmark-profile"),
  benchmarkSeed: $("benchmark-seed"),
  benchmarkOcta: $("benchmark-octa"),
  benchmarkDetail: $("benchmark-detail"),
  benchmarkWarmup: $("benchmark-warmup"),
  benchmarkSamples: $("benchmark-samples"),
  benchmarkRender: $("benchmark-render"),
  benchmarkRun: $("benchmark-run"),
  benchmarkStop: $("benchmark-stop"),
  benchmarkCopy: $("benchmark-copy"),
  benchmarkDownload: $("benchmark-download"),
  benchmarkStatus: $("benchmark-status"),
  benchmarkProgress: $("benchmark-progress"),
  benchmarkResult: $("benchmark-result"),
  benchmarkCanvas: $("benchmark-canvas"),
  labDiagnosticMode: $("lab-diagnostic-mode"),
  labDiagnosticInput: $("lab-diagnostic-input"),
  labDiagnosticLinks: $("lab-diagnostic-links"),
  labDiagnosticSelected: $("lab-diagnostic-selected"),
  labDiagnosticVersion: $("lab-diagnostic-version"),
  labDiagnosticSha: $("lab-diagnostic-sha"),
  labDiagnosticDetail: $("lab-diagnostic-detail"),
  modeHeading: $("mode-heading"),
  modeDescription: $("mode-description"),
  liveLab: $("live-lab"),
  mechanicalControls: $("mechanical-controls"),
  structuralControls: $("structural-controls"),
  structuralViewport: $("structural-viewport"),
  structuralRoot: $("structural-root"),
  structuralSpacing: $("structural-spacing"),
  structuralSpacingValue: $("structural-spacing-value"),
  structuralNodeSpacing: $("structural-node-spacing"),
  structuralNodeSpacingValue: $("structural-node-spacing-value"),
  structuralOptimize: $("structural-optimize"),
  structuralFit: $("structural-fit"),
  structuralReset: $("structural-reset"),
  structuralExport: $("structural-export"),
  structuralRenderDiagnostics: $("structural-render-diagnostics"),
  structuralComponents: $("structural-components"),
  structuralCrossings: $("structural-crossings"),
  structuralOptimizer: $("structural-optimizer"),
  structuralLinkCount: $("structural-link-count"),
  mechanicalCameraHint: $("mechanical-camera-hint"),
  mechanicalRenderDiagnostics: $("mechanical-render-diagnostics"),
  mechanicalGeometryPanel: $("mechanical-geometry-panel"),
  blueprintControls: $("blueprint-controls"),
  blueprintViewport: $("blueprint-viewport"),
  blueprintSpacing: $("blueprint-spacing"),
  blueprintSpacingValue: $("blueprint-spacing-value"),
  blueprintLoopRadius: $("blueprint-loop-radius"),
  blueprintLoopRadiusValue: $("blueprint-loop-radius-value"),
  blueprintClearance: $("blueprint-clearance"),
  blueprintClearanceValue: $("blueprint-clearance-value"),
  blueprintLabels: $("blueprint-labels"),
  blueprintFit: $("blueprint-fit"),
  blueprintReset: $("blueprint-reset"),
  blueprintExport: $("blueprint-export"),
  documentControls: $("document-controls"),
  documentViewport: $("document-viewport"),
  documentProfile: $("document-profile"),
  documentStrategy: $("document-strategy"),
  documentRoot: $("document-root"),
  documentFit: $("document-fit"),
  documentReset: $("document-reset"),
  documentExport: $("document-export"),
  documentManifest: $("document-manifest"),
  documentRenderDiagnostics: $("document-render-diagnostics"),
  documentSeed: $("document-seed"),
  documentCrossings: $("document-crossings"),
  documentOverlaps: $("document-overlaps"),
  documentOptimizer: $("document-optimizer"),
  documentDigest: $("document-digest"),
  classicControls: $("classic-controls"),
  classicViewport: $("classic-viewport"),
  classicCharge: $("classic-charge"),
  classicChargeValue: $("classic-charge-value"),
  classicRestLength: $("classic-rest-length"),
  classicRestLengthValue: $("classic-rest-length-value"),
  classicStiffness: $("classic-stiffness"),
  classicStiffnessValue: $("classic-stiffness-value"),
  classicDamping: $("classic-damping"),
  classicDampingValue: $("classic-damping-value"),
  classicTimeStep: $("classic-time-step"),
  classicTimeStepValue: $("classic-time-step-value"),
  classicLabels: $("classic-labels"),
  classicPause: $("classic-pause"),
  classicReset: $("classic-reset"),
  classicFit: $("classic-fit"),
  classicFullscreen: $("classic-fullscreen"),
  classicRenderDiagnostics: $("classic-render-diagnostics"),
  classicTick: $("classic-tick"),
  classicEvaluations: $("classic-evaluations"),
  classicMaxVelocity: $("classic-max-velocity"),
  classicPinned: $("classic-pinned"),
  modePlaceholder: $("mode-placeholder"),
  scene: $("scene"),
  labInputJson: $("lab-input-json"),
  labInputApply: $("lab-input-apply"),
  labInputFileButton: $("lab-input-file-button"),
  labInputFile: $("lab-input-file"),
  labInputCopy: $("lab-input-copy"),
  labInputStatus: $("lab-input-status"),
  inspectGeometry: $("inspect-geometry"),
  geometryBody: $("geometry-body"),
  lengthOcta: $("length-octa"),
  lengthValue: $("length-value"),
  nodeMass: $("node-mass"),
  nodeMassValue: $("node-mass-value"),
  longitudinalStiffness: $("longitudinal-stiffness"),
  longitudinalStiffnessValue: $("longitudinal-stiffness-value"),
  transverseStiffness: $("transverse-stiffness"),
  transverseStiffnessValue: $("transverse-stiffness-value"),
  nonlinearity: $("nonlinearity"),
  nonlinearityValue: $("nonlinearity-value"),
  linearDamping: $("linear-damping"),
  linearDampingValue: $("linear-damping-value"),
  angularDamping: $("angular-damping"),
  angularDampingValue: $("angular-damping-value"),
  simulationSpeed: $("simulation-speed"),
  simulationSpeedValue: $("simulation-speed-value"),
  restartRender: $("restart-render"),
  resetView: $("reset-view"),
  autoRotate: $("auto-rotate"),
  globalWireframe: $("global-wireframe"),
  globalSmoothNormals: $("global-smooth-normals"),
  showCenterMarkers: $("show-center-markers"),
  showEndCones: $("show-end-cones"),
  centerMarkerScale: $("center-marker-scale"),
  centerMarkerScaleValue: $("center-marker-scale-value"),
  endConeScale: $("end-cone-scale"),
  endConeScaleValue: $("end-cone-scale-value"),
  pauseRender: $("pause-render"),
  fullscreenRender: $("fullscreen-render"),
  viewportShell: $("viewport-shell"),
  renderCompute: $("render-compute"),
  renderTopology: $("render-topology"),
  renderZeroCopy: $("render-zero-copy"),
  renderFrames: $("render-frames"),
  copyLog: $("copy-log"),
  saveLog: $("save-log"),
  log: $("log"),
};

function setStatus(element, text, kind = "") {
  element.textContent = text;
  element.className = `value ${kind}`.trim();
}

function log(message) {
  const now = new Date().toISOString().slice(11, 23);
  ui.log.textContent += `[${now}] ${message}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
}

const LAB_MODE_UI = Object.freeze({
  "structural-2d": Object.freeze({ label: "Структурный 2D", issue: 126, ready: true, description: "SCC + структурные слои · START/END incidence · детерминированная минимизация пересечений" }),
  "blueprint-2d": Object.freeze({ label: "Blueprint 2D", issue: 127, ready: true, description: "цельные связи START → CENTER → END · SVG · drag / pan / zoom" }),
  "document-2d": Object.freeze({ label: "Документный 2D", issue: 123, ready: true, description: "детерминированный one-shot publication layout · exact 180° CENTER · canonical SVG" }),
  "classic-3d": Object.freeze({ label: "Классический 3D", issue: 128, ready: true, description: "центры с взаимным отталкиванием + пружины инцидентности" }),
  "mechanical-3d": Object.freeze({ label: "Механический 3D", issue: 129, ready: true, description: "монолитная физика связи · WebGPU zero-copy" }),
});

function labModeUi(modeId) {
  return LAB_MODE_UI[modeId] ?? null;
}

const UI_STATUS = Object.freeze({
  pending: "ожидание",
  running: "выполняется…",
  pass: "ПРОЙДЕНО",
  stale: "УСТАРЕЛО",
  unavailable: "НЕДОСТУПНО",
  failed: "НЕ ПРОЙДЕНО",
  error: "ОШИБКА",
});

function fixtureDisplayName(name) {
  switch (name) {
    case "root-1-R": return "корень 1 · R";
    case "root-2-RO": return "корень 2 · R + O";
    case "root-3-ROC": return "корень 3 · R + O + C";
    case "root-4-ROCL": return "корень 4 · R + O + C + L";
    case "root-5-ROCLU": return "корень 5 · R + O + C + L + U";
    case "ordinary": return "обычная связь";
    case "START-self": return "самозамыкание START";
    case "END-self": return "самозамыкание END";
    case "double-self": return "двойное самозамыкание";
    default: return name;
  }
}

function diagnosticLogText() {
  const header = [
    "mts_visual — диагностический журнал лаборатории визуализации",
    `версия: ${buildInfo.version}`,
    `SHA сборки: ${buildInfo.mainSha}`,
    `страница: ${location.href}`,
    `агент пользователя: ${navigator.userAgent}`,
    "",
  ];
  return header.join("\n") + ui.log.textContent;
}

async function copyDiagnosticLog() {
  const text = diagnosticLogText();
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("не удалось скопировать журнал в буфер обмена");
  }

  const original = ui.copyLog.textContent;
  ui.copyLog.textContent = "Скопировано";
  setTimeout(() => {
    ui.copyLog.textContent = original;
  }, 1200);
}

function saveDiagnosticLog() {
  const text = diagnosticLogText();
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  anchor.href = url;
  anchor.download =
    `mts-visual-webgpu-${String(buildInfo.mainSha).slice(0, 12)}-${stamp}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function fmt(value) {
  if (value === null || value === undefined) return "—";
  if (!Number.isFinite(value)) return String(value);
  return Math.abs(value) < 1e-3 && value !== 0
    ? value.toExponential(3)
    : value.toFixed(6);
}

const [core, webgpu, threeVisual, buildInfo] = await Promise.all([
  import("./vendor/mts-visual-core.bundle.js"),
  import("./vendor/mts-visual-webgpu.bundle.js"),
  import("./vendor/mts-visual-three.bundle.js"),
  fetch("./build-info.json", { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error(`ошибка загрузки сведений о сборке: HTTP ${response.status}`);
    return response.json();
  }),
]);

for (const exportName of [
  "createOctahedralWebGpuZeroCopyRenderer3D",
  "createRigidSectionWebGpuZeroCopyRenderer3D",
  "createRigidSectionWebGpuCompute3D",
]) {
  if (typeof webgpu[exportName] !== "function") {
    throw new Error(`опубликованный WebGPU-пакет не содержит экспорт: ${exportName}`);
  }
}

for (const exportName of [
  "createVisualThreeLiveRenderer",
  "destroyVisualThreeRenderer",
  "fitVisualThreeRenderer",
  "setVisualThreeLivePaused",
]) {
  if (typeof threeVisual[exportName] !== "function") {
    throw new Error(`опубликованный Three-пакет не содержит экспорт: ${exportName}`);
  }
}

const baselineAspectRatio = core.OCTAHEDRAL_PRESENTATION_BASELINE_ASPECT_RATIO;
const baselineOctahedra = core.OCTAHEDRAL_PRESENTATION_BASELINE_OCTAHEDRA;
if (!Number.isFinite(baselineAspectRatio) || baselineOctahedra !== 20) {
  throw new Error("опубликованный пакет не содержит принятую базовую геометрию на 20 октаэдров");
}

setStatus(
  ui.build,
  `@mts/visual ${buildInfo.version} @ ${buildInfo.mainSha.slice(0, 12)}`,
  "ok",
);
setStatus(
  ui.baseline,
  `${baselineOctahedra} октаэдров · аспект ${baselineAspectRatio.toFixed(4)}`,
  "ok",
);

const LINK_OCTAHEDRON_CHOICES = Object.freeze([16, 32, 64, 128, 256]);

function controlNumber(element, label, minimum, maximum) {
  const value = Number(element.value);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`недопустимое значение «${label}»: ${element.value}`);
  }
  return value;
}

function selectedPhysics() {
  const octahedra = Number(ui.lengthOcta.value);
  if (!LINK_OCTAHEDRON_CHOICES.includes(octahedra)) {
    throw new Error(`недопустимое число октаэдров: ${ui.lengthOcta.value}`);
  }

  const nodeMass = controlNumber(ui.nodeMass, "масса CENTER", 0.05, 20);
  const longitudinalStiffness =
    controlNumber(ui.longitudinalStiffness, "жёсткость растяжения", 0, 100);
  const transverseStiffness =
    controlNumber(ui.transverseStiffness, "жёсткость выпрямления", 0, 100);
  const nonlinearity = controlNumber(ui.nonlinearity, "нелинейность", 0, 50);
  const linearDampingRate =
    controlNumber(ui.linearDamping, "демпфирование CENTER", 0, 10);
  const angularDampingRate =
    controlNumber(ui.angularDamping, "угловое демпфирование", 0, 10);
  const simulationSpeed =
    controlNumber(ui.simulationSpeed, "скорость симуляции", 0, 20);

  return Object.freeze({
    octahedra,
    aspectRatio: Math.SQRT2 * (octahedra / 2),
    nodeMass,
    longitudinalStiffness,
    transverseStiffness,
    nonlinearity,
    linearDampingRate,
    angularDampingRate,
    simulationSpeed,
  });
}

function physicsSignature(physics = selectedPhysics()) {
  return [
    physics.octahedra,
    physics.nodeMass.toFixed(4),
    physics.longitudinalStiffness.toFixed(4),
    physics.transverseStiffness.toFixed(4),
    physics.nonlinearity.toFixed(4),
    physics.linearDampingRate.toFixed(4),
    physics.angularDampingRate.toFixed(4),
    physics.simulationSpeed.toFixed(4),
  ].join(":");
}

function monolithicPhysicsSignature(physics = selectedPhysics()) {
  return [
    physics.octahedra,
    physics.nodeMass.toFixed(4),
    physics.longitudinalStiffness.toFixed(4),
    physics.transverseStiffness.toFixed(4),
    physics.nonlinearity.toFixed(4),
    physics.linearDampingRate.toFixed(4),
    physics.simulationSpeed.toFixed(4),
  ].join(":");
}

function refreshPhysicsControlLabels() {
  const physics = selectedPhysics();
  ui.lengthValue.value =
    `${physics.octahedra} октаэдров · аспект ${physics.aspectRatio.toFixed(3)}`;
  ui.nodeMassValue.value = physics.nodeMass.toFixed(2);
  ui.longitudinalStiffnessValue.value =
    physics.longitudinalStiffness.toFixed(2);
  ui.transverseStiffnessValue.value =
    physics.transverseStiffness.toFixed(2);
  ui.nonlinearityValue.value = physics.nonlinearity.toFixed(2);
  ui.linearDampingValue.value = physics.linearDampingRate.toFixed(2);
  ui.angularDampingValue.value = physics.angularDampingRate.toFixed(2);
  ui.simulationSpeedValue.value = `${physics.simulationSpeed.toFixed(2)}×`;
}

function selectedGlobalRenderControls() {
  return Object.freeze({
    wireframe: ui.globalWireframe.checked,
    smoothNormals: ui.globalSmoothNormals.checked,
  });
}

function selectedMarkerControls() {
  return Object.freeze({
    showCenterMarkers: ui.showCenterMarkers.checked,
    showEndCones: ui.showEndCones.checked,
    centerMarkerScale:
      controlNumber(ui.centerMarkerScale, "размер маркера CENTER", 0.25, 8),
    endConeScale:
      controlNumber(ui.endConeScale, "размер конуса END", 0.25, 8),
  });
}

function refreshMarkerControlLabels() {
  const markers = selectedMarkerControls();
  ui.centerMarkerScaleValue.value = `${markers.centerMarkerScale.toFixed(2)}×`;
  ui.endConeScaleValue.value = `${markers.endConeScale.toFixed(2)}×`;
}

refreshPhysicsControlLabels();
refreshMarkerControlLabels();

const ROOT_BASIS = Object.freeze([
  Object.freeze({ key: "R", startKey: "R", endKey: "R", equation: "R = R ⟼ R" }),
  Object.freeze({ key: "O", startKey: "O", endKey: "R", equation: "O = O ⟼ R" }),
  Object.freeze({ key: "C", startKey: "R", endKey: "C", equation: "C = R ⟼ C" }),
  Object.freeze({ key: "L", startKey: "O", endKey: "C", equation: "L = O ⟼ C" }),
  Object.freeze({ key: "U", startKey: "C", endKey: "O", equation: "U = C ⟼ O" }),
]);

function rootBasisNetwork(count) {
  return core.createRootBasisNetwork(count);
}

function equationForNetworkLink(link) {
  const root = ROOT_BASIS.find((candidate) => candidate.key === link.key
    && candidate.startKey === link.startKey
    && candidate.endKey === link.endKey);
  return root?.equation ?? `${link.key} = ${link.startKey} ⟼ ${link.endKey}`;
}

const fixtures = [
  { name: "root-1-R", network: rootBasisNetwork(1) },
  { name: "root-2-RO", network: rootBasisNetwork(2) },
  { name: "root-3-ROC", network: rootBasisNetwork(3) },
  { name: "root-4-ROCL", network: rootBasisNetwork(4) },
  { name: "root-5-ROCLU", network: rootBasisNetwork(5) },
  {
    name: "ordinary",
    network: {
      links: [
        { key: "A", startKey: "B", endKey: "C" },
        { key: "B", startKey: "C", endKey: "D" },
        { key: "C", startKey: "D", endKey: "A" },
        { key: "D", startKey: "A", endKey: "B" },
      ],
    },
  },
  {
    name: "START-self",
    network: {
      links: [
        { key: "A", startKey: "A", endKey: "B" },
        { key: "B", startKey: "A", endKey: "A" },
      ],
    },
  },
  {
    name: "END-self",
    network: {
      links: [
        { key: "A", startKey: "B", endKey: "A" },
        { key: "B", startKey: "A", endKey: "A" },
      ],
    },
  },
  {
    name: "double-self",
    network: {
      links: [{ key: "R", startKey: "R", endKey: "R" }],
    },
  },
];

const DIFFERENTIAL_STEPS = 4;
const DIFFERENTIAL_TOLERANCE = 2e-3;
const RIGID_DIFFERENTIAL_TOLERANCE = 3e-3;
const MONOLITHIC_DIFFERENTIAL_TOLERANCE = 3e-3;

let adapter = null;
let device = null;
let differentialAllPass = false;
let rigidDifferentialAllPass = false;
let monolithicDifferentialAllPass = false;
let differentialPhysicsSignature = null;
let rigidDifferentialPhysicsSignature = null;
let monolithicDifferentialPhysicsSignature = null;
let mechanicalRuntimeController = null;

const MECHANICAL_DETAIL_SLOT_BUDGET = 4096;
const MECHANICAL_DETAIL_FRUSTUM_MARGIN = 0.18;
const MECHANICAL_DETAIL_CAMERA_DEBOUNCE_MS = 70;
const MECHANICAL_DETAIL_AUTOROTATE_INTERVAL_MS = 250;

const mechanicalDetailSelectionController =
  createMechanicalDetailSelectionController({
    getSelectedKey: () => selectedVisualKey,
    getViewProjection: (state) =>
      createViewProjection(
        state.camera,
        ui.canvas.width,
        ui.canvas.height,
      ),
    frustumMargin:
      MECHANICAL_DETAIL_FRUSTUM_MARGIN,
    defaultDelay:
      MECHANICAL_DETAIL_CAMERA_DEBOUNCE_MS,
    isStateCurrent: (state) =>
      mechanicalRuntimeController?.state() === state,
    updateDiagnostics: () =>
      updateSharedDiagnostics(),
    setTimeoutFn: (callback, milliseconds) =>
      window.setTimeout(callback, milliseconds),
    clearTimeoutFn: (timer) =>
      window.clearTimeout(timer),
    log,
  });

const mechanicalInteractionController =
  createMechanicalInteractionController({
    canvas: ui.canvas,
    showCenterMarkers: ui.showCenterMarkers,
    getMarkerControls: () => selectedMarkerControls(),
    isStateCurrent: (state) =>
      mechanicalRuntimeController?.state() === state,
    scheduleDetailSelection:
      (state, reason, delay) =>
        mechanicalDetailSelectionController.schedule(
          state,
          reason,
          delay,
        ),
    setSelectedKey: (key) =>
      setSelectedVisualKey(key),
    pickCenterIcosahedra3D:
      webgpu.pickRigidSectionCenterIcosahedra3D,
    screenDragDelta3D:
      webgpu.rigidSectionScreenDragDelta3D,
    setComputeStatus: (text, tone) =>
      setStatus(ui.renderCompute, text, tone),
    setTimeoutFn: (callback, milliseconds) =>
      window.setTimeout(callback, milliseconds),
    clearTimeoutFn: (timer) =>
      window.clearTimeout(timer),
    log,
  });

mechanicalRuntimeController =
  createMechanicalRuntimeController({
    ui,
    webgpu,
    core,
    getDevice: () => device,
    getScene: () => selectedScene(),
    getPhysics: () => selectedPhysics(),
    getRenderStyle: () =>
      selectedGlobalRenderControls(),
    getMarkerControls: () =>
      selectedMarkerControls(),
    getPreferredCanvasFormat: () =>
      navigator.gpu.getPreferredCanvasFormat(),
    detailSlotBudget:
      MECHANICAL_DETAIL_SLOT_BUDGET,
    autoRotateIntervalMs:
      MECHANICAL_DETAIL_AUTOROTATE_INTERVAL_MS,
    interactionController:
      mechanicalInteractionController,
    detailSelectionController:
      mechanicalDetailSelectionController,
    benchmarkIsRunning: () =>
      benchmarkController.isRunning(),
    resetCamera,
    createViewProjection,
    setStatus,
    uiStatus: UI_STATUS,
    updateOverall: () => updateOverall(),
    updateDiagnostics: () =>
      updateSharedDiagnostics(),
    equationForNetworkLink,
    fmt,
    log,
    requestAnimationFrameFn: (callback) =>
      requestAnimationFrame(callback),
    cancelAnimationFrameFn: (handle) =>
      cancelAnimationFrame(handle),
    nowFn: () => performance.now(),
    gpuRenderAttachmentUsage:
      globalThis.GPUTextureUsage
        ?.RENDER_ATTACHMENT
      ?? 0x10,
  });

const benchmarkController = createBenchmarkUiController({
  ui,
  selectedPhysics,
  getAdapter: () => adapter,
  getInteractiveDevice: () => device,
  isMechanicalMounted: () =>
    mechanicalRuntimeController.isMounted(),
  runBenchmark: runMechanicalWebGpuBenchmark,
  webgpu,
  buildInfo,
  copyText,
  downloadTextFile,
  log,
});
benchmarkController.mount();

function differentialIsCurrent() {
  return monolithicDifferentialAllPass
    && monolithicDifferentialPhysicsSignature
      === monolithicPhysicsSignature();
}

function markDifferentialStale() {
  differentialAllPass = false;
  rigidDifferentialAllPass = false;
  monolithicDifferentialAllPass = false;
  for (const collection of [rows, rigidRows, monolithicRows]) {
    for (const row of collection.values()) {
      const status = row.querySelector(".status");
      if (status.textContent === UI_STATUS.pass) {
        status.textContent = UI_STATUS.stale;
        status.className = "status warn";
      }
    }
  }
  updateOverall();
}

function updateOverall() {
  const differentialCurrent = differentialIsCurrent();
  const renderPass =
    mechanicalRuntimeController?.didRenderPass()
    ?? false;
  if (differentialCurrent && renderPass) {
    setStatus(ui.overall, "ПРОЙДЕНО — монолитная проверка + zero-copy рендеринг", "ok");
  } else if (device === null) {
    setStatus(ui.overall, UI_STATUS.unavailable, "warn");
  } else if (differentialCurrent || renderPass) {
    setStatus(ui.overall, "ЧАСТИЧНО — см. диагностику", "warn");
  } else {
    setStatus(ui.overall, "НЕ ПРОЙДЕНО / ожидание", "fail");
  }
}

function differentialRow(name) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${name}</td>
    <td class="status">${UI_STATUS.pending}</td>
    <td>${DIFFERENTIAL_STEPS}</td>
    <td>${DIFFERENTIAL_TOLERANCE}</td>
    <td class="pos">—</td>
    <td class="vel">—</td>
  `;
  return tr;
}

const rows = new Map();
for (const fixture of fixtures) {
  const row = differentialRow(fixtureDisplayName(fixture.name));
  rows.set(fixture.name, row);
  ui.diffBody.appendChild(row);
}

function rigidDifferentialRow(name) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${name}</td>
    <td class="status">${UI_STATUS.pending}</td>
    <td>${DIFFERENTIAL_STEPS}</td>
    <td>${RIGID_DIFFERENTIAL_TOLERANCE}</td>
    <td class="center">—</td>
    <td class="quat">—</td>
    <td class="linear">—</td>
    <td class="angular">—</td>
  `;
  return tr;
}

const rigidRows = new Map();
for (const fixture of fixtures) {
  const row = rigidDifferentialRow(fixtureDisplayName(fixture.name));
  rigidRows.set(fixture.name, row);
  ui.rigidDiffBody.appendChild(row);
}

function monolithicDifferentialRow(name) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${name}</td>
    <td class="status">${UI_STATUS.pending}</td>
    <td>${DIFFERENTIAL_STEPS}</td>
    <td>${MONOLITHIC_DIFFERENTIAL_TOLERANCE}</td>
    <td class="center">—</td>
    <td class="velocity">—</td>
  `;
  return tr;
}

const monolithicRows = new Map();
for (const fixture of fixtures) {
  const row = monolithicDifferentialRow(fixtureDisplayName(fixture.name));
  monolithicRows.set(fixture.name, row);
  ui.monolithicDiffBody.appendChild(row);
}

async function acquireDevice() {
  if (!("gpu" in navigator)) {
    setStatus(ui.webgpu, "НЕДОСТУПНО — navigator.gpu отсутствует", "warn");
    updateOverall();
    return null;
  }

  setStatus(ui.webgpu, "запрос адаптера…", "warn");
  adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    setStatus(ui.webgpu, "НЕДОСТУПНО — адаптер не найден", "warn");
    updateOverall();
    return null;
  }

  try {
    device = await adapter.requestDevice();
  } catch (error) {
    setStatus(ui.webgpu, `ОШИБКА — requestDevice: ${error.message ?? error}`, "fail");
    updateOverall();
    return null;
  }

  const adapterInfo = adapter.info;
  const label = adapterInfo
    ? [adapterInfo.vendor, adapterInfo.architecture, adapterInfo.device]
      .filter(Boolean)
      .join(" · ")
    : "адаптер получен";
  setStatus(ui.webgpu, `ДОСТУПНО — ${label || "адаптер получен"}`, "ok");
  log(`Устройство WebGPU получено; maxStorageBufferBindingSize=${device.limits.maxStorageBufferBindingSize}; maxStorageBuffersPerShaderStage=${device.limits.maxStorageBuffersPerShaderStage}`);

  device.lost.then((info) => {
    setStatus(ui.webgpu, `УСТРОЙСТВО ПОТЕРЯНО — ${info.message || info.reason}`, "fail");
    log(`УСТРОЙСТВО ПОТЕРЯНО: ${info.reason}: ${info.message}`);
    mechanicalRuntimeController?.dispose();
    updateOverall();
  });

  return device;
}

async function runDifferentials() {
  differentialAllPass = false;
  rigidDifferentialAllPass = false;
  monolithicDifferentialAllPass = false;
  updateOverall();

  if (!device) {
    for (const collection of [rows, rigidRows, monolithicRows]) {
      for (const row of collection.values()) {
        const status = row.querySelector(".status");
        status.textContent = UI_STATUS.unavailable;
        status.className = "status warn";
      }
    }
    return;
  }

  ui.rerun.disabled = true;
  const physics = selectedPhysics();
  const runSignature = physicsSignature(physics);
  let allPass = true;

  for (const fixture of fixtures) {
    const row = rows.get(fixture.name);
    const status = row.querySelector(".status");
    const pos = row.querySelector(".pos");
    const vel = row.querySelector(".vel");
    status.textContent = UI_STATUS.running;
    status.className = "status warn";
    pos.textContent = "—";
    vel.textContent = "—";

    try {
      const result = await webgpu.runOctahedralWebGpuDifferentialWitness3D(
        fixture.network,
        {
          aspectRatio: physics.aspectRatio,
          stiffness: physics.longitudinalStiffness,
          simulationSpeed: physics.simulationSpeed,
        },
        {
          device,
          steps: DIFFERENTIAL_STEPS,
          tolerance: DIFFERENTIAL_TOLERANCE,
        },
      );

      pos.textContent = fmt(result.maxPositionDelta);
      vel.textContent = fmt(result.maxVelocityDelta);

      if (result.available && result.passed) {
        status.textContent = UI_STATUS.pass;
        status.className = "status ok";
        log(
          `${fixtureDisplayName(fixture.name)}: ПРОЙДЕНО Δp=${fmt(result.maxPositionDelta)} Δv=${fmt(result.maxVelocityDelta)}`,
        );
      } else if (!result.available) {
        status.textContent = UI_STATUS.unavailable;
        status.className = "status warn";
        allPass = false;
        log(`${fixtureDisplayName(fixture.name)}: НЕДОСТУПНО — ${result.reason ?? "причина неизвестна"}`);
      } else {
        status.textContent = UI_STATUS.failed;
        status.className = "status fail";
        allPass = false;
        log(
          `${fixtureDisplayName(fixture.name)}: НЕ ПРОЙДЕНО Δp=${fmt(result.maxPositionDelta)} Δv=${fmt(result.maxVelocityDelta)}`,
        );
      }
    } catch (error) {
      status.textContent = UI_STATUS.error;
      status.className = "status fail";
      pos.textContent = "—";
      vel.textContent = "—";
      allPass = false;
      log(`${fixtureDisplayName(fixture.name)}: ОШИБКА — ${error.stack ?? error}`);
    }
  }

  differentialAllPass = allPass;
  differentialPhysicsSignature = runSignature;

  let rigidAllPass = true;
  const rigidAspectRatio = Math.SQRT2 * (physics.octahedra / 2);
  for (const fixture of fixtures) {
    const row = rigidRows.get(fixture.name);
    const status = row.querySelector(".status");
    const center = row.querySelector(".center");
    const quat = row.querySelector(".quat");
    const linear = row.querySelector(".linear");
    const angular = row.querySelector(".angular");
    status.textContent = UI_STATUS.running;
    status.className = "status warn";
    center.textContent = "—";
    quat.textContent = "—";
    linear.textContent = "—";
    angular.textContent = "—";

    try {
      const result = await webgpu.runRigidSectionWebGpuDifferential3D(
        device,
        fixture.network,
        {
          aspectRatio: rigidAspectRatio,
          longitudinalStiffness: physics.longitudinalStiffness,
          transverseStiffness: physics.transverseStiffness,
          nonlinearity: physics.nonlinearity,
          nodeMass: physics.nodeMass,
          linearDampingRate: physics.linearDampingRate,
          angularDampingRate: physics.angularDampingRate,
          simulationSpeed: physics.simulationSpeed,
        },
        DIFFERENTIAL_STEPS,
        RIGID_DIFFERENTIAL_TOLERANCE,
      );

      center.textContent = fmt(result.maxCenterDelta);
      quat.textContent = fmt(result.maxOrientationDelta);
      linear.textContent = fmt(result.maxLinearVelocityDelta);
      angular.textContent = fmt(result.maxAngularVelocityDelta);

      if (result.passed) {
        status.textContent = UI_STATUS.pass;
        status.className = "status ok";
        log(
          `жёсткая модель ${fixtureDisplayName(fixture.name)}: ПРОЙДЕНО Δc=${fmt(result.maxCenterDelta)} Δq=${fmt(result.maxOrientationDelta)} Δv=${fmt(result.maxLinearVelocityDelta)} Δω=${fmt(result.maxAngularVelocityDelta)}`,
        );
      } else {
        status.textContent = UI_STATUS.failed;
        status.className = "status fail";
        rigidAllPass = false;
        log(
          `жёсткая модель ${fixtureDisplayName(fixture.name)}: НЕ ПРОЙДЕНО Δc=${fmt(result.maxCenterDelta)} Δq=${fmt(result.maxOrientationDelta)} Δv=${fmt(result.maxLinearVelocityDelta)} Δω=${fmt(result.maxAngularVelocityDelta)}`,
        );
      }
    } catch (error) {
      status.textContent = UI_STATUS.error;
      status.className = "status fail";
      rigidAllPass = false;
      log(`жёсткая модель ${fixtureDisplayName(fixture.name)}: ОШИБКА — ${error.stack ?? error}`);
    }
  }

  rigidDifferentialAllPass = rigidAllPass;
  rigidDifferentialPhysicsSignature = runSignature;

  let monolithicAllPass = true;
  for (const fixture of fixtures) {
    const row = monolithicRows.get(fixture.name);
    const status = row.querySelector(".status");
    const center = row.querySelector(".center");
    const velocity = row.querySelector(".velocity");
    status.textContent = UI_STATUS.running;
    status.className = "status warn";
    center.textContent = "—";
    velocity.textContent = "—";

    try {
      const result = await webgpu.runMonolithicLinkWebGpuDifferential3D(
        device,
        fixture.network,
        {
          aspectRatio: rigidAspectRatio,
          stretchStiffness: physics.longitudinalStiffness,
          straighteningStiffness: physics.transverseStiffness,
          nonlinearity: physics.nonlinearity,
          centerMass: physics.nodeMass,
          dampingRate: physics.linearDampingRate,
          simulationSpeed: physics.simulationSpeed,
        },
        DIFFERENTIAL_STEPS,
        MONOLITHIC_DIFFERENTIAL_TOLERANCE,
      );

      center.textContent = fmt(result.maxCenterDelta);
      velocity.textContent = fmt(result.maxVelocityDelta);

      if (result.passed) {
        status.textContent = UI_STATUS.pass;
        status.className = "status ok";
        log(
          `монолитная модель ${fixtureDisplayName(fixture.name)}: ПРОЙДЕНО Δc=${fmt(result.maxCenterDelta)} Δv=${fmt(result.maxVelocityDelta)}`,
        );
      } else {
        status.textContent = UI_STATUS.failed;
        status.className = "status fail";
        monolithicAllPass = false;
        log(
          `монолитная модель ${fixtureDisplayName(fixture.name)}: НЕ ПРОЙДЕНО Δc=${fmt(result.maxCenterDelta)} Δv=${fmt(result.maxVelocityDelta)}`,
        );
      }
    } catch (error) {
      status.textContent = UI_STATUS.error;
      status.className = "status fail";
      monolithicAllPass = false;
      log(`монолитная модель ${fixtureDisplayName(fixture.name)}: ОШИБКА — ${error.stack ?? error}`);
    }
  }

  monolithicDifferentialAllPass = monolithicAllPass;
  monolithicDifferentialPhysicsSignature =
    monolithicPhysicsSignature(physics);
  ui.rerun.disabled = false;
  log(
    `параметры проверки: ${physics.octahedra} октаэдров, mNode=${physics.nodeMass.toFixed(2)}, kLong=${physics.longitudinalStiffness.toFixed(2)}, kTrans=${physics.transverseStiffness.toFixed(2)}, alpha=${physics.nonlinearity.toFixed(2)}, dLin=${physics.linearDampingRate.toFixed(2)}, dAng=${physics.angularDampingRate.toFixed(2)}, скорость=${physics.simulationSpeed.toFixed(2)}x`,
  );
  log(`аспект жёсткой дифференциальной модели=${rigidAspectRatio.toFixed(4)} (жёсткие треугольные секции без крышек)`);
  log(
    `монолитная проверка: масса CENTER=mNode, растяжение=kLong, выпрямление=kTrans, демпфирование=dLin · ${monolithicAllPass ? "ПРОЙДЕНО" : "НЕ ПРОЙДЕНО"}`,
  );
  updateOverall();
}

const fixtureSceneCache = new Map();
let importedScene = null;

function fixtureScene(id) {
  const cached = fixtureSceneCache.get(id);
  if (cached) return cached;

  const fixture = core.visualLabFixture(id);
  const scene = Object.freeze({
    id: fixture.id,
    label: fixture.label,
    network: fixture.network,
    hints: fixture.hints ?? Object.freeze({}),
    sourceKind: "fixture",
  });
  fixtureSceneCache.set(id, scene);
  return scene;
}

function populateSceneSelector(preferredId = ui.scene.value || "root-r") {
  ui.scene.replaceChildren();

  for (const definition of core.VISUAL_LAB_FIXTURE_DEFINITIONS) {
    const option = document.createElement("option");
    option.value = definition.id;
    option.textContent = definition.label;
    ui.scene.appendChild(option);
  }

  if (importedScene) {
    const option = document.createElement("option");
    option.value = IMPORTED_SCENE_ID;
    option.textContent = importedScene.label;
    ui.scene.appendChild(option);
  }

  const available = [...ui.scene.options].some((option) => option.value === preferredId);
  ui.scene.value = available ? preferredId : "root-r";
}

function selectedScene() {
  if (ui.scene.value === IMPORTED_SCENE_ID) {
    if (!importedScene) throw new Error("импортированная асеть отсутствует");
    return importedScene;
  }
  return fixtureScene(ui.scene.value);
}

function sceneInputManifest(scene = selectedScene()) {
  return createSceneInputManifest(
    scene,
    core.DOCUMENT2D_INPUT_SCHEMA,
  );
}

function sceneInputManifestText(scene = selectedScene()) {
  return serializeSceneInputManifest(
    scene,
    core.DOCUMENT2D_INPUT_SCHEMA,
  );
}

function setLabInputStatus(text, kind = "") {
  ui.labInputStatus.textContent = text;
  ui.labInputStatus.className = `lab-input-status ${kind}`.trim();
}

function syncLabInputPanel(scene = selectedScene()) {
  ui.labInputJson.value = sceneInputManifestText(scene);
  if (scene.sourceKind === "import") {
    setLabInputStatus(
      `Импорт · ${scene.network.links.length} связей · schema=${core.DOCUMENT2D_INPUT_SCHEMA}`,
      "ok",
    );
  } else {
    setLabInputStatus(
      `Встроенный fixture «${scene.label}» · ${scene.network.links.length} связей`,
      "ok",
    );
  }
}

function applyImportedManifestText(text, sourceLabel) {
  importedScene = createImportedSceneFromText(
    text,
    sourceLabel,
    {
      parseManifest: core.parseDocument2DInputManifest,
      normalizeNetwork: core.normalizeVisualLinkNetwork,
    },
  );

  populateSceneSelector(IMPORTED_SCENE_ID);
  syncLabInputPanel(importedScene);
  ui.scene.dispatchEvent(new Event("change"));
  log(
    `импортирована асеть: источник=${sourceLabel}, связей=${importedScene.network.links.length}, schema=${core.DOCUMENT2D_INPUT_SCHEMA}`,
  );
}

async function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("не удалось скопировать текст в буфер обмена");
}

let selectedVisualKey = null;
let currentLabModeId = ui.visualizationMode.value;

function reconcileSelectedVisualKey(scene = selectedScene()) {
  selectedVisualKey = reconcileSelectedLinkKey(
    scene,
    selectedVisualKey,
  );
}

function setSelectedVisualKey(key) {
  const scene = selectedScene();
  selectedVisualKey = validateSelectedLinkKey(scene, key);
  mechanicalRuntimeController
    .scheduleSelectedLink(
      scene,
      "shared-selection",
    );
  updateSharedDiagnostics();
}

function structuralDiagnosticDetail() {
  return structural2DController.diagnosticDetail(selectedScene());
}

function blueprintDiagnosticDetail() {
  return blueprint2DController.diagnosticDetail(selectedScene());
}

function documentDiagnosticDetail() {
  return document2DController.diagnosticDetail(selectedScene());
}

function classicDiagnosticDetail() {
  return classic3DController.diagnosticDetail(selectedScene());
}

function mechanicalDiagnosticDetail() {
  return mechanicalRuntimeController
    .diagnosticDetail(selectedScene());
}

function activeModeDiagnosticDetail() {
  switch (currentLabModeId) {
    case "structural-2d": return structuralDiagnosticDetail();
    case "blueprint-2d": return blueprintDiagnosticDetail();
    case "document-2d": return documentDiagnosticDetail();
    case "classic-3d": return classicDiagnosticDetail();
    case "mechanical-3d": return mechanicalDiagnosticDetail();
    default: return null;
  }
}

function sharedDiagnosticSnapshot() {
  const scene = selectedScene();
  const definition = labModeUi(currentLabModeId);
  return createSharedDiagnosticEnvelope({
    mode: currentLabModeId,
    modeLabel: definition?.label ?? currentLabModeId,
    scene,
    selectedKey: selectedVisualKey,
    rendererVersion: buildInfo.version,
    rendererBuildSha: buildInfo.mainSha,
    detail: activeModeDiagnosticDetail(),
  });
}

function updateSharedDiagnostics() {
  const display = projectSharedDiagnosticDisplay(
    sharedDiagnosticSnapshot(),
  );
  ui.labDiagnosticMode.textContent = display.mode;
  ui.labDiagnosticInput.textContent = display.input;
  ui.labDiagnosticLinks.textContent = display.links;
  ui.labDiagnosticSelected.textContent = display.selected;
  ui.labDiagnosticVersion.textContent = display.version;
  ui.labDiagnosticSha.textContent = display.sha;
  ui.labDiagnosticDetail.textContent = display.detail;
}

function sharedDiagnosticText() {
  return serializeSharedDiagnosticSnapshot(
    sharedDiagnosticSnapshot(),
  );
}

async function sha256Text(text) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto SHA-256 недоступен в этом браузере");
  }
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function downloadTextFile(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

populateSceneSelector("root-r");
syncLabInputPanel();


const structural2DController = createStructural2DController({
  ui,
  core,
  getSelectedScene: () => selectedScene(),
  setSelectedKey: (key) => setSelectedVisualKey(key),
  updateSharedDiagnostics,
  controlNumber,
  downloadTextFile,
  buildInfo,
  createOption: () => document.createElement("option"),
  log,
});
structural2DController.mountControls();

function mountStructural2D() {
  return structural2DController.mount();
}

const blueprint2DController = createBlueprint2DController({
  ui,
  core,
  getSelectedScene: () => selectedScene(),
  setSelectedKey: (key) => setSelectedVisualKey(key),
  updateSharedDiagnostics,
  controlNumber,
  downloadTextFile,
  buildInfo,
  log,
});
blueprint2DController.mountControls();

function mountBlueprint() {
  return blueprint2DController.mount();
}

const document2DController = createDocument2DController({
  ui,
  core,
  getSelectedScene: () => selectedScene(),
  setSelectedKey: (key) => setSelectedVisualKey(key),
  updateSharedDiagnostics,
  sceneInputManifestText: (scene) => sceneInputManifestText(scene),
  sha256Text,
  downloadTextFile,
  buildInfo,
  createOption: () => document.createElement("option"),
  log,
});
document2DController.mountControls();

function mountDocument2D() {
  return document2DController.mount();
}

const classic3DController = createClassic3DController({
  ui,
  core,
  threeVisual,
  getSelectedScene: () => selectedScene(),
  setSelectedKey: (key) => setSelectedVisualKey(key),
  updateSharedDiagnostics,
  controlNumber,
  formatNumber: fmt,
  requestRemount: () => activateLabMode("classic-3d"),
  setIntervalFn: (callback, milliseconds) =>
    window.setInterval(callback, milliseconds),
  clearIntervalFn: (timer) => window.clearInterval(timer),
  scheduleFrame: (callback) => requestAnimationFrame(callback),
  isFullscreen: () => document.fullscreenElement === ui.viewportShell,
  requestFullscreen: () => ui.viewportShell.requestFullscreen(),
  exitFullscreen: () => document.exitFullscreen(),
  log,
});
classic3DController.mountControls();

function mountClassic3D() {
  return classic3DController.mount();
}

function updateModePlaceholder(modeId) {
  const definition = labModeUi(modeId);
  const scene = selectedScene();
  if (!definition) return;
  ui.modePlaceholder.innerHTML =
    `<div><strong>${definition.label}</strong>`
    + `Режим зарегистрирован общим lifecycle лаборатории.<br>`
    + `Текущая асеть: ${scene.label} · ${scene.network.links.length} связей.<br>`
    + `Подключение renderer: issue #${definition.issue}.</div>`;
}

// Versioned Pages/browser acceptance contract; changing it requires explicit acceptance evidence.
const LAB_SELF_TEST_CONTRACT = "five-mode-resource-cycle/v1";
const LAB_SELF_TEST_QUERY = "mode-cycle";
const labResourceLedger = createLabResourceLedger();

function activeModeState(modeId) {
  switch (modeId) {
    case "structural-2d": return structural2DController.state();
    case "blueprint-2d": return blueprint2DController.state();
    case "document-2d": return document2DController.state();
    case "classic-3d": return classic3DController.state();
    case "mechanical-3d":
      return mechanicalRuntimeController.state();
    default: return null;
  }
}

function claimLabResources(modeId) {
  claimLabResourceLedger(
    labResourceLedger,
    modeId,
    { mounted: activeModeState(modeId) !== null },
  );
  renderLabResourceAudit();
}

function releaseLabResources(modeId) {
  if (!releaseLabResourceLedger(labResourceLedger, modeId)) return;
  renderLabResourceAudit();
}

function labResourceAuditSnapshot() {
  const threeSnapshot = typeof threeVisual.getVisualThreeRendererSnapshot === "function"
    ? threeVisual.getVisualThreeRendererSnapshot(ui.classicViewport)
    : undefined;
  return Object.freeze({
    ledger: snapshotLabResourceLedger(labResourceLedger),
    actual: Object.freeze({
      structuralState: structural2DController.isMounted(),
      blueprintState: blueprint2DController.isMounted(),
      documentState: document2DController.isMounted(),
      classicState: classic3DController.isMounted(),
      mechanicalState:
        mechanicalRuntimeController.isMounted(),
      structuralSvgRoots: ui.structuralViewport.querySelectorAll("svg").length,
      blueprintSvgRoots: ui.blueprintViewport.querySelectorAll("svg").length,
      documentSvgRoots: ui.documentViewport.querySelectorAll("svg").length,
      classicThreeMounted: Boolean(threeSnapshot),
      classicCanvasRoots: ui.classicViewport.querySelectorAll("canvas").length,
      mechanicalCanvasConfigured:
        mechanicalRuntimeController.isMounted(),
    }),
  });
}

function renderLabResourceAudit(extra = null) {
  if (!ui.labResourceAudit) return;
  const snapshot = labResourceAuditSnapshot();
  ui.labResourceAudit.textContent = JSON.stringify(
    extra === null ? snapshot : { ...snapshot, selfTest: extra },
    null,
    2,
  );
}

function assertLabCycle(condition, message) {
  if (!condition) throw new Error(`mode-cycle: ${message}`);
}

function assertRealModeResources(modeId, scene) {
  const audit = labResourceAuditSnapshot();
  assertLabCycle(
    selectedScene() === scene,
    `${modeId}: input scene identity changed`,
  );
  assertLabResourceAudit({
    modeId,
    audit,
    mechanicalAvailable: Boolean(device),
  });

  const active = activeModeState(modeId);
  if (!(modeId === "mechanical-3d" && !device)) {
    assertLabCycle(
      active?.scene === scene,
      `${modeId}: renderer uses another input snapshot`,
    );
  }

  return audit;
}

const labCycleSelfTestController = createLabCycleSelfTestController({
  ui,
  cycle: LAB_REAL_CYCLE,
  repeats: LAB_REAL_CYCLE_REPEATS,
  getActiveMode: () => labLifecycle.activeMode,
  activateMode: (modeId) => activateLabMode(modeId),
  getSelectedScene: () => selectedScene(),
  sceneManifestText: (scene) => sceneInputManifestText(scene),
  getSelectedKey: () => selectedVisualKey,
  getResourceLedger: () => labResourceLedger,
  assertModeResources: (modeId, scene) =>
    assertRealModeResources(modeId, scene),
  hasWebGpuDevice: () => Boolean(device),
  renderResourceAudit: (selfTest) =>
    renderLabResourceAudit(selfTest),
  log,
});

async function runLabModeCycleSelfTest() {
  return labCycleSelfTestController.run();
}

const labModeMountController = createLabModeMountController({
  ui,
  mountMechanical: () =>
    mechanicalRuntimeController.mount(),
  mountStructural: () => mountStructural2D(),
  mountBlueprint: () => mountBlueprint(),
  mountDocument: () => mountDocument2D(),
  mountClassic: () => mountClassic3D(),
  mountPlaceholder: (modeId) => {
    updateModePlaceholder(modeId);
    return () => ui.modePlaceholder.replaceChildren();
  },
  claimResources: claimLabResources,
  releaseResources: releaseLabResources,
});

async function mountLabMode(modeId) {
  return labModeMountController.mount(modeId);
}

const modeIdsInUi = [...ui.visualizationMode.options].map((option) => option.value);
const modeIdsInCore = core.VISUAL_LAB_MODE_IDS;
if (modeIdsInUi.join(",") !== modeIdsInCore.join(",")) {
  throw new Error(
    `режимы UI не совпадают с @mts/visual: UI=${modeIdsInUi.join(",")}; core=${modeIdsInCore.join(",")}`,
  );
}

const labLifecycle = core.createVisualLabLifecycle({
  mount: mountLabMode,
  onStateChange: ({ state, modeId, error }) => {
    const definition = modeId ? labModeUi(modeId) : null;
    if (modeId) currentLabModeId = modeId;
    if (state === "mounting") {
      ui.modeStatus.textContent = `${definition?.label ?? modeId} · переключение…`;
      ui.modeHeading.textContent = definition?.label ?? modeId;
      ui.modeDescription.textContent = definition?.description ?? "";
    } else if (state === "mounted") {
      ui.modeStatus.textContent = definition?.ready
        ? `${definition.label} · готов`
        : `${definition?.label ?? modeId} · каркас готов · renderer #${definition?.issue}`;
    } else if (state === "error") {
      ui.modeStatus.textContent = `${definition?.label ?? modeId} · ошибка`;
      log(`ОШИБКА переключения режима ${modeId} — ${error?.stack ?? error}`);
    } else if (state === "disposed") {
      ui.modeStatus.textContent = "renderer освобождён";
    }
    updateSharedDiagnostics();
  },
});

async function activateLabMode(modeId) {
  await labLifecycle.activate(modeId);
}

function mechanicalModeIsActive() {
  return labLifecycle.activeMode === "mechanical-3d";
}

function remountMechanical(reason) {
  if (!mechanicalModeIsActive()) return Promise.resolve();
  return activateLabMode("mechanical-3d").catch((error) => {
    mechanicalRuntimeController
      .invalidateRenderPass();
    setStatus(ui.renderCompute, UI_STATUS.error, "fail");
    setStatus(ui.renderZeroCopy, "НЕ ПРОЙДЕНО — см. журнал", "fail");
    log(`ОШИБКА Mechanical 3D (${reason}) — ${error.stack ?? error}`);
    updateOverall();
  });
}

ui.visualizationMode.addEventListener("change", () => {
  activateLabMode(ui.visualizationMode.value).catch((error) => {
    log(`ОШИБКА активации режима — ${error.stack ?? error}`);
  });
});

ui.labInputApply.addEventListener("click", () => {
  try {
    applyImportedManifestText(ui.labInputJson.value, "вставка JSON");
  } catch (error) {
    setLabInputStatus(
      `Ошибка импорта: ${error instanceof Error ? error.message : String(error)}`,
      "fail",
    );
    log(`ОШИБКА импорта JSON — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
});

ui.labInputFileButton.addEventListener("click", () => {
  ui.labInputFile.click();
});

ui.labInputFile.addEventListener("change", async () => {
  const file = ui.labInputFile.files?.[0];
  if (!file) return;
  try {
    applyImportedManifestText(await file.text(), file.name);
  } catch (error) {
    setLabInputStatus(
      `Ошибка файла: ${error instanceof Error ? error.message : String(error)}`,
      "fail",
    );
    log(`ОШИБКА импорта файла ${file.name} — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  } finally {
    ui.labInputFile.value = "";
  }
});

ui.labInputCopy.addEventListener("click", () => {
  copyText(sceneInputManifestText()).then(() => {
    setLabInputStatus(
      `JSON скопирован · ${selectedScene().network.links.length} связей`,
      "ok",
    );
  }).catch((error) => {
    setLabInputStatus(
      `Ошибка копирования: ${error instanceof Error ? error.message : String(error)}`,
      "fail",
    );
    log(`ОШИБКА копирования input manifest — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  });
});

ui.labRunCycleTest.addEventListener("click", () => {
  runLabModeCycleSelfTest().catch((error) => {
    log(`ОШИБКА mode-cycle self-test — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  });
});

ui.labCopyDiagnostics.addEventListener("click", () => {
  copyText(sharedDiagnosticText()).then(() => {
    ui.modeStatus.textContent = `${labModeUi(currentLabModeId)?.label ?? currentLabModeId} · диагностика скопирована`;
  }).catch((error) => {
    log(`ОШИБКА копирования общей диагностики — ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  });
});

ui.copyLog.addEventListener("click", () => {
  copyDiagnosticLog().catch((error) => {
    log(`ОШИБКА копирования диагностического журнала — ${error.stack ?? error}`);
  });
});

ui.saveLog.addEventListener("click", () => {
  try {
    saveDiagnosticLog();
  } catch (error) {
    log(`ОШИБКА сохранения диагностического журнала — ${error.stack ?? error}`);
  }
});

ui.rerun.addEventListener("click", () => {
  runDifferentials().catch((error) => {
    differentialAllPass = false;
    rigidDifferentialAllPass = false;
    monolithicDifferentialAllPass = false;
    monolithicDifferentialPhysicsSignature = null;
    log(`ОШИБКА запуска дифференциальной проверки — ${error.stack ?? error}`);
    updateOverall();
  });
});

ui.scene.addEventListener("change", () => {
  syncLabInputPanel();
  reconcileSelectedVisualKey();
  updateSharedDiagnostics();
  ui.geometryBody.innerHTML = '<tr><td colspan="9" class="muted">Нажмите «Проверить геометрию».</td></tr>';
  const activeMode = labLifecycle.activeMode ?? ui.visualizationMode.value;
  if (activeMode === "structural-2d" || activeMode === "blueprint-2d" || activeMode === "document-2d" || activeMode === "classic-3d") {
    activateLabMode(activeMode).catch((error) => {
      log(`ОШИБКА перезапуска режима ${activeMode} — ${error.stack ?? error}`);
    });
    return;
  }
  if (!mechanicalModeIsActive()) {
    updateModePlaceholder(activeMode);
    return;
  }
  void remountMechanical("смена сцены");
});

ui.inspectGeometry.addEventListener("click", () => {
  void mechanicalRuntimeController
    .inspectGeometry();
});

ui.restartRender.addEventListener("click", () => {
  void remountMechanical("ручной перезапуск");
});

ui.resetView.addEventListener("click", () => {
  mechanicalRuntimeController.resetView();
});

ui.autoRotate.addEventListener("change", () => {
  log(`автовращение камеры ${ui.autoRotate.checked ? "включено" : "выключено"}`);
});

ui.globalWireframe.addEventListener("change", () => {
  log(
    `глобальный каркас ${ui.globalWireframe.checked ? "включён" : "выключен"} — для всех материальных экземпляров связей, физическое состояние сохранено`,
  );
});

ui.globalSmoothNormals.addEventListener("change", () => {
  log(
    `глобальное сглаживание нормалей ${ui.globalSmoothNormals.checked ? "включено" : "выключено"} — для всех заполненных треугольников связей, только рендер`,
  );
});

ui.showCenterMarkers.addEventListener("change", () => {
  if (!ui.showCenterMarkers.checked) {
    mechanicalRuntimeController
      .clearCenterInteraction();
  }
  log(
    `маркер CENTER ${ui.showCenterMarkers.checked ? "включён" : "выключен"} — каркасный икосаэдр L2, физическое состояние сохранено`,
  );
});

ui.showEndCones.addEventListener("change", () => {
  log(
    `конусы END ${ui.showEndCones.checked ? "включены" : "выключены"} — физическое состояние сохранено`,
  );
});

for (const control of [ui.centerMarkerScale, ui.endConeScale]) {
  control.addEventListener("input", () => {
    refreshMarkerControlLabels();
  });
}

ui.lengthOcta.addEventListener("change", () => {
  refreshPhysicsControlLabels();
  markDifferentialStale();
  mechanicalRuntimeController
    .invalidateRenderPass();
  updateOverall();
  void remountMechanical("изменение длины связи");
});

function applyLivePhysicsControls() {
  refreshPhysicsControlLabels();
  markDifferentialStale();
  mechanicalRuntimeController
    .applyLivePhysics();
}

for (const control of [
  ui.nodeMass,
  ui.longitudinalStiffness,
  ui.transverseStiffness,
  ui.nonlinearity,
  ui.linearDamping,
  ui.simulationSpeed,
]) {
  control.addEventListener("input", applyLivePhysicsControls);
}

ui.angularDamping.addEventListener("input", () => {
  refreshPhysicsControlLabels();
  rigidDifferentialAllPass = false;
  rigidDifferentialPhysicsSignature = null;
  for (const row of rigidRows.values()) {
    const status = row.querySelector(".status");
    if (status.textContent === UI_STATUS.pass) {
      status.textContent = UI_STATUS.stale;
      status.className = "status warn";
    }
  }
  log(
    "изменено устаревшее угловое демпфирование жёсткой модели — монолитная физика реального времени не затронута",
  );
  updateOverall();
});

ui.pauseRender.addEventListener("click", () => {
  mechanicalRuntimeController.togglePause();
});

ui.fullscreenRender.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement === ui.viewportShell) {
      await document.exitFullscreen();
    } else {
      await ui.viewportShell.requestFullscreen();
    }
  } catch (error) {
    log(`ОШИБКА полноэкранного режима — ${error.stack ?? error}`);
  }
});

document.addEventListener("fullscreenchange", () => {
  const active = document.fullscreenElement === ui.viewportShell;
  ui.fullscreenRender.textContent = active ? "Выйти из полноэкранного режима" : "На весь экран";
  classic3DController.handleFullscreenChange(active);
  if (structural2DController.isMounted()) {
    requestAnimationFrame(() => structural2DController.fit());
  }
  if (blueprint2DController.isMounted()) {
    requestAnimationFrame(() => blueprint2DController.fit());
  }
  if (document2DController.isMounted()) {
    requestAnimationFrame(() => document2DController.fit());
  }
});

try {
  await acquireDevice();
  if (device) await runDifferentials();
  await activateLabMode(ui.visualizationMode.value);

  const startupParams = new URLSearchParams(window.location.search);
  const requestedSelfTest = startupParams.get("selftest");
  if (requestedSelfTest === LAB_SELF_TEST_QUERY) {
    log(`запрошен browser self-test ${LAB_SELF_TEST_CONTRACT} через URL`);
    await runLabModeCycleSelfTest();
  }

  if (benchmarkController.applyQuery(startupParams)) {
    log("запрошен Mechanical WebGPU benchmark через URL");
    await benchmarkController.run();
  }
} catch (error) {
  setStatus(ui.overall, "ОШИБКА — см. диагностический журнал", "fail");
  log(error.stack ?? String(error));
}

window.addEventListener("pagehide", () => {
  benchmarkController.requestStop({ announce: false });
  benchmarkController.dispose();
  structural2DController.disposeControls();
  blueprint2DController.disposeControls();
  document2DController.disposeControls();
  classic3DController.disposeControls();
  void labLifecycle.dispose();
  mechanicalRuntimeController.dispose();
});
