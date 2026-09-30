const IDENTITY_VIEW_PROJECTION = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

const DEVICE_LIMIT_NAMES = Object.freeze([
  "maxStorageBufferBindingSize",
  "maxBufferSize",
  "maxComputeWorkgroupsPerDimension",
  "maxStorageBuffersPerShaderStage",
  "maxComputeInvocationsPerWorkgroup",
  "maxComputeWorkgroupSizeX",
  "maxComputeWorkgroupSizeY",
  "maxComputeWorkgroupSizeZ",
  "maxComputeWorkgroupStorageSize",
  "maxBindGroups",
  "maxBindingsPerBindGroup",
]);

function nowMs() {
  return performance.now();
}

function finiteInteger(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`invalid benchmark ${name}: ${String(value)}`);
  }
  return value;
}

function plainAdapterInfo(adapter) {
  const info = adapter?.info;
  if (!info) return null;
  return {
    vendor: info.vendor ?? "",
    architecture: info.architecture ?? "",
    device: info.device ?? "",
    description: info.description ?? "",
  };
}

function plainDeviceLimits(device) {
  const result = {};
  for (const name of DEVICE_LIMIT_NAMES) {
    const value = device?.limits?.[name];
    if (typeof value === "number") result[name] = value;
  }
  return result;
}

