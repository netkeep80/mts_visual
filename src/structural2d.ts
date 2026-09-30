import {
  normalizeVisualLinkNetwork,
  type VisualKey,
  type VisualLinkNetwork,
} from "./index.js";
import type { Point2D } from "./blueprint-geometry.js";

export type Structural2DArcRole = "start" | "end";

export interface Structural2DOptions {
  readonly rootKey?: VisualKey;
  readonly layerSpacing?: number;
  readonly minimumNodeSpacing?: number;
  readonly nodeRadius?: number;
  readonly arcBend?: number;
  readonly loopRadius?: number;
  readonly crossingPasses?: number;
  readonly crossingEvaluations?: number;
  readonly optimizeCrossings?: boolean;
}

export interface Structural2DComponent {
  readonly id: string;
  readonly members: readonly VisualKey[];
  readonly depth: number;
  readonly dependencyComponents: readonly string[];
  readonly root: boolean;
}

export interface Structural2DPosition {
  readonly key: VisualKey;
  readonly point: Point2D;
  readonly depth: number;
  readonly componentId: string;
}

export interface Structural2DArc {
  readonly id: string;
  readonly linkKey: VisualKey;
  readonly role: Structural2DArcRole;
  readonly sourceKey: VisualKey;
  readonly targetKey: VisualKey;
  readonly points: readonly Point2D[];
}

export interface Structural2DCrossingAnalysis {
  readonly count: number;
  readonly hotNodeCounts: Readonly<Record<VisualKey, number>>;
}

export interface Structural2DMetrics {
  readonly crossingsBefore: number;
  readonly crossingsAfter: number;
  readonly evaluations: number;
  readonly passes: number;
  readonly changed: boolean;
}

export interface Structural2DBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export interface Structural2DLayout {
  readonly positions: readonly Structural2DPosition[];
  readonly components: readonly Structural2DComponent[];
  readonly arcs: readonly Structural2DArc[];
  readonly metrics: Structural2DMetrics;
  readonly bounds: Structural2DBounds;
  readonly viewBox: string;
}

export type Structural2DErrorCode = "invalid-option" | "unknown-root";

export class Structural2DError extends Error {
  readonly code: Structural2DErrorCode;
  readonly detail?: string;

