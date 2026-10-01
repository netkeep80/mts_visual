export const IMPORTED_SCENE_ID = "__imported__";

export function createSceneInputManifest(scene, schema) {
  return Object.freeze({
    schema,
    ...(scene.sourceRepository === undefined
      ? {}
      : { sourceRepository: scene.sourceRepository }),
    ...(scene.sourceSha === undefined
      ? {}
      : { sourceSha: scene.sourceSha }),
    links: scene.network.links,
  });
}

export function serializeSceneInputManifest(scene, schema) {
  return JSON.stringify(
    createSceneInputManifest(scene, schema),
    null,
    2,
  ) + "\n";
}

export function createImportedSceneFromText(
  text,
  sourceLabel,
  {
    parseManifest,
    normalizeNetwork,
  },
) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `некорректный JSON: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }

  const parsed = parseManifest(raw);
  const network = normalizeNetwork(parsed.network);

  return Object.freeze({
    id: IMPORTED_SCENE_ID,
    label: `Импорт · ${sourceLabel}`,
    network,
    hints: Object.freeze({}),
    sourceKind: "import",
    ...(parsed.sourceRepository === undefined
      ? {}
      : { sourceRepository: parsed.sourceRepository }),
    ...(parsed.sourceSha === undefined
      ? {}
      : { sourceSha: parsed.sourceSha }),
  });
}
