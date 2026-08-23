export type VisualKey = string;

/**
 * Renderer-neutral presentation of one MTS Link.
 *
 * The keys are presentation references only. They are not semantic Link identity,
 * runtime handles, proof identity, or a third "center node" ontology.
 */
export interface VisualLink {
  readonly key: VisualKey;
  readonly startKey: VisualKey;
  readonly endKey: VisualKey;
  readonly label?: string;
  readonly tags?: readonly string[];
}

export interface VisualLinkNetwork {
  readonly links: readonly VisualLink[];
}

export type VisualNetworkErrorCode =
  | "empty-key"
  | "duplicate-key"
  | "empty-start"
  | "empty-end"
  | "missing-start"
  | "missing-end";

export class VisualNetworkError extends Error {
  readonly code: VisualNetworkErrorCode;
  readonly key: VisualKey;
  readonly reference?: VisualKey;

  constructor(code: VisualNetworkErrorCode, key: VisualKey, reference?: VisualKey) {
    const suffix = reference === undefined ? "" : `: ${reference}`;
    super(`${code} for ${key}${suffix}`);
    this.name = "VisualNetworkError";
    this.code = code;
    this.key = key;
    if (reference !== undefined) this.reference = reference;
  }
}

function isBlank(key: VisualKey): boolean {
  return key.trim().length === 0;
}

/**
 * Validate only presentation topology.
 *
 * Cycles and self-links are intentionally legal. In particular this function must
 * not impose an ordinary acyclic graph model on recursive MTS Link structure.
 */
export function validateVisualLinkNetwork(network: VisualLinkNetwork): void {
  const keys = new Set<VisualKey>();

  for (const link of network.links) {
    if (isBlank(link.key)) throw new VisualNetworkError("empty-key", link.key);
    if (keys.has(link.key)) throw new VisualNetworkError("duplicate-key", link.key);
    keys.add(link.key);
  }

  for (const link of network.links) {
    if (isBlank(link.startKey)) {
      throw new VisualNetworkError("empty-start", link.key, link.startKey);
    }
    if (isBlank(link.endKey)) {
      throw new VisualNetworkError("empty-end", link.key, link.endKey);
    }
    if (!keys.has(link.startKey)) {
      throw new VisualNetworkError("missing-start", link.key, link.startKey);
    }
    if (!keys.has(link.endKey)) {
      throw new VisualNetworkError("missing-end", link.key, link.endKey);
    }
  }
}

function cloneVisualLink(link: VisualLink): VisualLink {
  return Object.freeze({
    key: link.key,
    startKey: link.startKey,
    endKey: link.endKey,
    ...(link.label === undefined ? {} : { label: link.label }),
    ...(link.tags === undefined ? {} : { tags: Object.freeze([...link.tags]) }),
  });
}

/**
 * Produce a deterministic immutable presentation snapshot.
 *
 * Sorting by VisualKey is only presentation normalization. It is deliberately not
 * named or treated as semantic canonicalization of MTS Links.
 */
export function normalizeVisualLinkNetwork(network: VisualLinkNetwork): VisualLinkNetwork {
  validateVisualLinkNetwork(network);
  const links = [...network.links]
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .map(cloneVisualLink);
  return Object.freeze({ links: Object.freeze(links) });
}

export * from "./presentation.js";
export * from "./blueprint-geometry.js";
export * from "./blueprint-svg.js";
export * from "./blueprint-interaction.js";
export * from "./geometry3d.js";
export * from "./physics3d.js";
export * from "./live-physics3d.js";