function errorText(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function downloadSafeConfig(config) {
  return {
    linkCount: config.linkCount,
    topologyProfile: config.topologyProfile,
    seed: config.seed,
    octahedra: config.octahedra,
    detailProfile: config.detailProfile,
    warmupCount: config.warmupCount,
    sampleCount: config.sampleCount,
    renderRequested: Boolean(config.renderEnabled),
    physics: { ...config.physics },
  };
}

async function measureHost(work) {
  const started = nowMs();
  const value = await work();
  return {
    value,
    elapsedMs: nowMs() - started,
  };
}

async function measureSubmitted(device, submit) {
  const started = nowMs();
  const value = submit();
  await device.queue.onSubmittedWorkDone();
  return {
    value,
    elapsedMs: nowMs() - started,
  };
}

function benchmarkFrame(canvas, targetView, depthView) {
  return {
    targetView,
    depthView,
    viewProjection: IDENTITY_VIEW_PROJECTION,
    width: canvas.width,
    height: canvas.height,
    wireframe: false,
    showCenterMarkers: false,
    showEndCones: false,
    smoothNormals: true,
    clearColor: { r: 0, g: 0, b: 0, a: 1 },
  };
}

function capacityBlockReason(plan, requestedDetailCapacity) {
  if (!plan.limits.fitsStorageBindingLimit) {
    return "maxStorageBufferBindingSize";
  }
  if (!plan.limits.fitsBufferSizeLimit) {
    return "maxBufferSize";
  }
  if (!plan.limits.fitsDispatchLimit) {
    return "maxComputeWorkgroupsPerDimension";
  }
  if (plan.detailCapacity < requestedDetailCapacity) {
    return "detail-cache-binding-limit";
  }
  return null;
}

function emptyStageStatistics() {
  return {
    physics: null,
    shape: null,
    render: null,
    total: null,
  };
}

function baseEvidence({
  webgpu,
  buildInfo,
  adapter,
  device,
  config,
  requestedDetailCapacity,
  renderEnabled,
  capacityPlan,
}) {
  return {
    schemaId: webgpu.MONOLITHIC_WEBGPU_BENCHMARK_SCHEMA_ID,
    schemaVersion: webgpu.MONOLITHIC_WEBGPU_BENCHMARK_SCHEMA_VERSION,
    packageVersion: buildInfo.version,
    buildSha: buildInfo.mainSha,
    createdAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    adapterInfo: plainAdapterInfo(adapter),
    deviceLimits: plainDeviceLimits(device),
    topologyProfile: config.topologyProfile,
    seed: config.seed >>> 0,
    linkCount: config.linkCount,
    octahedraPerLink: config.octahedra,
    detailProfile: config.detailProfile,
    requestedDetailCapacity,
    effectiveDetailCapacity: capacityPlan.detailCapacity,
    compactTopologyBytes: null,
    renderRequested: Boolean(config.renderEnabled),
    renderEnabled,
    timingSource: webgpu.MONOLITHIC_WEBGPU_BENCHMARK_TIMING_SOURCE,
    timestampQuerySupported:
      adapter?.features?.has?.("timestamp-query") === true,
    timestampQueryUsed: false,
    capacityPlan,
    warmupCountRequested: config.warmupCount,
    warmupCountCompleted: 0,
    sampleCountRequested: config.sampleCount,
    sampleCountCompleted: 0,
    stoppedEarly: false,
    initializationMs: {
      topologyGeneration: null,
      computeCreation: null,
      shapeCreation: null,
      detailSelectionSetup: null,
      rendererCreation: null,
      warmupTotal: null,
      destroy: null,
    },
    stages: emptyStageStatistics(),
    status: "RUNTIME_FAILED",
    error: null,
    capacityBlockReason: null,
    configuration: downloadSafeConfig(config),
  };
}

function completedEvidence(webgpu, evidence, samples) {
  return {
    ...evidence,
    sampleCountCompleted: samples.physics.length,
    stages: {
      physics: webgpu.summarizeMonolithicLinkBenchmarkSamples3D(
        samples.physics,
      ),
      shape: webgpu.summarizeMonolithicLinkBenchmarkSamples3D(
        samples.shape,
      ),
      render:
        samples.render.length > 0
          ? webgpu.summarizeMonolithicLinkBenchmarkSamples3D(
              samples.render,
            )
          : null,
      total: webgpu.summarizeMonolithicLinkBenchmarkSamples3D(
        samples.total,
      ),
    },
    status: "PASS",
    error: null,
  };
}

export async function runMechanicalWebGpuBenchmark({
  adapter,
  webgpu,
  buildInfo,
  canvas,
  config,
  onProgress = () => {},
  shouldStop = () => false,
}) {
  if (!adapter) {
    throw new Error("benchmark requires a WebGPU adapter");
  }
  if (!canvas) {
    throw new Error("benchmark requires a canvas");
  }

  const linkCount = finiteInteger(config.linkCount, "linkCount", 1);
  const warmupCount = finiteInteger(config.warmupCount, "warmupCount", 1);
  const sampleCount = finiteInteger(config.sampleCount, "sampleCount", 1);
  const octahedra = finiteInteger(config.octahedra, "octahedra", 2);
  const seed = finiteInteger(config.seed >>> 0, "seed", 0);
  const aspectRatio =
    webgpu.aspectRatioForMonolithicBenchmarkOctahedra3D(octahedra);
  const requestedDetailCapacity =
    webgpu.detailCapacityForMonolithicBenchmark3D(
      config.detailProfile,
      linkCount,
    );
  const renderEnabled =
    Boolean(config.renderEnabled)
    && requestedDetailCapacity > 0;

  let benchmarkDevice = null;
  let topology = null;
  let compute = null;
  let shape = null;
  let renderer = null;
  let context = null;
  let depthTexture = null;
  let evidence = null;
  const samples = {
    physics: [],
    shape: [],
    render: [],
    total: [],
  };

  try {
    onProgress({ phase: "device", completed: 0, total: 1 });
    const deviceMeasurement = await measureHost(
      () => adapter.requestDevice(),
    );
    benchmarkDevice = deviceMeasurement.value;

    if (
      typeof benchmarkDevice.queue?.onSubmittedWorkDone !== "function"
    ) {
      throw new Error(
        "benchmark requires GPUQueue.onSubmittedWorkDone()",
      );
    }

    const limits = plainDeviceLimits(benchmarkDevice);
    const capacityPlan = webgpu.planMonolithicLinkWebGpuCapacity3D(
      linkCount,
      aspectRatio,
      {
        maxStorageBufferBindingSize:
          limits.maxStorageBufferBindingSize,
        maxBufferSize: limits.maxBufferSize,
        maxComputeWorkgroupsPerDimension:
          limits.maxComputeWorkgroupsPerDimension,
      },
      {
        detailCapacity: requestedDetailCapacity,
        includeRenderer: renderEnabled,
      },
    );

    evidence = baseEvidence({
      webgpu,
      buildInfo,
      adapter,
      device: benchmarkDevice,
      config: {
        ...config,
        linkCount,
        warmupCount,
        sampleCount,
        octahedra,
        seed,
      },
      requestedDetailCapacity,
      renderEnabled,
      capacityPlan,
    });
    evidence.initializationMs.deviceCreation =
      deviceMeasurement.elapsedMs;

    const blockReason = capacityBlockReason(
      capacityPlan,
      requestedDetailCapacity,
    );
    if (blockReason !== null) {
      return {
        ...evidence,
        status: "CAPACITY_BLOCKED",
        capacityBlockReason: blockReason,
        error: null,
      };
    }

    onProgress({ phase: "topology", completed: 0, total: 1 });
    const topologyMeasurement = await measureHost(async () =>
      webgpu.createMonolithicLinkBenchmarkTopology3D({
        linkCount,
        profile: config.topologyProfile,
        seed,
      })
    );
    topology = topologyMeasurement.value;
    evidence.compactTopologyBytes = topology.inputTopologyBytes;
    evidence.initializationMs.topologyGeneration =
      topologyMeasurement.elapsedMs;

    const physicsOptions = {
      aspectRatio,
      stretchStiffness: config.physics.stretchStiffness,
      straighteningStiffness:
        config.physics.straighteningStiffness,
      nonlinearity: config.physics.nonlinearity,
      centerMass: config.physics.centerMass,
      dampingRate: config.physics.dampingRate,
      simulationSpeed: config.physics.simulationSpeed,
    };

    onProgress({ phase: "compute-create", completed: 0, total: 1 });
    const computeMeasurement = await measureHost(async () => {
      const created =
        await webgpu.createMonolithicLinkWebGpuComputeFromTopology3D(
          benchmarkDevice,
          topology,
          physicsOptions,
        );
      await benchmarkDevice.queue.onSubmittedWorkDone();
      return created;
    });
    compute = computeMeasurement.value;
    evidence.initializationMs.computeCreation =
      computeMeasurement.elapsedMs;

    onProgress({ phase: "shape-create", completed: 0, total: 1 });
    const shapeMeasurement = await measureHost(async () => {
      const created = await webgpu.createMonolithicLinkWebGpuShape3D(
        benchmarkDevice,
        compute,
        aspectRatio,
        { detailCapacity: requestedDetailCapacity },
      );
      await benchmarkDevice.queue.onSubmittedWorkDone();
      return created;
    });
    shape = shapeMeasurement.value;
    evidence.initializationMs.shapeCreation =
      shapeMeasurement.elapsedMs;

    const shapeSnapshot = shape.snapshot();
    evidence.effectiveDetailCapacity =
      shapeSnapshot.detailCapacity;
    if (
      shapeSnapshot.detailCapacity
      !== requestedDetailCapacity
    ) {
      throw new Error(
        "runtime detail capacity differs from accepted preflight: "
        + `${shapeSnapshot.detailCapacity} != ${requestedDetailCapacity}`,
      );
    }

    if (
      requestedDetailCapacity > 0
      && linkCount > requestedDetailCapacity
    ) {
      const selectionMeasurement = await measureSubmitted(
        benchmarkDevice,
        () => shape.setGpuDetailSelectionView({
          viewProjection: IDENTITY_VIEW_PROJECTION,
          selectedLink: null,
          frustumMargin: 0.18,
        }),
      );
      evidence.initializationMs.detailSelectionSetup =
        selectionMeasurement.elapsedMs;
    } else {
      evidence.initializationMs.detailSelectionSetup = 0;
    }

    if (renderEnabled) {
      onProgress({ phase: "renderer-create", completed: 0, total: 1 });
      const rendererMeasurement = await measureHost(async () => {
        context = canvas.getContext("webgpu");
        if (!context) {
          throw new Error(
            "benchmark canvas.getContext('webgpu') returned null",
          );
        }
        const colorFormat =
          navigator.gpu.getPreferredCanvasFormat();
        context.configure({
          device: benchmarkDevice,
          format: colorFormat,
          alphaMode: "opaque",
        });
        depthTexture = benchmarkDevice.createTexture({
          label: "mts-visual-benchmark-depth",
          size: [canvas.width, canvas.height, 1],
          format: "depth24plus",
          usage:
            globalThis.GPUTextureUsage?.RENDER_ATTACHMENT
            ?? 0x10,
        });
        const created =
          await webgpu.createMonolithicLinkWebGpuZeroCopyRenderer3D(
            benchmarkDevice,
            compute,
            shape,
            {
              colorFormat,
              depthFormat: "depth24plus",
            },
          );
        await benchmarkDevice.queue.onSubmittedWorkDone();
        return created;
      });
      renderer = rendererMeasurement.value;
      evidence.initializationMs.rendererCreation =
        rendererMeasurement.elapsedMs;
    } else {
      evidence.initializationMs.rendererCreation = 0;
    }

    onProgress({
      phase: "warmup",
      completed: 0,
      total: warmupCount,
    });
    const warmupStarted = nowMs();
    let warmupCompleted = 0;
    for (let index = 0; index < warmupCount; index += 1) {
      compute.step();
      shape.update();
      if (renderer) {
        renderer.render(
          benchmarkFrame(
            canvas,
            context.getCurrentTexture().createView(),
            depthTexture.createView(),
          ),
        );
      }
      await benchmarkDevice.queue.onSubmittedWorkDone();
      warmupCompleted += 1;
      evidence.warmupCountCompleted = warmupCompleted;
      onProgress({
        phase: "warmup",
        completed: warmupCompleted,
        total: warmupCount,
      });
      if (shouldStop()) break;
    }
    evidence.initializationMs.warmupTotal =
      nowMs() - warmupStarted;

    if (shouldStop()) {
      return {
        ...evidence,
        stoppedEarly: true,
        status: "RUNTIME_FAILED",
        error: "USER_STOPPED_BEFORE_MEASURED_SAMPLES",
      };
    }

    onProgress({
      phase: "samples",
      completed: 0,
      total: sampleCount,
    });

    for (let index = 0; index < sampleCount; index += 1) {
      const totalStarted = nowMs();

      const physicsMeasurement = await measureSubmitted(
        benchmarkDevice,
        () => compute.step(),
      );
      samples.physics.push(physicsMeasurement.elapsedMs);

      const shapeMeasurementMeasured = await measureSubmitted(
        benchmarkDevice,
        () => shape.update(),
      );
      samples.shape.push(shapeMeasurementMeasured.elapsedMs);

      if (renderer) {
        const renderMeasurement = await measureSubmitted(
          benchmarkDevice,
          () => renderer.render(
            benchmarkFrame(
              canvas,
              context.getCurrentTexture().createView(),
              depthTexture.createView(),
            ),
          ),
        );
        samples.render.push(renderMeasurement.elapsedMs);
      }

      samples.total.push(nowMs() - totalStarted);
      evidence.sampleCountCompleted = samples.physics.length;
      onProgress({
        phase: "samples",
        completed: samples.physics.length,
        total: sampleCount,
      });

      if (shouldStop()) {
        evidence.stoppedEarly = true;
        break;
      }
    }

    if (samples.physics.length === 0) {
      return {
        ...evidence,
        stoppedEarly: true,
        status: "RUNTIME_FAILED",
        error: "USER_STOPPED_BEFORE_MEASURED_SAMPLES",
      };
    }

    return completedEvidence(webgpu, evidence, samples);
  } catch (error) {
    if (evidence === null) {
      throw error;
    }
    return {
      ...evidence,
      status: "RUNTIME_FAILED",
      error: errorText(error),
    };
  } finally {
    const destroyStarted = nowMs();
    try {
      if (benchmarkDevice?.queue?.onSubmittedWorkDone) {
        await benchmarkDevice.queue.onSubmittedWorkDone();
      }
    } catch {}
    try { renderer?.destroy(); } catch {}
    try { depthTexture?.destroy(); } catch {}
    try { context?.unconfigure?.(); } catch {}
    try { shape?.destroy(); } catch {}
    try { compute?.destroy(); } catch {}
    try { benchmarkDevice?.destroy?.(); } catch {}
    if (evidence !== null) {
      evidence.initializationMs.destroy =
        nowMs() - destroyStarted;
    }
    onProgress({ phase: "done", completed: 1, total: 1 });
  }
}