  constructor(code: Structural2DErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "Structural2DError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

interface ResolvedStructural2DOptions {
  readonly rootKey?: VisualKey;
  readonly layerSpacing: number;
  readonly minimumNodeSpacing: number;
  readonly nodeRadius: number;
  readonly arcBend: number;
  readonly loopRadius: number;
  readonly crossingPasses: number;
  readonly crossingEvaluations: number;
  readonly optimizeCrossings: boolean;
}

interface StructuralAnalysis {
  readonly components: readonly Structural2DComponent[];
  readonly depthByKey: ReadonlyMap<VisualKey, number>;
  readonly componentIdByKey: ReadonlyMap<VisualKey, string>;
}

const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;
const DEFAULTS = Object.freeze({
  layerSpacing: 112,
  minimumNodeSpacing: 72,
  nodeRadius: 13,
  arcBend: 28,
  loopRadius: 30,
  crossingPasses: 5,
  crossingEvaluations: 240,
  optimizeCrossings: true,
});

export function layoutStructural2D(
  network: VisualLinkNetwork,
  options: Structural2DOptions = {},
): Structural2DLayout {
  const normalized = normalizeVisualLinkNetwork(network);
  const resolved = resolveOptions(normalized, options);
  const analysis = analyzeStructure(normalized, resolved.rootKey);
  const initialPositions = createRadialPositions(normalized, analysis, resolved);
  const optimized = optimizePositions(
    normalized,
    initialPositions,
    analysis,
    resolved,
  );
  const arcs = buildStructuralArcs(normalized, optimized.positions, resolved);
  const positions = normalized.links.map((link) => freezePosition(
    link.key,
    optimized.positions.get(link.key)!,
    analysis.depthByKey.get(link.key)!,
    analysis.componentIdByKey.get(link.key)!,
  ));
  const bounds = structuralBounds(positions, arcs, resolved.nodeRadius);
  return Object.freeze({
    positions: Object.freeze(positions),
    components: analysis.components,
    arcs,
    metrics: Object.freeze({
      crossingsBefore: optimized.crossingsBefore,
      crossingsAfter: optimized.crossingsAfter,
      evaluations: optimized.evaluations,
      passes: optimized.passes,
      changed: optimized.changed,
    }),
    bounds,
    viewBox: [
      numberText(bounds.minX),
      numberText(bounds.minY),
      numberText(bounds.width),
      numberText(bounds.height),
    ].join(" "),
  });
}

export function analyzeStructural2DCrossings(
  arcs: readonly Structural2DArc[],
): Structural2DCrossingAnalysis {
  const hot: Record<VisualKey, number> = {};
  let count = 0;
  for (let leftIndex = 0; leftIndex < arcs.length; leftIndex += 1) {
    const left = arcs[leftIndex]!;
    const leftBounds = pointsBounds(left.points);
    for (let rightIndex = leftIndex + 1; rightIndex < arcs.length; rightIndex += 1) {
      const right = arcs[rightIndex]!;
      if (shareSemanticEndpoint(left, right)) continue;
      const rightBounds = pointsBounds(right.points);
      if (!boundsOverlap(leftBounds, rightBounds)) continue;
      if (!pathsProperlyIntersect(left.points, right.points)) continue;
      count += 1;
      for (const key of new Set([
        left.sourceKey,
        left.targetKey,
        right.sourceKey,
        right.targetKey,
      ])) {
        hot[key] = (hot[key] ?? 0) + 1;
      }
    }
  }
  return Object.freeze({
    count,
    hotNodeCounts: Object.freeze({ ...hot }),
  });
}

export function serializeStructural2DSvg(
  network: VisualLinkNetwork,
  layout: Structural2DLayout,
): string {
  const normalized = normalizeVisualLinkNetwork(network);
  const positionByKey = new Map(layout.positions.map((position) => [position.key, position] as const));
  const linkByKey = new Map(normalized.links.map((link) => [link.key, link] as const));
  if (positionByKey.size !== normalized.links.length || layout.arcs.length !== normalized.links.length * 2) {
    throw new Structural2DError("invalid-option", "layout/network mismatch");
  }

  const arcMarkup = layout.arcs.map((arc) => {
    const d = arc.points.map((point, index) =>
      `${index === 0 ? "M" : "L"} ${numberText(point.x)} ${numberText(point.y)}`
    ).join(" ");
    const roleClass = arc.role === "start" ? "structural-start" : "structural-end";
    const marker = arc.role === "start" ? "url(#structural-start-arrow)" : "url(#structural-end-arrow)";
    return `<path data-role="structural-arc" data-arc-role="${arc.role}" data-link-key="${escapeXml(arc.linkKey)}" data-source-key="${escapeXml(arc.sourceKey)}" data-target-key="${escapeXml(arc.targetKey)}" class="${roleClass}" d="${d}" marker-end="${marker}"/>`;
  }).join("");

  const nodeMarkup = normalized.links.map((link) => {
    const position = positionByKey.get(link.key);
    if (!position) throw new Structural2DError("invalid-option", `missing position: ${link.key}`);
    const label = link.label ?? link.key;
    return [
      `<g data-role="structural-node" data-link-key="${escapeXml(link.key)}" transform="translate(${numberText(position.point.x)} ${numberText(position.point.y)})">`,
      `<circle r="13"/>`,
      `<text data-role="structural-label" x="18" y="4">${escapeXml(label)}</text>`,
      `</g>`,
    ].join("");
  }).join("");

  // Ensure every layout key is known to the supplied network.
  for (const position of layout.positions) {
    if (!linkByKey.has(position.key)) {
      throw new Structural2DError("invalid-option", `unknown layout key: ${position.key}`);
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${layout.viewBox}" role="img" aria-label="Structural 2D">`,
    "<defs>",
    '<marker id="structural-start-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#ff6b6b"/></marker>',
    '<marker id="structural-end-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#68a0ff"/></marker>',
    "</defs>",
    '<g fill="none" stroke-linecap="round" stroke-linejoin="round">',
    arcMarkup,
    "</g>",
    '<g class="structural-nodes">',
    nodeMarkup,
    "</g>",
    "</svg>",
  ].join("");
}

function resolveOptions(
  network: VisualLinkNetwork,
  options: Structural2DOptions,
): ResolvedStructural2DOptions {
  const rootKey = options.rootKey;
  if (rootKey !== undefined && !network.links.some((link) => link.key === rootKey)) {
    throw new Structural2DError("unknown-root", rootKey);
  }

  const positive = (name: string, value: number | undefined, fallback: number): number => {
    const resolved = value ?? fallback;
    if (!Number.isFinite(resolved) || resolved <= 0) {
      throw new Structural2DError("invalid-option", name);
    }
    return resolved;
  };
  const integer = (name: string, value: number | undefined, fallback: number): number => {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < 0) {
      throw new Structural2DError("invalid-option", name);
    }
    return resolved;
  };

  return Object.freeze({
    ...(rootKey === undefined ? {} : { rootKey }),
    layerSpacing: positive("layerSpacing", options.layerSpacing, DEFAULTS.layerSpacing),
    minimumNodeSpacing: positive(
      "minimumNodeSpacing",
      options.minimumNodeSpacing,
      DEFAULTS.minimumNodeSpacing,
    ),
    nodeRadius: positive("nodeRadius", options.nodeRadius, DEFAULTS.nodeRadius),
    arcBend: positive("arcBend", options.arcBend, DEFAULTS.arcBend),
    loopRadius: positive("loopRadius", options.loopRadius, DEFAULTS.loopRadius),
    crossingPasses: integer("crossingPasses", options.crossingPasses, DEFAULTS.crossingPasses),
    crossingEvaluations: integer(
      "crossingEvaluations",
      options.crossingEvaluations,
      DEFAULTS.crossingEvaluations,
    ),
    optimizeCrossings: options.optimizeCrossings ?? DEFAULTS.optimizeCrossings,
  });
}

function analyzeStructure(
  network: VisualLinkNetwork,
  rootKey: VisualKey | undefined,
): StructuralAnalysis {
  const ids = network.links.map((link) => link.key);
  const known = new Set(ids);
  const dependencies = new Map<VisualKey, readonly VisualKey[]>();
  for (const link of network.links) {
    dependencies.set(
      link.key,
      Object.freeze([...new Set([link.startKey, link.endKey].filter((key) => known.has(key)))].sort()),
    );
  }

  const { components, componentOf } = stronglyConnectedComponents(ids, dependencies);
  const componentDependencies = components.map(() => new Set<number>());
  components.forEach((members, componentIndex) => {
    for (const key of members) {
      for (const dependency of dependencies.get(key) ?? []) {
        const dependencyComponent = componentOf.get(dependency);
        if (dependencyComponent !== undefined && dependencyComponent !== componentIndex) {
          componentDependencies[componentIndex]!.add(dependencyComponent);
        }
      }
    }
  });

  const rootComponent = rootKey === undefined ? undefined : componentOf.get(rootKey);
  const componentDepths = new Array<number | undefined>(components.length);
  const depthOf = (componentIndex: number): number => {
    const cached = componentDepths[componentIndex];
    if (cached !== undefined) return cached;
    if (rootComponent !== undefined && componentIndex === rootComponent) {
      componentDepths[componentIndex] = 0;
      return 0;
    }
    const dependenciesForComponent = [...componentDependencies[componentIndex]!].sort((a, b) => a - b);
    let depth: number;
    if (dependenciesForComponent.length === 0) {
      depth = rootComponent === undefined ? 0 : 1;
    } else {
      depth = 1 + Math.max(...dependenciesForComponent.map(depthOf));
    }
    componentDepths[componentIndex] = depth;
    return depth;
  };
  for (let index = 0; index < components.length; index += 1) depthOf(index);

  const depthByKey = new Map<VisualKey, number>();
  const componentIdByKey = new Map<VisualKey, string>();
  const resultComponents = components.map((members, index): Structural2DComponent => {
    const id = members.join("|");
    const depth = componentDepths[index]!;
    for (const key of members) {
      depthByKey.set(key, depth);
      componentIdByKey.set(key, id);
    }
    return Object.freeze({
      id,
      members: Object.freeze([...members]),
      depth,
      dependencyComponents: Object.freeze([...componentDependencies[index]!]
        .map((dependencyIndex) => components[dependencyIndex]!.join("|"))
        .sort()),
      root: index === rootComponent,
    });
  });

  return {
    components: Object.freeze(resultComponents),
    depthByKey,
    componentIdByKey,
  };
}

function stronglyConnectedComponents(
  ids: readonly VisualKey[],
  adjacency: ReadonlyMap<VisualKey, readonly VisualKey[]>,
): Readonly<{
  components: readonly (readonly VisualKey[])[];
  componentOf: ReadonlyMap<VisualKey, number>;
}> {
  let nextIndex = 0;
  const indexById = new Map<VisualKey, number>();
  const lowLinkById = new Map<VisualKey, number>();
  const stack: VisualKey[] = [];
  const onStack = new Set<VisualKey>();
  const rawComponents: VisualKey[][] = [];

  const visit = (id: VisualKey): void => {
    indexById.set(id, nextIndex);
    lowLinkById.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);

    for (const dependency of adjacency.get(id) ?? []) {
      if (!indexById.has(dependency)) {
        visit(dependency);
        lowLinkById.set(
          id,
          Math.min(lowLinkById.get(id)!, lowLinkById.get(dependency)!),
        );
      } else if (onStack.has(dependency)) {
        lowLinkById.set(
          id,
          Math.min(lowLinkById.get(id)!, indexById.get(dependency)!),
        );
      }
    }

    if (lowLinkById.get(id) !== indexById.get(id)) return;
    const members: VisualKey[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      members.push(member);
      if (member === id) break;
    }
    members.sort();
    rawComponents.push(members);
  };

  for (const id of [...ids].sort()) {
    if (!indexById.has(id)) visit(id);
  }
  rawComponents.sort((left, right) => compareKey(left[0]!, right[0]!));
  const componentOf = new Map<VisualKey, number>();
  rawComponents.forEach((members, index) => {
    for (const key of members) componentOf.set(key, index);
  });
  return Object.freeze({
    components: Object.freeze(rawComponents.map((members) => Object.freeze([...members]))),
    componentOf,
  });
}

function createRadialPositions(
  network: VisualLinkNetwork,
  analysis: StructuralAnalysis,
  options: ResolvedStructural2DOptions,
): ReadonlyMap<VisualKey, Point2D> {
  const layers = new Map<number, VisualKey[]>();
  for (const link of network.links) {
    const depth = analysis.depthByKey.get(link.key)!;
    const layer = layers.get(depth) ?? [];
    layer.push(link.key);
    layers.set(depth, layer);
  }
  for (const layer of layers.values()) layer.sort(compareKey);

  let spacing = options.layerSpacing;
  for (const [depth, rawIds] of layers) {
    const ids = rawIds.filter((key) => key !== options.rootKey);
    if (ids.length <= 1) continue;
    const factor = depth === 0 ? 0.75 : depth + 0.75;
    const requiredRadius = ids.length * options.minimumNodeSpacing / TWO_PI;
    spacing = Math.max(spacing, requiredRadius / Math.max(factor, 0.75));
  }

  const positions = new Map<VisualKey, Point2D>();
  for (const [depth, rawIds] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
    const ids = rawIds.filter((key) => key !== options.rootKey);
    if (options.rootKey !== undefined && rawIds.includes(options.rootKey)) {
      positions.set(options.rootKey, freezePoint({ x: 0, y: 0 }));
    }
    if (ids.length === 0) continue;

    const singletonAtCenter = options.rootKey === undefined && depth === 0 && ids.length === 1;
    if (singletonAtCenter) {
      positions.set(ids[0]!, freezePoint({ x: 0, y: 0 }));
      continue;
    }

    const radius = (depth === 0 ? 0.75 : depth + 0.75) * spacing;
    const ordered = ids.map((key) => ({ key, angle: stableAngle(key) }))
      .sort((left, right) => left.angle - right.angle || compareKey(left.key, right.key));
    const step = TWO_PI / ordered.length;
    const phase = -Math.PI / 2 + (depth % 2 === 0 ? step / 2 : 0);
    ordered.forEach(({ key }, index) => {
      positions.set(key, freezePoint({
        x: Math.cos(phase + index * step) * radius,
        y: Math.sin(phase + index * step) * radius,
      }));
    });
  }

  return positions;
}

function optimizePositions(
  network: VisualLinkNetwork,
  initial: ReadonlyMap<VisualKey, Point2D>,
  analysis: StructuralAnalysis,
  options: ResolvedStructural2DOptions,
): Readonly<{
  positions: ReadonlyMap<VisualKey, Point2D>;
  crossingsBefore: number;
  crossingsAfter: number;
  evaluations: number;
  passes: number;
  changed: boolean;
}> {
  let evaluations = 0;
  const evaluate = (positions: ReadonlyMap<VisualKey, Point2D>) => {
    evaluations += 1;
    const arcs = buildStructuralArcs(network, positions, options);
    const crossings = analyzeStructural2DCrossings(arcs);
    const pathLength = arcs.reduce((total, arc) => total + polylineLength(arc.points), 0);
    return { crossings, pathLength };
  };

  const baseline = clonePositionMap(initial);
  const before = evaluate(baseline);
  if (!options.optimizeCrossings
    || options.crossingPasses === 0
    || options.crossingEvaluations === 0
    || before.crossings.count === 0) {
    return Object.freeze({
      positions: baseline,
      crossingsBefore: before.crossings.count,
      crossingsAfter: before.crossings.count,
      evaluations,
      passes: 0,
      changed: false,
    });
  }

  const layers = new Map<number, VisualKey[]>();
  for (const link of network.links) {
    if (link.key === options.rootKey) continue;
    const point = baseline.get(link.key)!;
    if (Math.hypot(point.x, point.y) <= EPSILON) continue;
    const depth = analysis.depthByKey.get(link.key)!;
    const layer = layers.get(depth) ?? [];
    layer.push(link.key);
    layers.set(depth, layer);
  }
  for (const layer of layers.values()) layer.sort(compareKey);

  let current = baseline;
  let currentEvaluation = before;
  let passes = 0;

  for (let pass = 0;
    pass < options.crossingPasses && evaluations < options.crossingEvaluations;
    pass += 1) {
    passes = pass + 1;
    const hot = currentEvaluation.crossings.hotNodeCounts;
    const ranked = [...new Set(network.links.map((link) => link.key))]
      .filter((key) => (hot[key] ?? 0) > 0 && key !== options.rootKey)
      .sort((left, right) => (hot[right] ?? 0) - (hot[left] ?? 0) || compareKey(left, right));
    if (ranked.length === 0) break;

    let bestPositions: Map<VisualKey, Point2D> | null = null;
    let bestEvaluation: ReturnType<typeof evaluate> | null = null;

    for (const layer of [...layers.values()]) {
      const hotInLayer = layer.filter((key) => ranked.includes(key));
      if (hotInLayer.length === 0) continue;
      for (const leftKey of hotInLayer) {
        for (const rightKey of layer) {
          if (compareKey(leftKey, rightKey) >= 0) continue;
          if (evaluations >= options.crossingEvaluations) break;
          const candidate = clonePositionMap(current);
          const leftPoint = candidate.get(leftKey)!;
          const rightPoint = candidate.get(rightKey)!;
          candidate.set(leftKey, rightPoint);
          candidate.set(rightKey, leftPoint);
          const candidateEvaluation = evaluate(candidate);
          if (!betterEvaluation(candidateEvaluation, currentEvaluation)) continue;
          if (bestEvaluation === null || betterEvaluation(candidateEvaluation, bestEvaluation)) {
            bestPositions = candidate;
            bestEvaluation = candidateEvaluation;
          }
        }
        if (evaluations >= options.crossingEvaluations) break;
      }
      if (evaluations >= options.crossingEvaluations) break;
    }

    if (bestPositions === null || bestEvaluation === null) break;
    current = bestPositions;
    currentEvaluation = bestEvaluation;
    if (currentEvaluation.crossings.count === 0) break;
  }

  return Object.freeze({
    positions: current,
    crossingsBefore: before.crossings.count,
    crossingsAfter: currentEvaluation.crossings.count,
    evaluations,
    passes,
    changed: !samePositionMaps(baseline, current),
  });
}

function betterEvaluation(
  candidate: Readonly<{ crossings: Structural2DCrossingAnalysis; pathLength: number }>,
  current: Readonly<{ crossings: Structural2DCrossingAnalysis; pathLength: number }>,
): boolean {
  if (candidate.crossings.count !== current.crossings.count) {
    return candidate.crossings.count < current.crossings.count;
  }
  return candidate.pathLength < current.pathLength - EPSILON;
}

function buildStructuralArcs(
  network: VisualLinkNetwork,
  positions: ReadonlyMap<VisualKey, Point2D>,
  options: ResolvedStructural2DOptions,
): readonly Structural2DArc[] {
  const arcs: Structural2DArc[] = [];
  for (const link of network.links) {
    arcs.push(buildArc(
      link.key,
      "start",
      link.startKey,
      link.key,
      positions,
      options,
    ));
    arcs.push(buildArc(
      link.key,
      "end",
      link.key,
      link.endKey,
      positions,
      options,
    ));
  }
  return Object.freeze(arcs);
}

function buildArc(
  linkKey: VisualKey,
  role: Structural2DArcRole,
  sourceKey: VisualKey,
  targetKey: VisualKey,
  positions: ReadonlyMap<VisualKey, Point2D>,
  options: ResolvedStructural2DOptions,
): Structural2DArc {
  const source = positions.get(sourceKey)!;
  const target = positions.get(targetKey)!;
  const points = sourceKey === targetKey
    ? sampleSelfLoop(source, options.loopRadius, linkKey, role)
    : sampleQuadratic(source, target, options.arcBend, role);
  return Object.freeze({
    id: `${linkKey}:${role}`,
    linkKey,
    role,
    sourceKey,
    targetKey,
    points,
  });
}

function sampleQuadratic(
  source: Point2D,
  target: Point2D,
  requestedBend: number,
  role: Structural2DArcRole,
): readonly Point2D[] {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy);
  const nx = distance <= EPSILON ? 0 : -dy / distance;
  const ny = distance <= EPSILON ? 1 : dx / distance;
  const bend = Math.min(requestedBend, Math.max(8, distance * 0.28))
    * (role === "start" ? 1 : -1);
  const control = {
    x: (source.x + target.x) / 2 + nx * bend,
    y: (source.y + target.y) / 2 + ny * bend,
  };
  const points: Point2D[] = [];
  const segments = 12;
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const inverse = 1 - t;
    points.push(freezePoint({
      x: inverse * inverse * source.x + 2 * inverse * t * control.x + t * t * target.x,
      y: inverse * inverse * source.y + 2 * inverse * t * control.y + t * t * target.y,
    }));
  }
  return Object.freeze(points);
}

