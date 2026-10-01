function packedVec3(values, index) {
  const offset = index * 3;
  return [
    values[offset],
    values[offset + 1],
    values[offset + 2],
  ];
}

function distance3(a, b) {
  return Math.hypot(
    a[0] - b[0],
    a[1] - b[1],
    a[2] - b[2],
  );
}

export function createMechanicalRuntimeController({
  ui,
  webgpu,
  core,
  getDevice,
  getScene,
  getPhysics,
  getRenderStyle,
  getMarkerControls,
  getPreferredCanvasFormat,
  detailSlotBudget,
  autoRotateIntervalMs,
  interactionController,
  detailSelectionController,
  benchmarkIsRunning,
  resetCamera,
  createViewProjection,
  setStatus,
  uiStatus,
  updateOverall,
  updateDiagnostics,
  equationForNetworkLink,
  fmt,
  log,
  requestAnimationFrameFn,
  cancelAnimationFrameFn,
  nowFn,
  gpuRenderAttachmentUsage,
}) {
  let mountedState = null;
  let renderPass = false;

  function state() {
    return mountedState;
  }

  function isMounted() {
    return mountedState !== null;
  }

  function didRenderPass() {
    return renderPass;
  }

  function invalidateRenderPass() {
    renderPass = false;
  }

  function resizeCanvas() {
    const scale = Math.min(
      globalThis.devicePixelRatio || 1,
      2,
    );
    const width = Math.max(
      1,
      Math.round(ui.canvas.clientWidth * scale),
    );
    const height = Math.max(
      1,
      Math.round(ui.canvas.clientHeight * scale),
    );
    if (
      ui.canvas.width !== width
      || ui.canvas.height !== height
    ) {
      ui.canvas.width = width;
      ui.canvas.height = height;
      return true;
    }
    return false;
  }

  function currentViewProjection(target) {
    return createViewProjection(
      target.camera,
      ui.canvas.width,
      ui.canvas.height,
    );
  }

  function dispose() {
    if (!mountedState) {
      renderPass = false;
      return false;
    }

    const target = mountedState;
    mountedState = null;
    renderPass = false;

    cancelAnimationFrameFn(target.raf);
    detailSelectionController.cancel(target);
    try {
      target.cleanupCameraControls?.();
    } catch {}
    try {
      target.renderer.destroy();
    } catch {}
    try {
      target.depthTexture?.destroy();
    } catch {}
    try {
      target.context.unconfigure?.();
    } catch {}
    try {
      target.shape.destroy();
    } catch {}
    try {
      target.compute.destroy();
    } catch {}
    return true;
  }

  async function mount() {
    dispose();

    const device = getDevice();
    if (!device) {
      setStatus(
        ui.renderCompute,
        uiStatus.unavailable,
        "warn",
      );
      setStatus(
        ui.renderZeroCopy,
        uiStatus.unavailable,
        "warn",
      );
      updateOverall();
      return () => dispose();
    }

    const scene = getScene();
    const network = scene.network;
    const linkCount = network.links.length;
    const physics = getPhysics();
    const monolithicOptions = {
      aspectRatio: physics.aspectRatio,
      stretchStiffness:
        physics.longitudinalStiffness,
      straighteningStiffness:
        physics.transverseStiffness,
      nonlinearity: physics.nonlinearity,
      centerMass: physics.nodeMass,
      dampingRate: physics.linearDampingRate,
      simulationSpeed: physics.simulationSpeed,
    };

    const compute =
      await webgpu.createMonolithicLinkWebGpuCompute3D(
        device,
        network,
        monolithicOptions,
      );

    let shape = null;
    let renderer = null;
    let context = null;

    try {
      shape =
        await webgpu.createMonolithicLinkWebGpuShape3D(
          device,
          compute,
          physics.aspectRatio,
          {
            detailCapacity: Math.min(
              linkCount,
              detailSlotBudget,
            ),
          },
        );
      shape.update();

      if (
        shape.template.octahedronCount
        !== physics.octahedra
      ) {
        throw new Error(
          `несоответствие длины: запрошено ${physics.octahedra} октаэдров, получено ${shape.template.octahedronCount}`,
        );
      }

      context = ui.canvas.getContext("webgpu");
      if (!context) {
        throw new Error(
          "canvas.getContext('webgpu') вернул null",
        );
      }

      const colorFormat =
        getPreferredCanvasFormat();
      context.configure({
        device,
        format: colorFormat,
        alphaMode: "opaque",
      });

      renderer =
        await webgpu.createMonolithicLinkWebGpuZeroCopyRenderer3D(
          device,
          compute,
          shape,
          {
            colorFormat,
            depthFormat: "depth24plus",
          },
        );

      const rendererSnapshot =
        renderer.snapshot();
      const zeroCopy =
        renderer.semanticCenterBuffer
          === compute.centerBuffer
        && renderer.shapeParameterBuffer
          === shape.parameterBuffer
        && renderer.shapeDetailLinkIndexBuffer
          === shape.detailLinkIndexBuffer
        && renderer.shapeSectionFrameBuffer
          === shape.sectionFrameBuffer
        && rendererSnapshot.sharedSemanticCenterBuffer
          === true
        && rendererSnapshot.sharedShapeParameterBuffer
          === true
        && rendererSnapshot.dynamicStateUploadBytesPerFrame
          === 0
        && rendererSnapshot.rendererDynamicStateBytes
          === 0;

      if (!zeroCopy) {
        throw new Error(
          "нарушен инвариант монолитного zero-copy до первого кадра",
        );
      }

      renderPass = true;
      const shapeSnapshot = shape.snapshot();
      setStatus(
        ui.renderCompute,
        "ДОСТУПНО · 2 прохода физики + compact shape + bounded detail pipeline",
        "ok",
      );
      setStatus(
        ui.renderTopology,
        `${scene.label} · ${linkCount} связей · ${shapeSnapshot.octahedronCount} октаэдров/связь · detail=${shapeSnapshot.detailedLinkCount}/${shapeSnapshot.detailCapacity} · compact=${shapeSnapshot.compactDynamicStateBytes.toLocaleString()} Б · detail-cache=${shapeSnapshot.detailDynamicStateBytes.toLocaleString()} Б · mC=${physics.nodeMass.toFixed(2)} · kS=${physics.longitudinalStiffness.toFixed(2)} · kB=${physics.transverseStiffness.toFixed(2)} · α=${physics.nonlinearity.toFixed(2)} · t=${physics.simulationSpeed.toFixed(2)}x`,
        "ok",
      );
      setStatus(
        ui.renderZeroCopy,
        "ПРОЙДЕНО — общий семантический CENTER + компактный буфер формы · 0 Б динамической загрузки CPU",
        "ok",
      );
      updateOverall();

      const initialCpu =
        core.createMonolithicLinkSpringPhysics3D(
          network,
          monolithicOptions,
        );
      const initialSemanticCenters =
        Array.from(
          { length: linkCount },
          (_, link) => [
            ...initialCpu.semanticCenter(link),
          ],
        );

      const side = Math.ceil(
        Math.cbrt(linkCount),
      );
      const spacing =
        shape.template.diameter * 2.5;
      const defaultCameraDistance = Math.max(
        18,
        shape.template.restLength * 1.35,
        side * spacing * 2.6,
      );
      const startedAt = nowFn();
      const target = {
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
        startedAt,
        lastFrameAt: nowFn(),
        lastUiAt: 0,
        lastDetailAutoRotateAt: 0,
        detailSelectionTimer: null,
        detailSelection: null,
        detailSelectionView: null,
        detailSelectionUpdates: 0,
        detailSelectionIndexUploadBytes: 0,
        detailSelectionGlobalsUploadBytes: 0,
        detailSelectionControlUploadBytes: 0,
        centerCacheRevision: 0,
        linkIndexByKey: new Map(
          compute.topology.keys.map(
            (key, index) => [key, index],
          ),
        ),
        camera: {
          yaw: 0,
          pitch: 0,
          distance: defaultCameraDistance,
          defaultDistance:
            defaultCameraDistance,
          minDistance: Math.max(
            2,
            defaultCameraDistance * 0.08,
          ),
          maxDistance:
            defaultCameraDistance * 20,
          target: [0, 0, 0],
        },
        cleanupCameraControls: null,
        centerDrag: null,
        hoveredCenterLink: -1,
        initialSemanticCenters,
        semanticCenterCache:
          initialSemanticCenters.map(
            (center) => [...center],
          ),
        scene,
        network,
      };

      resetCamera(
        target.camera,
        defaultCameraDistance,
      );
      target.cleanupCameraControls =
        interactionController.mount(target);
      mountedState = target;
      resizeCanvas();
      detailSelectionController.refresh(
        target,
        "initial-camera",
      );
      ui.pauseRender.textContent = "Пауза";

      function ensureDepth() {
        const resized = resizeCanvas();
        if (
          resized
          || target.depthTexture === null
        ) {
          target.depthTexture?.destroy();
          target.depthTexture =
            device.createTexture({
              label:
                "mts-visual-witness-depth",
              size: [
                ui.canvas.width,
                ui.canvas.height,
                1,
              ],
              format: "depth24plus",
              usage: gpuRenderAttachmentUsage,
            });
        }
      }

      function frame(now) {
        if (mountedState !== target) return;

        if (benchmarkIsRunning()) {
          target.lastFrameAt = now;
          target.raf =
            requestAnimationFrameFn(frame);
          return;
        }

        try {
          ensureDepth();

          if (!target.paused) {
            const physicsStats =
              target.compute.step();
            if (
              physicsStats.computePasses !== 2
              || physicsStats.dynamicStateUploadBytes
                !== 0
            ) {
              throw new Error(
                `нарушен инвариант монолитной физики: проходы=${physicsStats.computePasses}, загрузка=${physicsStats.dynamicStateUploadBytes}`,
              );
            }
            target.steps += 1;
          }

          const dragStats =
            interactionController
              .applyCenterDrag(target);
          if (
            dragStats
            && target.centerDrag
          ) {
            target.centerDrag.uploadedBytes +=
              dragStats.centerBytes
              + dragStats.velocityBytes;
          }

          const shapeStats =
            target.shape.update();
          const expectedDetailDispatches =
            shapeStats.detailedLinkCount > 0
              ? 1
              : 0;
          const expectedSelectorDispatches =
            shapeStats.selectionMode
              === "gpu-partition"
            && shapeStats.detailedLinkCount > 0
              ? 1
              : 0;
          const expectedShapePasses =
            1
            + expectedSelectorDispatches
            + expectedDetailDispatches;

          if (
            shapeStats.compactDispatches !== 1
            || shapeStats.selectorDispatches
              !== expectedSelectorDispatches
            || shapeStats.detailDispatches
              !== expectedDetailDispatches
            || shapeStats.computePasses
              !== expectedShapePasses
            || shapeStats.dynamicStateUploadBytes
              !== 0
          ) {
            throw new Error(
              `нарушен инвариант производной геометрии: compact=${shapeStats.compactDispatches}, selector=${shapeStats.selectorDispatches}/${expectedSelectorDispatches}, detail=${shapeStats.detailDispatches}, проходы=${shapeStats.computePasses}/${expectedShapePasses}, detailLinks=${shapeStats.detailedLinkCount}, режим=${shapeStats.selectionMode}, загрузка=${shapeStats.dynamicStateUploadBytes}`,
            );
          }
          target.shapeUpdates += 1;

          const frameDeltaSeconds =
            Math.min(
              0.1,
              Math.max(
                0,
                (now - target.lastFrameAt)
                  / 1000,
              ),
            );
          target.lastFrameAt = now;

          if (
            ui.autoRotate.checked
            && !target.centerDrag
          ) {
            target.camera.yaw +=
              frameDeltaSeconds * 0.16;
            if (
              now
                - target.lastDetailAutoRotateAt
              >= autoRotateIntervalMs
            ) {
              target.lastDetailAutoRotateAt =
                now;
              detailSelectionController
                .schedule(
                  target,
                  "auto-rotate",
                  0,
                );
            }
          }

          const viewProjection =
            currentViewProjection(target);
          const renderStyle =
            getRenderStyle();
          const markers =
            getMarkerControls();
          const stats =
            target.renderer.render({
              targetView:
                target.context
                  .getCurrentTexture()
                  .createView(),
              depthView:
                target.depthTexture
                  .createView(),
              viewProjection,
              width: ui.canvas.width,
              height: ui.canvas.height,
              wireframe:
                renderStyle.wireframe,
              showCenterMarkers:
                markers.showCenterMarkers,
              showEndCones:
                markers.showEndCones,
              centerMarkerScale:
                markers.centerMarkerScale,
              endConeScale:
                markers.endConeScale,
              hoveredCenterLink:
                target.hoveredCenterLink,
              smoothNormals:
                renderStyle.smoothNormals,
              clearColor: {
                r: 0.005,
                g: 0.008,
                b: 0.014,
                a: 1,
              },
            });
          target.frames += 1;

          const hasDetail =
            stats.detailedLinkCount > 0;
          const expectedDrawCalls =
            (hasDetail ? 1 : 0)
            + (
              markers.showCenterMarkers
              && target.hoveredCenterLink >= 0
                ? 1
                : 0
            )
            + (
              markers.showEndCones
              && hasDetail
                ? 1
                : 0
            );

          if (
            stats.dynamicStateUploadBytes !== 0
            || stats.bufferCopies !== 0
            || stats.readbacks !== 0
            || stats.drawCalls
              !== expectedDrawCalls
          ) {
            throw new Error(
              `нарушение zero-copy во время рендера: загрузки=${stats.dynamicStateUploadBytes}, копии=${stats.bufferCopies}, чтения=${stats.readbacks}, отрисовки=${stats.drawCalls}/${expectedDrawCalls}`,
            );
          }

          if (
            now - target.lastUiAt > 250
          ) {
            target.lastUiAt = now;
            ui.renderFrames.textContent =
              `${target.frames.toLocaleString()} / ${target.steps.toLocaleString()}`;
            updateDiagnostics();
          }
        } catch (error) {
          renderPass = false;
          setStatus(
            ui.renderCompute,
            uiStatus.error,
            "fail",
          );
          setStatus(
            ui.renderZeroCopy,
            "НЕ ПРОЙДЕНО — см. журнал",
            "fail",
          );
          log(
            `ОШИБКА монолитного рендера — ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
          );
          updateOverall();
          dispose();
          return;
        }

        target.raf =
          requestAnimationFrameFn(frame);
      }

      target.raf =
        requestAnimationFrameFn(frame);
      log(
        `монолитный рендер v0.6 запущен: сцена=${scene.label}, ${linkCount} связей, detail=${shape.snapshot().detailedLinkCount}/${shape.snapshot().detailCapacity}, selector=${shape.snapshot().selectionMode}, ${shape.template.octahedronCount} октаэдров/связь, массаCENTER=${physics.nodeMass.toFixed(2)}, растяжение=${physics.longitudinalStiffness.toFixed(2)}, выпрямление=${physics.transverseStiffness.toFixed(2)}, нелинейность=${physics.nonlinearity.toFixed(2)}, демпфирование=${physics.linearDampingRate.toFixed(2)}, скорость=${physics.simulationSpeed.toFixed(2)}x`,
      );

      return () => dispose();
    } catch (error) {
      try {
        renderer?.destroy();
      } catch {}
      try {
        context?.unconfigure?.();
      } catch {}
      try {
        shape?.destroy();
      } catch {}
      try {
        compute.destroy();
      } catch {}
      renderPass = false;
      throw error;
    }
  }

  function diagnosticDetail(scene) {
    const target = mountedState;
    if (
      !target
      || target.scene !== scene
    ) {
      return null;
    }

    const compute =
      target.compute.snapshot();
    const shape =
      target.shape.snapshot();
    const renderer =
      target.renderer.snapshot();

    return {
      frames: target.frames,
      steps: target.steps,
      shapeUpdates: target.shapeUpdates,
      paused: target.paused,
      linkCount:
        target.compute.topology.linkCount,
      centerBytes: compute.centerBytes,
      velocityBytes: compute.velocityBytes,
      octahedraPerLink:
        shape.octahedronCount,
      detail: {
        policy:
          target.detailSelection?.policy
          ?? (
            shape.detailCapacity
              < target.compute.topology.linkCount
              ? "gpu-partition-frustum/v1"
              : "full-detail-identity/v1"
          ),
        slotBudget: detailSlotBudget,
        detailedLinkCount:
          shape.detailedLinkCount,
        detailCapacity:
          shape.detailCapacity,
        culledLinkCount:
          target.detailSelection
            ?.culledLinkCount
          ?? Math.max(
            0,
            target.compute.topology.linkCount
              - shape.detailedLinkCount,
          ),
        visibleCandidateCount:
          target.detailSelection
            ?.visibleCandidateCount
          ?? null,
        selectedPinned:
          target.detailSelection
            ?.selectedPinned
          ?? false,
        hoveredPinned:
          target.detailSelection
            ?.hoveredPinned
          ?? false,
        selectionReason:
          target.detailSelection?.reason
          ?? "initial-prefix",
        selectionUpdates:
          target.detailSelectionUpdates,
        liveCenterSource:
          shape.selectionMode
            === "gpu-partition"
            ? "semantic-center-buffer"
            : "full-detail-identity",
        centerCacheRevision:
          target.centerCacheRevision,
        selectionCenterRevision:
          target.detailSelection
            ?.centerCacheRevision
          ?? null,
        selectionMode:
          shape.selectionMode,
        selectorControlBytes:
          shape.selectionControlBytes,
        indexUploadBytes:
          target
            .detailSelectionIndexUploadBytes,
        globalsUploadBytes:
          target
            .detailSelectionGlobalsUploadBytes,
        selectionControlUploadBytes:
          target
            .detailSelectionControlUploadBytes,
        compactDynamicStateBytes:
          shape.compactDynamicStateBytes,
        detailDynamicStateBytes:
          shape.detailDynamicStateBytes,
        sectionFrameBytes:
          shape.sectionFrameBytes,
      },
      zeroCopy: {
        sharedSemanticCenterBuffer:
          renderer.sharedSemanticCenterBuffer,
        sharedShapeParameterBuffer:
          renderer.sharedShapeParameterBuffer,
        sharedDetailLinkIndexBuffer:
          target.renderer
            .shapeDetailLinkIndexBuffer
          === target.shape
            .detailLinkIndexBuffer,
        sharedSectionFrameBuffer:
          target.renderer
            .shapeSectionFrameBuffer
          === target.shape
            .sectionFrameBuffer,
        dynamicStateUploadBytesPerFrame:
          renderer
            .dynamicStateUploadBytesPerFrame,
        rendererDynamicStateBytes:
          renderer.rendererDynamicStateBytes,
      },
    };
  }

  function scheduleSelectedLink(
    scene,
    reason = "shared-selection",
  ) {
    if (
      !mountedState
      || mountedState.scene !== scene
    ) {
      return false;
    }
    return detailSelectionController.schedule(
      mountedState,
      reason,
      0,
    );
  }

  function resetView() {
    if (!mountedState) return false;
    resetCamera(
      mountedState.camera,
      mountedState.camera.defaultDistance,
    );
    return true;
  }

  function togglePause() {
    if (!mountedState) return null;
    mountedState.paused =
      !mountedState.paused;
    ui.pauseRender.textContent =
      mountedState.paused
        ? "Продолжить"
        : "Пауза";
    return mountedState.paused;
  }

  function clearCenterInteraction() {
    if (!mountedState) return false;
    return interactionController
      .clearCenterInteraction(
        mountedState,
      );
  }

  function applyLivePhysics() {
    if (!mountedState) return false;

    const physics = getPhysics();
    const compute = mountedState.compute;

    compute.setCenterMass(
      physics.nodeMass,
    );
    compute.setStretchStiffness(
      physics.longitudinalStiffness,
    );
    compute.setStraighteningStiffness(
      physics.transverseStiffness,
    );
    compute.setNonlinearity(
      physics.nonlinearity,
    );
    compute.setDampingRate(
      physics.linearDampingRate,
    );
    compute.setSimulationSpeed(
      physics.simulationSpeed,
    );

    const snapshot = compute.snapshot();
    const checks = [
      [
        "масса CENTER",
        snapshot.centerMass,
        physics.nodeMass,
      ],
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
      [
        "нелинейность",
        snapshot.nonlinearity,
        physics.nonlinearity,
      ],
      [
        "демпфирование CENTER",
        snapshot.dampingRate,
        physics.linearDampingRate,
      ],
      [
        "скорость симуляции",
        snapshot.simulationSpeed,
        physics.simulationSpeed,
      ],
    ];

    for (
      const [label, actual, expected]
      of checks
    ) {
      if (
        Math.abs(actual - expected)
        > 1e-12
      ) {
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
    return true;
  }

  async function inspectGeometry() {
    if (!mountedState) return null;

    const target = mountedState;
    const wasPaused = target.paused;
    target.paused = true;
    ui.inspectGeometry.disabled = true;

    try {
      const gpuState =
        await target.compute.readBackState();
      if (mountedState !== target) {
        return null;
      }

      const topology =
        target.compute.topology;
      const restLength =
        target.shape.template.restLength;
      const networkByKey = new Map(
        target.network.links.map(
          (link) => [link.key, link],
        ),
      );
      const rowsHtml = [];
      let globalMaxBend = 0;
      let globalMaxSpeed = 0;
      let totalPotentialEnergy = 0;

      for (
        let linkIndex = 0;
        linkIndex < topology.linkCount;
        linkIndex += 1
      ) {
        const key =
          topology.keys[linkIndex];
        const source =
          networkByKey.get(key);
        if (!source) {
          throw new Error(
            `не найдена исходная связь для диагностики: ${key}`,
          );
        }

        const startIndex =
          topology.startIndices[linkIndex];
        const endIndex =
          topology.endIndices[linkIndex];
        const start = packedVec3(
          gpuState.centers,
          startIndex,
        );
        const center = packedVec3(
          gpuState.centers,
          linkIndex,
        );
        const end = packedVec3(
          gpuState.centers,
          endIndex,
        );
        const velocity = packedVec3(
          gpuState.velocities,
          linkIndex,
        );

        const startLength =
          distance3(start, center);
        const endLength =
          distance3(center, end);
        const bendVector = [
          start[0]
            - 2 * center[0]
            + end[0],
          start[1]
            - 2 * center[1]
            + end[1],
          start[2]
            - 2 * center[2]
            + end[2],
        ];
        const bend =
          Math.hypot(...bendVector);
        const centerDisplacement =
          distance3(
            center,
            target.initialSemanticCenters[
              linkIndex
            ],
          );
        const speed =
          Math.hypot(...velocity);
        const energy =
          core.evaluateMonolithicLinkSpring3D(
            start,
            center,
            end,
            restLength,
            {
              stretchStiffness:
                target.compute
                  .stretchStiffness,
              straighteningStiffness:
                target.compute
                  .straighteningStiffness,
              nonlinearity:
                target.compute
                  .nonlinearity,
            },
          ).energy;

        globalMaxBend = Math.max(
          globalMaxBend,
          bend,
        );
        globalMaxSpeed = Math.max(
          globalMaxSpeed,
          speed,
        );
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

      ui.geometryBody.innerHTML =
        rowsHtml.join("");
      const readbackBytes =
        gpuState.centers.byteLength
        + gpuState.velocities.byteLength;
      log(
        `проверка монолитной геометрии: сцена=${target.scene.label}, ${topology.linkCount} связей, чтение=${readbackBytes} Б, максИзгиб=${fmt(globalMaxBend)}, потенциал=${fmt(totalPotentialEnergy)}, максСкоростьCENTER=${fmt(globalMaxSpeed)}, длинаПокоя=${fmt(restLength)}`,
      );
      return {
        linkCount: topology.linkCount,
        readbackBytes,
        globalMaxBend,
        totalPotentialEnergy,
        globalMaxSpeed,
        restLength,
      };
    } catch (error) {
      ui.geometryBody.innerHTML =
        `<tr><td colspan="9" class="fail">ОШИБКА проверки — ${String(error)}</td></tr>`;
      log(
        `ОШИБКА проверки монолитной геометрии — ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
      );
      return null;
    } finally {
      if (mountedState === target) {
        target.paused = wasPaused;
      }
      ui.inspectGeometry.disabled = false;
    }
  }

  return Object.freeze({
    applyLivePhysics,
    clearCenterInteraction,
    diagnosticDetail,
    didRenderPass,
    dispose,
    inspectGeometry,
    invalidateRenderPass,
    isMounted,
    mount,
    resetView,
    scheduleSelectedLink,
    state,
    togglePause,
  });
}
