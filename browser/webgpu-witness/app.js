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
  documentRenderDiagnostics: $("document-render-diagnostics"),
  documentSeed: $("document-seed"),
  documentCrossings: $("document-crossings"),
  documentOverlaps: $("document-overlaps"),
  documentOptimizer: $("document-optimizer"),
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

/**
 * Compatibility witness retained while the public bundle still exports the
 * legacy v0.4 renderer. The live laboratory below no longer uses this path.
 */
function legacyOctahedralZeroCopyInvariant(renderer, compute) {
  return renderer.positionBuffer === compute.positionBuffer;
}
void legacyOctahedralZeroCopyInvariant;

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
  if (!Number.isSafeInteger(count) || count < 1 || count > ROOT_BASIS.length) {
    throw new Error(`недопустимая ступень корневого базиса: ${count}`);
  }
  return {
    links: ROOT_BASIS.slice(0, count).map(({ key, startKey, endKey }) => ({
      key,
      startKey,
      endKey,
    })),
  };
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
let renderPass = false;
let renderState = null;

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
    renderPass = false;
    stopRender();
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

function classicSeparationNetwork() {
  return {
    links: [
      { key: "R", startKey: "R", endKey: "R" },
      { key: "O", startKey: "O", endKey: "R" },
      { key: "C", startKey: "R", endKey: "C" },
      { key: "L", startKey: "O", endKey: "C" },
      { key: "U", startKey: "C", endKey: "O" },
      { key: "A", startKey: "L", endKey: "U" },
      { key: "B", startKey: "L", endKey: "A" },
      { key: "D", startKey: "B", endKey: "U" },
      { key: "E", startKey: "A", endKey: "D" },
      { key: "F", startKey: "B", endKey: "E" },
    ],
  };
}

function selectedScene() {
  switch (ui.scene.value) {
    case "root-r": return Object.freeze({ id: "root-r", label: "только R", network: rootBasisNetwork(1) });
    case "root-ro": return Object.freeze({ id: "root-ro", label: "R + O", network: rootBasisNetwork(2) });
    case "root-roc": return Object.freeze({ id: "root-roc", label: "R + O + C", network: rootBasisNetwork(3) });
    case "root-rocl": return Object.freeze({ id: "root-rocl", label: "R + O + C + L", network: rootBasisNetwork(4) });
    case "root-roclu": return Object.freeze({ id: "root-roclu", label: "R + O + C + L + U", network: rootBasisNetwork(5) });
    case "classic-separation": return Object.freeze({ id: "classic-separation", label: "Classic · разведение похожих связей", network: classicSeparationNetwork() });
    case "hub-64": return Object.freeze({ id: "hub-64", label: "нагрузка 64", network: hubHeavyNetwork(64) });
    case "hub-333": return Object.freeze({ id: "hub-333", label: "нагрузка 333", network: hubHeavyNetwork(333) });
    case "hub-1000": return Object.freeze({ id: "hub-1000", label: "нагрузка 1000", network: hubHeavyNetwork(1000) });
    default: throw new Error(`неизвестная сцена: ${ui.scene.value}`);
  }
}

function hubHeavyNetwork(count) {
  if (!Number.isSafeInteger(count) || count < 8) throw new Error("нагрузочная сцена требует не менее 8 связей");

  const links = [
    { key: "L1", startKey: "L1", endKey: "L1" },
    { key: "L2", startKey: "L2", endKey: "L1" },
    { key: "L3", startKey: "L1", endKey: "L3" },
  ];
  const key = (oneBased) => `L${oneBased}`;

  for (let oneBased = 4; oneBased <= count; oneBased += 1) {
    const previous = key(oneBased - 1);
    const previous2 = key(Math.max(1, oneBased - 2));
    const self = key(oneBased);
    const role = oneBased % 16;

    let startKey;
    let endKey;
    switch (role) {
      case 0: startKey = previous; endKey = "L2"; break;
      case 1: startKey = previous; endKey = "L3"; break;
      case 2: startKey = self; endKey = previous; break;
      case 3: startKey = "L1"; endKey = previous; break;
      case 4: startKey = previous2; endKey = "L2"; break;
      case 5: startKey = previous2; endKey = "L3"; break;
      case 6: startKey = previous2; endKey = previous; break;
      case 7: startKey = previous; endKey = previous2; break;
      default:
        startKey = previous;
        endKey = oneBased % 3 === 0 ? "L3" : "L2";
        break;
    }
    links.push({ key: self, startKey, endKey });
  }
  return { links };
}

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lookAt(eye, center, up) {
  const z = normalize3([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const x = normalize3(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function multiply4(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let k = 0; k < 4; k += 1) {
        value += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = value;
    }
  }
  return out;
}

function transformPoint4(matrix, point) {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15],
  ];
}

function currentViewProjection(state) {
  const eye = cameraEye(state.camera);
  const view = lookAt(eye, state.camera.target, [0, 1, 0]);
  const projection = perspective(
    Math.PI / 4,
    Math.max(1e-9, ui.canvas.width / ui.canvas.height),
    0.1,
    state.camera.maxDistance * 4,
  );
  return multiply4(projection, view);
}

function projectWorldToClient(state, world) {
  const clip = transformPoint4(currentViewProjection(state), world);
  if (!(clip[3] > 1e-6)) return null;
  const ndcX = clip[0] / clip[3];
  const ndcY = clip[1] / clip[3];
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return null;
  const rect = ui.canvas.getBoundingClientRect();
  return [
    rect.left + (ndcX * 0.5 + 0.5) * rect.width,
    rect.top + (0.5 - ndcY * 0.5) * rect.height,
  ];
}

function packedVec3(values, index) {
  const offset = index * 3;
  return [values[offset], values[offset + 1], values[offset + 2]];
}

function pointerWorldRay(state, event) {
  const { eye, forward, right, up } = cameraBasis(state.camera);
  const rect = ui.canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const ndcX = ((event.clientX - rect.left) / width) * 2 - 1;
  const ndcY = 1 - ((event.clientY - rect.top) / height) * 2;
  const tanHalfFov = Math.tan(Math.PI / 8);
  const aspect = width / height;
  const direction = normalize3([
    forward[0] + right[0] * ndcX * aspect * tanHalfFov + up[0] * ndcY * tanHalfFov,
    forward[1] + right[1] * ndcX * aspect * tanHalfFov + up[1] * ndcY * tanHalfFov,
    forward[2] + right[2] * ndcX * aspect * tanHalfFov + up[2] * ndcY * tanHalfFov,
  ]);
  return { origin: eye, direction };
}

function pickCenterIcosahedron(state, event, centers) {
  const ray = pointerWorldRay(state, event);
  // The two central octahedra define the hover neighborhood around semantic
  // CENTER. The L2 icosahedron has diameter 2 * octahedron diameter, hence
  // radius = one octahedron diameter.
  return webgpu.pickRigidSectionCenterIcosahedra3D(
    ray.origin,
    ray.direction,
    centers,
    state.shape.template.diameter
      * selectedMarkerControls().centerMarkerScale,
  );
}

function moveCenterDragTarget(state, dx, dy) {
  const drag = state.centerDrag;
  if (!drag || (dx === 0 && dy === 0)) return;
  const { right, up } = cameraBasis(state.camera);
  const rect = ui.canvas.getBoundingClientRect();
  const delta = webgpu.rigidSectionScreenDragDelta3D(
    right,
    up,
    drag.depth,
    Math.max(1, rect.height),
    dx,
    dy,
  );
  for (let axis = 0; axis < 3; axis += 1) {
    drag.target[axis] += delta[axis];
  }
  state.semanticCenterCache[drag.linkIndex] = [...drag.target];
}

