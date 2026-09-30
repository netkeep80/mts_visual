import {
  normalizeVisualLinkNetwork,
  type VisualKey,
  type VisualLink,
  type VisualLinkNetwork,
} from "./index.js";
import {
  blueprintLinkColor,
  type BlueprintSvgBounds,
} from "./blueprint-svg.js";
import {
  createBlueprintInitialPositions,
  type CubicBezierSegment,
  type Point2D,
} from "./blueprint-geometry.js";
import { layoutStructural2D } from "./structural2d.js";

export type Document2DProfile = "formal" | "article" | "debug";
export type Document2DSeedStrategy = "canonical" | "radial" | "layered" | "auto";

export interface Document2DOptions {
  readonly profile?: Document2DProfile;
  readonly strategy?: Document2DSeedStrategy;
  readonly rootKey?: VisualKey;
  readonly spacing?: number;
  readonly tangentLength?: number;
  readonly loopRadius?: number;
  readonly minimumCenterSpacing?: number;
  readonly optimizerPasses?: number;
  readonly optimizerEvaluations?: number;
  readonly positionStep?: number;
  readonly angleStepDegrees?: number;
}

export interface Document2DPose {
  readonly key: VisualKey;
  readonly x: number;
  readonly y: number;
  readonly theta: number;
}

export interface Document2DLinkGeometry {
  readonly key: VisualKey;
  readonly startKey: VisualKey;
  readonly endKey: VisualKey;
  readonly pose: Document2DPose;
  readonly startAnchor: Point2D;
  readonly center: Point2D;
  readonly endAnchor: Point2D;
  /** Outward tangent from CENTER toward the START leg. */
  readonly startTangent: Point2D;
  /** Outward tangent from CENTER toward the END leg. */
  readonly endTangent: Point2D;
  readonly segments: readonly CubicBezierSegment[];
}

export interface Document2DLabel {
  readonly key: VisualKey;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly anchor: string;
}

export interface Document2DQuality {
  readonly crossings: number;
  readonly centerOverlaps: number;
  readonly labelOverlaps: number;
  readonly totalPathLength: number;
  readonly area: number;
  readonly score: number;
}

export interface Document2DMetrics {
  readonly seedStrategy: Exclude<Document2DSeedStrategy, "auto">;
  readonly seedCandidates: number;
  readonly optimizerEvaluations: number;
  readonly optimizerPasses: number;
  readonly qualityBefore: Document2DQuality;
  readonly qualityAfter: Document2DQuality;
}

export interface Document2DLayout {
  readonly profile: Document2DProfile;
  readonly strategy: Exclude<Document2DSeedStrategy, "auto">;
  readonly poses: readonly Document2DPose[];
  readonly links: readonly Document2DLinkGeometry[];
  readonly labels: readonly Document2DLabel[];
  readonly metrics: Document2DMetrics;
  readonly bounds: BlueprintSvgBounds;
  readonly viewBox: string;
}

export type Document2DErrorCode =
  | "invalid-option"
  | "unknown-root"
  | "layout-network-mismatch";

export class Document2DError extends Error {
  readonly code: Document2DErrorCode;
  readonly detail?: string;

