import assert from "node:assert/strict";
import {
  IMPORTED_SCENE_ID,
  createImportedSceneFromText,
  createSceneInputManifest,
  serializeSceneInputManifest,
} from "../browser/webgpu-witness/lab-input-model.js";

const schema = "mts.visual.document2d.input/v1";
const network = {
  links: [
    { key: "A", startKey: "B", endKey: "C" },
  ],
};

{
  const scene = {
    id: "fixture-a",
    label: "Fixture A",
    network,
    sourceKind: "fixture",
  };
  const manifest = createSceneInputManifest(scene, schema);
  assert.equal(Object.isFrozen(manifest), true);
  assert.deepEqual(manifest, {
    schema,
    links: network.links,
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(manifest, "sourceRepository"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(manifest, "sourceSha"),
    false,
  );

  const text = serializeSceneInputManifest(scene, schema);
  assert.equal(
    text,
    JSON.stringify(manifest, null, 2) + "\n",
  );
  assert.equal(text.endsWith("\n\n"), false);
}

{
  const scene = {
    network,
    sourceRepository: "https://example.invalid/repo",
    sourceSha: "00abcDEF-source-sha",
  };
  const manifest = createSceneInputManifest(scene, schema);
  assert.equal(
    manifest.sourceRepository,
    "https://example.invalid/repo",
  );
  assert.equal(manifest.sourceSha, "00abcDEF-source-sha");
  assert.equal(manifest.links, network.links);
}

{
  let parseCalls = 0;
  let normalizeCalls = 0;
  let rawSeen = null;
  let networkSeen = null;
  const parsedNetwork = {
    links: [{ key: "raw" }],
  };
  const normalizedNetwork = {
    links: [{ key: "normalized" }],
  };

  const scene = createImportedSceneFromText(
    JSON.stringify({
      schema,
      sourceRepository: "repo://exact",
      sourceSha: "Sha-With-Case",
      links: [{ key: "wire" }],
    }),
    "fixture.json",
    {
      parseManifest(raw) {
        parseCalls += 1;
        rawSeen = raw;
        return {
          network: parsedNetwork,
          sourceRepository: raw.sourceRepository,
          sourceSha: raw.sourceSha,
        };
      },
      normalizeNetwork(value) {
        normalizeCalls += 1;
        networkSeen = value;
        return normalizedNetwork;
      },
    },
  );

  assert.equal(parseCalls, 1);
  assert.equal(normalizeCalls, 1);
  assert.deepEqual(rawSeen.links, [{ key: "wire" }]);
  assert.equal(networkSeen, parsedNetwork);

  assert.equal(scene.id, IMPORTED_SCENE_ID);
  assert.equal(scene.id, "__imported__");
  assert.equal(scene.label, "Импорт · fixture.json");
  assert.equal(scene.sourceKind, "import");
  assert.equal(scene.network, normalizedNetwork);
  assert.deepEqual(scene.hints, {});
  assert.equal(Object.isFrozen(scene), true);
  assert.equal(Object.isFrozen(scene.hints), true);
  assert.equal(scene.sourceRepository, "repo://exact");
  assert.equal(scene.sourceSha, "Sha-With-Case");
}

{
  const normalizedNetwork = {
    links: [{ key: "only" }],
  };
  const scene = createImportedSceneFromText(
    JSON.stringify({
      schema,
      links: [{ key: "wire" }],
    }),
    "без-provenance.json",
    {
      parseManifest() {
        return {
          network: { links: [{ key: "parsed" }] },
        };
      },
      normalizeNetwork() {
        return normalizedNetwork;
      },
    },
  );

  assert.equal(scene.network, normalizedNetwork);
  assert.equal(
    Object.prototype.hasOwnProperty.call(scene, "sourceRepository"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(scene, "sourceSha"),
    false,
  );
}

{
  let parseCalls = 0;
  let normalizeCalls = 0;
  assert.throws(
    () => createImportedSceneFromText(
      "{ definitely not json",
      "broken.json",
      {
        parseManifest() {
          parseCalls += 1;
        },
        normalizeNetwork() {
          normalizeCalls += 1;
        },
      },
    ),
    /некорректный JSON:/,
  );
  assert.equal(parseCalls, 0);
  assert.equal(normalizeCalls, 0);
}

{
  const provenance = {
    sourceRepository: "repo://must-not-change",
    sourceSha: "sha://must-not-change",
  };
  const normalizedNetwork = {
    links: [{ key: "N" }],
  };

  const scene = createImportedSceneFromText(
    "{}",
    'name" with presentation text',
    {
      parseManifest() {
        return {
          network: { links: [{ key: "P" }] },
          ...provenance,
        };
      },
      normalizeNetwork() {
        return normalizedNetwork;
      },
    },
  );

  assert.equal(
    scene.label,
    'Импорт · name" with presentation text',
  );
  assert.equal(
    scene.sourceRepository,
    provenance.sourceRepository,
  );
  assert.equal(scene.sourceSha, provenance.sourceSha);
  assert.equal(scene.network, normalizedNetwork);
}

console.log("Web Lab shared input model executable contract: PASS");
