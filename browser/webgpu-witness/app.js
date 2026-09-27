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
  wireframe: $("wireframe"),
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

function fmt(value) {
  if (value === null || value === undefined) return "—";
  if (!Number.isFinite(value)) return String(value);
  return Math.abs(value) < 1e-3 && value !== 0
    ? value.toExponential(3)
    : value.toFixed(6);
}

const [core, webgpu, buildInfo] = await Promise.all([
  import("./vendor/mts-visual-core.bundle.js"),
  import("./vendor/mts-visual-webgpu.bundle.js"),
  fetch("./build-info.json", { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error(`build-info HTTP ${response.status}`);
    return response.json();
  }),
]);

for (const exportName of [
  "createOctahedralWebGpuZeroCopyRenderer3D",
  "createRigidSectionWebGpuZeroCopyRenderer3D",
  "createRigidSectionWebGpuCompute3D",
]) {
  if (typeof webgpu[exportName] !== "function") {
    throw new Error(`published WebGPU bundle missing export: ${exportName}`);
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
  throw new Error("published bundle does not expose accepted 20-octahedron baseline");
}

setStatus(
  ui.build,
  `@mts/visual ${buildInfo.version} @ ${buildInfo.mainSha.slice(0, 12)}`,
  "ok",
);
setStatus(
  ui.baseline,
  `${baselineOctahedra} octa · aspect ${baselineAspectRatio.toFixed(4)}`,
  "ok",
);

const LINK_OCTAHEDRON_CHOICES = Object.freeze([16, 32, 64, 128, 256]);

function controlNumber(element, label, minimum, maximum) {
  const value = Number(element.value);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`invalid ${label} control value: ${element.value}`);
  }
  return value;
}

