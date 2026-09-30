import type {
  MonolithicLinkWebGpuTopology3D,
} from "./monolithic-link-compute.js";

export type MonolithicLinkBenchmarkProfile3D =
  | "chain"
  | "hub-heavy"
  | "mixed"
  | "self-incidence"
  | "branching";

export interface MonolithicLinkBenchmarkTopologyOptions3D {
  readonly linkCount: number;
  readonly profile: MonolithicLinkBenchmarkProfile3D;
  readonly seed?: number;
}

export interface MonolithicLinkBenchmarkTopology3D
extends MonolithicLinkWebGpuTopology3D {
  readonly profile: MonolithicLinkBenchmarkProfile3D;
  readonly seed: number;
  readonly inputTopologyBytes: number;
  readonly startSelfCount: number;
  readonly endSelfCount: number;
}

function requireLinkCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `invalid monolithic benchmark linkCount: ${String(value)}`,
    );
  }
  if (value > 0xffff_ffff) {
    throw new Error(
      `monolithic benchmark linkCount exceeds Uint32 index space: ${value}`,
    );
  }
  return value;
}

function requireSeed(value: number | undefined): number {
  const resolved = value ?? 0x4d545356;
  if (!Number.isSafeInteger(resolved)) {
    throw new Error(
      `invalid monolithic benchmark seed: ${String(value)}`,
    );
  }
  return resolved >>> 0;
}

function mix32(value: number): number {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function target(
  link: number,
  salt: number,
  seed: number,
  linkCount: number,
): number {
  if (linkCount === 0) return 0;
  return mix32(
    (link >>> 0)
      ^ seed
      ^ Math.imul(salt, 0x9e3779b1),
  ) % linkCount;
}

function writeChain(
  startIndices: Uint32Array,
  endIndices: Uint32Array,
): void {
  const count = startIndices.length;
  for (let link = 0; link < count; link += 1) {
    startIndices[link] = link === 0 ? 0 : link - 1;
    endIndices[link] = link + 1 < count ? link + 1 : link;
  }
}

function writeHubHeavy(
  startIndices: Uint32Array,
  endIndices: Uint32Array,
  seed: number,
): void {
  const count = startIndices.length;
  if (count === 0) return;
  const hub = seed % count;
  for (let link = 0; link < count; link += 1) {
    startIndices[link] = hub;
    endIndices[link] =
      link === hub
        ? hub
        : target(link, 17, seed, count);
  }
}

function writeMixed(
  startIndices: Uint32Array,
  endIndices: Uint32Array,
  seed: number,
): void {
  const count = startIndices.length;
  for (let link = 0; link < count; link += 1) {
    const mode = mix32(link ^ seed) & 7;
    startIndices[link] =
      mode === 0
        ? link
        : mode <= 2 && link > 0
          ? link - 1
          : target(link, 31, seed, count);
    endIndices[link] =
      mode === 1
        ? link
        : mode === 3 && link + 1 < count
          ? link + 1
          : target(link, 47, seed, count);
  }
}

function writeSelfIncidence(
  startIndices: Uint32Array,
  endIndices: Uint32Array,
  seed: number,
): void {
  const count = startIndices.length;
  for (let link = 0; link < count; link += 1) {
    const pattern = mix32(link ^ seed) & 3;
    startIndices[link] =
      pattern === 0 || pattern === 2
        ? link
        : target(link, 59, seed, count);
    endIndices[link] =
      pattern === 1 || pattern === 2
        ? link
        : target(link, 71, seed, count);
  }
}

function writeBranching(
  startIndices: Uint32Array,
  endIndices: Uint32Array,
): void {
  const count = startIndices.length;
  for (let link = 0; link < count; link += 1) {
    startIndices[link] =
      link === 0 ? 0 : Math.floor((link - 1) / 2);
    const firstChild = link * 2 + 1;
    endIndices[link] =
      firstChild < count ? firstChild : link;
  }
}

/**
 * Generate deterministic indexed Link topology without presentation keys.
 *
 * The returned persistent input footprint is exactly 8 * LinkCount bytes:
 * START and END are one Uint32 each. Reverse incidence is intentionally built
 * later by the production WebGPU compute factory so benchmarks exercise the
 * same topology packing path as ordinary Mechanical execution.
 */
export function createMonolithicLinkBenchmarkTopology3D(
  options: MonolithicLinkBenchmarkTopologyOptions3D,
): MonolithicLinkBenchmarkTopology3D {
  const linkCount = requireLinkCount(options.linkCount);
  const seed = requireSeed(options.seed);
  const startIndices = new Uint32Array(linkCount);
  const endIndices = new Uint32Array(linkCount);

  switch (options.profile) {
    case "chain":
      writeChain(startIndices, endIndices);
      break;
    case "hub-heavy":
      writeHubHeavy(startIndices, endIndices, seed);
      break;
    case "mixed":
      writeMixed(startIndices, endIndices, seed);
      break;
    case "self-incidence":
      writeSelfIncidence(startIndices, endIndices, seed);
      break;
    case "branching":
      writeBranching(startIndices, endIndices);
      break;
    default: {
      const unreachable: never = options.profile;
      throw new Error(
        `unsupported monolithic benchmark profile: ${String(unreachable)}`,
      );
    }
  }

  let startSelfCount = 0;
  let endSelfCount = 0;
  for (let link = 0; link < linkCount; link += 1) {
    if (startIndices[link] === link) startSelfCount += 1;
    if (endIndices[link] === link) endSelfCount += 1;
  }

  return Object.freeze({
    linkCount,
    startIndices,
    endIndices,
    profile: options.profile,
    seed,
    inputTopologyBytes:
      startIndices.byteLength + endIndices.byteLength,
    startSelfCount,
    endSelfCount,
  });
}
