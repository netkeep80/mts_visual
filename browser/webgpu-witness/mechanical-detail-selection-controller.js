function errorText(error) {
  return error instanceof Error
    ? error.stack ?? error.message
    : String(error);
}

export function sameMechanicalGpuSelectionView(
  previous,
  matrix,
  priorityLink,
) {
  if (
    previous === null
    || previous.priorityLink !== priorityLink
    || previous.viewProjection.length
      !== matrix.length
  ) {
    return false;
  }

  for (
    let index = 0;
    index < matrix.length;
    index += 1
  ) {
    if (
      previous.viewProjection[index]
      !== matrix[index]
    ) {
      return false;
    }
  }
  return true;
}

export function createMechanicalDetailSelectionController({
  getSelectedKey,
  getViewProjection,
  frustumMargin,
  defaultDelay,
  isStateCurrent,
  updateDiagnostics,
  setTimeoutFn,
  clearTimeoutFn,
  log = () => {},
}) {
  function selectedLinkIndex(state) {
    const selectedKey = getSelectedKey();
    if (selectedKey === null) return -1;
    return (
      state.linkIndexByKey.get(selectedKey)
      ?? -1
    );
  }

  function refresh(state, reason) {
    if (!isStateCurrent(state)) return null;

    const shapeSnapshot =
      state.shape.snapshot();
    const linkCount =
      state.compute.topology.linkCount;
    const selectedLink =
      selectedLinkIndex(state);
    const hoveredLink =
      state.hoveredCenterLink;
    const bounded =
      shapeSnapshot.detailCapacity < linkCount;

    if (!bounded) {
      state.detailSelectionView = null;
      state.detailSelection = {
        policy: "full-detail-identity/v1",
        reason,
        detailedLinkCount:
          shapeSnapshot.detailedLinkCount,
        culledLinkCount: 0,
        visibleCandidateCount: null,
        selectedPinned: false,
        hoveredPinned: false,
        centerCacheRevision: null,
      };
      updateDiagnostics();
      return null;
    }

    const priorityLink =
      selectedLink >= 0
        ? selectedLink
        : hoveredLink;
    const viewProjection =
      getViewProjection(state);

    if (
      sameMechanicalGpuSelectionView(
        state.detailSelectionView,
        viewProjection,
        priorityLink,
      )
    ) {
      state.detailSelection = {
        ...state.detailSelection,
        reason,
      };
      updateDiagnostics();
      return null;
    }

    const updateStats =
      state.shape.setGpuDetailSelectionView({
        viewProjection,
        selectedLink: priorityLink,
        frustumMargin,
      });

    state.detailSelectionUpdates += 1;
    state.detailSelectionIndexUploadBytes +=
      updateStats.indexUploadBytes;
    state.detailSelectionGlobalsUploadBytes +=
      updateStats.globalsUploadBytes;
    state.detailSelectionControlUploadBytes +=
      updateStats.selectionControlUploadBytes;

    state.detailSelectionView = {
      priorityLink,
      viewProjection:
        Array.from(viewProjection),
    };
    state.detailSelection = {
      policy: "gpu-partition-frustum/v1",
      reason,
      detailedLinkCount:
        updateStats.detailedLinkCount,
      culledLinkCount: Math.max(
        0,
        linkCount
          - updateStats.detailedLinkCount,
      ),
      visibleCandidateCount: null,
      selectedPinned: selectedLink >= 0,
      hoveredPinned:
        selectedLink < 0
        && hoveredLink >= 0,
      centerCacheRevision: null,
    };

    updateDiagnostics();
    return updateStats;
  }

  function cancel(state) {
    if (
      !state
      || state.detailSelectionTimer === null
    ) {
      return false;
    }
    clearTimeoutFn(
      state.detailSelectionTimer,
    );
    state.detailSelectionTimer = null;
    return true;
  }

  function schedule(
    state,
    reason,
    delay = defaultDelay,
  ) {
    if (!isStateCurrent(state)) {
      return false;
    }

    cancel(state);
    state.detailSelectionTimer =
      setTimeoutFn(
        () => {
          state.detailSelectionTimer = null;
          if (!isStateCurrent(state)) {
            return;
          }
          try {
            refresh(state, reason);
          } catch (error) {
            log(
              `ОШИБКА выбора detail-cache (${reason}) — ${errorText(error)}`,
            );
          }
        },
        Math.max(0, delay),
      );
    return true;
  }

  return Object.freeze({
    cancel,
    refresh,
    sameSelectionView:
      sameMechanicalGpuSelectionView,
    schedule,
    selectedLinkIndex,
  });
}