function selectedPhysics() {
  const octahedra = Number(ui.lengthOcta.value);
  if (!LINK_OCTAHEDRON_CHOICES.includes(octahedra)) {
    throw new Error(`invalid octahedron control value: ${ui.lengthOcta.value}`);
  }

  const nodeMass = controlNumber(ui.nodeMass, "node mass", 0.05, 20);
  const longitudinalStiffness =
    controlNumber(ui.longitudinalStiffness, "longitudinal stiffness", 0, 100);
  const transverseStiffness =
    controlNumber(ui.transverseStiffness, "transverse stiffness", 0, 100);
  const nonlinearity = controlNumber(ui.nonlinearity, "nonlinearity", 0, 50);
  const linearDampingRate =
    controlNumber(ui.linearDamping, "linear damping", 0, 10);
  const angularDampingRate =
    controlNumber(ui.angularDamping, "angular damping", 0, 10);
  const simulationSpeed =
    controlNumber(ui.simulationSpeed, "simulation speed", 0, 8);

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

function refreshPhysicsControlLabels() {
  const physics = selectedPhysics();
  ui.lengthValue.value =
    `${physics.octahedra} octa · aspect ${physics.aspectRatio.toFixed(3)}`;
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

function selectedMarkerControls() {
  return Object.freeze({
    showCenterMarkers: ui.showCenterMarkers.checked,
    showEndCones: ui.showEndCones.checked,
    centerMarkerScale:
      controlNumber(ui.centerMarkerScale, "CENTER size", 0.25, 8),
    endConeScale:
      controlNumber(ui.endConeScale, "END cone size", 0.25, 8),
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
    throw new Error(`invalid root-basis stage: ${count}`);
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
  const signature = physicsSignature();
  return differentialAllPass
    && rigidDifferentialAllPass
    && differentialPhysicsSignature === signature
    && rigidDifferentialPhysicsSignature === signature;
}

function markDifferentialStale() {
  differentialAllPass = false;
  rigidDifferentialAllPass = false;
  monolithicDifferentialAllPass = false;
  for (const collection of [rows, rigidRows, monolithicRows]) {
    for (const row of collection.values()) {
      const status = row.querySelector(".status");
      if (status.textContent === "PASS") {
        status.textContent = "STALE";
        status.className = "status warn";
      }
    }
  }
  updateOverall();
}

function updateOverall() {
  const differentialCurrent = differentialIsCurrent();
  if (differentialCurrent && renderPass) {
    setStatus(ui.overall, "PASS — compute differential + zero-copy render", "ok");
  } else if (device === null) {
    setStatus(ui.overall, "UNAVAILABLE", "warn");
  } else if (differentialCurrent || renderPass) {
    setStatus(ui.overall, "PARTIAL — see diagnostics", "warn");
  } else {
    setStatus(ui.overall, "FAIL / pending", "fail");
  }
}

function differentialRow(name) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${name}</td>
    <td class="status">pending</td>
    <td>${DIFFERENTIAL_STEPS}</td>
    <td>${DIFFERENTIAL_TOLERANCE}</td>
    <td class="pos">—</td>
    <td class="vel">—</td>
  `;
  return tr;
}

const rows = new Map();
for (const fixture of fixtures) {
  const row = differentialRow(fixture.name);
  rows.set(fixture.name, row);
  ui.diffBody.appendChild(row);
}

function rigidDifferentialRow(name) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${name}</td>
    <td class="status">pending</td>
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
  const row = rigidDifferentialRow(fixture.name);
  rigidRows.set(fixture.name, row);
  ui.rigidDiffBody.appendChild(row);
}

function monolithicDifferentialRow(name) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${name}</td>
    <td class="status">pending</td>
    <td>${DIFFERENTIAL_STEPS}</td>
    <td>${MONOLITHIC_DIFFERENTIAL_TOLERANCE}</td>
    <td class="center">—</td>
    <td class="velocity">—</td>
  `;
  return tr;
}

const monolithicRows = new Map();
for (const fixture of fixtures) {
  const row = monolithicDifferentialRow(fixture.name);
  monolithicRows.set(fixture.name, row);
  ui.monolithicDiffBody.appendChild(row);
}

async function acquireDevice() {
  if (!("gpu" in navigator)) {
    setStatus(ui.webgpu, "UNAVAILABLE — navigator.gpu missing", "warn");
    updateOverall();
    return null;
  }

  setStatus(ui.webgpu, "requesting adapter…", "warn");
  adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    setStatus(ui.webgpu, "UNAVAILABLE — no adapter", "warn");
    updateOverall();
    return null;
  }

  try {
    device = await adapter.requestDevice();
  } catch (error) {
    setStatus(ui.webgpu, `FAIL — requestDevice: ${error.message ?? error}`, "fail");
    updateOverall();
    return null;
  }

  const adapterInfo = adapter.info;
  const label = adapterInfo
    ? [adapterInfo.vendor, adapterInfo.architecture, adapterInfo.device]
      .filter(Boolean)
      .join(" · ")
    : "adapter acquired";
  setStatus(ui.webgpu, `AVAILABLE — ${label || "adapter acquired"}`, "ok");
  log(`WebGPU device acquired; maxStorageBufferBindingSize=${device.limits.maxStorageBufferBindingSize}; maxStorageBuffersPerShaderStage=${device.limits.maxStorageBuffersPerShaderStage}`);

  device.lost.then((info) => {
    setStatus(ui.webgpu, `DEVICE LOST — ${info.message || info.reason}`, "fail");
    log(`DEVICE LOST: ${info.reason}: ${info.message}`);
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
        status.textContent = "UNAVAILABLE";
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
    status.textContent = "running…";
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
        status.textContent = "PASS";
        status.className = "status ok";
        log(
          `${fixture.name}: PASS Δp=${fmt(result.maxPositionDelta)} Δv=${fmt(result.maxVelocityDelta)}`,
        );
      } else if (!result.available) {
        status.textContent = "UNAVAILABLE";
        status.className = "status warn";
        allPass = false;
        log(`${fixture.name}: UNAVAILABLE — ${result.reason ?? "unknown"}`);
      } else {
        status.textContent = "FAIL";
        status.className = "status fail";
        allPass = false;
        log(
          `${fixture.name}: FAIL Δp=${fmt(result.maxPositionDelta)} Δv=${fmt(result.maxVelocityDelta)}`,
        );
      }
    } catch (error) {
      status.textContent = "ERROR";
      status.className = "status fail";
      pos.textContent = "—";
      vel.textContent = "—";
      allPass = false;
      log(`${fixture.name}: ERROR — ${error.stack ?? error}`);
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
    status.textContent = "running…";
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
        status.textContent = "PASS";
        status.className = "status ok";
        log(
          `rigid ${fixture.name}: PASS Δc=${fmt(result.maxCenterDelta)} Δq=${fmt(result.maxOrientationDelta)} Δv=${fmt(result.maxLinearVelocityDelta)} Δω=${fmt(result.maxAngularVelocityDelta)}`,
        );
      } else {
        status.textContent = "FAIL";
        status.className = "status fail";
        rigidAllPass = false;
        log(
          `rigid ${fixture.name}: FAIL Δc=${fmt(result.maxCenterDelta)} Δq=${fmt(result.maxOrientationDelta)} Δv=${fmt(result.maxLinearVelocityDelta)} Δω=${fmt(result.maxAngularVelocityDelta)}`,
        );
      }
    } catch (error) {
      status.textContent = "ERROR";
      status.className = "status fail";
      rigidAllPass = false;
      log(`rigid ${fixture.name}: ERROR — ${error.stack ?? error}`);
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
    status.textContent = "running…";
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
        status.textContent = "PASS";
        status.className = "status ok";
        log(
          `monolithic ${fixture.name}: PASS Δc=${fmt(result.maxCenterDelta)} Δv=${fmt(result.maxVelocityDelta)}`,
        );
      } else {
        status.textContent = "FAIL";
        status.className = "status fail";
        monolithicAllPass = false;
        log(
          `monolithic ${fixture.name}: FAIL Δc=${fmt(result.maxCenterDelta)} Δv=${fmt(result.maxVelocityDelta)}`,
        );
      }
    } catch (error) {
      status.textContent = "ERROR";
      status.className = "status fail";
      monolithicAllPass = false;
      log(`monolithic ${fixture.name}: ERROR — ${error.stack ?? error}`);
    }
  }

  monolithicDifferentialAllPass = monolithicAllPass;
  monolithicDifferentialPhysicsSignature = runSignature;
  ui.rerun.disabled = false;
  log(
    `differential parameters: ${physics.octahedra} octa, mNode=${physics.nodeMass.toFixed(2)}, kLong=${physics.longitudinalStiffness.toFixed(2)}, kTrans=${physics.transverseStiffness.toFixed(2)}, alpha=${physics.nonlinearity.toFixed(2)}, dLin=${physics.linearDampingRate.toFixed(2)}, dAng=${physics.angularDampingRate.toFixed(2)}, speed=${physics.simulationSpeed.toFixed(2)}x`,
  );
  log(`rigid differential aspect=${rigidAspectRatio.toFixed(4)} (capless rigid triangular sections)`);
  log(
    `monolithic differential: centerMass=mNode, stretch=kLong, straightening=kTrans, damping=dLin · ${monolithicAllPass ? "PASS" : "FAIL"}`,
  );
  updateOverall();
}

