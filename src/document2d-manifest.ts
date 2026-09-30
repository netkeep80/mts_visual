import {
  normalizeVisualLinkNetwork,
  type VisualLink,
  type VisualLinkNetwork,
} from "./index.js";
import type {
  Document2DProfile,
  Document2DQuality,
  Document2DSeedStrategy,
} from "./document2d.js";

export const DOCUMENT2D_INPUT_SCHEMA = "mts-visual-document-input/v1" as const;
export const DOCUMENT2D_RENDER_MANIFEST_SCHEMA = "mts-visual-document-render/v1" as const;

export interface Document2DInputManifest {
  readonly schema: typeof DOCUMENT2D_INPUT_SCHEMA;
  readonly network: VisualLinkNetwork;
  readonly sourceRepository?: string;
  readonly sourceSha?: string;
}

export interface Document2DRenderLayoutOptions {
  readonly strategy: Document2DSeedStrategy;
  readonly rootKey: string | null;
}

export interface Document2DRenderManifest {
  readonly schema: typeof DOCUMENT2D_RENDER_MANIFEST_SCHEMA;
  readonly inputPath: string;
  readonly inputDigest: string;
  readonly sourceRepository: string | null;
  readonly sourceSha: string | null;
  readonly rendererVersion: string;
  readonly rendererSha: string;
  readonly profile: Document2DProfile;
  readonly format: "svg";
  readonly layoutOptions: Document2DRenderLayoutOptions;
  readonly seedStrategy: Exclude<Document2DSeedStrategy, "auto">;
  readonly quality: Document2DQuality;
  readonly outputPath: string;
  readonly outputDigest: string;
}

export type Document2DManifestErrorCode =
  | "invalid-manifest"
  | "invalid-schema"
  | "invalid-source"
  | "invalid-digest"
  | "invalid-renderer-sha";

export class Document2DManifestError extends Error {
  readonly code: Document2DManifestErrorCode;
  readonly detail?: string;

  constructor(code: Document2DManifestErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "Document2DManifestError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export function parseDocument2DInputManifest(value: unknown): Document2DInputManifest {
  if (!isRecord(value)) throw new Document2DManifestError("invalid-manifest", "root");
  if (value.schema !== DOCUMENT2D_INPUT_SCHEMA) {
    throw new Document2DManifestError("invalid-schema", String(value.schema));
  }
  if (!Array.isArray(value.links)) {
    throw new Document2DManifestError("invalid-manifest", "links");
  }

  const links: VisualLink[] = value.links.map((entry, index) => parseLink(entry, index));
  const network = normalizeVisualLinkNetwork({ links });
  const sourceRepository = optionalNonBlankString(value.sourceRepository, "sourceRepository");
  const sourceSha = optionalGitSha(value.sourceSha, "sourceSha");

  return Object.freeze({
    schema: DOCUMENT2D_INPUT_SCHEMA,
    network,
    ...(sourceRepository === undefined ? {} : { sourceRepository }),
    ...(sourceSha === undefined ? {} : { sourceSha }),
  });
}

export function createDocument2DRenderManifest(input: Readonly<{
  inputPath: string;
  inputDigest: string;
  sourceRepository?: string;
  sourceSha?: string;
  rendererVersion: string;
  rendererSha: string;
  profile: Document2DProfile;
  layoutOptions: Document2DRenderLayoutOptions;
  seedStrategy: Exclude<Document2DSeedStrategy, "auto">;
  quality: Document2DQuality;
  outputPath: string;
  outputDigest: string;
}>): Document2DRenderManifest {
  const inputPath = nonBlankString(input.inputPath, "inputPath");
  const outputPath = nonBlankString(input.outputPath, "outputPath");
  const rendererVersion = nonBlankString(input.rendererVersion, "rendererVersion");
  const inputDigest = sha256(input.inputDigest, "inputDigest");
  const outputDigest = sha256(input.outputDigest, "outputDigest");
  const rendererSha = gitSha(input.rendererSha, "rendererSha");
  const sourceRepository = optionalNonBlankString(input.sourceRepository, "sourceRepository");
  const sourceSha = optionalGitSha(input.sourceSha, "sourceSha");

  if (!["formal", "article", "debug"].includes(input.profile)) {
    throw new Document2DManifestError("invalid-manifest", "profile");
  }
  if (!["canonical", "radial", "layered", "auto"].includes(input.layoutOptions.strategy)) {
    throw new Document2DManifestError("invalid-manifest", "layoutOptions.strategy");
  }
  if (input.layoutOptions.rootKey !== null
    && (typeof input.layoutOptions.rootKey !== "string"
      || input.layoutOptions.rootKey.trim().length === 0)) {
    throw new Document2DManifestError("invalid-manifest", "layoutOptions.rootKey");
  }
  if (!["canonical", "radial", "layered"].includes(input.seedStrategy)) {
    throw new Document2DManifestError("invalid-manifest", "seedStrategy");
  }

  return Object.freeze({
    schema: DOCUMENT2D_RENDER_MANIFEST_SCHEMA,
    inputPath,
    inputDigest,
    sourceRepository: sourceRepository ?? null,
    sourceSha: sourceSha ?? null,
    rendererVersion,
    rendererSha,
    profile: input.profile,
    format: "svg",
    layoutOptions: Object.freeze({
      strategy: input.layoutOptions.strategy,
      rootKey: input.layoutOptions.rootKey,
    }),
    seedStrategy: input.seedStrategy,
    quality: Object.freeze({ ...input.quality }),
    outputPath,
    outputDigest,
  });
}

function parseLink(value: unknown, index: number): VisualLink {
  if (!isRecord(value)) throw new Document2DManifestError("invalid-manifest", `links[${index}]`);
  const key = nonBlankString(value.key, `links[${index}].key`);
  const startKey = nonBlankString(value.startKey, `links[${index}].startKey`);
  const endKey = nonBlankString(value.endKey, `links[${index}].endKey`);
  const label = optionalString(value.label, `links[${index}].label`);
  const tags = optionalTags(value.tags, `links[${index}].tags`);
  return Object.freeze({
    key,
    startKey,
    endKey,
    ...(label === undefined ? {} : { label }),
    ...(tags === undefined ? {} : { tags }),
  });
}

function optionalTags(value: unknown, detail: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    throw new Document2DManifestError("invalid-manifest", detail);
  }
  return Object.freeze([...value]);
}

function optionalString(value: unknown, detail: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Document2DManifestError("invalid-manifest", detail);
  return value;
}

function optionalNonBlankString(value: unknown, detail: string): string | undefined {
  if (value === undefined) return undefined;
  return nonBlankString(value, detail);
}

function nonBlankString(value: unknown, detail: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Document2DManifestError("invalid-manifest", detail);
  }
  return value;
}

function optionalGitSha(value: unknown, detail: string): string | undefined {
  if (value === undefined) return undefined;
  return gitSha(value, detail);
}

function gitSha(value: unknown, detail: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40,64}$/i.test(value)) {
    throw new Document2DManifestError("invalid-renderer-sha", detail);
  }
  return value.toLowerCase();
}

function sha256(value: unknown, detail: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new Document2DManifestError("invalid-digest", detail);
  }
  return value.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
