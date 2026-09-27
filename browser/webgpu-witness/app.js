const $ = (id) => document.getElementById(id);

const ui = {
  build: $("build"),
  webgpu: $("webgpu"),
  baseline: $("baseline"),
  overall: $("overall"),
  diffBody: $("diff-body"),
  rerun: $("rerun"),
  canvas: $("gpu-canvas"),
  linkCount: $("link-count"),
  lengthOcta: $("length-octa"),
  lengthValue: $("length-value"),
  stiffness: $("stiffness"),
  stiffnessValue: $("stiffness-value"),
  simulationSpeed: $("simulation-speed"),
  simulationSpeedValue: $("simulation-speed-value"),
  restartRender: $("restart-render"),
  resetView: $("reset-view"),
  autoRotate: $("auto-rotate"),
  pauseRender: $("pause-render"),
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

function selectedPhysics() {
  const octahedra = Number(ui.lengthOcta.value);
  if (!Number.isSafeInteger(octahedra) || octahedra < 10 || octahedra > 100 || octahedra % 2 !== 0) {
    throw new Error(`invalid octahedron control value: ${ui.lengthOcta.value}`);
  }

  const stiffness = Number(ui.stiffness.value);
  const simulationSpeed = Number(ui.simulationSpeed.value);
  if (!Number.isFinite(stiffness) || stiffness < 0 || stiffness > 5) {
    throw new Error(`invalid stiffness control value: ${ui.stiffness.value}`);
  }
  if (!Number.isFinite(simulationSpeed) || simulationSpeed < 0 || simulationSpeed > 4) {
    throw new Error(`invalid simulation speed control value: ${ui.simulationSpeed.value}`);
  }

  return Object.freeze({
    octahedra,
    aspectRatio: Math.SQRT2 * (octahedra / 2 + 1),
    stiffness,
    simulationSpeed,
  });
}

function physicsSignature(physics = selectedPhysics()) {
  return [
    physics.octahedra,
    physics.stiffness.toFixed(4),
    physics.simulationSpeed.toFixed(4),
  ].join(":");
}

function refreshPhysicsControlLabels() {
  const physics = selectedPhysics();
  ui.lengthValue.value = `${physics.octahedra} octa · aspect ${physics.aspectRatio.toFixed(3)}`;
  ui.stiffnessValue.value = physics.stiffness.toFixed(2);
  ui.simulationSpeedValue.value = `${physics.simulationSpeed.toFixed(2)}×`;
}

refreshPhysicsControlLabels();

const fixtures = [
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

let adapter = null;
let device = null;
let differentialAllPass = false;
let differentialPhysicsSignature = null;
let renderPass = false;
let renderState = null;

function differentialIsCurrent() {
  return differentialAllPass
    && differentialPhysicsSignature === physicsSignature();
}

function markDifferentialStale() {
  differentialAllPass = false;
  for (const row of rows.values()) {
    const status = row.querySelector(".status");
    if (status.textContent === "PASS") {
      status.textContent = "STALE";
      status.className = "status warn";
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
  log(`WebGPU device acquired; maxStorageBufferBindingSize=${device.limits.maxStorageBufferBindingSize}`);

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
  updateOverall();

  if (!device) {
    for (const row of rows.values()) {
      const status = row.querySelector(".status");
      status.textContent = "UNAVAILABLE";
      status.className = "status warn";
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
          stiffness: physics.stiffness,
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
  ui.rerun.disabled = false;
  log(`differential parameters: ${physics.octahedra} octa, stiffness=${physics.stiffness.toFixed(2)}, speed=${physics.simulationSpeed.toFixed(2)}x`);
  updateOverall();
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
  let pointerId = null;
  let mode = null;
  let lastX = 0;
  let lastY = 0;

  const endDrag = (event) => {
    if (pointerId !== event.pointerId) return;
    try { canvas.releasePointerCapture(pointerId); } catch {}
    pointerId = null;
    mode = null;
    canvas.classList.remove("dragging");
  };

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  canvas.addEventListener("pointerdown", (event) => {
    if (pointerId !== null) return;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    mode = event.button === 2 || (event.button === 0 && event.shiftKey)
      ? "pan"
      : "orbit";
    canvas.setPointerCapture(pointerId);
    canvas.classList.add("dragging");
    event.preventDefault();
  });

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
    } else {
      panCamera(state.camera, dx, dy);
    }
  });

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.001);
    state.camera.distance = clamp(
      state.camera.distance * factor,
      state.camera.minDistance,
      state.camera.maxDistance,
    );
  }, { passive: false });

  return () => {
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

  const linkCount = Number(ui.linkCount.value);
  const physics = selectedPhysics();
  const network = hubHeavyNetwork(linkCount);
  const compute = await webgpu.createOctahedralWebGpuCompute3D(
    device,
    network,
    {
      aspectRatio: physics.aspectRatio,
      stiffness: physics.stiffness,
      simulationSpeed: physics.simulationSpeed,
    },
  );

  if (compute.template.octahedronCount !== physics.octahedra) {
    compute.destroy();
    throw new Error(`length control mismatch: requested ${physics.octahedra} octa, got ${compute.template.octahedronCount}`);
  }

  const context = ui.canvas.getContext("webgpu");
  if (!context) {
    compute.destroy();
    throw new Error("canvas.getContext('webgpu') returned null");
  }

  const colorFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: colorFormat,
    alphaMode: "opaque",
  });

  const renderer = await webgpu.createOctahedralWebGpuZeroCopyRenderer3D(
    device,
    compute,
    {
      colorFormat,
      depthFormat: "depth24plus",
      centerMarkerPixels: 2.5,
      arrowLengthPixels: 8,
    },
  );

  const zeroCopy =
    renderer.positionBuffer === compute.positionBuffer
    && renderer.snapshot().sharedPositionBuffer === true
    && renderer.snapshot().dynamicStateUploadBytesPerFrame === 0
    && renderer.snapshot().rendererDynamicPositionBytes === 0;

  if (!zeroCopy) {
    renderer.destroy();
    compute.destroy();
    throw new Error("zero-copy invariant failed before first render");
  }

  renderPass = true;
  setStatus(ui.renderCompute, "AVAILABLE", "ok");
  setStatus(
    ui.renderTopology,
    `${linkCount} Links · ${compute.snapshot().totalPhysicalVertices.toLocaleString()} vertices · ${compute.template.octahedronCount} octa · k=${physics.stiffness.toFixed(2)} · t=${physics.simulationSpeed.toFixed(2)}x`,
    "ok",
  );
  setStatus(ui.renderZeroCopy, "PASS — shared positionBuffer · 0 B dynamic upload", "ok");
  updateOverall();

  const side = Math.ceil(Math.cbrt(linkCount));
  const spacing = compute.template.diameter * 1.5;
  const defaultCameraDistance = Math.max(18, side * spacing * 2.6);
  const state = {
    compute,
    renderer,
    context,
    colorFormat,
    depthTexture: null,
    raf: 0,
    frames: 0,
    steps: 0,
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
        state.compute.step();
        state.steps += 1;
      }

      const frameDeltaSeconds = Math.min(0.1, Math.max(0, (now - state.lastFrameAt) / 1000));
      state.lastFrameAt = now;
      if (ui.autoRotate.checked) {
        state.camera.yaw += frameDeltaSeconds * 0.16;
      }
      const eye = cameraEye(state.camera);
      const view = lookAt(eye, state.camera.target, [0, 1, 0]);
      const projection = perspective(
        Math.PI / 4,
        ui.canvas.width / ui.canvas.height,
        0.1,
        state.camera.maxDistance * 4,
      );
      const viewProjection = multiply4(projection, view);

      const stats = state.renderer.render({
        targetView: state.context.getCurrentTexture().createView(),
        depthView: state.depthTexture.createView(),
        viewProjection,
        width: ui.canvas.width,
        height: ui.canvas.height,
        clearColor: { r: 0.005, g: 0.008, b: 0.014, a: 1 },
      });
      state.frames += 1;

      if (
        stats.dynamicStateUploadBytes !== 0
        || stats.bufferCopies !== 0
        || stats.readbacks !== 0
        || stats.drawCalls !== 3
      ) {
        throw new Error(
          `zero-copy runtime violation: uploads=${stats.dynamicStateUploadBytes} copies=${stats.bufferCopies} readbacks=${stats.readbacks} draws=${stats.drawCalls}`,
        );
      }

      if (now - state.lastUiAt > 250) {
        state.lastUiAt = now;
        ui.renderFrames.textContent = `${state.frames.toLocaleString()} / ${state.steps.toLocaleString()}`;
      }
    } catch (error) {
      renderPass = false;
      setStatus(ui.renderCompute, "ERROR", "fail");
      setStatus(ui.renderZeroCopy, "FAIL — see log", "fail");
      log(`render ERROR — ${error.stack ?? error}`);
      updateOverall();
      return;
    }

    state.raf = requestAnimationFrame(frame);
  }

  state.raf = requestAnimationFrame(frame);
  log(
    `zero-copy render started: ${linkCount} Links, ${compute.template.octahedronCount} octa/Link, stiffness=${physics.stiffness.toFixed(2)}, speed=${physics.simulationSpeed.toFixed(2)}x, ${compute.snapshot().totalPhysicalVertices} physical vertices`,
  );
}