function applyCenterDrag(state) {
  const drag = state.centerDrag;
  if (!drag) return null;
  return state.compute.writeCenterOverrides([
    {
      linkIndex: drag.linkIndex,
      position: [...drag.target],
      velocity: [0, 0, 0],
    },
  ]);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function cameraEye(camera) {
  const cp = Math.cos(camera.pitch);
  return [
    camera.target[0] + Math.cos(camera.yaw) * cp * camera.distance,
    camera.target[1] + Math.sin(camera.pitch) * camera.distance,
    camera.target[2] + Math.sin(camera.yaw) * cp * camera.distance,
  ];
}

function resetCamera(camera, distance) {
  camera.yaw = -0.8;
  camera.pitch = 0.38;
  camera.distance = distance;
  camera.defaultDistance = distance;
  camera.minDistance = Math.max(2, distance * 0.08);
  camera.maxDistance = distance * 20;
  camera.target[0] = 0;
  camera.target[1] = 0;
  camera.target[2] = 0;
}

function cameraBasis(camera) {
  const eye = cameraEye(camera);
  const forward = normalize3([
    camera.target[0] - eye[0],
    camera.target[1] - eye[1],
    camera.target[2] - eye[2],
  ]);
  const right = normalize3(cross(forward, [0, 1, 0]));
  const up = normalize3(cross(right, forward));
  return { eye, forward, right, up };
}

function panCamera(camera, dx, dy) {
  const { right, up } = cameraBasis(camera);
  const scale = camera.distance * 0.0015;
  for (let axis = 0; axis < 3; axis += 1) {
    camera.target[axis] += right[axis] * (-dx * scale) + up[axis] * (dy * scale);
  }
}

function installCameraControls(state) {
  const canvas = ui.canvas;
  const abortController = new AbortController();
  const listenerOptions = { signal: abortController.signal };
  let pointerId = null;
  let mode = null;
  let lastX = 0;
  let lastY = 0;
  let hoverGeneration = 0;
  let hoverBusy = false;
  let hoverTimer = null;
  let queuedHover = null;

  const setHoveredCenter = (selected) => {
    const next = Number.isSafeInteger(selected) ? selected : -1;
    if (state.hoveredCenterLink === next) return;
    state.hoveredCenterLink = next;
    canvas.classList.toggle("center-hover", next >= 0);
  };

  const runHoverPick = async () => {
    hoverTimer = null;
    if (
      hoverBusy
      || queuedHover === null
      || pointerId !== null
      || state.centerDrag
      || !ui.showCenterMarkers.checked
      || renderState !== state
    ) {
      if (!ui.showCenterMarkers.checked || state.centerDrag) {
        setHoveredCenter(-1);
      }
      return;
    }

    hoverBusy = true;
    const point = queuedHover;
    queuedHover = null;
    const generation = hoverGeneration;
    try {
      // Interaction-triggered readback only. The frame loop remains zero-copy.
      const gpuState = await state.compute.readBackState();
      if (
        generation !== hoverGeneration
        || renderState !== state
        || pointerId !== null
      ) return;

      const worldCenters = [];
      for (let link = 0; link < state.compute.topology.linkCount; link += 1) {
        const center = packedVec3(gpuState.centers, link);
        worldCenters.push(center);
        state.semanticCenterCache[link] = [...center];
      }
      setHoveredCenter(
        pickCenterIcosahedron(state, point, worldCenters),
      );
    } catch (error) {
      if (generation === hoverGeneration && renderState === state) {
        setHoveredCenter(-1);
        log(`ОШИБКА выбора маркера CENTER — ${error.stack ?? error}`);
      }
    } finally {
      hoverBusy = false;
      if (
        queuedHover !== null
        && pointerId === null
        && renderState === state
      ) {
        hoverTimer = setTimeout(runHoverPick, 45);
      }
    }
  };

  const requestHoverPick = (event) => {
    if (
      pointerId !== null
      || state.centerDrag
      || !ui.showCenterMarkers.checked
    ) return;
    queuedHover = {
      clientX: event.clientX,
      clientY: event.clientY,
    };
    if (!hoverBusy && hoverTimer === null) {
      hoverTimer = setTimeout(runHoverPick, 35);
    }
  };

  const finishPointer = (event) => {
    if (pointerId !== event.pointerId) return;
    const releasedMode = mode;
    const releasedDrag = state.centerDrag;
    try { canvas.releasePointerCapture(pointerId); } catch {}
    pointerId = null;
    mode = null;
    state.centerDrag = null;
    canvas.classList.remove("dragging");
    if (releasedMode === "center" && releasedDrag) {
      setHoveredCenter(releasedDrag.linkIndex);
      log(`перетаскивание CENTER завершено: ${releasedDrag.key}`);
      setStatus(
        ui.renderCompute,
        `ДОСТУПНО · mC=${state.compute.centerMass.toFixed(2)} · kS=${state.compute.stretchStiffness.toFixed(2)} · kB=${state.compute.straighteningStiffness.toFixed(2)} · t=${state.compute.simulationSpeed.toFixed(2)}x`,
        "ok",
      );
    }
  };

  const activateCenterDrag = (selected, center, source) => {
    const basis = cameraBasis(state.camera);
    const depth = Math.max(
      0.1,
      dot(
        [
          center[0] - basis.eye[0],
          center[1] - basis.eye[1],
          center[2] - basis.eye[2],
        ],
        basis.forward,
      ),
    );
    state.centerDrag = {
      linkIndex: selected,
      key: state.compute.topology.keys[selected],
      target: [...center],
      depth,
      uploadedBytes: 0,
    };
    state.semanticCenterCache[selected] = [...center];
    setHoveredCenter(selected);
    mode = "center";
    log(
      `выбран CENTER для перетаскивания: ${state.centerDrag.key} · источник=${source} · один семантический CENTER`,
    );
    setStatus(
      ui.renderCompute,
      `ПЕРЕТАСКИВАНИЕ ${state.centerDrag.key} · переопределение семантического CENTER`,
      "warn",
    );
  };

  canvas.addEventListener(
    "contextmenu",
    (event) => event.preventDefault(),
    listenerOptions,
  );

  canvas.addEventListener("pointerdown", (event) => {
    if (pointerId !== null) return;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    hoverGeneration += 1;
    queuedHover = null;
    if (hoverTimer !== null) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    canvas.setPointerCapture(pointerId);
    canvas.classList.add("dragging");

    if (event.button === 2 || (event.button === 0 && event.shiftKey)) {
      mode = "pan";
    } else if (
      event.button === 0
      && ui.showCenterMarkers.checked
      && state.hoveredCenterLink >= 0
    ) {
      const selected = state.hoveredCenterLink;
      activateCenterDrag(
        selected,
        state.semanticCenterCache[selected],
        "область двух центральных октаэдров CENTER",
      );
    } else {
      mode = "orbit";
    }
    event.preventDefault();
  }, listenerOptions);

  canvas.addEventListener("pointermove", (event) => {
    if (pointerId === null) {
      requestHoverPick(event);
      return;
    }
    if (pointerId !== event.pointerId || mode === null) return;

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    if (mode === "orbit") {
      state.camera.yaw -= dx * 0.006;
      state.camera.pitch = clamp(
        state.camera.pitch - dy * 0.006,
        -Math.PI * 0.48,
        Math.PI * 0.48,
      );
    } else if (mode === "pan") {
      panCamera(state.camera, dx, dy);
    } else if (mode === "center" && state.centerDrag) {
      moveCenterDragTarget(state, dx, dy);
    }
    event.preventDefault();
  }, listenerOptions);

  canvas.addEventListener("pointerleave", () => {
    if (pointerId === null) {
      queuedHover = null;
      setHoveredCenter(-1);
    }
  }, listenerOptions);

  canvas.addEventListener("pointerup", finishPointer, listenerOptions);
  canvas.addEventListener("pointercancel", finishPointer, listenerOptions);

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (state.centerDrag) return;
    const factor = Math.exp(event.deltaY * 0.001);
    state.camera.distance = clamp(
      state.camera.distance * factor,
      state.camera.minDistance,
      state.camera.maxDistance,
    );
  }, { passive: false, signal: abortController.signal });

  return () => {
    hoverGeneration += 1;
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    queuedHover = null;
    state.centerDrag = null;
    state.hoveredCenterLink = -1;
    abortController.abort();
    canvas.classList.remove("dragging", "center-hover");
  };
}
function resizeCanvas(canvas) {
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(canvas.clientWidth * scale));
  const height = Math.max(1, Math.round(canvas.clientHeight * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    return true;
  }
  return false;
}