function selectedScene() {
  switch (ui.scene.value) {
    case "root-r": return Object.freeze({ id: "root-r", label: "R only", network: rootBasisNetwork(1) });
    case "root-ro": return Object.freeze({ id: "root-ro", label: "R + O", network: rootBasisNetwork(2) });
    case "root-roc": return Object.freeze({ id: "root-roc", label: "R + O + C", network: rootBasisNetwork(3) });
    case "root-rocl": return Object.freeze({ id: "root-rocl", label: "R + O + C + L", network: rootBasisNetwork(4) });
    case "root-roclu": return Object.freeze({ id: "root-roclu", label: "R + O + C + L + U", network: rootBasisNetwork(5) });
    case "hub-64": return Object.freeze({ id: "hub-64", label: "stress 64", network: hubHeavyNetwork(64) });
    case "hub-333": return Object.freeze({ id: "hub-333", label: "stress 333", network: hubHeavyNetwork(333) });
    case "hub-1000": return Object.freeze({ id: "hub-1000", label: "stress 1000", network: hubHeavyNetwork(1000) });
    default: throw new Error(`unknown scene: ${ui.scene.value}`);
  }
}

function hubHeavyNetwork(count) {
  if (!Number.isSafeInteger(count) || count < 8) throw new Error("render fixture requires >= 8 Links");

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

function rigidBodyCenter3(centers, bodyIndex) {
  const offset = bodyIndex * 3;
  return [centers[offset], centers[offset + 1], centers[offset + 2]];
}

function rigidSemanticCenter3(template, centers, linkIndex) {
  const bodyIndex = linkIndex * template.sectionCount + template.centerSection;
  return rigidBodyCenter3(centers, bodyIndex);
}

function centerDragBodySet(state, linkIndex) {
  return webgpu.collectRigidSectionCenterDragBodies3D(
    state.compute.topology,
    state.compute.template,
    linkIndex,
  );
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
  return webgpu.pickRigidSectionCenterIcosahedra3D(
    ray.origin,
    ray.direction,
    centers,
    2
      * state.compute.template.edgeRestLength
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
  return state.compute.writeCenterOverrides(
    drag.bodies.map(({ bodyIndex }) => ({
      bodyIndex,
      position: [...drag.target],
      velocity: [0, 0, 0],
    })),
  );
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
  let pickGeneration = 0;
  let pendingPickDx = 0;
  let pendingPickDy = 0;

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
      log(`center drag released: ${releasedDrag.key}`);
      setStatus(
        ui.renderCompute,
        `AVAILABLE · k=${state.compute.stiffness.toFixed(2)} · t=${state.compute.simulationSpeed.toFixed(2)}x`,
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
      bodies: centerDragBodySet(state, selected),
      uploadedBytes: 0,
    };
    state.semanticCenterCache[selected] = [...center];
    mode = "center";
    log(
      `center drag selected: ${state.centerDrag.key} · source=${source} · ${state.centerDrag.bodies.length} rigid sections`,
    );
    setStatus(
      ui.renderCompute,
      `DRAG ${state.centerDrag.key} · sparse rigid-center override`,
      "warn",
    );
  };

  const beginCenterPick = async (event) => {
    const generation = ++pickGeneration;
    mode = "picking";
    setStatus(ui.renderCompute, "PICKING CENTER ICOSAHEDRON…", "warn");
    try {
      // One-shot readback on pointer-down keeps picking exact while ordinary
      // frames remain zero-copy and the simulated CENTER positions keep moving.
      const centers = await state.compute.readBackCenters();
      if (
        generation !== pickGeneration
        || pointerId !== event.pointerId
        || renderState !== state
      ) return;

      const worldCenters = [];
      for (let link = 0; link < state.compute.topology.linkCount; link += 1) {
        const center = rigidSemanticCenter3(state.compute.template, centers, link);
        worldCenters.push(center);
        state.semanticCenterCache[link] = [...center];
      }

      const selected = pickCenterIcosahedron(state, event, worldCenters);

      if (selected < 0) {
        mode = "orbit";
        if (pendingPickDx !== 0 || pendingPickDy !== 0) {
          state.camera.yaw -= pendingPickDx * 0.006;
          state.camera.pitch = clamp(
            state.camera.pitch - pendingPickDy * 0.006,
            -Math.PI * 0.48,
            Math.PI * 0.48,
          );
        }
        pendingPickDx = 0;
        pendingPickDy = 0;
        log("center icosahedron pick MISS — continuing as orbit");
        setStatus(
          ui.renderCompute,
          `AVAILABLE · m=${state.compute.nodeMass.toFixed(2)} · k∥=${state.compute.longitudinalStiffness.toFixed(2)} · k⊥=${state.compute.transverseStiffness.toFixed(2)} · α=${state.compute.nonlinearity.toFixed(2)} · t=${state.compute.simulationSpeed.toFixed(2)}x`,
          "ok",
        );
        return;
      }

      activateCenterDrag(
        selected,
        worldCenters[selected],
        "exact world-space icosahedron",
      );
      moveCenterDragTarget(state, pendingPickDx, pendingPickDy);
      pendingPickDx = 0;
      pendingPickDy = 0;
    } catch (error) {
      if (generation !== pickGeneration || renderState !== state) return;
      log(`center pick ERROR — ${error.stack ?? error}`);
      mode = "orbit";
      pendingPickDx = 0;
      pendingPickDy = 0;
    }
  };

  canvas.addEventListener("contextmenu", (event) => event.preventDefault(), listenerOptions);

  canvas.addEventListener("pointerdown", (event) => {
    if (pointerId !== null) return;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    pendingPickDx = 0;
    pendingPickDy = 0;
    canvas.setPointerCapture(pointerId);
    canvas.classList.add("dragging");

    if (event.button === 2 || (event.button === 0 && event.shiftKey)) {
      mode = "pan";
    } else if (event.button === 0 && ui.showCenterMarkers.checked) {
      void beginCenterPick(event);
    } else {
      mode = "orbit";
    }
    event.preventDefault();
  }, listenerOptions);

  canvas.addEventListener("pointermove", (event) => {
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
    } else if (mode === "picking") {
      pendingPickDx += dx;
      pendingPickDy += dy;
    } else if (mode === "center" && state.centerDrag) {
      moveCenterDragTarget(state, dx, dy);
    }
    event.preventDefault();
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
    pickGeneration += 1;
    state.centerDrag = null;
    abortController.abort();
    canvas.classList.remove("dragging");
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
    setStatus(ui.renderCompute, "UNAVAILABLE", "warn");
    setStatus(ui.renderZeroCopy, "UNAVAILABLE", "warn");
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
        `length control mismatch: requested ${physics.octahedra} octa, got ${shape.template.octahedronCount}`,
      );
    }

    const context = ui.canvas.getContext("webgpu");
    if (!context) {
      throw new Error("canvas.getContext('webgpu') returned null");
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
        "monolithic zero-copy invariant failed before first render",
      );
    }

    renderPass = true;
    const computeSnapshot = compute.snapshot();
    const shapeSnapshot = shape.snapshot();
    setStatus(
      ui.renderCompute,
      `AVAILABLE · 2 physics passes + 1 derived-shape pass`,
      "ok",
    );
    setStatus(
      ui.renderTopology,
      `${scene.label} · ${linkCount} Links · ${shapeSnapshot.octahedronCount} octa/Link · semantic state=${(computeSnapshot.centerBytes + computeSnapshot.velocityBytes).toLocaleString()} B · mC=${physics.nodeMass.toFixed(2)} · kS=${physics.longitudinalStiffness.toFixed(2)} · kB=${physics.transverseStiffness.toFixed(2)} · α=${physics.nonlinearity.toFixed(2)} · t=${physics.simulationSpeed.toFixed(2)}x`,
      "ok",
    );
    setStatus(
      ui.renderZeroCopy,
      "PASS — shared semantic CENTER + compact shape buffer · 0 B dynamic CPU upload",
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
      initialSemanticCenters,
      semanticCenterCache: initialSemanticCenters.map((center) => [...center]),
      scene,
      network,
    };
    resetCamera(state.camera, defaultCameraDistance);
    state.cleanupCameraControls = installCameraControls(state);
    renderState = state;
    ui.pauseRender.textContent = "Pause";

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
              `monolithic physics invariant failed: passes=${physicsStats.computePasses} upload=${physicsStats.dynamicStateUploadBytes}`,
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
            `monolithic shape invariant failed: passes=${shapeStats.computePasses} upload=${shapeStats.dynamicStateUploadBytes}`,
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

        const markers = selectedMarkerControls();
        const stats = state.renderer.render({
          targetView: state.context.getCurrentTexture().createView(),
          depthView: state.depthTexture.createView(),
          viewProjection,
          width: ui.canvas.width,
          height: ui.canvas.height,
          wireframe: ui.wireframe.checked,
          showCenterMarkers: markers.showCenterMarkers,
          showEndCones: markers.showEndCones,
          centerMarkerScale: markers.centerMarkerScale,
          endConeScale: markers.endConeScale,
          clearColor: { r: 0.005, g: 0.008, b: 0.014, a: 1 },
        });
        state.frames += 1;

        const expectedDrawCalls =
          1
          + (markers.showCenterMarkers ? 1 : 0)
          + (markers.showEndCones ? 1 : 0);
        if (
          stats.dynamicStateUploadBytes !== 0
          || stats.bufferCopies !== 0
          || stats.readbacks !== 0
          || stats.drawCalls !== expectedDrawCalls
        ) {
          throw new Error(
            `zero-copy runtime violation: uploads=${stats.dynamicStateUploadBytes} copies=${stats.bufferCopies} readbacks=${stats.readbacks} draws=${stats.drawCalls}/${expectedDrawCalls}`,
          );
        }

        if (now - state.lastUiAt > 250) {
          state.lastUiAt = now;
          ui.renderFrames.textContent =
            `${state.frames.toLocaleString()} / ${state.steps.toLocaleString()}`;
        }
      } catch (error) {
        renderPass = false;
        setStatus(ui.renderCompute, "ERROR", "fail");
        setStatus(ui.renderZeroCopy, "FAIL — see log", "fail");
        log(`monolithic render ERROR — ${error.stack ?? error}`);
        updateOverall();
        return;
      }

      state.raf = requestAnimationFrame(frame);
    }

    state.raf = requestAnimationFrame(frame);
    log(
      `v0.5 monolithic render started: scene=${scene.label}, ${linkCount} Links, ${shape.template.octahedronCount} octa/Link, centerMass=${physics.nodeMass.toFixed(2)}, stretch=${physics.longitudinalStiffness.toFixed(2)}, straighten=${physics.transverseStiffness.toFixed(2)}, alpha=${physics.nonlinearity.toFixed(2)}, damping=${physics.linearDampingRate.toFixed(2)}, speed=${physics.simulationSpeed.toFixed(2)}x`,
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

function rigidBodyQuat4(orientations, bodyIndex) {
  const offset = bodyIndex * 4;
  return [
    orientations[offset],
    orientations[offset + 1],
    orientations[offset + 2],
    orientations[offset + 3],
  ];
}

function rigidBodyVelocity3(values, bodyIndex) {
  const offset = bodyIndex * 3;
  return [values[offset], values[offset + 1], values[offset + 2]];
}

function quaternionNormError(q) {
  return Math.abs(Math.hypot(q[0], q[1], q[2], q[3]) - 1);
}

function diagnosticClass(value, warn = 1e-3, fail = 1e-2) {
  if (value > fail) return "fail";
  if (value > warn) return "warn";
  return "ok";
}

function rigidLinkPotentialEnergy(template, state, linkIndex, elasticity) {
  let energy = 0;
  const base = linkIndex * template.sectionCount;
  for (let local = 0; local < template.octahedronCount; local += 1) {
    const lower = base + local;
    const upper = lower + 1;
    energy += core.evaluateRigidSectionPotential3D(
      template,
      rigidBodyCenter3(state.centers, lower),
      rigidBodyQuat4(state.orientations, lower),
      rigidBodyCenter3(state.centers, upper),
      rigidBodyQuat4(state.orientations, upper),
      elasticity,
    ).energy;
  }
  return energy;
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

    const { template, topology } = render.compute;
    const networkByKey = new Map(render.network.links.map((link) => [link.key, link]));
    const rowsHtml = [];
    let globalHingeError = 0;
    let globalQuaternionError = 0;
    let globalMaxLinearSpeed = 0;
    let globalMaxAngularSpeed = 0;
    let totalPotentialEnergy = 0;

    for (let linkIndex = 0; linkIndex < topology.linkCount; linkIndex += 1) {
      const key = topology.keys[linkIndex];
      const source = networkByKey.get(key);
      if (!source) throw new Error(`diagnostic source Link missing: ${key}`);

      const base = linkIndex * template.sectionCount;
      const middleBody = base + template.centerSection;
      const startBody = base;
      const endBody = base + template.sectionCount - 1;
      const startTargetBody =
        topology.startIndices[linkIndex] * template.sectionCount
        + template.centerSection;
      const endTargetBody =
        topology.endIndices[linkIndex] * template.sectionCount
        + template.centerSection;

      const ownCenter = rigidBodyCenter3(gpuState.centers, middleBody);
      const startError = distance3(
        rigidBodyCenter3(gpuState.centers, startBody),
        rigidBodyCenter3(gpuState.centers, startTargetBody),
      );
      const endError = distance3(
        rigidBodyCenter3(gpuState.centers, endBody),
        rigidBodyCenter3(gpuState.centers, endTargetBody),
      );
      const centerDisplacement = distance3(
        ownCenter,
        render.initialSemanticCenters[linkIndex],
      );
      const energy = rigidLinkPotentialEnergy(
        template,
        gpuState,
        linkIndex,
        {
          longitudinalStiffness: render.compute.longitudinalStiffness,
          transverseStiffness: render.compute.transverseStiffness,
          nonlinearity: render.compute.nonlinearity,
        },
      );

      let maxLinearSpeed = 0;
      let maxAngularSpeed = 0;
      let maxQuaternionError = 0;
      for (let local = 0; local < template.sectionCount; local += 1) {
        const body = base + local;
        const velocity = rigidBodyVelocity3(gpuState.linearVelocities, body);
        const angular = rigidBodyVelocity3(gpuState.angularVelocities, body);
        maxLinearSpeed = Math.max(maxLinearSpeed, Math.hypot(...velocity));
        maxAngularSpeed = Math.max(maxAngularSpeed, Math.hypot(...angular));
        maxQuaternionError = Math.max(
          maxQuaternionError,
          quaternionNormError(rigidBodyQuat4(gpuState.orientations, body)),
        );
      }

      globalHingeError = Math.max(globalHingeError, startError, endError);
      globalQuaternionError = Math.max(globalQuaternionError, maxQuaternionError);
      globalMaxLinearSpeed = Math.max(globalMaxLinearSpeed, maxLinearSpeed);
      globalMaxAngularSpeed = Math.max(globalMaxAngularSpeed, maxAngularSpeed);
      totalPotentialEnergy += energy;

      rowsHtml.push(`
        <tr>
          <td class="value">${key}</td>
          <td>${equationForNetworkLink(source)}</td>
          <td class="${diagnosticClass(startError)}">${fmt(startError)}</td>
          <td class="${diagnosticClass(endError)}">${fmt(endError)}</td>
          <td>${fmt(centerDisplacement)}</td>
          <td>${fmt(energy)}</td>
          <td>${fmt(maxLinearSpeed)}</td>
          <td>${fmt(maxAngularSpeed)}</td>
          <td class="${diagnosticClass(maxQuaternionError, 1e-5, 1e-3)}">${fmt(maxQuaternionError)}</td>
        </tr>
      `);
    }

    ui.geometryBody.innerHTML = rowsHtml.join("");
    const readbackBytes =
      gpuState.centers.byteLength
      + gpuState.orientations.byteLength
      + gpuState.linearVelocities.byteLength
      + gpuState.angularVelocities.byteLength;
    log(
      `rigid geometry inspection: scene=${render.scene.label}, ${topology.linkCount} Links, readback=${readbackBytes} B, maxHinge=${fmt(globalHingeError)}, maxQNormErr=${fmt(globalQuaternionError)}, potential=${fmt(totalPotentialEnergy)}, maxV=${fmt(globalMaxLinearSpeed)}, maxOmega=${fmt(globalMaxAngularSpeed)}`,
    );
  } catch (error) {
    ui.geometryBody.innerHTML = `<tr><td colspan="9" class="fail">Inspection ERROR — ${String(error)}</td></tr>`;
    log(`geometry inspection ERROR — ${error.stack ?? error}`);
  } finally {
    if (renderState === render) render.paused = wasPaused;
    ui.inspectGeometry.disabled = false;
  }
}

