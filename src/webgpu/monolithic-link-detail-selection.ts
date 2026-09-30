export interface MonolithicLinkDetailSelectionInput3D {
  readonly linkCount: number;
  readonly detailCapacity: number;
  readonly viewProjection: readonly number[] | Float32Array;
  readonly centerAt: (linkIndex: number) => readonly number[];
  readonly selectedLink?: number | null;
  readonly hoveredLink?: number | null;
  readonly frustumMargin?: number;
}

export interface MonolithicLinkDetailSelection3D {
  readonly indices: readonly number[];
  readonly visibleCandidateCount: number;
  readonly selectedIncluded: boolean;
  readonly hoveredIncluded: boolean;
  readonly selectedPinned: boolean;
  readonly hoveredPinned: boolean;
  readonly culledLinkCount: number;
}

interface Candidate {
  readonly linkIndex: number;
  readonly visibleRank: 0 | 1;
  readonly screenRadiusSq: number;
  readonly depth: number;
}

function requireCount(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`invalid monolithic detail ${name}: ${String(value)}`);
  }
  return value;
}

function requireOptionalLink(
  value: number | null | undefined,
  linkCount: number,
  name: string,
): number | null {
  if (value === undefined || value === null || value < 0) return null;
  if (!Number.isSafeInteger(value) || value >= linkCount) {
    throw new Error(
      `invalid monolithic detail ${name}: ${String(value)}`,
    );
  }
  return value;
}

function requireMatrix(
  value: readonly number[] | Float32Array,
): readonly number[] | Float32Array {
  if (value.length !== 16) {
    throw new Error(
      `invalid monolithic detail viewProjection length: ${value.length}`,
    );
  }
  for (let index = 0; index < 16; index += 1) {
    if (!Number.isFinite(value[index])) {
      throw new Error(
        `non-finite monolithic detail viewProjection[${index}]`,
      );
    }
  }
  return value;
}

function requireMargin(value: number | undefined): number {
  const resolved = value ?? 0.15;
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > 4) {
    throw new Error(
      `invalid monolithic detail frustumMargin: ${String(value)}`,
    );
  }
  return resolved;
}

function candidateFor(
  matrix: readonly number[] | Float32Array,
  center: readonly number[],
  linkIndex: number,
  margin: number,
): Candidate {
  if (center.length < 3) {
    throw new Error(
      `invalid monolithic detail center[${linkIndex}] length: ${center.length}`,
    );
  }
  const x = center[0]!;
  const y = center[1]!;
  const z = center[2]!;
  if (![x, y, z].every(Number.isFinite)) {
    throw new Error(
      `non-finite monolithic detail center[${linkIndex}]`,
    );
  }

  const clipX =
    matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!;
  const clipY =
    matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!;
  const clipZ =
    matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!;
  const clipW =
    matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;

  if (!(clipW > 1e-9)) {
    return {
      linkIndex,
      visibleRank: 1,
      screenRadiusSq: Number.POSITIVE_INFINITY,
      depth: Number.POSITIVE_INFINITY,
    };
  }

  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  const ndcZ = clipZ / clipW;
  const visible =
    Number.isFinite(ndcX)
    && Number.isFinite(ndcY)
    && Number.isFinite(ndcZ)
    && Math.abs(ndcX) <= 1 + margin
    && Math.abs(ndcY) <= 1 + margin
    && ndcZ >= -1 - margin
    && ndcZ <= 1 + margin;

  return {
    linkIndex,
    visibleRank: visible ? 0 : 1,
    screenRadiusSq: visible
      ? ndcX * ndcX + ndcY * ndcY
      : Number.POSITIVE_INFINITY,
    depth: visible ? clipW : Number.POSITIVE_INFINITY,
  };
}

function compareCandidate(left: Candidate, right: Candidate): number {
  if (left.visibleRank !== right.visibleRank) {
    return left.visibleRank - right.visibleRank;
  }
  if (left.screenRadiusSq !== right.screenRadiusSq) {
    return left.screenRadiusSq < right.screenRadiusSq ? -1 : 1;
  }
  if (left.depth !== right.depth) {
    return left.depth < right.depth ? -1 : 1;
  }
  return left.linkIndex - right.linkIndex;
}

function siftWorstUp(heap: Candidate[], start: number): void {
  let index = start;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (compareCandidate(heap[index]!, heap[parent]!) <= 0) break;
    [heap[index], heap[parent]] = [heap[parent]!, heap[index]!];
    index = parent;
  }
}