function stopRender() {
  if (!renderState) return;
  cancelAnimationFrame(renderState.raf);
  try { renderState.renderer.destroy(); } catch {}
  try { renderState.shape.destroy(); } catch {}
  try { renderState.compute.destroy(); } catch {}
  try { renderState.depthTexture?.destroy(); } catch {}
  try { renderState.cleanupCameraControls?.(); } catch {}
  renderState = null;
  renderPass = false;
}

async function startRender() {
  stopRender();

  if (!device) {
    setStatus(ui.renderCompute, UI_STATUS.unavailable, "warn");
    setStatus(ui.renderZeroCopy, UI_STATUS.unavailable, "warn");
    updateOverall();
    return;
  }

  const scene = selectedScene();
  const network = scene.network;
  const linkCount = network.links.length;
  const physics = selectedPhysics();
  const monolithicOptions = {
    aspectRatio: physics.aspectRatio,
    stretchStiffness: physics.longitudinalStiffness,
    straighteningStiffness: physics.transverseStiffness,
    nonlinearity: physics.nonlinearity,
    centerMass: physics.nodeMass,
    dampingRate: physics.linearDampingRate,
    simulationSpeed: physics.simulationSpeed,
  };

  const compute = await webgpu.createMonolithicLinkWebGpuCompute3D(
    device,
    network,
    monolithicOptions,
  );

  let shape = null;
  let renderer = null;
  try {
    shape = await webgpu.createMonolithicLinkWebGpuShape3D(
      device,
      compute,
      physics.aspectRatio,
    );
    shape.update();

    if (shape.template.octahedronCount !== physics.octahedra) {
      throw new Error(
        `несоответствие длины: запрошено ${physics.octahedra} октаэдров, получено ${shape.template.octahedronCount}`,
      );
    }

    const context = ui.canvas.getContext("webgpu");
    if (!context) {
      throw new Error("canvas.getContext('webgpu') вернул null");
    }

    const colorFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format: colorFormat,
      alphaMode: "opaque",
    });

    renderer = await webgpu.createMonolithicLinkWebGpuZeroCopyRenderer3D(
      device,
      compute,
      shape,
      {
        colorFormat,
        depthFormat: "depth24plus",
      },
    );

    const rendererSnapshot = renderer.snapshot();
    const zeroCopy =
      renderer.semanticCenterBuffer === compute.centerBuffer
      && renderer.shapeParameterBuffer === shape.parameterBuffer
      && rendererSnapshot.sharedSemanticCenterBuffer === true
      && rendererSnapshot.sharedShapeParameterBuffer === true
      && rendererSnapshot.dynamicStateUploadBytesPerFrame === 0
      && rendererSnapshot.rendererDynamicStateBytes === 0;

    if (!zeroCopy) {
      throw new Error(
        "нарушен инвариант монолитного zero-copy до первого кадра",
      );
    }

    renderPass = true;
    const computeSnapshot = compute.snapshot();
    const shapeSnapshot = shape.snapshot();
    setStatus(
      ui.renderCompute,
      `ДОСТУПНО · 2 прохода физики + 1 проход производной геометрии`,
      "ok",
    );
    setStatus(
      ui.renderTopology,
      `${scene.label} · ${linkCount} связей · ${shapeSnapshot.octahedronCount} октаэдров/связь · семантическое состояние=${(computeSnapshot.centerBytes + computeSnapshot.velocityBytes).toLocaleString()} Б · mC=${physics.nodeMass.toFixed(2)} · kS=${physics.longitudinalStiffness.toFixed(2)} · kB=${physics.transverseStiffness.toFixed(2)} · α=${physics.nonlinearity.toFixed(2)} · t=${physics.simulationSpeed.toFixed(2)}x`,
      "ok",
    );
    setStatus(
      ui.renderZeroCopy,
      "ПРОЙДЕНО — общий семантический CENTER + компактный буфер формы · 0 Б динамической загрузки CPU",
      "ok",
    );
    updateOverall();

    const initialCpu = core.createMonolithicLinkSpringPhysics3D(
      network,
      monolithicOptions,
    );
    const initialSemanticCenters = Array.from(
      { length: linkCount },
      (_, link) => [...initialCpu.semanticCenter(link)],
    );

    const side = Math.ceil(Math.cbrt(linkCount));
    const spacing = shape.template.diameter * 2.5;
    const defaultCameraDistance = Math.max(
      18,
      shape.template.restLength * 1.35,
      side * spacing * 2.6,
    );
    const state = {
      compute,
      shape,
      renderer,
      context,
      colorFormat,
      depthTexture: null,
      raf: 0,
      frames: 0,
      steps: 0,
      shapeUpdates: 0,
      paused: false,
      startedAt: performance.now(),
      lastFrameAt: performance.now(),
      lastUiAt: 0,
      camera: {
        yaw: 0,
        pitch: 0,
        distance: defaultCameraDistance,
        defaultDistance: defaultCameraDistance,
        minDistance: Math.max(2, defaultCameraDistance * 0.08),
        maxDistance: defaultCameraDistance * 20,
        target: [0, 0, 0],
      },
      cleanupCameraControls: null,
      centerDrag: null,
      hoveredCenterLink: -1,
      initialSemanticCenters,
      semanticCenterCache: initialSemanticCenters.map((center) => [...center]),
      scene,
      network,
    };
    resetCamera(state.camera, defaultCameraDistance);
    state.cleanupCameraControls = installCameraControls(state);
    renderState = state;
    ui.pauseRender.textContent = "Пауза";

    function ensureDepth() {
      const resized = resizeCanvas(ui.canvas);
      if (resized || state.depthTexture === null) {
        state.depthTexture?.destroy();
        state.depthTexture = device.createTexture({
          label: "mts-visual-witness-depth",
          size: [ui.canvas.width, ui.canvas.height, 1],
          format: "depth24plus",
          usage: globalThis.GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10,
        });
      }
    }

    function frame(now) {
      if (renderState !== state) return;

      try {
        ensureDepth();
        if (!state.paused) {
          const physicsStats = state.compute.step();
          if (
            physicsStats.computePasses !== 2
            || physicsStats.dynamicStateUploadBytes !== 0
          ) {
            throw new Error(
              `нарушен инвариант монолитной физики: проходы=${physicsStats.computePasses}, загрузка=${physicsStats.dynamicStateUploadBytes}`,
            );
          }
          state.steps += 1;
        }

        const dragStats = applyCenterDrag(state);
        if (dragStats && state.centerDrag) {
          state.centerDrag.uploadedBytes +=
            dragStats.centerBytes + dragStats.velocityBytes;
        }

        const shapeStats = state.shape.update();
        if (
          shapeStats.computePasses !== 1
          || shapeStats.dynamicStateUploadBytes !== 0
        ) {
          throw new Error(
            `нарушен инвариант производной геометрии: проходы=${shapeStats.computePasses}, загрузка=${shapeStats.dynamicStateUploadBytes}`,
          );
        }
        state.shapeUpdates += 1;

        const frameDeltaSeconds = Math.min(
          0.1,
          Math.max(0, (now - state.lastFrameAt) / 1000),
        );
        state.lastFrameAt = now;
        if (ui.autoRotate.checked && !state.centerDrag) {
          state.camera.yaw += frameDeltaSeconds * 0.16;
        }
        const viewProjection = currentViewProjection(state);

        const renderStyle = selectedGlobalRenderControls();
        const markers = selectedMarkerControls();
        const stats = state.renderer.render({
          targetView: state.context.getCurrentTexture().createView(),
          depthView: state.depthTexture.createView(),
          viewProjection,
          width: ui.canvas.width,
          height: ui.canvas.height,
          wireframe: renderStyle.wireframe,
          showCenterMarkers: markers.showCenterMarkers,
          showEndCones: markers.showEndCones,
          centerMarkerScale: markers.centerMarkerScale,
          endConeScale: markers.endConeScale,
          hoveredCenterLink: state.hoveredCenterLink,
          smoothNormals: renderStyle.smoothNormals,
          clearColor: { r: 0.005, g: 0.008, b: 0.014, a: 1 },
        });
        state.frames += 1;

        const expectedDrawCalls =
          1
          + (
            markers.showCenterMarkers
            && state.hoveredCenterLink >= 0
              ? 1
              : 0
          )
          + (markers.showEndCones ? 1 : 0);
        if (
          stats.dynamicStateUploadBytes !== 0
          || stats.bufferCopies !== 0
          || stats.readbacks !== 0
          || stats.drawCalls !== expectedDrawCalls
        ) {
          throw new Error(
            `нарушение zero-copy во время рендера: загрузки=${stats.dynamicStateUploadBytes}, копии=${stats.bufferCopies}, чтения=${stats.readbacks}, отрисовки=${stats.drawCalls}/${expectedDrawCalls}`,
          );
        }

        if (now - state.lastUiAt > 250) {
          state.lastUiAt = now;
          ui.renderFrames.textContent =
            `${state.frames.toLocaleString()} / ${state.steps.toLocaleString()}`;
        }
      } catch (error) {
        renderPass = false;
        setStatus(ui.renderCompute, UI_STATUS.error, "fail");
        setStatus(ui.renderZeroCopy, "НЕ ПРОЙДЕНО — см. журнал", "fail");
        log(`ОШИБКА монолитного рендера — ${error.stack ?? error}`);
        updateOverall();
        return;
      }

      state.raf = requestAnimationFrame(frame);
    }

    state.raf = requestAnimationFrame(frame);
    log(
      `монолитный рендер v0.5 запущен: сцена=${scene.label}, ${linkCount} связей, ${shape.template.octahedronCount} октаэдров/связь, массаCENTER=${physics.nodeMass.toFixed(2)}, растяжение=${physics.longitudinalStiffness.toFixed(2)}, выпрямление=${physics.transverseStiffness.toFixed(2)}, нелинейность=${physics.nonlinearity.toFixed(2)}, демпфирование=${physics.linearDampingRate.toFixed(2)}, скорость=${physics.simulationSpeed.toFixed(2)}x`,
    );
  } catch (error) {
    try { renderer?.destroy(); } catch {}
    try { shape?.destroy(); } catch {}
    try { compute.destroy(); } catch {}
    throw error;
  }
}