  constructor(code: Document2DErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`);
    this.name = "Document2DError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

interface ResolvedOptions {
  readonly profile: Document2DProfile;
  readonly strategy: Document2DSeedStrategy;
  readonly rootKey?: VisualKey;
  readonly spacing: number;
  readonly tangentLength: number;
  readonly loopRadius: number;
  readonly minimumCenterSpacing: number;
  readonly optimizerPasses: number;
  readonly optimizerEvaluations: number;
  readonly positionStep: number;
  readonly angleStep: number;
}

interface EvaluatedCandidate {
  readonly strategy: Exclude<Document2DSeedStrategy, "auto">;
  readonly poses: ReadonlyMap<VisualKey, Document2DPose>;
  readonly links: readonly Document2DLinkGeometry[];
  readonly labels: readonly Document2DLabel[];
  readonly quality: Document2DQuality;
}

const EPSILON = 1e-9;
const TWO_PI = Math.PI * 2;
const PROFILE_PADDING: Readonly<Record<Document2DProfile, number>> = Object.freeze({
  formal: 32,
  article: 48,
  debug: 42,
});

const DEFAULTS = Object.freeze({
  profile: "article" as Document2DProfile,
  strategy: "auto" as Document2DSeedStrategy,
  spacing: 112,
  tangentLength: 34,
  loopRadius: 34,
  minimumCenterSpacing: 54,
  optimizerPasses: 5,
  optimizerEvaluations: 260,
  positionStep: 34,
  angleStepDegrees: 18,
});

const AUTO_STRATEGIES = Object.freeze([
  "layered",
  "radial",
  "canonical",
] as const);

export function layoutDocument2D(
  network: VisualLinkNetwork,
  options: Document2DOptions = {},
): Document2DLayout {
  const normalized = normalizeVisualLinkNetwork(network);
  const resolved = resolveOptions(normalized, options);

  const strategies: readonly Exclude<Document2DSeedStrategy, "auto">[] =
    resolved.strategy === "auto" ? AUTO_STRATEGIES : [resolved.strategy];

  const seedCandidates = strategies.map((strategy) =>
    evaluateCandidate(
      normalized,
      createSeedPoses(normalized, strategy, resolved),
      strategy,
      resolved,
    )
  );
  const seed = seedCandidates.reduce((best, candidate) =>
    betterQuality(candidate.quality, best.quality) ? candidate : best
  );

  const optimized = optimizeCandidate(normalized, seed, resolved);
  const finalPoses = normalized.links.map((link) =>
    freezePose(optimized.candidate.poses.get(link.key)!)
  );
  const bounds = computeDocumentBounds(
    optimized.candidate.links,
    optimized.candidate.labels,
    PROFILE_PADDING[resolved.profile],
  );

  return Object.freeze({
    profile: resolved.profile,
    strategy: optimized.candidate.strategy,
    poses: Object.freeze(finalPoses),
    links: optimized.candidate.links,
    labels: optimized.candidate.labels,
    metrics: Object.freeze({
      seedStrategy: seed.strategy,
      seedCandidates: seedCandidates.length,
      optimizerEvaluations: optimized.evaluations,
      optimizerPasses: optimized.passes,
      qualityBefore: seed.quality,
      qualityAfter: optimized.candidate.quality,
    }),
    bounds,
    viewBox: [
      canonicalNumber(bounds.minX),
      canonicalNumber(bounds.minY),
      canonicalNumber(bounds.width),
      canonicalNumber(bounds.height),
    ].join(" "),
  });
}

export function buildDocument2DGeometry(
  network: VisualLinkNetwork,
  poses: readonly Document2DPose[],
  options: Pick<Document2DOptions, "tangentLength" | "loopRadius"> = {},
): readonly Document2DLinkGeometry[] {
  const normalized = normalizeVisualLinkNetwork(network);
  const tangentLength = positiveOption(
    "tangentLength",
    options.tangentLength,
    DEFAULTS.tangentLength,
  );
  const loopRadius = positiveOption("loopRadius", options.loopRadius, DEFAULTS.loopRadius);
  const poseMap = exactPoseMap(normalized, poses);
  return buildGeometryFromPoseMap(normalized, poseMap, tangentLength, loopRadius);
}

export function serializeDocument2DSvg(
  network: VisualLinkNetwork,
  layout: Document2DLayout,
): string {
  const normalized = normalizeVisualLinkNetwork(network);
  validateLayout(normalized, layout);
  const linkByKey = new Map(normalized.links.map((link) => [link.key, link] as const));
  const geometryByKey = new Map(layout.links.map((link) => [link.key, link] as const));
  const labelByKey = new Map(layout.labels.map((label) => [label.key, label] as const));

  const style = profileStyle(layout.profile);
  const defs = layout.links.map((geometry, index) => {
    const color = blueprintLinkColor(index);
    const id = encodedId(index, geometry.key);
    return [
      `<marker id="${id}-start" viewBox="0 0 100 100" markerWidth="9" markerHeight="9" refX="50" refY="50" orient="auto" markerUnits="strokeWidth"><line x1="50" y1="34" x2="50" y2="66" stroke="${escapeXml(color)}" stroke-width="7" stroke-linecap="round"/></marker>`,
      `<marker id="${id}-end" viewBox="-2 0 102 100" markerWidth="9" markerHeight="9" refX="10" refY="50" orient="auto" markerUnits="strokeWidth"><polyline points="0,39 11,50 0,61" fill="none" stroke="${escapeXml(color)}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></marker>`,
    ].join("");
  }).join("");

  const content = normalized.links.map((link, index) => {
    const geometry = geometryByKey.get(link.key)!;
    const label = labelByKey.get(link.key)!;
    const color = blueprintLinkColor(index);
    const id = encodedId(index, link.key);
    const path = cubicPathData(geometry.segments);
    const debug = layout.profile === "debug"
      ? `<text data-role="document-debug-role" x="${canonicalNumber(label.x)}" y="${canonicalNumber(label.y + label.height)}" font-size="9" fill="#8f9bad">${escapeXml(`S=${link.startKey} E=${link.endKey} θ=${canonicalNumber(geometry.pose.theta)}`)}</text>`
      : "";
    return [
      `<g data-role="document-link" data-link-key="${escapeXml(link.key)}" data-start-key="${escapeXml(link.startKey)}" data-end-key="${escapeXml(link.endKey)}" data-pose-theta="${canonicalNumber(geometry.pose.theta)}">`,
      `<path id="${id}-path" data-role="document-link-path" d="${escapeXml(path)}" fill="none" stroke="${escapeXml(color)}" stroke-width="${style.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" marker-start="url(#${id}-start)" marker-end="url(#${id}-end)"/>`,
      `<circle data-role="document-center" cx="${canonicalNumber(geometry.center.x)}" cy="${canonicalNumber(geometry.center.y)}" r="${style.centerRadius}" fill="${escapeXml(color)}"/>`,
      `<text data-role="document-label" x="${canonicalNumber(label.x)}" y="${canonicalNumber(label.y)}" font-size="${style.fontSize}" fill="#17202c" font-family="ui-monospace, SFMono-Regular, Consolas, monospace">${escapeXml(label.text)}</text>`,
      debug,
      "</g>",
    ].join("");
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Document 2D" viewBox="${escapeXml(layout.viewBox)}"><rect x="${canonicalNumber(layout.bounds.minX)}" y="${canonicalNumber(layout.bounds.minY)}" width="${canonicalNumber(layout.bounds.width)}" height="${canonicalNumber(layout.bounds.height)}" fill="#ffffff"/><defs>${defs}</defs>${content}</svg>`;
}

export function document2DCenterTangentsAreAntiparallel(
  geometry: Document2DLinkGeometry,
  epsilon = 1e-9,
): boolean {
  if (!Number.isFinite(epsilon) || epsilon < 0) return false;
  const startLength = Math.hypot(geometry.startTangent.x, geometry.startTangent.y);
  const endLength = Math.hypot(geometry.endTangent.x, geometry.endTangent.y);
  if (startLength <= EPSILON || endLength <= EPSILON) return false;
  const dot = (
    geometry.startTangent.x * geometry.endTangent.x
    + geometry.startTangent.y * geometry.endTangent.y
  ) / (startLength * endLength);
  return Math.abs(dot + 1) <= epsilon;
}

function resolveOptions(network: VisualLinkNetwork, options: Document2DOptions): ResolvedOptions {
  const profile = options.profile ?? DEFAULTS.profile;
  const strategy = options.strategy ?? DEFAULTS.strategy;
  if (!["formal", "article", "debug"].includes(profile)) {
    throw new Document2DError("invalid-option", "profile");
  }
  if (!["canonical", "radial", "layered", "auto"].includes(strategy)) {
    throw new Document2DError("invalid-option", "strategy");
  }
  if (options.rootKey !== undefined
    && !network.links.some((link) => link.key === options.rootKey)) {
    throw new Document2DError("unknown-root", options.rootKey);
  }

  const optimizerPasses = integerOption(
    "optimizerPasses",
    options.optimizerPasses,
    DEFAULTS.optimizerPasses,
  );
  const optimizerEvaluations = integerOption(
    "optimizerEvaluations",
    options.optimizerEvaluations,
    DEFAULTS.optimizerEvaluations,
  );
  const angleStepDegrees = positiveOption(
    "angleStepDegrees",
    options.angleStepDegrees,
    DEFAULTS.angleStepDegrees,
  );

  return Object.freeze({
    profile,
    strategy,
    ...(options.rootKey === undefined ? {} : { rootKey: options.rootKey }),
    spacing: positiveOption("spacing", options.spacing, DEFAULTS.spacing),
    tangentLength: positiveOption(
      "tangentLength",
      options.tangentLength,
      DEFAULTS.tangentLength,
    ),
    loopRadius: positiveOption("loopRadius", options.loopRadius, DEFAULTS.loopRadius),
    minimumCenterSpacing: positiveOption(
      "minimumCenterSpacing",
      options.minimumCenterSpacing,
      DEFAULTS.minimumCenterSpacing,
    ),
    optimizerPasses,
    optimizerEvaluations,
    positionStep: positiveOption(
      "positionStep",
      options.positionStep,
      DEFAULTS.positionStep,
    ),
    angleStep: angleStepDegrees * Math.PI / 180,
  });
}

function createSeedPoses(
  network: VisualLinkNetwork,
  strategy: Exclude<Document2DSeedStrategy, "auto">,
  options: ResolvedOptions,
): ReadonlyMap<VisualKey, Document2DPose> {
  let positions: readonly { readonly key: VisualKey; readonly point: Point2D }[];
  if (strategy === "canonical") {
    positions = createBlueprintInitialPositions(network, { spacing: options.spacing });
  } else if (strategy === "layered") {
    const structural = layoutStructural2D(network, {
      ...(options.rootKey === undefined ? {} : { rootKey: options.rootKey }),
      layerSpacing: options.spacing,
      minimumNodeSpacing: options.minimumCenterSpacing,
      optimizeCrossings: true,
      crossingPasses: 4,
      crossingEvaluations: 180,
    });
    positions = structural.positions.map((position) => ({
      key: position.key,
      point: position.point,
    }));
  } else {
    const count = network.links.length;
    const radius = count <= 1
      ? 0
      : Math.max(options.spacing, count * options.minimumCenterSpacing / TWO_PI);
    positions = network.links.map((link, index) => ({
      key: link.key,
      point: count <= 1
        ? { x: 0, y: 0 }
        : {
            x: Math.cos(-Math.PI / 2 + TWO_PI * index / count) * radius,
            y: Math.sin(-Math.PI / 2 + TWO_PI * index / count) * radius,
          },
    }));
  }

  const pointByKey = new Map(positions.map((position) => [position.key, position.point] as const));
  const poses = new Map<VisualKey, Document2DPose>();
  for (const link of network.links) {
    const point = pointByKey.get(link.key)!;
    poses.set(link.key, freezePose({
      key: link.key,
      x: point.x,
      y: point.y,
      theta: seedTheta(link, pointByKey),
    }));
  }
  return poses;
}

function seedTheta(
  link: VisualLink,
  positions: ReadonlyMap<VisualKey, Point2D>,
): number {
  const center = positions.get(link.key)!;
  const start = positions.get(link.startKey)!;
  const end = positions.get(link.endKey)!;
  const startDistinct = distance(start, center) > EPSILON;
  const endDistinct = distance(end, center) > EPSILON;
  if (startDistinct && endDistinct) return Math.atan2(end.y - start.y, end.x - start.x);
  if (endDistinct) return Math.atan2(end.y - center.y, end.x - center.x);
  if (startDistinct) return Math.atan2(center.y - start.y, center.x - start.x);
  return stableAngle(link.key);
}

function optimizeCandidate(
  network: VisualLinkNetwork,
  seed: EvaluatedCandidate,
  options: ResolvedOptions,
): Readonly<{ candidate: EvaluatedCandidate; evaluations: number; passes: number }> {
  if (options.optimizerPasses === 0 || options.optimizerEvaluations === 0) {
    return Object.freeze({ candidate: seed, evaluations: 0, passes: 0 });
  }

  let current = seed;
  let evaluations = 0;
  let passes = 0;
  const keys = network.links.map((link) => link.key);

  for (let pass = 0;
    pass < options.optimizerPasses && evaluations < options.optimizerEvaluations;
    pass += 1) {
    passes = pass + 1;
    const step = options.positionStep * Math.pow(0.62, pass);
    const angle = options.angleStep * Math.pow(0.7, pass);
    let best = current;

    for (const key of keys) {
      const base = current.poses.get(key)!;
      const moves = [
        { dx: step, dy: 0, da: 0 },
        { dx: -step, dy: 0, da: 0 },
        { dx: 0, dy: step, da: 0 },
        { dx: 0, dy: -step, da: 0 },
        { dx: step * Math.SQRT1_2, dy: step * Math.SQRT1_2, da: 0 },
        { dx: step * Math.SQRT1_2, dy: -step * Math.SQRT1_2, da: 0 },
        { dx: -step * Math.SQRT1_2, dy: step * Math.SQRT1_2, da: 0 },
        { dx: -step * Math.SQRT1_2, dy: -step * Math.SQRT1_2, da: 0 },
        { dx: 0, dy: 0, da: angle },
        { dx: 0, dy: 0, da: -angle },
      ];
      for (const move of moves) {
        if (evaluations >= options.optimizerEvaluations) break;
        const candidatePoses = clonePoseMap(current.poses);
        candidatePoses.set(key, freezePose({
          key,
          x: quantize(base.x + move.dx),
          y: quantize(base.y + move.dy),
          theta: normalizeAngle(base.theta + move.da),
        }));
        const candidate = evaluateCandidate(
          network,
          candidatePoses,
          current.strategy,
          options,
        );
        evaluations += 1;
        if (betterQuality(candidate.quality, best.quality)) best = candidate;
      }
      if (evaluations >= options.optimizerEvaluations) break;
    }

    if (best === current) break;
    current = best;
    if (
      current.quality.crossings === 0
      && current.quality.centerOverlaps === 0
      && current.quality.labelOverlaps === 0
    ) break;
  }

  return Object.freeze({ candidate: current, evaluations, passes });
}

function evaluateCandidate(
  network: VisualLinkNetwork,
  poses: ReadonlyMap<VisualKey, Document2DPose>,
  strategy: Exclude<Document2DSeedStrategy, "auto">,
  options: ResolvedOptions,
): EvaluatedCandidate {
  const links = buildGeometryFromPoseMap(
    network,
    poses,
    options.tangentLength,
    options.loopRadius,
  );
  const labels = placeLabels(network, links, options.profile);
  const quality = evaluateQuality(
    links,
    labels,
    options.minimumCenterSpacing,
  );
  return Object.freeze({
    strategy,
    poses,
    links,
    labels,
    quality,
  });
}

function buildGeometryFromPoseMap(
  network: VisualLinkNetwork,
  poses: ReadonlyMap<VisualKey, Document2DPose>,
  tangentLength: number,
  loopRadius: number,
): readonly Document2DLinkGeometry[] {
  const pointByKey = new Map<VisualKey, Point2D>(
    [...poses].map(([key, pose]) => [key, freezePoint({ x: pose.x, y: pose.y })]),
  );
  const links = network.links.map((link) => {
    const pose = poses.get(link.key)!;
    const center = pointByKey.get(link.key)!;
    const startAnchor = pointByKey.get(link.startKey)!;
    const endAnchor = pointByKey.get(link.endKey)!;
    const axis = { x: Math.cos(pose.theta), y: Math.sin(pose.theta) };
    const normal = { x: -axis.y, y: axis.x };
    const startTangent = freezePoint({ x: -axis.x, y: -axis.y });
    const endTangent = freezePoint(axis);

    const startSegment = link.startKey === link.key
      ? selfStartSegment(center, axis, normal, tangentLength, loopRadius)
      : ordinaryStartSegment(startAnchor, center, axis, tangentLength);
    const endSegment = link.endKey === link.key
      ? selfEndSegment(center, axis, normal, tangentLength, loopRadius)
      : ordinaryEndSegment(center, endAnchor, axis, tangentLength);

    return Object.freeze({
      key: link.key,
      startKey: link.startKey,
      endKey: link.endKey,
      pose: freezePose(pose),
      startAnchor: freezePoint(startAnchor),
      center: freezePoint(center),
      endAnchor: freezePoint(endAnchor),
      startTangent,
      endTangent,
      segments: Object.freeze([startSegment, endSegment]),
    });
  });
  return Object.freeze(links);
}

function ordinaryStartSegment(
  start: Point2D,
  center: Point2D,
  axis: Point2D,
  tangentLength: number,
): CubicBezierSegment {
  const direction = unitVector(start, center, axis);
  const length = distance(start, center);
  const outerHandle = Math.min(tangentLength, Math.max(8, length * 0.42));
  const centerHandle = Math.min(tangentLength, Math.max(8, length * 0.36));
  return freezeSegment(
    start,
    add(start, scale(direction, outerHandle)),
    subtract(center, scale(axis, centerHandle)),
    center,
  );
}

function ordinaryEndSegment(
  center: Point2D,
  end: Point2D,
  axis: Point2D,
  tangentLength: number,
): CubicBezierSegment {
  const direction = unitVector(center, end, axis);
  const length = distance(center, end);
  const centerHandle = Math.min(tangentLength, Math.max(8, length * 0.36));
  const outerHandle = Math.min(tangentLength, Math.max(8, length * 0.42));
  return freezeSegment(
    center,
    add(center, scale(axis, centerHandle)),
    subtract(end, scale(direction, outerHandle)),
    end,
  );
}

function selfStartSegment(
  center: Point2D,
  axis: Point2D,
  normal: Point2D,
  tangentLength: number,
  loopRadius: number,
): CubicBezierSegment {
  return freezeSegment(
    center,
    add(center, scale(normal, loopRadius * 1.8)),
    subtract(center, scale(axis, tangentLength)),
    center,
  );
}

function selfEndSegment(
  center: Point2D,
  axis: Point2D,
  normal: Point2D,
  tangentLength: number,
  loopRadius: number,
): CubicBezierSegment {
  return freezeSegment(
    center,
    add(center, scale(axis, tangentLength)),
    subtract(center, scale(normal, loopRadius * 1.8)),
    center,
  );
}

function placeLabels(
  network: VisualLinkNetwork,
  links: readonly Document2DLinkGeometry[],
  profile: Document2DProfile,
): readonly Document2DLabel[] {
  const geometryByKey = new Map(links.map((link) => [link.key, link] as const));
  const placed: Document2DLabel[] = [];
  for (const link of network.links) {
    const geometry = geometryByKey.get(link.key)!;
    const text = profile === "debug"
      ? (link.label ?? link.key)
      : (link.label ?? link.key);
    const width = Math.max(28, text.length * (profile === "article" ? 7.6 : 6.8) + 10);
    const height = profile === "article" ? 18 : 16;
    const radius = 18;
    const candidates = [
      { anchor: "ne", x: geometry.center.x + radius, y: geometry.center.y - radius },
      { anchor: "nw", x: geometry.center.x - radius - width, y: geometry.center.y - radius },
      { anchor: "se", x: geometry.center.x + radius, y: geometry.center.y + radius + height },
      { anchor: "sw", x: geometry.center.x - radius - width, y: geometry.center.y + radius + height },
      { anchor: "e", x: geometry.center.x + radius, y: geometry.center.y + height / 2 },
      { anchor: "w", x: geometry.center.x - radius - width, y: geometry.center.y + height / 2 },
      { anchor: "n", x: geometry.center.x - width / 2, y: geometry.center.y - radius },
      { anchor: "s", x: geometry.center.x - width / 2, y: geometry.center.y + radius + height },
    ];
    let best = candidates[0]!;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const box = labelBox(candidate.x, candidate.y, width, height);
      let score = 0;
      for (const previous of placed) {
        if (boxesOverlap(box, labelBox(previous.x, previous.y, previous.width, previous.height))) {
          score += 1000;
        }
      }
      for (const other of links) {
        if (pointInsideExpandedBox(other.center, box, 8)) score += 100;
      }
      score += Math.abs(candidate.x - geometry.center.x)
        + Math.abs(candidate.y - geometry.center.y);
      if (score < bestScore - EPSILON) {
        best = candidate;
        bestScore = score;
      }
    }
    placed.push(Object.freeze({
      key: link.key,
      text,
      x: quantize(best.x),
      y: quantize(best.y),
      width: quantize(width),
      height: quantize(height),
      anchor: best.anchor,
    }));
  }
  return Object.freeze(placed);
}

