import assert from "node:assert/strict";
import {
  createSharedDiagnosticSnapshot,
  projectSharedDiagnosticDisplay,
  reconcileSelectedLinkKey,
  serializeSharedDiagnosticSnapshot,
  validateSelectedLinkKey,
} from "../browser/webgpu-witness/lab-diagnostics-model.js";

const network = {
  links: [
    { key: "R", startKey: "O", endKey: "C" },
    { key: "O", startKey: "C", endKey: "R" },
  ],
};
const scene = {
  id: "fixture",
  label: "Fixture",
  sourceKind: "fixture",
  network,
};

assert.equal(validateSelectedLinkKey(scene, null), null);
assert.equal(validateSelectedLinkKey(scene, "R"), "R");
assert.throws(
  () => validateSelectedLinkKey(scene, "missing"),
  /неизвестная выбранная связь: missing/,
);

assert.equal(reconcileSelectedLinkKey(scene, null), null);
assert.equal(reconcileSelectedLinkKey(scene, "O"), "O");
assert.equal(reconcileSelectedLinkKey(scene, "missing"), null);

{
  const detail = {
    frames: 12,
    nested: { value: 7 },
  };
  const snapshot = createSharedDiagnosticSnapshot({
    mode: "mechanical-3d",
    modeLabel: "Mechanical 3D",
    scene,
    selectedKey: "R",
    rendererVersion: "0.6.0",
    rendererBuildSha:
      "1234567890abcdef1234567890abcdef12345678",
    detail,
  });

  assert.deepEqual(snapshot, {
    mode: "mechanical-3d",
    modeLabel: "Mechanical 3D",
    input: {
      id: "fixture",
      label: "Fixture",
      sourceKind: "fixture",
      links: 2,
    },
    selectedKey: "R",
    renderer: {
      version: "0.6.0",
      buildSha:
        "1234567890abcdef1234567890abcdef12345678",
    },
    detail,
  });

  assert.equal(snapshot.detail, detail);
  assert.equal(network.links.length, 2);
  assert.equal(scene.label, "Fixture");

  const text = serializeSharedDiagnosticSnapshot(snapshot);
  assert.equal(
    text,
    JSON.stringify(snapshot, null, 2) + "\n",
  );
  assert.equal(text.endsWith("\n\n"), false);

  const display = projectSharedDiagnosticDisplay(snapshot);
  assert.equal(display.mode, "Mechanical 3D · mechanical-3d");
  assert.equal(display.input, "Fixture · fixture");
  assert.equal(display.links, "2");
  assert.equal(display.selected, "R");
  assert.equal(display.version, "0.6.0");
  assert.equal(display.sha, "1234567890ab");
  assert.equal(
    display.detail,
    JSON.stringify(detail, null, 2),
  );
  assert.equal(Object.isFrozen(display), true);
}

{
  const provenanceScene = {
    ...scene,
    sourceKind: "import",
    sourceRepository: "repo://Exact/Path",
    sourceSha: "Sha-With-Case",
  };
  const snapshot = createSharedDiagnosticSnapshot({
    mode: "document-2d",
    modeLabel: "Document 2D",
    scene: provenanceScene,
    selectedKey: null,
    rendererVersion: 6,
    rendererBuildSha: "abcdef",
    detail: null,
  });

  assert.equal(
    snapshot.input.sourceRepository,
    "repo://Exact/Path",
  );
  assert.equal(snapshot.input.sourceSha, "Sha-With-Case");

  const display = projectSharedDiagnosticDisplay(snapshot);
  assert.equal(display.selected, "—");
  assert.equal(display.version, "6");
  assert.equal(display.sha, "abcdef");
  assert.equal(display.detail, "{}");
}

{
  const snapshot = createSharedDiagnosticSnapshot({
    mode: "structural-2d",
    modeLabel: "Structural 2D",
    scene,
    selectedKey: null,
    rendererVersion: "0.6.0",
    rendererBuildSha: "1234567890123456",
    detail: null,
  });

  assert.equal(
    Object.prototype.hasOwnProperty.call(
      snapshot.input,
      "sourceRepository",
    ),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      snapshot.input,
      "sourceSha",
    ),
    false,
  );
}

{
  const beforeScene = JSON.stringify(scene);
  const detail = Object.freeze({ x: 1 });
  const snapshot = createSharedDiagnosticSnapshot({
    mode: "classic-3d",
    modeLabel: "Classic 3D",
    scene,
    selectedKey: "O",
    rendererVersion: "v",
    rendererBuildSha: "sha",
    detail,
  });
  projectSharedDiagnosticDisplay(snapshot);
  serializeSharedDiagnosticSnapshot(snapshot);
  validateSelectedLinkKey(scene, "O");
  reconcileSelectedLinkKey(scene, "O");

  assert.equal(JSON.stringify(scene), beforeScene);
  assert.equal(snapshot.detail, detail);
}

console.log("Web Lab shared diagnostics model executable contract: PASS");