function siftWorstDown(heap: Candidate[], start: number): void {
  let index = start;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let worst = index;
    if (
      left < heap.length
      && compareCandidate(heap[left]!, heap[worst]!) > 0
    ) {
      worst = left;
    }
    if (
      right < heap.length
      && compareCandidate(heap[right]!, heap[worst]!) > 0
    ) {
      worst = right;
    }
    if (worst === index) return;
    [heap[index], heap[worst]] = [heap[worst]!, heap[index]!];
    index = worst;
  }
}

function keepBestCandidate(
  heap: Candidate[],
  candidate: Candidate,
  capacity: number,
): void {
  if (capacity <= 0) return;
  if (heap.length < capacity) {
    heap.push(candidate);
    siftWorstUp(heap, heap.length - 1);
    return;
  }
  if (compareCandidate(candidate, heap[0]!) >= 0) return;
  heap[0] = candidate;
  siftWorstDown(heap, 0);
}

function pushUnique(
  target: number[],
  included: Set<number>,
  value: number | null,
  capacity: number,
): boolean {
  if (value === null || target.length >= capacity || included.has(value)) {
    return false;
  }
  included.add(value);
  target.push(value);
  return true;
}

/**
 * Selects the bounded set of semantic Links that receive full octahedral
 * carrier detail.
 *
 * The function is deterministic and allocation-bounded by detailCapacity:
 * it scans all semantic Links once and keeps only a max-heap of the best
 * visible candidates. Selected/hovered Links are reserved first.
 *
 * If the detail capacity covers the whole network, identity order is
 * preserved exactly so existing small-scene rendering remains unchanged.
 */
export function selectMonolithicLinkDetail3D(
  input: MonolithicLinkDetailSelectionInput3D,
): MonolithicLinkDetailSelection3D {
  const linkCount = requireCount(input.linkCount, "linkCount");
  const requestedCapacity = requireCount(
    input.detailCapacity,
    "detailCapacity",
  );
  const capacity = Math.min(linkCount, requestedCapacity);
  const matrix = requireMatrix(input.viewProjection);
  const margin = requireMargin(input.frustumMargin);
  const selected = requireOptionalLink(
    input.selectedLink,
    linkCount,
    "selectedLink",
  );
  const hovered = requireOptionalLink(
    input.hoveredLink,
    linkCount,
    "hoveredLink",
  );

  if (capacity >= linkCount) {
    let visibleCandidateCount = 0;
    for (let linkIndex = 0; linkIndex < linkCount; linkIndex += 1) {
      if (
        candidateFor(
          matrix,
          input.centerAt(linkIndex),
          linkIndex,
          margin,
        ).visibleRank === 0
      ) {
        visibleCandidateCount += 1;
      }
    }
    const indices = Object.freeze(
      Array.from({ length: linkCount }, (_value, index) => index),
    );
    return Object.freeze({
      indices,
      visibleCandidateCount,
      selectedIncluded: selected !== null,
      hoveredIncluded: hovered !== null,
      selectedPinned: false,
      hoveredPinned: false,
      culledLinkCount: 0,
    });
  }

  const forced: number[] = [];
  const included = new Set<number>();
  const selectedIncluded = pushUnique(
    forced,
    included,
    selected,
    capacity,
  );
  const hoveredIncluded = pushUnique(
    forced,
    included,
    hovered,
    capacity,
  );

  let visibleCandidateCount = 0;
  const heap: Candidate[] = [];
  const candidateCapacity = Math.max(0, capacity - forced.length);

  for (let linkIndex = 0; linkIndex < linkCount; linkIndex += 1) {
    const candidate = candidateFor(
      matrix,
      input.centerAt(linkIndex),
      linkIndex,
      margin,
    );
    if (candidate.visibleRank === 0) visibleCandidateCount += 1;
    if (included.has(linkIndex)) continue;
    keepBestCandidate(heap, candidate, candidateCapacity);
  }

  heap.sort(compareCandidate);
  const indices = Object.freeze([
    ...forced,
    ...heap.map((candidate) => candidate.linkIndex),
  ]);

  return Object.freeze({
    indices,
    visibleCandidateCount,
    selectedIncluded,
    hoveredIncluded,
    selectedPinned:
      selectedIncluded
      && selected !== null
      && !heap.some((candidate) => candidate.linkIndex === selected),
    hoveredPinned:
      hoveredIncluded
      && hovered !== null
      && hovered !== selected
      && !heap.some((candidate) => candidate.linkIndex === hovered),
    culledLinkCount: linkCount - indices.length,
  });
}