function evaluateQuality(
  links: readonly Document2DLinkGeometry[],
  labels: readonly Document2DLabel[],
  minimumCenterSpacing: number,
): Document2DQuality {
  const sampled = links.map((link) => ({
    link,
    points: sampleLink(link, 8),
  }));
  let crossings = 0;
  for (let leftIndex = 0; leftIndex < sampled.length; leftIndex += 1) {
    const left = sampled[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < sampled.length; rightIndex += 1) {
      const right = sampled[rightIndex]!;
      if (linksProperlyCross(left.link, left.points, right.link, right.points)) crossings += 1;
    }
  }

  let centerOverlaps = 0;
  for (let left = 0; left < links.length; left += 1) {
    for (let right = left + 1; right < links.length; right += 1) {
      if (distance(links[left]!.center, links[right]!.center) < minimumCenterSpacing - EPSILON) {
        centerOverlaps += 1;
      }
    }
  }

  let labelOverlaps = 0;
  for (let left = 0; left < labels.length; left += 1) {
    for (let right = left + 1; right < labels.length; right += 1) {
      if (boxesOverlap(
        labelBox(labels[left]!.x, labels[left]!.y, labels[left]!.width, labels[left]!.height),
        labelBox(labels[right]!.x, labels[right]!.y, labels[right]!.width, labels[right]!.height),
      )) labelOverlaps += 1;
    }
  }

  const totalPathLength = sampled.reduce(
    (total, current) => total + polylineLength(current.points),
    0,
  );
  const rawBounds = computeDocumentBounds(links, labels, 0);
  const area = rawBounds.width * rawBounds.height;
  const score = crossings * 1_000_000
    + centerOverlaps * 100_000
    + labelOverlaps * 10_000
    + totalPathLength
    + area * 0.0005;

  return Object.freeze({
    crossings,
    centerOverlaps,
    labelOverlaps,
    totalPathLength: quantize(totalPathLength),
    area: quantize(area),
    score: quantize(score),
  });
}