ui.rerun.addEventListener("click", () => {
  runDifferentials().catch((error) => {
    differentialAllPass = false;
    log(`differential runner ERROR — ${error.stack ?? error}`);
    updateOverall();
  });
});

ui.scene.addEventListener("change", () => {
  ui.geometryBody.innerHTML = '<tr><td colspan="9" class="muted">Press Inspect geometry.</td></tr>';
  startRender().catch((error) => {
    renderPass = false;
    setStatus(ui.renderCompute, "ERROR", "fail");
    setStatus(ui.renderZeroCopy, "FAIL — see log", "fail");
    log(`scene render restart ERROR — ${error.stack ?? error}`);
    updateOverall();
  });
});

ui.inspectGeometry.addEventListener("click", () => {
  inspectGeometry();
});

ui.restartRender.addEventListener("click", () => {
  startRender().catch((error) => {
    renderPass = false;
    setStatus(ui.renderCompute, "ERROR", "fail");
    setStatus(ui.renderZeroCopy, "FAIL — see log", "fail");
    log(`render setup ERROR — ${error.stack ?? error}`);
    updateOverall();
  });
});

ui.resetView.addEventListener("click", () => {
  if (!renderState) return;
  resetCamera(renderState.camera, renderState.camera.defaultDistance);
});

