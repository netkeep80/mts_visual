function modeFlags(modeId) {
  return Object.freeze({
    mechanical: modeId === "mechanical-3d",
    structural: modeId === "structural-2d",
    blueprint: modeId === "blueprint-2d",
    document2d: modeId === "document-2d",
    classic: modeId === "classic-3d",
  });
}

export function createLabModeMountController({
  ui,
  mountMechanical,
  mountStructural,
  mountBlueprint,
  mountDocument,
  mountClassic,
  mountPlaceholder,
  claimResources,
  releaseResources,
}) {
  function applyVisibility(modeId) {
    const flags = modeFlags(modeId);
    const hasRenderer =
      flags.mechanical
      || flags.structural
      || flags.blueprint
      || flags.document2d
      || flags.classic;

    ui.mechanicalControls.hidden = !flags.mechanical;
    ui.structuralControls.hidden = !flags.structural;
    ui.blueprintControls.hidden = !flags.blueprint;
    ui.documentControls.hidden = !flags.document2d;
    ui.classicControls.hidden = !flags.classic;

    ui.canvas.hidden = !flags.mechanical;
    ui.structuralViewport.hidden = !flags.structural;
    ui.blueprintViewport.hidden = !flags.blueprint;
    ui.documentViewport.hidden = !flags.document2d;
    ui.classicViewport.hidden = !flags.classic;
    ui.modePlaceholder.hidden = hasRenderer;

    ui.mechanicalCameraHint.hidden = !flags.mechanical;
    ui.mechanicalRenderDiagnostics.hidden = !flags.mechanical;
    ui.structuralRenderDiagnostics.hidden = !flags.structural;
    ui.documentRenderDiagnostics.hidden = !flags.document2d;
    ui.classicRenderDiagnostics.hidden = !flags.classic;
    ui.mechanicalGeometryPanel.hidden = !flags.mechanical;

    ui.liveLab.classList.toggle("placeholder-mode", !hasRenderer);
    return flags;
  }

  async function mount(modeId) {
    const flags = applyVisibility(modeId);
    let cleanup;

    if (flags.mechanical) {
      cleanup = await mountMechanical();
    } else if (flags.structural) {
      cleanup = await mountStructural();
    } else if (flags.blueprint) {
      cleanup = await mountBlueprint();
    } else if (flags.document2d) {
      cleanup = await mountDocument();
    } else if (flags.classic) {
      cleanup = await mountClassic();
    } else {
      cleanup = await mountPlaceholder(modeId);
    }

    claimResources(modeId);

    let disposed = false;
    return async () => {
      if (disposed) return false;
      disposed = true;
      try {
        await cleanup?.();
      } finally {
        releaseResources(modeId);
      }
      return true;
    };
  }

  return Object.freeze({
    applyVisibility,
    mount,
  });
}