function sampleSelfLoop(
  center: Point2D,
  radius: number,
  linkKey: VisualKey,
  role: Structural2DArcRole,
): readonly Point2D[] {
  const base = stableAngle(`${linkKey}:${role}`);
  const axis = { x: Math.cos(base), y: Math.sin(base) };
  const loopCenter = {
    x: center.x + axis.x * radius,
    y: center.y + axis.y * radius,
  };
  const startVector = { x: center.x - loopCenter.x, y: center.y - loopCenter.y };
  const direction = role === "start" ? 1 : -1;
  const points: Point2D[] = [];
  const segments = 18;
  for (let index = 0; index <= segments; index += 1) {
    const angle = direction * TWO_PI * index / segments;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    points.push(freezePoint({
      x: loopCenter.x + startVector.x * cos - startVector.y * sin,
      y: loopCenter.y + startVector.x * sin + startVector.y * cos,
    }));
  }
  return Object.freeze(points);
}

function structuralBounds(
  positions: readonly Structural2DPosition[],
  arcs: readonly Structural2DArc[],
  nodeRadius: number,
): Structural2DBounds {
  if (positions.length === 0) {
    return Object.freeze({
      minX: -50,
      minY: -50,
      maxX: 50,
      maxY: 50,
      width: 100,
      height: 100,
    });
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (point: Point2D): void => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };
  for (const position of positions) include(position.point);
  for (const arc of arcs) for (const point of arc.points) include(point);
  const padding = Math.max(36, nodeRadius * 3);
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;
  return Object.freeze({
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  });
}

