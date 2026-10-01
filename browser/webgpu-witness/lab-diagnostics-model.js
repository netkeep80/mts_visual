function sceneHasKey(scene, key) {
  return scene.network.links.some((link) => link.key === key);
}

export function validateSelectedLinkKey(scene, key) {
  if (key === null) return null;
  if (!sceneHasKey(scene, key)) {
    throw new Error(`неизвестная выбранная связь: ${key}`);
  }
  return key;
}

export function reconcileSelectedLinkKey(scene, key) {
  if (key === null) return null;
  return sceneHasKey(scene, key) ? key : null;
}

export function createSharedDiagnosticSnapshot({
  mode,
  modeLabel,
  scene,
  selectedKey,
  rendererVersion,
  rendererBuildSha,
  detail,
}) {
  return {
    mode,
    modeLabel,
    input: {
      id: scene.id,
      label: scene.label,
      sourceKind: scene.sourceKind,
      links: scene.network.links.length,
      ...(scene.sourceRepository === undefined
        ? {}
        : { sourceRepository: scene.sourceRepository }),
      ...(scene.sourceSha === undefined
        ? {}
        : { sourceSha: scene.sourceSha }),
    },
    selectedKey,
    renderer: {
      version: rendererVersion,
      buildSha: rendererBuildSha,
    },
    detail,
  };
}

export function serializeSharedDiagnosticSnapshot(snapshot) {
  return JSON.stringify(snapshot, null, 2) + "\n";
}

export function projectSharedDiagnosticDisplay(snapshot) {
  return Object.freeze({
    mode: `${snapshot.modeLabel} · ${snapshot.mode}`,
    input:
      `${snapshot.input.label} · ${snapshot.input.sourceKind}`,
    links: String(snapshot.input.links),
    selected: snapshot.selectedKey ?? "—",
    version: String(snapshot.renderer.version),
    sha: String(snapshot.renderer.buildSha).slice(0, 12),
    detail: JSON.stringify(snapshot.detail ?? {}, null, 2),
  });
}