ui.autoRotate.addEventListener("change", () => {
  log(`camera auto-rotate ${ui.autoRotate.checked ? "enabled" : "disabled"}`);
});

ui.wireframe.addEventListener("change", () => {
  log(`wireframe ${ui.wireframe.checked ? "enabled" : "disabled"} — physics state preserved`);
});

ui.showCenterMarkers.addEventListener("change", () => {
  if (!ui.showCenterMarkers.checked && renderState?.centerDrag) {
    renderState.centerDrag = null;
  }
  log(
    `CENTER nodes ${ui.showCenterMarkers.checked ? "enabled" : "disabled"} — physics state preserved`,
  );
});

ui.showEndCones.addEventListener("change", () => {
  log(
    `END cones ${ui.showEndCones.checked ? "enabled" : "disabled"} — physics state preserved`,
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
    setStatus(ui.renderCompute, "ERROR", "fail");
    setStatus(ui.renderZeroCopy, "FAIL — see log", "fail");
    log(`length-control render restart ERROR — ${error.stack ?? error}`);
    updateOverall();
  });
});

function applyLivePhysicsControls() {
  refreshPhysicsControlLabels();
  markDifferentialStale();
  if (!renderState) return;

  const physics = selectedPhysics();
  const compute = renderState.compute;
  compute.setNodeMass(physics.nodeMass);
  compute.setLongitudinalStiffness(physics.longitudinalStiffness);
  compute.setTransverseStiffness(physics.transverseStiffness);
  compute.setNonlinearity(physics.nonlinearity);
  compute.setLinearDampingRate(physics.linearDampingRate);
  compute.setAngularDampingRate(physics.angularDampingRate);
  compute.setSimulationSpeed(physics.simulationSpeed);

  const snapshot = compute.snapshot();
  const checks = [
    ["nodeMass", snapshot.nodeMass, physics.nodeMass],
    ["longitudinalStiffness", snapshot.longitudinalStiffness, physics.longitudinalStiffness],
    ["transverseStiffness", snapshot.transverseStiffness, physics.transverseStiffness],
    ["nonlinearity", snapshot.nonlinearity, physics.nonlinearity],
    ["linearDampingRate", snapshot.linearDampingRate, physics.linearDampingRate],
    ["angularDampingRate", snapshot.angularDampingRate, physics.angularDampingRate],
    ["simulationSpeed", snapshot.simulationSpeed, physics.simulationSpeed],
  ];
  for (const [label, actual, expected] of checks) {
    if (Math.abs(actual - expected) > 1e-12) {
      throw new Error(
        `${label} control mismatch: requested ${expected}, got ${actual}`,
      );
    }
  }

  setStatus(
    ui.renderCompute,
    `AVAILABLE · m=${physics.nodeMass.toFixed(2)} · k∥=${physics.longitudinalStiffness.toFixed(2)} · k⊥=${physics.transverseStiffness.toFixed(2)} · α=${physics.nonlinearity.toFixed(2)} · t=${physics.simulationSpeed.toFixed(2)}x`,
    "ok",
  );
}

for (const control of [
  ui.nodeMass,
  ui.longitudinalStiffness,
  ui.transverseStiffness,
  ui.nonlinearity,
  ui.linearDamping,
  ui.angularDamping,
  ui.simulationSpeed,
]) {
  control.addEventListener("input", applyLivePhysicsControls);
}

ui.pauseRender.addEventListener("click", () => {
  if (!renderState) return;
  renderState.paused = !renderState.paused;
  ui.pauseRender.textContent = renderState.paused ? "Resume" : "Pause";
});

ui.fullscreenRender.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement === ui.viewportShell) {
      await document.exitFullscreen();
    } else {
      await ui.viewportShell.requestFullscreen();
    }
  } catch (error) {
    log(`fullscreen ERROR — ${error.stack ?? error}`);
  }
});

document.addEventListener("fullscreenchange", () => {
  ui.fullscreenRender.textContent =
    document.fullscreenElement === ui.viewportShell
      ? "Exit fullscreen"
      : "Fullscreen";
});

try {
  await acquireDevice();
  if (device) {
    await runDifferentials();
    await startRender();
  }
} catch (error) {
  setStatus(ui.overall, "ERROR — see diagnostic log", "fail");
  log(error.stack ?? String(error));
}