function freezePosition(
  key: VisualKey,
  point: Point2D,
  depth: number,
  componentId: string,
): Structural2DPosition {
  return Object.freeze({
    key,
    point: freezePoint(point),
    depth,
    componentId,
  });
}

function clonePositionMap(source: ReadonlyMap<VisualKey, Point2D>): Map<VisualKey, Point2D> {
  const result = new Map<VisualKey, Point2D>();
  for (const [key, point] of [...source.entries()].sort(([a], [b]) => compareKey(a, b))) {
    result.set(key, freezePoint(point));
  }
  return result;
}

function samePositionMaps(
  left: ReadonlyMap<VisualKey, Point2D>,
  right: ReadonlyMap<VisualKey, Point2D>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, point] of left) {
    const other = right.get(key);
    if (other === undefined
      || Math.abs(point.x - other.x) > EPSILON
      || Math.abs(point.y - other.y) > EPSILON) return false;
  }
  return true;
}

function shareSemanticEndpoint(left: Structural2DArc, right: Structural2DArc): boolean {
  const endpoints = new Set([left.sourceKey, left.targetKey]);
  return endpoints.has(right.sourceKey) || endpoints.has(right.targetKey);
}

function pathsProperlyIntersect(
  left: readonly Point2D[],
  right: readonly Point2D[],
): boolean {
  for (let leftIndex = 1; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex < right.length; rightIndex += 1) {
      if (properSegmentsIntersect(
        left[leftIndex - 1]!,
        left[leftIndex]!,
        right[rightIndex - 1]!,
        right[rightIndex]!,
      )) return true;
    }
  }
  return false;
}

function properSegmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return oppositeSigns(o1, o2) && oppositeSigns(o3, o4);
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function oppositeSigns(left: number, right: number): boolean {
  return (left > EPSILON && right < -EPSILON) || (left < -EPSILON && right > EPSILON);
}

function pointsBounds(points: readonly Point2D[]): Structural2DBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function boundsOverlap(left: Structural2DBounds, right: Structural2DBounds): boolean {
  return left.minX <= right.maxX + EPSILON
    && left.maxX + EPSILON >= right.minX
    && left.minY <= right.maxY + EPSILON
    && left.maxY + EPSILON >= right.minY;
}

function polylineLength(points: readonly Point2D[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]!;
    const right = points[index]!;
    total += Math.hypot(right.x - left.x, right.y - left.y);
  }
  return total;
}

function stableAngle(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash / 0x100000000 * TWO_PI - Math.PI;
}

function freezePoint(point: Point2D): Point2D {
  return Object.freeze({ x: point.x, y: point.y });
}

function compareKey(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function numberText(value: number): string {
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return "0";
  return Number(value.toFixed(9)).toString();
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