function betterQuality(candidate: Document2DQuality, current: Document2DQuality): boolean {
  if (candidate.crossings !== current.crossings) return candidate.crossings < current.crossings;
  if (candidate.centerOverlaps !== current.centerOverlaps) {
    return candidate.centerOverlaps < current.centerOverlaps;
  }
  if (candidate.labelOverlaps !== current.labelOverlaps) {
    return candidate.labelOverlaps < current.labelOverlaps;
  }
  return candidate.score < current.score - EPSILON;
}

function linksProperlyCross(
  left: Document2DLinkGeometry,
  leftPoints: readonly Point2D[],
  right: Document2DLinkGeometry,
  rightPoints: readonly Point2D[],
): boolean {
  const sharedKeys = new Set(
    [left.startKey, left.key, left.endKey].filter((key) =>
      key === right.startKey || key === right.key || key === right.endKey
    ),
  );
  const sharedCenters = [...sharedKeys].flatMap((key) => {
    if (key === left.key) return [left.center];
    if (key === left.startKey) return [left.startAnchor];
    if (key === left.endKey) return [left.endAnchor];
    return [];
  });

  for (let li = 1; li < leftPoints.length; li += 1) {
    for (let ri = 1; ri < rightPoints.length; ri += 1) {
      const a = leftPoints[li - 1]!;
      const b = leftPoints[li]!;
      const c = rightPoints[ri - 1]!;
      const d = rightPoints[ri]!;
      if (sharedCenters.some((center) =>
        segmentNearPoint(a, b, center, 4) || segmentNearPoint(c, d, center, 4)
      )) continue;
      if (properSegmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function sampleLink(link: Document2DLinkGeometry, segmentsPerCubic: number): readonly Point2D[] {
  const points: Point2D[] = [];
  link.segments.forEach((segment, segmentIndex) => {
    for (let index = 0; index <= segmentsPerCubic; index += 1) {
      if (segmentIndex > 0 && index === 0) continue;
      const t = index / segmentsPerCubic;
      const inverse = 1 - t;
      points.push({
        x: inverse ** 3 * segment.p0.x
          + 3 * inverse * inverse * t * segment.p1.x
          + 3 * inverse * t * t * segment.p2.x
          + t ** 3 * segment.p3.x,
        y: inverse ** 3 * segment.p0.y
          + 3 * inverse * inverse * t * segment.p1.y
          + 3 * inverse * t * t * segment.p2.y
          + t ** 3 * segment.p3.y,
      });
    }
  });
  return points;
}

function computeDocumentBounds(
  links: readonly Document2DLinkGeometry[],
  labels: readonly Document2DLabel[],
  padding: number,
): BlueprintSvgBounds {
  if (links.length === 0) {
    const half = 50 + padding;
    return Object.freeze({
      minX: -half,
      minY: -half,
      maxX: half,
      maxY: half,
      width: half * 2,
      height: half * 2,
    });
  }

  const points = links.flatMap((link) => [
    link.center,
    link.startAnchor,
    link.endAnchor,
    ...link.segments.flatMap((segment) => [
      segment.p0,
      segment.p1,
      segment.p2,
      segment.p3,
    ]),
  ]);
  let minX = Math.min(...points.map((point) => point.x));
  let minY = Math.min(...points.map((point) => point.y));
  let maxX = Math.max(...points.map((point) => point.x));
  let maxY = Math.max(...points.map((point) => point.y));
  for (const label of labels) {
    const box = labelBox(label.x, label.y, label.width, label.height);
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  if (maxX - minX < 1) {
    minX -= 0.5;
    maxX += 0.5;
  }
  if (maxY - minY < 1) {
    minY -= 0.5;
    maxY += 0.5;
  }
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;
  return Object.freeze({
    minX: quantize(minX),
    minY: quantize(minY),
    maxX: quantize(maxX),
    maxY: quantize(maxY),
    width: quantize(maxX - minX),
    height: quantize(maxY - minY),
  });
}

function exactPoseMap(
  network: VisualLinkNetwork,
  poses: readonly Document2DPose[],
): ReadonlyMap<VisualKey, Document2DPose> {
  const expected = new Set(network.links.map((link) => link.key));
  const map = new Map<VisualKey, Document2DPose>();
  for (const pose of poses) {
    if (!expected.has(pose.key) || map.has(pose.key)) {
      throw new Document2DError("layout-network-mismatch", pose.key);
    }
    if (![pose.x, pose.y, pose.theta].every(Number.isFinite)) {
      throw new Document2DError("invalid-option", `non-finite pose: ${pose.key}`);
    }
    map.set(pose.key, freezePose(pose));
  }
  for (const key of expected) {
    if (!map.has(key)) throw new Document2DError("layout-network-mismatch", key);
  }
  return map;
}

function validateLayout(network: VisualLinkNetwork, layout: Document2DLayout): void {
  const expected = network.links.map((link) => link.key);
  if (layout.poses.length !== expected.length
    || layout.links.length !== expected.length
    || layout.labels.length !== expected.length) {
    throw new Document2DError("layout-network-mismatch", "count");
  }
  const poseKeys = layout.poses.map((pose) => pose.key).join("\u0000");
  const linkKeys = layout.links.map((link) => link.key).join("\u0000");
  const labelKeys = layout.labels.map((label) => label.key).join("\u0000");
  const expectedKeys = expected.join("\u0000");
  if (poseKeys !== expectedKeys || linkKeys !== expectedKeys || labelKeys !== expectedKeys) {
    throw new Document2DError("layout-network-mismatch", "order");
  }
}

function cubicPathData(segments: readonly CubicBezierSegment[]): string {
  const first = segments[0];
  if (first === undefined) throw new Document2DError("layout-network-mismatch", "empty path");
  return [
    `M ${pointText(first.p0)}`,
    ...segments.map((segment) =>
      `C ${pointText(segment.p1)} ${pointText(segment.p2)} ${pointText(segment.p3)}`
    ),
  ].join(" ");
}

function profileStyle(profile: Document2DProfile): Readonly<{
  strokeWidth: number;
  centerRadius: number;
  fontSize: number;
}> {
  switch (profile) {
    case "formal": return Object.freeze({ strokeWidth: 1.6, centerRadius: 4.5, fontSize: 11 });
    case "debug": return Object.freeze({ strokeWidth: 1.8, centerRadius: 5, fontSize: 11 });
    default: return Object.freeze({ strokeWidth: 2.4, centerRadius: 6, fontSize: 13 });
  }
}

function clonePoseMap(
  source: ReadonlyMap<VisualKey, Document2DPose>,
): Map<VisualKey, Document2DPose> {
  return new Map(
    [...source.entries()]
      .sort(([left], [right]) => compareKey(left, right))
      .map(([key, pose]) => [key, freezePose(pose)] as const),
  );
}

function freezePose(pose: Document2DPose): Document2DPose {
  return Object.freeze({
    key: pose.key,
    x: quantize(pose.x),
    y: quantize(pose.y),
    theta: quantize(normalizeAngle(pose.theta)),
  });
}

function freezeSegment(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
): CubicBezierSegment {
  return Object.freeze({
    p0: freezePoint(p0),
    p1: freezePoint(p1),
    p2: freezePoint(p2),
    p3: freezePoint(p3),
  });
}

function freezePoint(point: Point2D): Point2D {
  return Object.freeze({ x: quantize(point.x), y: quantize(point.y) });
}

function unitVector(from: Point2D, to: Point2D, fallback: Point2D): Point2D {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return fallback;
  return { x: dx / length, y: dy / length };
}

function add(left: Point2D, right: Point2D): Point2D {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Point2D, right: Point2D): Point2D {
  return { x: left.x - right.x, y: left.y - right.y };
}

function scale(point: Point2D, factor: number): Point2D {
  return { x: point.x * factor, y: point.y * factor };
}

function distance(left: Point2D, right: Point2D): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function labelBox(x: number, baselineY: number, width: number, height: number) {
  return {
    minX: x,
    minY: baselineY - height,
    maxX: x + width,
    maxY: baselineY,
  };
}

function boxesOverlap(
  left: ReturnType<typeof labelBox>,
  right: ReturnType<typeof labelBox>,
): boolean {
  return left.minX < right.maxX - EPSILON
    && left.maxX > right.minX + EPSILON
    && left.minY < right.maxY - EPSILON
    && left.maxY > right.minY + EPSILON;
}

function pointInsideExpandedBox(
  point: Point2D,
  box: ReturnType<typeof labelBox>,
  padding: number,
): boolean {
  return point.x >= box.minX - padding
    && point.x <= box.maxX + padding
    && point.y >= box.minY - padding
    && point.y <= box.maxY + padding;
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

function segmentNearPoint(a: Point2D, b: Point2D, point: Point2D, radius: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return distance(a, point) <= radius;
  const t = Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared
  ));
  const closest = { x: a.x + dx * t, y: a.y + dy * t };
  return distance(closest, point) <= radius;
}

function polylineLength(points: readonly Point2D[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1]!, points[index]!);
  }
  return total;
}

function positiveOption(name: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Document2DError("invalid-option", name);
  }
  return resolved;
}

function integerOption(name: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Document2DError("invalid-option", name);
  }
  return resolved;
}

function stableAngle(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash / 0x100000000 * TWO_PI - Math.PI;
}

function normalizeAngle(value: number): number {
  let angle = value % TWO_PI;
  if (angle <= -Math.PI) angle += TWO_PI;
  if (angle > Math.PI) angle -= TWO_PI;
  return angle;
}

function quantize(value: number): number {
  if (Object.is(value, -0) || Math.abs(value) < 5e-10) return 0;
  return Number(value.toFixed(9));
}

function pointText(point: Point2D): string {
  return `${canonicalNumber(point.x)} ${canonicalNumber(point.y)}`;
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Document2DError("invalid-option", "non-finite output");
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return "0";
  return Number(value.toFixed(9)).toString();
}

function compareKey(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function encodedId(index: number, key: string): string {
  const encoded = [...key].map((character) => character.codePointAt(0)!.toString(16)).join("_");
  return `mts-document-${index}-${encoded}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