function distance3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

async function inspectGeometry() {
  if (!renderState) return;

  const render = renderState;
  const wasPaused = render.paused;
  render.paused = true;
  ui.inspectGeometry.disabled = true;

  try {
    const gpuState = await render.compute.readBackState();
    if (renderState !== render) return;

    const topology = render.compute.topology;
    const restLength = render.shape.template.restLength;
    const networkByKey = new Map(
      render.network.links.map((link) => [link.key, link]),
    );
    const rowsHtml = [];
    let globalMaxBend = 0;
    let globalMaxSpeed = 0;
    let totalPotentialEnergy = 0;

    for (let linkIndex = 0; linkIndex < topology.linkCount; linkIndex += 1) {
      const key = topology.keys[linkIndex];
      const source = networkByKey.get(key);
      if (!source) {
        throw new Error(`не найдена исходная связь для диагностики: ${key}`);
      }

      const startIndex = topology.startIndices[linkIndex];
      const endIndex = topology.endIndices[linkIndex];
      const start = packedVec3(gpuState.centers, startIndex);
      const center = packedVec3(gpuState.centers, linkIndex);
      const end = packedVec3(gpuState.centers, endIndex);
      const velocity = packedVec3(gpuState.velocities, linkIndex);

      const startLength = distance3(start, center);
      const endLength = distance3(center, end);
      const bendVector = [
        start[0] - 2 * center[0] + end[0],
        start[1] - 2 * center[1] + end[1],
        start[2] - 2 * center[2] + end[2],
      ];
      const bend = Math.hypot(...bendVector);
      const centerDisplacement = distance3(
        center,
        render.initialSemanticCenters[linkIndex],
      );
      const speed = Math.hypot(...velocity);
      const energy = core.evaluateMonolithicLinkSpring3D(
        start,
        center,
        end,
        restLength,
        {
          stretchStiffness: render.compute.stretchStiffness,
          straighteningStiffness:
            render.compute.straighteningStiffness,
          nonlinearity: render.compute.nonlinearity,
        },
      ).energy;

      globalMaxBend = Math.max(globalMaxBend, bend);
      globalMaxSpeed = Math.max(globalMaxSpeed, speed);
      totalPotentialEnergy += energy;

      rowsHtml.push(`
        <tr>
          <td class="value">${key}</td>
          <td>${equationForNetworkLink(source)}</td>
          <td>${fmt(startLength)}</td>
          <td>${fmt(endLength)}</td>
          <td>${fmt(bend)}</td>
          <td>${fmt(centerDisplacement)}</td>
          <td>${fmt(energy)}</td>
          <td>${fmt(speed)}</td>
          <td>${fmt(restLength)}</td>
        </tr>
      `);
    }

    ui.geometryBody.innerHTML = rowsHtml.join("");
    const readbackBytes =
      gpuState.centers.byteLength + gpuState.velocities.byteLength;
    log(
      `проверка монолитной геометрии: сцена=${render.scene.label}, ${topology.linkCount} связей, чтение=${readbackBytes} Б, максИзгиб=${fmt(globalMaxBend)}, потенциал=${fmt(totalPotentialEnergy)}, максСкоростьCENTER=${fmt(globalMaxSpeed)}, длинаПокоя=${fmt(restLength)}`,
    );
  } catch (error) {
    ui.geometryBody.innerHTML =
      `<tr><td colspan="9" class="fail">ОШИБКА проверки — ${String(error)}</td></tr>`;
    log(`ОШИБКА проверки монолитной геометрии — ${error.stack ?? error}`);
  } finally {
    if (renderState === render) render.paused = wasPaused;
    ui.inspectGeometry.disabled = false;
  }
}

let structuralState = null;

function selectedStructuralOptions() {
  const rootKey = ui.structuralRoot.value || undefined;
  return Object.freeze({
    ...(rootKey === undefined ? {} : { rootKey }),
    layerSpacing: controlNumber(ui.structuralSpacing, "шаг структурных слоёв", 64, 240),
    minimumNodeSpacing: controlNumber(ui.structuralNodeSpacing, "минимальное расстояние Structural", 36, 160),
    optimizeCrossings: ui.structuralOptimize.checked,
    crossingPasses: 5,
    crossingEvaluations: 240,
  });
}

function refreshStructuralControlLabels() {
  const options = selectedStructuralOptions();
  ui.structuralSpacingValue.value = options.layerSpacing.toFixed(0);
  ui.structuralNodeSpacingValue.value = options.minimumNodeSpacing.toFixed(0);
}

function refreshStructuralRootOptions(network) {
  const previous = ui.structuralRoot.value;
  ui.structuralRoot.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Без явного корня";
  ui.structuralRoot.appendChild(none);
  for (const link of [...network.links].sort((left, right) => left.key.localeCompare(right.key))) {
    const option = document.createElement("option");
    option.value = link.key;
    option.textContent = link.key;
    ui.structuralRoot.appendChild(option);
  }
  ui.structuralRoot.value = network.links.some((link) => link.key === previous) ? previous : "";
}

function structuralViewportSize() {
  return {
    width: Math.max(1, ui.structuralViewport.clientWidth),
    height: Math.max(1, ui.structuralViewport.clientHeight),
  };
}

function applyStructuralViewport(state) {
  const svg = ui.structuralViewport.querySelector("svg");
  if (!svg || !state.viewport) return;
  const { width, height } = structuralViewportSize();
  const { scale, panX, panY } = state.viewport;
  svg.setAttribute(
    "viewBox",
    [
      -panX / scale,
      -panY / scale,
      width / scale,
      height / scale,
    ].map((value) => Number(value.toFixed(9))).join(" "),
  );
  svg.setAttribute("preserveAspectRatio", "none");
}