ui.rerun.addEventListener("click", () => {
  runDifferentials().catch((error) => {
    differentialAllPass = false;
    log(`differential runner ERROR — ${error.stack ?? error}`);
    updateOverall();
  });
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

ui.lengthOcta.addEventListener("input", () => {
  refreshPhysicsControlLabels();
  markDifferentialStale();
  renderPass = false;
  updateOverall();
});

ui.lengthOcta.addEventListener("change", () => {
  startRender().catch((error) => {
    renderPass = false;
    setStatus(ui.renderCompute, "ERROR", "fail");
    setStatus(ui.renderZeroCopy, "FAIL — see log", "fail");
    log(`length-control render restart ERROR — ${error.stack ?? error}`);
    updateOverall();
  });
});

ui.stiffness.addEventListener("input", () => {
  refreshPhysicsControlLabels();
  markDifferentialStale();
  if (!renderState) return;
  const physics = selectedPhysics();
  renderState.compute.setStiffness(physics.stiffness);
  const snapshot = renderState.compute.snapshot();
  if (Math.abs(snapshot.stiffness - physics.stiffness) > 1e-12) {
    throw new Error(`stiffness control mismatch: requested ${physics.stiffness}, got ${snapshot.stiffness}`);
  }
  setStatus(ui.renderCompute, `AVAILABLE · k=${physics.stiffness.toFixed(2)} · t=${physics.simulationSpeed.toFixed(2)}x`, "ok");
});

ui.simulationSpeed.addEventListener("input", () => {
  refreshPhysicsControlLabels();
  markDifferentialStale();
  if (!renderState) return;
  const physics = selectedPhysics();
  renderState.compute.setSimulationSpeed(physics.simulationSpeed);
  const snapshot = renderState.compute.snapshot();
  if (Math.abs(snapshot.simulationSpeed - physics.simulationSpeed) > 1e-12) {
    throw new Error(`simulation-speed control mismatch: requested ${physics.simulationSpeed}, got ${snapshot.simulationSpeed}`);
  }
  setStatus(ui.renderCompute, `AVAILABLE · k=${physics.stiffness.toFixed(2)} · t=${physics.simulationSpeed.toFixed(2)}x`, "ok");
});

ui.pauseRender.addEventListener("click", () => {
  if (!renderState) return;
  renderState.paused = !renderState.paused;
  ui.pauseRender.textContent = renderState.paused ? "Resume" : "Pause";
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
