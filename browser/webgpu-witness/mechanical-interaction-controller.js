import {
  cameraBasis,
  clamp,
  dot3,
  panCamera,
  pointerWorldRay,
} from "./mechanical-camera-model.js";

function errorText(error) {
  return error instanceof Error
    ? error.stack ?? error.message
    : String(error);
}

function packedVec3(values, index) {
  const offset = index * 3;
  return [
    values[offset],
    values[offset + 1],
    values[offset + 2],
  ];
}

export function createMechanicalInteractionController({
  canvas,
  showCenterMarkers,
  getMarkerControls,
  isStateCurrent,
  scheduleDetailSelection,
  setSelectedKey,
  pickCenterIcosahedra3D,
  screenDragDelta3D,
  setComputeStatus,
  setTimeoutFn,
  clearTimeoutFn,
  createAbortController = () => new AbortController(),
  log = () => {},
}) {
  function pickCenter(state, point, centers) {
    const rect = canvas.getBoundingClientRect();
    const ray = pointerWorldRay({
      camera: state.camera,
      clientX: point.clientX,
      clientY: point.clientY,
      rect,
    });
    return pickCenterIcosahedra3D(
      ray.origin,
      ray.direction,
      centers,
      state.shape.template.diameter
        * getMarkerControls().centerMarkerScale,
    );
  }

  function moveCenterDragTarget(state, dx, dy) {
    const drag = state.centerDrag;
    if (!drag || (dx === 0 && dy === 0)) return;

    const { right, up } = cameraBasis(state.camera);
    const rect = canvas.getBoundingClientRect();
    const delta = screenDragDelta3D(
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
    state.semanticCenterCache[drag.linkIndex] = [
      ...drag.target,
    ];
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

  function clearCenterInteraction(state) {
    if (!state) return false;
    state.centerDrag = null;
    state.hoveredCenterLink = -1;
    canvas.classList.remove("center-hover");
    return true;
  }

  function mount(state) {
    const abortController = createAbortController();
    const listenerOptions = {
      signal: abortController.signal,
    };
    let pointerId = null;
    let mode = null;
    let lastX = 0;
    let lastY = 0;
    let hoverGeneration = 0;
    let hoverBusy = false;
    let hoverTimer = null;
    let queuedHover = null;
    let cleaned = false;

    const setHoveredCenter = (selected) => {
      const next = Number.isSafeInteger(selected)
        ? selected
        : -1;
      if (state.hoveredCenterLink === next) return;
      state.hoveredCenterLink = next;
      canvas.classList.toggle(
        "center-hover",
        next >= 0,
      );
      scheduleDetailSelection(
        state,
        "hover-priority",
        0,
      );
    };

    const runHoverPick = async () => {
      hoverTimer = null;
      if (
        cleaned
        || hoverBusy
        || queuedHover === null
        || pointerId !== null
        || state.centerDrag
        || !showCenterMarkers.checked
        || !isStateCurrent(state)
      ) {
        if (
          !showCenterMarkers.checked
          || state.centerDrag
        ) {
          setHoveredCenter(-1);
        }
        return;
      }

      hoverBusy = true;
      const point = queuedHover;
      queuedHover = null;
      const generation = hoverGeneration;
      try {
        // Interaction-triggered readback only.
        // The render frame loop remains zero-copy.
        const gpuState =
          await state.compute.readBackState();
        if (
          cleaned
          || generation !== hoverGeneration
          || !isStateCurrent(state)
          || pointerId !== null
        ) {
          return;
        }

        const worldCenters = [];
        for (
          let link = 0;
          link < state.compute.topology.linkCount;
          link += 1
        ) {
          const center = packedVec3(
            gpuState.centers,
            link,
          );
          worldCenters.push(center);
          state.semanticCenterCache[link] = [
            ...center,
          ];
        }
        state.centerCacheRevision += 1;
        setHoveredCenter(
          pickCenter(
            state,
            point,
            worldCenters,
          ),
        );
      } catch (error) {
        if (
          !cleaned
          && generation === hoverGeneration
          && isStateCurrent(state)
        ) {
          setHoveredCenter(-1);
          log(
            `ОШИБКА выбора маркера CENTER — ${errorText(error)}`,
          );
        }
      } finally {
        hoverBusy = false;
        if (
          !cleaned
          && queuedHover !== null
          && pointerId === null
          && isStateCurrent(state)
        ) {
          hoverTimer = setTimeoutFn(
            runHoverPick,
            45,
          );
        }
      }
    };

    const requestHoverPick = (event) => {
      if (
        cleaned
        || pointerId !== null
        || state.centerDrag
        || !showCenterMarkers.checked
      ) {
        return;
      }
      queuedHover = {
        clientX: event.clientX,
        clientY: event.clientY,
      };
      if (!hoverBusy && hoverTimer === null) {
        hoverTimer = setTimeoutFn(
          runHoverPick,
          35,
        );
      }
    };

    const finishPointer = (event) => {
      if (pointerId !== event.pointerId) return;

      const releasedMode = mode;
      const releasedDrag = state.centerDrag;
      try {
        canvas.releasePointerCapture(pointerId);
      } catch {}

      pointerId = null;
      mode = null;
      state.centerDrag = null;
      canvas.classList.remove("dragging");

      if (
        releasedMode === "center"
        && releasedDrag
      ) {
        setHoveredCenter(
          releasedDrag.linkIndex,
        );
        log(
          `перетаскивание CENTER завершено: ${releasedDrag.key}`,
        );
        setComputeStatus(
          `ДОСТУПНО · mC=${state.compute.centerMass.toFixed(2)} · kS=${state.compute.stretchStiffness.toFixed(2)} · kB=${state.compute.straighteningStiffness.toFixed(2)} · t=${state.compute.simulationSpeed.toFixed(2)}x`,
          "ok",
        );
      }
    };

    const activateCenterDrag = (
      selected,
      center,
      source,
    ) => {
      const basis = cameraBasis(state.camera);
      const depth = Math.max(
        0.1,
        dot3(
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
      state.semanticCenterCache[selected] = [
        ...center,
      ];
      setHoveredCenter(selected);
      setSelectedKey(state.centerDrag.key);
      mode = "center";
      log(
        `выбран CENTER для перетаскивания: ${state.centerDrag.key} · источник=${source} · один семантический CENTER`,
      );
      setComputeStatus(
        `ПЕРЕТАСКИВАНИЕ ${state.centerDrag.key} · переопределение семантического CENTER`,
        "warn",
      );
    };

    canvas.addEventListener(
      "contextmenu",
      (event) => event.preventDefault(),
      listenerOptions,
    );

    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (
          cleaned
          || pointerId !== null
        ) {
          return;
        }

        pointerId = event.pointerId;
        lastX = event.clientX;
        lastY = event.clientY;
        hoverGeneration += 1;
        queuedHover = null;

        if (hoverTimer !== null) {
          clearTimeoutFn(hoverTimer);
          hoverTimer = null;
        }

        canvas.setPointerCapture(pointerId);
        canvas.classList.add("dragging");

        if (
          event.button === 2
          || (
            event.button === 0
            && event.shiftKey
          )
        ) {
          mode = "pan";
        } else if (
          event.button === 0
          && showCenterMarkers.checked
          && state.hoveredCenterLink >= 0
        ) {
          const selected =
            state.hoveredCenterLink;
          activateCenterDrag(
            selected,
            state.semanticCenterCache[selected],
            "область двух центральных октаэдров CENTER",
          );
        } else {
          mode = "orbit";
        }
        event.preventDefault();
      },
      listenerOptions,
    );

    canvas.addEventListener(
      "pointermove",
      (event) => {
        if (cleaned) return;

        if (pointerId === null) {
          requestHoverPick(event);
          return;
        }
        if (
          pointerId !== event.pointerId
          || mode === null
        ) {
          return;
        }

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
        } else if (
          mode === "center"
          && state.centerDrag
        ) {
          moveCenterDragTarget(
            state,
            dx,
            dy,
          );
        }

        if (
          mode === "orbit"
          || mode === "pan"
        ) {
          scheduleDetailSelection(
            state,
            "camera-interaction",
          );
        }
        event.preventDefault();
      },
      listenerOptions,
    );

    canvas.addEventListener(
      "pointerleave",
      () => {
        if (
          !cleaned
          && pointerId === null
        ) {
          queuedHover = null;
          setHoveredCenter(-1);
        }
      },
      listenerOptions,
    );

    canvas.addEventListener(
      "pointerup",
      finishPointer,
      listenerOptions,
    );
    canvas.addEventListener(
      "pointercancel",
      finishPointer,
      listenerOptions,
    );

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (
          cleaned
          || state.centerDrag
        ) {
          return;
        }

        const factor =
          Math.exp(event.deltaY * 0.001);
        state.camera.distance = clamp(
          state.camera.distance * factor,
          state.camera.minDistance,
          state.camera.maxDistance,
        );
        scheduleDetailSelection(
          state,
          "camera-zoom",
        );
      },
      {
        passive: false,
        signal: abortController.signal,
      },
    );

    return () => {
      if (cleaned) return;
      cleaned = true;
      hoverGeneration += 1;
      if (hoverTimer !== null) {
        clearTimeoutFn(hoverTimer);
        hoverTimer = null;
      }
      queuedHover = null;
      state.centerDrag = null;
      state.hoveredCenterLink = -1;
      abortController.abort();
      canvas.classList.remove(
        "dragging",
        "center-hover",
      );
    };
  }

  return Object.freeze({
    applyCenterDrag,
    clearCenterInteraction,
    mount,
    moveCenterDragTarget,
  });
}