function fitStructuralState(state) {
  const { width, height } = structuralViewportSize();
  state.viewport = core.fitBlueprintViewport(
    state.layout.bounds,
    width,
    height,
    { padding: 30, minScale: 0.05, maxScale: 16 },
  );
  applyStructuralViewport(state);
}

function updateStructuralDiagnostics(state) {
  const maxDepth = state.layout.positions.reduce(
    (maximum, position) => Math.max(maximum, position.depth),
    0,
  );
  ui.structuralComponents.textContent =
    `${state.layout.components.length} / ${maxDepth + 1}`;
  ui.structuralCrossings.textContent =
    `${state.layout.metrics.crossingsBefore} → ${state.layout.metrics.crossingsAfter}`;
  ui.structuralOptimizer.textContent =
    `${state.layout.metrics.evaluations} проверок · ${state.layout.metrics.passes} проходов`;
  ui.structuralLinkCount.textContent = String(state.network.links.length);
}

function renderStructuralState(state, { fit = false } = {}) {
  state.options = selectedStructuralOptions();
  state.layout = core.layoutStructural2D(state.network, state.options);
  ui.structuralViewport.innerHTML = core.serializeStructural2DSvg(
    state.network,
    state.layout,
  );
  const svg = ui.structuralViewport.querySelector("svg");
  if (!svg) throw new Error("Structural 2D renderer не создал SVG");
  svg.setAttribute("aria-label", `Structural 2D: ${state.scene.label}`);
  updateStructuralDiagnostics(state);
  if (fit || !state.viewport) fitStructuralState(state);
  else applyStructuralViewport(state);
}

function structuralPointerPoint(event) {
  const rect = ui.structuralViewport.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function downloadStructuralSvg() {
  if (!structuralState?.layout) return;
  const text = core.serializeStructural2DSvg(
    structuralState.network,
    structuralState.layout,
  );
  const blob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download =
    `mts-visual-structural-${structuralState.scene.id}-${String(buildInfo.mainSha).slice(0, 12)}.svg`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  log(
    `Structural SVG сохранён: сцена=${structuralState.scene.label}, пересечения=${structuralState.layout.metrics.crossingsAfter}`,
  );
}

function mountStructural2D() {
  const scene = selectedScene();
  const abortController = new AbortController();
  refreshStructuralRootOptions(scene.network);
  refreshStructuralControlLabels();

  const state = {
    scene,
    network: scene.network,
    options: null,
    layout: null,
    viewport: null,
    pointerId: null,
    panPointer: null,
    abortController,
  };
  structuralState = state;
  renderStructuralState(state, { fit: true });

  const signal = abortController.signal;
  ui.structuralViewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    state.pointerId = event.pointerId;
    state.panPointer = { x: event.clientX, y: event.clientY };
    ui.structuralViewport.setPointerCapture?.(event.pointerId);
    ui.structuralViewport.classList.add("dragging");
    event.preventDefault();
  }, { signal });

  ui.structuralViewport.addEventListener("pointermove", (event) => {
    if (state.pointerId !== event.pointerId || !state.panPointer) return;
    const dx = event.clientX - state.panPointer.x;
    const dy = event.clientY - state.panPointer.y;
    state.panPointer = { x: event.clientX, y: event.clientY };
    state.viewport = core.panBlueprintViewport(state.viewport, dx, dy);
    applyStructuralViewport(state);
    event.preventDefault();
  }, { signal });

  const finishPointer = (event) => {
    if (state.pointerId !== event.pointerId) return;
    state.pointerId = null;
    state.panPointer = null;
    ui.structuralViewport.classList.remove("dragging");
  };
  ui.structuralViewport.addEventListener("pointerup", finishPointer, { signal });
  ui.structuralViewport.addEventListener("pointercancel", finishPointer, { signal });

  ui.structuralViewport.addEventListener("wheel", (event) => {
    const factor = Math.exp(-event.deltaY * 0.001);
    state.viewport = core.zoomBlueprintViewport(
      state.viewport,
      factor,
      structuralPointerPoint(event),
      { minScale: 0.05, maxScale: 24 },
    );
    applyStructuralViewport(state);
    event.preventDefault();
  }, { passive: false, signal });

  log(
    `Structural 2D запущен: сцена=${scene.label}, SCC=${state.layout.components.length}, пересечения=${state.layout.metrics.crossingsBefore}→${state.layout.metrics.crossingsAfter}`,
  );

  return () => {
    abortController.abort();
    ui.structuralViewport.classList.remove("dragging");
    ui.structuralViewport.replaceChildren();
    if (structuralState === state) structuralState = null;
  };
}

let blueprintState = null;

function selectedBlueprintOptions() {
  const spacing = controlNumber(ui.blueprintSpacing, "шаг Blueprint", 48, 220);
  const loopRadius = controlNumber(ui.blueprintLoopRadius, "радиус самопетли Blueprint", 12, 100);
  const clearance = controlNumber(ui.blueprintClearance, "отступ концов Blueprint", 0, 0.30);
  return Object.freeze({ spacing, loopRadius, clearance });
}

function refreshBlueprintControlLabels() {
  const options = selectedBlueprintOptions();
  ui.blueprintSpacingValue.value = options.spacing.toFixed(0);
  ui.blueprintLoopRadiusValue.value = options.loopRadius.toFixed(0);
  ui.blueprintClearanceValue.value = options.clearance.toFixed(2);
}

function blueprintPresentationNetwork(network) {
  return {
    links: network.links.map((link) => {
      const copy = { ...link };
      if (ui.blueprintLabels.checked) copy.label = link.label ?? link.key;
      else delete copy.label;
      return copy;
    }),
  };
}

function blueprintViewportSize() {
  return {
    width: Math.max(1, ui.blueprintViewport.clientWidth),
    height: Math.max(1, ui.blueprintViewport.clientHeight),
  };
}

function applyBlueprintViewport(state) {
  const svg = ui.blueprintViewport.querySelector("svg");
  if (!svg) return;
  const { width, height } = blueprintViewportSize();
  const { scale, panX, panY } = state.viewport;
  svg.setAttribute(
    "viewBox",
    [
      -panX / scale,
      -panY / scale,
      width / scale,
      height / scale,
    ].map((value) => Number(value.toFixed(9))).join(" "),
  );
  svg.setAttribute("preserveAspectRatio", "none");
}

function fitBlueprintState(state) {
  const { width, height } = blueprintViewportSize();
  state.viewport = core.fitBlueprintViewport(
    state.svgScene.bounds,
    width,
    height,
    { padding: 28, minScale: 0.05, maxScale: 12 },
  );
  applyBlueprintViewport(state);
}

function renderBlueprintState(state, { fit = false } = {}) {
  const options = selectedBlueprintOptions();
  const network = blueprintPresentationNetwork(state.sourceNetwork);
  state.geometry = core.buildBlueprintGeometry(network, state.positions, {
    spacing: options.spacing,
    loopRadius: options.loopRadius,
    startOffsetFraction: options.clearance,
    endOffsetFraction: options.clearance,
  });
  state.svgScene = core.buildBlueprintSvgScene(network, state.geometry, { padding: 36 });
  ui.blueprintViewport.innerHTML = core.serializeBlueprintSvg(state.svgScene);
  const svg = ui.blueprintViewport.querySelector("svg");
  if (!svg) throw new Error("Blueprint renderer не создал SVG");

  svg.setAttribute("aria-label", `Blueprint 2D: ${state.scene.label}`);
  svg.querySelectorAll('[data-role="blueprint-center"]').forEach((center) => {
    center.setAttribute("tabindex", "0");
  });

  if (fit || !state.viewport) fitBlueprintState(state);
  else applyBlueprintViewport(state);
}

function resetBlueprintPositions(state) {
  const options = selectedBlueprintOptions();
  state.positions = core.createBlueprintInitialPositions(state.sourceNetwork, {
    spacing: options.spacing,
  });
  renderBlueprintState(state, { fit: true });
}

