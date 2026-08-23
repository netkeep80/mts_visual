import type { VisualKey } from "./index.js";

export interface VisualHaloPresentation {
  readonly color: number;
  readonly scale?: number;
  readonly opacity?: number;
}

export interface VisualLinkPresentation {
  readonly key: VisualKey;
  readonly visible?: boolean;
  readonly emphasis?: number;
  readonly selected?: boolean;
  readonly labelVisible?: boolean;
  readonly halo?: VisualHaloPresentation;
}

export interface VisualPresentationState {
  readonly links: readonly VisualLinkPresentation[];
}

export interface VisualPresentationKeySpace {
  readonly links: readonly Readonly<{ key: VisualKey }>[];
}

export type VisualPresentationErrorCode =
  | "empty-key"
  | "unknown-key"
  | "duplicate-key"
  | "invalid-emphasis"
  | "invalid-halo-scale"
  | "invalid-halo-opacity"
  | "invalid-halo-color";

export class VisualPresentationError extends Error {
  readonly code: VisualPresentationErrorCode;
  readonly key: VisualKey;

  constructor(code: VisualPresentationErrorCode, key: VisualKey, message: string) {
    super(message);
    this.name = "VisualPresentationError";
    this.code = code;
    this.key = key;
  }
}

function fail(code: VisualPresentationErrorCode, key: VisualKey, message: string): never {
  throw new VisualPresentationError(code, key, message);
}

function validateHalo(key: VisualKey, halo: VisualHaloPresentation): void {
  if (!Number.isInteger(halo.color) || halo.color < 0 || halo.color > 0xffffff) {
    fail("invalid-halo-color", key, `Presentation halo color for ${key} must be an integer in 0x000000..0xffffff.`);
  }
  if (halo.scale !== undefined && (!Number.isFinite(halo.scale) || halo.scale <= 0)) {
    fail("invalid-halo-scale", key, `Presentation halo scale for ${key} must be finite and > 0.`);
  }
  if (
    halo.opacity !== undefined &&
    (!Number.isFinite(halo.opacity) || halo.opacity < 0 || halo.opacity > 1)
  ) {
    fail("invalid-halo-opacity", key, `Presentation halo opacity for ${key} must be finite and within 0..1.`);
  }
}

export function validateVisualPresentationState(
  keySpace: VisualPresentationKeySpace,
  state: VisualPresentationState,
): void {
  const knownKeys = new Set(keySpace.links.map((link) => link.key));
  const seenKeys = new Set<VisualKey>();

  for (const entry of state.links) {
    if (entry.key.trim().length === 0) {
      fail("empty-key", entry.key, "Presentation key must not be blank.");
    }
    if (!knownKeys.has(entry.key)) {
      fail("unknown-key", entry.key, `Presentation key ${entry.key} does not exist in the visual network.`);
    }
    if (seenKeys.has(entry.key)) {
      fail("duplicate-key", entry.key, `Presentation key ${entry.key} occurs more than once.`);
    }
    seenKeys.add(entry.key);

    if (entry.emphasis !== undefined && (!Number.isFinite(entry.emphasis) || entry.emphasis <= 0)) {
      fail("invalid-emphasis", entry.key, `Presentation emphasis for ${entry.key} must be finite and > 0.`);
    }
    if (entry.halo !== undefined) validateHalo(entry.key, entry.halo);
  }
}

function normalizeHalo(halo: VisualHaloPresentation): VisualHaloPresentation {
  return Object.freeze({
    color: halo.color,
    ...(halo.scale === undefined ? {} : { scale: halo.scale }),
    ...(halo.opacity === undefined ? {} : { opacity: halo.opacity }),
  });
}

function normalizeEntry(entry: VisualLinkPresentation): VisualLinkPresentation {
  return Object.freeze({
    key: entry.key,
    ...(entry.visible === undefined ? {} : { visible: entry.visible }),
    ...(entry.emphasis === undefined ? {} : { emphasis: entry.emphasis }),
    ...(entry.selected === undefined ? {} : { selected: entry.selected }),
    ...(entry.labelVisible === undefined ? {} : { labelVisible: entry.labelVisible }),
    ...(entry.halo === undefined ? {} : { halo: normalizeHalo(entry.halo) }),
  });
}

export function normalizeVisualPresentationState(
  keySpace: VisualPresentationKeySpace,
  state: VisualPresentationState,
): VisualPresentationState {
  validateVisualPresentationState(keySpace, state);
  const links = state.links
    .map(normalizeEntry)
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  return Object.freeze({ links: Object.freeze(links) });
}