function blueprintPointerPoint(event) {
  const rect = ui.blueprintViewport.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function downloadBlueprintSvg() {
  if (!blueprintState?.svgScene) return;
  const text = core.serializeBlueprintSvg(blueprintState.svgScene);
  const blob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mts-visual-blueprint-${blueprintState.scene.id}-${String(buildInfo.mainSha).slice(0, 12)}.svg`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  log(`Blueprint SVG сохранён: сцена=${blueprintState.scene.label}, связей=${blueprintState.sourceNetwork.links.length}`);
}

function mountBlueprint() {
  const scene = selectedScene();
  const abortController = new AbortController();
  const state = {
    scene,
    sourceNetwork: scene.network,
    positions: core.createBlueprintInitialPositions(scene.network, {
      spacing: selectedBlueprintOptions().spacing,
    }),
    viewport: null,
    geometry: null,
    svgScene: null,
    dragKey: null,
    panPointer: null,
    pointerId: null,
    abortController,
  };
  blueprintState = state;
  refreshBlueprintControlLabels();
  renderBlueprintState(state, { fit: true });

  const signal = abortController.signal;
  ui.blueprintViewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const center = event.target.closest?.('[data-role="blueprint-center"]');
    state.pointerId = event.pointerId;
    ui.blueprintViewport.setPointerCapture?.(event.pointerId);
    ui.blueprintViewport.classList.add("dragging");

    if (center) {
      state.dragKey = center.getAttribute("data-link-key");
      state.panPointer = null;
    } else {
      state.dragKey = null;
      state.panPointer = { x: event.clientX, y: event.clientY };
    }
    event.preventDefault();
  }, { signal });

  ui.blueprintViewport.addEventListener("pointermove", (event) => {
    if (state.pointerId !== event.pointerId) return;
    if (state.dragKey) {
      const world = core.blueprintScreenToWorld(
        state.viewport,
        blueprintPointerPoint(event),
      );
      state.positions = core.moveBlueprintPosition(
        state.positions,
        state.dragKey,
        world,
      );
      renderBlueprintState(state);
      event.preventDefault();
      return;
    }

    if (state.panPointer) {
      const dx = event.clientX - state.panPointer.x;
      const dy = event.clientY - state.panPointer.y;
      state.panPointer = { x: event.clientX, y: event.clientY };
      state.viewport = core.panBlueprintViewport(state.viewport, dx, dy);
      applyBlueprintViewport(state);
      event.preventDefault();
    }
  }, { signal });

  const finishPointer = (event) => {
    if (state.pointerId !== event.pointerId) return;
    state.pointerId = null;
    state.dragKey = null;
    state.panPointer = null;
    ui.blueprintViewport.classList.remove("dragging");
  };
  ui.blueprintViewport.addEventListener("pointerup", finishPointer, { signal });
  ui.blueprintViewport.addEventListener("pointercancel", finishPointer, { signal });

  ui.blueprintViewport.addEventListener("wheel", (event) => {
    const factor = Math.exp(-event.deltaY * 0.001);
    state.viewport = core.zoomBlueprintViewport(
      state.viewport,
      factor,
      blueprintPointerPoint(event),
      { minScale: 0.05, maxScale: 20 },
    );
    applyBlueprintViewport(state);
    event.preventDefault();
  }, { passive: false, signal });

  log(`Blueprint 2D запущен: сцена=${scene.label}, связей=${scene.network.links.length}`);

  return () => {
    abortController.abort();
    ui.blueprintViewport.classList.remove("dragging");
    ui.blueprintViewport.replaceChildren();
    if (blueprintState === state) blueprintState = null;
  };
}

let document2dState = null;

function selectedDocumentOptions() {
  const rootKey = ui.documentRoot.value || undefined;
  return Object.freeze({
    profile: ui.documentProfile.value,
    strategy: ui.documentStrategy.value,
    ...(rootKey === undefined ? {} : { rootKey }),
  });
}

function refreshDocumentRootOptions(network) {
  const previous = ui.documentRoot.value;
  ui.documentRoot.replaceChildren();

  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Без явного корня";
  ui.documentRoot.appendChild(none);

  for (const link of [...network.links].sort((left, right) => left.key.localeCompare(right.key))) {
    const option = document.createElement("option");
    option.value = link.key;
    option.textContent = link.key;
    ui.documentRoot.appendChild(option);
  }

  ui.documentRoot.value = network.links.some((link) => link.key === previous)
    ? previous
    : "";
}

function documentViewportSize() {
  return {
    width: Math.max(1, ui.documentViewport.clientWidth),
    height: Math.max(1, ui.documentViewport.clientHeight),
  };
}

function applyDocumentViewport(state) {
  const svg = ui.documentViewport.querySelector("svg");
  if (!svg || !state.viewport) return;
  const { width, height } = documentViewportSize();
  const { scale, panX, panY } = state.viewport;
  svg.setAttribute(
    "viewBox",
    [
      -panX / scale,
      -panY / scale,
      width / scale,
      height / scale,
    ].map((value) => Number(value.toFixed(9))).join(" "),
  );
  svg.setAttribute("preserveAspectRatio", "none");
}

function fitDocumentState(state) {
  const { width, height } = documentViewportSize();
  state.viewport = core.fitBlueprintViewport(
    state.layout.bounds,
    width,
    height,
    { padding: 28, minScale: 0.05, maxScale: 16 },
  );
  applyDocumentViewport(state);
}

function updateDocumentDiagnostics(state) {
  const before = state.layout.metrics.qualityBefore;
  const after = state.layout.metrics.qualityAfter;
  ui.documentSeed.textContent =
    `${state.layout.metrics.seedStrategy} · ${state.layout.metrics.seedCandidates} кандидата`;
  ui.documentCrossings.textContent =
    `${before.crossings} → ${after.crossings}`;
  ui.documentOverlaps.textContent =
    `центры ${after.centerOverlaps} · подписи ${after.labelOverlaps}`;
  ui.documentOptimizer.textContent =
    `${state.layout.metrics.optimizerEvaluations} проверок · ${state.layout.metrics.optimizerPasses} проходов`;
}

function renderDocumentState(state, { fit = false } = {}) {
  state.options = selectedDocumentOptions();
  state.layout = core.layoutDocument2D(state.network, state.options);
  ui.documentViewport.innerHTML = core.serializeDocument2DSvg(
    state.network,
    state.layout,
  );

  const svg = ui.documentViewport.querySelector("svg");
  if (!svg) throw new Error("Document 2D renderer не создал SVG");
  svg.setAttribute(
    "aria-label",
    `Document 2D: ${state.scene.label} · ${state.layout.profile}`,
  );

  updateDocumentDiagnostics(state);
  if (fit || !state.viewport) fitDocumentState(state);
  else applyDocumentViewport(state);
}

function documentPointerPoint(event) {
  const rect = ui.documentViewport.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function downloadDocumentSvg() {
  if (!document2dState?.layout) return;
  const text = core.serializeDocument2DSvg(
    document2dState.network,
    document2dState.layout,
  );
  const blob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download =
    `mts-visual-document-${document2dState.scene.id}-${document2dState.layout.profile}-${String(buildInfo.mainSha).slice(0, 12)}.svg`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  log(
    `Document SVG сохранён: сцена=${document2dState.scene.label}, профиль=${document2dState.layout.profile}, seed=${document2dState.layout.metrics.seedStrategy}, качество=${document2dState.layout.metrics.qualityAfter.score}`,
  );
}

function mountDocument2D() {
  const scene = selectedScene();
  const abortController = new AbortController();
  refreshDocumentRootOptions(scene.network);

  const state = {
    scene,
    network: scene.network,
    options: null,
    layout: null,
    viewport: null,
    pointerId: null,
    panPointer: null,
    abortController,
  };
  document2dState = state;
  renderDocumentState(state, { fit: true });

  const signal = abortController.signal;
  ui.documentViewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    state.pointerId = event.pointerId;
    state.panPointer = { x: event.clientX, y: event.clientY };
    ui.documentViewport.setPointerCapture?.(event.pointerId);
    ui.documentViewport.classList.add("dragging");
    event.preventDefault();
  }, { signal });

  ui.documentViewport.addEventListener("pointermove", (event) => {
    if (state.pointerId !== event.pointerId || !state.panPointer) return;
    const dx = event.clientX - state.panPointer.x;
    const dy = event.clientY - state.panPointer.y;
    state.panPointer = { x: event.clientX, y: event.clientY };
    state.viewport = core.panBlueprintViewport(state.viewport, dx, dy);
    applyDocumentViewport(state);
    event.preventDefault();
  }, { signal });

  const finishPointer = (event) => {
    if (state.pointerId !== event.pointerId) return;
    state.pointerId = null;
    state.panPointer = null;
    ui.documentViewport.classList.remove("dragging");
  };
  ui.documentViewport.addEventListener("pointerup", finishPointer, { signal });
  ui.documentViewport.addEventListener("pointercancel", finishPointer, { signal });

  ui.documentViewport.addEventListener("wheel", (event) => {
    const factor = Math.exp(-event.deltaY * 0.001);
    state.viewport = core.zoomBlueprintViewport(
      state.viewport,
      factor,
      documentPointerPoint(event),
      { minScale: 0.05, maxScale: 24 },
    );
    applyDocumentViewport(state);
    event.preventDefault();
  }, { passive: false, signal });

  log(
    `Document 2D запущен: сцена=${scene.label}, профиль=${state.layout.profile}, seed=${state.layout.metrics.seedStrategy}, пересечения=${state.layout.metrics.qualityBefore.crossings}→${state.layout.metrics.qualityAfter.crossings}`,
  );

  return () => {
    abortController.abort();
    ui.documentViewport.classList.remove("dragging");
    ui.documentViewport.replaceChildren();
    if (document2dState === state) document2dState = null;
  };
}

let classicState = null;

function selectedClassicOptions() {
  return Object.freeze({
    charge: controlNumber(ui.classicCharge, "отталкивание центров", 0, 3),
    restLength: controlNumber(ui.classicRestLength, "длина покоя Classic", 0.25, 8),
    springStiffness: controlNumber(ui.classicStiffness, "жёсткость пружин Classic", 0, 0.30),
    damping: controlNumber(ui.classicDamping, "затухание Classic", 0.50, 0.99),
    timeStep: controlNumber(ui.classicTimeStep, "шаг времени Classic", 0.02, 0.50),
  });
}

function refreshClassicControlLabels() {
  const options = selectedClassicOptions();
  ui.classicChargeValue.value = options.charge.toFixed(2);
  ui.classicRestLengthValue.value = options.restLength.toFixed(2);
  ui.classicStiffnessValue.value = options.springStiffness.toFixed(3);
  ui.classicDampingValue.value = options.damping.toFixed(2);
  ui.classicTimeStepValue.value = options.timeStep.toFixed(2);
}

function classicPresentationNetwork(network) {
  return {
    links: network.links.map((link) => {
      const copy = { ...link };
      if (ui.classicLabels.checked) copy.label = link.label ?? link.key;
      else delete copy.label;
      return copy;
    }),
  };
}

function updateClassicDiagnostics(state) {
  const snapshot = core.snapshotLivePhysics3D(state.controller);
  const linkCount = state.controller.model.keys.length;
  const chargePairs = linkCount * (linkCount - 1) / 2;
  ui.classicTick.textContent = `${snapshot.tick} · ${snapshot.awake ? "активен" : "покой"}`;
  ui.classicEvaluations.textContent =
    `${state.controller.model.springs.length} / ${chargePairs}`;
  ui.classicMaxVelocity.textContent = fmt(snapshot.maxVelocity);
  ui.classicPinned.textContent = String(snapshot.pinnedKeys.length);
}

function applyClassicPhysicsControls() {
  refreshClassicControlLabels();
  if (!classicState) return;
  const options = selectedClassicOptions();
  classicState.options = options;
  core.setLivePhysics3DOptions(classicState.controller, options);
  if (!classicState.paused) {
    threeVisual.setVisualThreeLivePaused(ui.classicViewport, false);
  }
  updateClassicDiagnostics(classicState);
}

function mountClassic3D() {
  const scene = selectedScene();
  const network = classicPresentationNetwork(scene.network);
  const options = selectedClassicOptions();
  const controller = core.createLivePhysics3D(
    network,
    core.createInitialPhysics3DState(network, { radius: 3 }),
    options,
  );
  const state = {
    scene,
    network,
    controller,
    options,
    paused: false,
    diagnosticsTimer: null,
  };
  classicState = state;
  refreshClassicControlLabels();
  ui.classicPause.textContent = "Пауза";

  const renderer = threeVisual.createVisualThreeLiveRenderer(
    ui.classicViewport,
    network,
    controller,
    {
      samples: 18,
      nodeRadius: 0.13,
      onActivateKey: (key) => {
        log(`Classic 3D: выбрана связь ${key}`);
      },
    },
  );
  state.diagnosticsTimer = window.setInterval(() => {
    if (classicState === state) updateClassicDiagnostics(state);
  }, 200);
  updateClassicDiagnostics(state);

  log(
    `Classic 3D запущен: сцена=${scene.label}, связей=${network.links.length}, пружин=${controller.model.springs.length}, пар отталкивания=${network.links.length * (network.links.length - 1) / 2}`,
  );

  return () => {
    if (state.diagnosticsTimer !== null) window.clearInterval(state.diagnosticsTimer);
    threeVisual.destroyVisualThreeRenderer(ui.classicViewport);
    ui.classicViewport.replaceChildren();
    if (classicState === state) classicState = null;
  };
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

async function mountLabMode(modeId) {
  const mechanical = modeId === "mechanical-3d";
  const structural = modeId === "structural-2d";
  const blueprint = modeId === "blueprint-2d";
  const classic = modeId === "classic-3d";
  const hasSideControls = mechanical || structural || blueprint || classic;

  ui.mechanicalControls.hidden = !mechanical;
  ui.structuralControls.hidden = !structural;
  ui.blueprintControls.hidden = !blueprint;
  ui.classicControls.hidden = !classic;
  ui.canvas.hidden = !mechanical;
  ui.structuralViewport.hidden = !structural;
  ui.blueprintViewport.hidden = !blueprint;
  ui.classicViewport.hidden = !classic;
  ui.modePlaceholder.hidden = mechanical || structural || blueprint || classic;
  ui.mechanicalCameraHint.hidden = !mechanical;
  ui.mechanicalRenderDiagnostics.hidden = !mechanical;
  ui.structuralRenderDiagnostics.hidden = !structural;
  ui.classicRenderDiagnostics.hidden = !classic;
  ui.mechanicalGeometryPanel.hidden = !mechanical;
  ui.liveLab.classList.toggle("placeholder-mode", !hasSideControls);

  if (mechanical) {
    await startRender();
    return () => stopRender();
  }

  if (structural) return mountStructural2D();
  if (blueprint) return mountBlueprint();
  if (classic) return mountClassic3D();

  updateModePlaceholder(modeId);
  log(`режим ${modeId} выбран; renderer будет подключён отдельным этапом roadmap`);
  return () => {
    ui.modePlaceholder.replaceChildren();
  };
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
  },
});

async function activateLabMode(modeId) {
  await labLifecycle.activate(modeId);
}

function mechanicalModeIsActive() {
  return labLifecycle.activeMode === "mechanical-3d";
}

ui.visualizationMode.addEventListener("change", () => {
  activateLabMode(ui.visualizationMode.value).catch((error) => {
    log(`ОШИБКА активации режима — ${error.stack ?? error}`);
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
  ui.geometryBody.innerHTML = '<tr><td colspan="9" class="muted">Нажмите «Проверить геометрию».</td></tr>';
  const activeMode = labLifecycle.activeMode ?? ui.visualizationMode.value;
  if (activeMode === "structural-2d" || activeMode === "blueprint-2d" || activeMode === "classic-3d") {
    activateLabMode(activeMode).catch((error) => {
      log(`ОШИБКА перезапуска режима ${activeMode} — ${error.stack ?? error}`);
    });
    return;
  }
  if (!mechanicalModeIsActive()) {
    updateModePlaceholder(activeMode);
    return;
  }
  startRender().catch((error) => {
    renderPass = false;
    setStatus(ui.renderCompute, UI_STATUS.error, "fail");
    setStatus(ui.renderZeroCopy, "НЕ ПРОЙДЕНО — см. журнал", "fail");
    log(`ОШИБКА перезапуска сцены — ${error.stack ?? error}`);
    updateOverall();
  });
});

for (const control of [
  ui.structuralSpacing,
  ui.structuralNodeSpacing,
]) {
  control.addEventListener("input", () => {
    refreshStructuralControlLabels();
    if (structuralState) renderStructuralState(structuralState, { fit: true });
  });
}

ui.structuralRoot.addEventListener("change", () => {
  if (structuralState) renderStructuralState(structuralState, { fit: true });
});

ui.structuralOptimize.addEventListener("change", () => {
  if (structuralState) renderStructuralState(structuralState, { fit: true });
});

ui.structuralFit.addEventListener("click", () => {
  if (structuralState) fitStructuralState(structuralState);
});

ui.structuralReset.addEventListener("click", () => {
  if (structuralState) renderStructuralState(structuralState, { fit: true });
});

ui.structuralExport.addEventListener("click", () => {
  downloadStructuralSvg();
});

for (const control of [
  ui.blueprintSpacing,
  ui.blueprintLoopRadius,
  ui.blueprintClearance,
]) {
  control.addEventListener("input", () => {
    refreshBlueprintControlLabels();
    if (!blueprintState) return;

    if (control === ui.blueprintSpacing) {
      blueprintState.positions = core.createBlueprintInitialPositions(
        blueprintState.sourceNetwork,
        { spacing: selectedBlueprintOptions().spacing },
      );
      renderBlueprintState(blueprintState, { fit: true });
    } else {
      renderBlueprintState(blueprintState);
    }
  });
}

ui.blueprintLabels.addEventListener("change", () => {
  if (blueprintState) renderBlueprintState(blueprintState);
});

ui.blueprintFit.addEventListener("click", () => {
  if (blueprintState) fitBlueprintState(blueprintState);
});

ui.blueprintReset.addEventListener("click", () => {
  if (blueprintState) resetBlueprintPositions(blueprintState);
});

ui.blueprintExport.addEventListener("click", () => {
  downloadBlueprintSvg();
});

for (const control of [
  ui.classicCharge,
  ui.classicRestLength,
  ui.classicStiffness,
  ui.classicDamping,
  ui.classicTimeStep,
]) {
  control.addEventListener("input", applyClassicPhysicsControls);
}

ui.classicLabels.addEventListener("change", () => {
  if (!classicState) return;
  activateLabMode("classic-3d").catch((error) => {
    log(`ОШИБКА обновления подписей Classic 3D — ${error.stack ?? error}`);
  });
});

ui.classicPause.addEventListener("click", () => {
  if (!classicState) return;
  classicState.paused = !classicState.paused;
  threeVisual.setVisualThreeLivePaused(ui.classicViewport, classicState.paused);
  ui.classicPause.textContent = classicState.paused ? "Продолжить" : "Пауза";
  updateClassicDiagnostics(classicState);
});

ui.classicReset.addEventListener("click", () => {
  if (!classicState) return;
  activateLabMode("classic-3d").catch((error) => {
    log(`ОШИБКА сброса Classic 3D — ${error.stack ?? error}`);
  });
});

ui.classicFit.addEventListener("click", () => {
  if (classicState) threeVisual.fitVisualThreeRenderer(ui.classicViewport);
});

ui.classicFullscreen.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement === ui.viewportShell) await document.exitFullscreen();
    else await ui.viewportShell.requestFullscreen();
  } catch (error) {
    log(`ОШИБКА полноэкранного режима Classic 3D — ${error.stack ?? error}`);
  }
});

ui.inspectGeometry.addEventListener("click", () => {
  inspectGeometry();
});

ui.restartRender.addEventListener("click", () => {
  startRender().catch((error) => {
    renderPass = false;
    setStatus(ui.renderCompute, UI_STATUS.error, "fail");
    setStatus(ui.renderZeroCopy, "НЕ ПРОЙДЕНО — см. журнал", "fail");
    log(`ОШИБКА настройки рендера — ${error.stack ?? error}`);
    updateOverall();
  });
});

ui.resetView.addEventListener("click", () => {
  if (!renderState) return;
  resetCamera(renderState.camera, renderState.camera.defaultDistance);
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
  if (!ui.showCenterMarkers.checked && renderState) {
    renderState.centerDrag = null;
    renderState.hoveredCenterLink = -1;
    ui.canvas.classList.remove("center-hover");
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
  renderPass = false;
  updateOverall();
  startRender().catch((error) => {
    renderPass = false;
    setStatus(ui.renderCompute, UI_STATUS.error, "fail");
    setStatus(ui.renderZeroCopy, "НЕ ПРОЙДЕНО — см. журнал", "fail");
    log(`ОШИБКА перезапуска после изменения длины — ${error.stack ?? error}`);
    updateOverall();
  });
});

function applyLivePhysicsControls() {
  refreshPhysicsControlLabels();
  markDifferentialStale();
  if (!renderState) return;

  const physics = selectedPhysics();
  const compute = renderState.compute;
  compute.setCenterMass(physics.nodeMass);
  compute.setStretchStiffness(physics.longitudinalStiffness);
  compute.setStraighteningStiffness(physics.transverseStiffness);
  compute.setNonlinearity(physics.nonlinearity);
  compute.setDampingRate(physics.linearDampingRate);
  compute.setSimulationSpeed(physics.simulationSpeed);

  const snapshot = compute.snapshot();
  const checks = [
    ["масса CENTER", snapshot.centerMass, physics.nodeMass],
    [
      "жёсткость растяжения",
      snapshot.stretchStiffness,
      physics.longitudinalStiffness,
    ],
    [
      "жёсткость выпрямления",
      snapshot.straighteningStiffness,
      physics.transverseStiffness,
    ],
    ["нелинейность", snapshot.nonlinearity, physics.nonlinearity],
    ["демпфирование CENTER", snapshot.dampingRate, physics.linearDampingRate],
    ["скорость симуляции", snapshot.simulationSpeed, physics.simulationSpeed],
  ];
  for (const [label, actual, expected] of checks) {
    if (Math.abs(actual - expected) > 1e-12) {
      throw new Error(
        `несоответствие параметра ${label}: запрошено ${expected}, получено ${actual}`,
      );
    }
  }

  setStatus(
    ui.renderCompute,
    `ДОСТУПНО · mC=${physics.nodeMass.toFixed(2)} · kS=${physics.longitudinalStiffness.toFixed(2)} · kB=${physics.transverseStiffness.toFixed(2)} · α=${physics.nonlinearity.toFixed(2)} · t=${physics.simulationSpeed.toFixed(2)}x`,
    "ok",
  );
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
  if (!renderState) return;
  renderState.paused = !renderState.paused;
  ui.pauseRender.textContent = renderState.paused ? "Продолжить" : "Пауза";
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
  ui.classicFullscreen.textContent = active ? "Выйти из полноэкранного режима" : "На весь экран";
  if (classicState) {
    requestAnimationFrame(() => threeVisual.fitVisualThreeRenderer(ui.classicViewport));
  }
  if (structuralState) requestAnimationFrame(() => fitStructuralState(structuralState));
  if (blueprintState) requestAnimationFrame(() => fitBlueprintState(blueprintState));
});

try {
  await acquireDevice();
  if (device) await runDifferentials();
  await activateLabMode(ui.visualizationMode.value);
} catch (error) {
  setStatus(ui.overall, "ОШИБКА — см. диагностический журнал", "fail");
  log(error.stack ?? String(error));
}

window.addEventListener("pagehide", () => {
  void labLifecycle.dispose();
  stopRender();
});
