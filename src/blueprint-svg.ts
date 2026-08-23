import {
  normalizeVisualLinkNetwork,
  type VisualKey,
  type VisualLinkNetwork,
} from "./index.js";
import {
  blueprintGeometryIsFinite,
  buildBlueprintGeometry,
  type BlueprintGeometry,
  type BlueprintOptions,
  type BlueprintPosition,
  type CubicBezierSegment,
  type Point2D,
} from "./blueprint-geometry.js";

// Presentation-only marker/color language adapted from the current anum_parser
// blueprint renderer. Historical visual inspiration remains:
// repository: konard/links-visuals
// commit: f377441533e4f10fa94aaa07138b684df88234b1
// license: Unlicense

export interface BlueprintSvgOptions {
  readonly padding?: number;
  readonly positions?: readonly BlueprintPosition[];
  readonly geometryOptions?: BlueprintOptions;
}

export interface BlueprintSvgBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export interface BlueprintSvgMarker {
  readonly id: string;
  readonly kind: "start" | "end";
  readonly color: string;
}

export interface BlueprintSvgLink {
  readonly key: VisualKey;
  readonly startKey: VisualKey;
  readonly endKey: VisualKey;
  readonly pathId: string;
  readonly d: string;
  readonly color: string;
  readonly startMarkerId: string;
  readonly endMarkerId: string;
  readonly center: Point2D;
  readonly label?: string;
}

export interface BlueprintSvgScene {
  readonly links: readonly BlueprintSvgLink[];
  readonly markers: readonly BlueprintSvgMarker[];
  readonly bounds: BlueprintSvgBounds;
  readonly viewBox: string;
  readonly padding: number;
}

export type BlueprintSvgErrorCode =
  | "invalid-padding"
  | "geometry-count-mismatch"
  | "geometry-key-mismatch"
  | "geometry-pole-mismatch"
  | "non-finite-geometry"
  | "empty-path";

export class BlueprintSvgError extends Error {
  readonly code: BlueprintSvgErrorCode;
  readonly key?: VisualKey;

  constructor(code: BlueprintSvgErrorCode, key?: VisualKey) {
    super(key === undefined ? code : `${code}: ${key}`);
    this.name = "BlueprintSvgError";
    this.code = code;
    if (key !== undefined) this.key = key;
  }
}

export const BLUEPRINT_LINK_PALETTE = Object.freeze([
  "#59aaf7",
  "#ff9d4d",
  "#ef6f6c",
  "#65c4b0",
  "#9bc75b",
  "#f2cf5b",
  "#b889d6",
  "#f28eae",
  "#c49a6c",
  "#b9b9b9",
  "#5bc0eb",
  "#d982c3",
] as const);

export function blueprintLinkColor(index: number): string {
  const safeIndex = Number.isInteger(index) && index >= 0 ? index : 0;
  const paletteColor = BLUEPRINT_LINK_PALETTE[safeIndex];
  if (paletteColor !== undefined) return paletteColor;
  const hue = (210 + safeIndex * 137.50776405003785) % 360;
  return `hsl(${Number(hue.toFixed(3))} 72% 62%)`;
}

export function buildBlueprintSvgScene(
  network: VisualLinkNetwork,
  geometry?: BlueprintGeometry,
  options: BlueprintSvgOptions = {},
): BlueprintSvgScene {
  const normalized = normalizeVisualLinkNetwork(network);
  const padding = resolvePadding(options.padding);
  const resolvedGeometry = geometry ?? buildBlueprintGeometry(
    normalized,
    options.positions,
    options.geometryOptions ?? {},
  );
  validateGeometry(normalized, resolvedGeometry);

  const geometryByKey = new Map(resolvedGeometry.links.map((link) => [link.key, link] as const));
  const links = normalized.links.map((link, index) => {
    const current = geometryByKey.get(link.key);
    if (current === undefined) throw new BlueprintSvgError("geometry-key-mismatch", link.key);
    const baseId = `mts-blueprint-${index}-${encodeVisualKey(link.key)}`;
    return freezeSvgLink({
      key: link.key,
      startKey: link.startKey,
      endKey: link.endKey,
      pathId: `${baseId}-path`,
      d: cubicPathData(current.segments),
      color: blueprintLinkColor(index),
      startMarkerId: `${baseId}-start`,
      endMarkerId: `${baseId}-end`,
      center: current.center,
      ...(link.label === undefined ? {} : { label: link.label }),
    });
  });

  const markers = Object.freeze(links.flatMap((link) => [
    freezeMarker({ id: link.startMarkerId, kind: "start", color: link.color }),
    freezeMarker({ id: link.endMarkerId, kind: "end", color: link.color }),
  ]));
  const bounds = freezeBounds(computeBounds(resolvedGeometry, padding));
  const viewBox = [bounds.minX, bounds.minY, bounds.width, bounds.height]
    .map(canonicalNumber)
    .join(" ");

  return Object.freeze({
    links: Object.freeze(links),
    markers,
    bounds,
    viewBox,
    padding,
  });
}

export function serializeBlueprintSvg(scene: BlueprintSvgScene): string {
  const markerMarkup = scene.markers.map((marker) => marker.kind === "start"
    ? serializeStartMarker(marker)
    : serializeEndMarker(marker)).join("");
  const linkMarkup = scene.links.map((link) => {
    const label = link.label === undefined
      ? ""
      : `<text data-role="blueprint-label" data-link-key="${escapeXml(link.key)}" x="${canonicalNumber(link.center.x + 11)}" y="${canonicalNumber(link.center.y - 11)}">${escapeXml(link.label)}</text>`;
    return `<g data-role="blueprint-link" data-link-key="${escapeXml(link.key)}">`
      + `<path id="${escapeXml(link.pathId)}" data-role="blueprint-link-path" d="${escapeXml(link.d)}" fill="none" stroke="${escapeXml(link.color)}" marker-start="url(#${escapeXml(link.startMarkerId)})" marker-end="url(#${escapeXml(link.endMarkerId)})"/>`
      + `<circle data-role="blueprint-center" data-link-key="${escapeXml(link.key)}" cx="${canonicalNumber(link.center.x)}" cy="${canonicalNumber(link.center.y)}" r="6.5"/>`
      + label
      + `</g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="${escapeXml(scene.viewBox)}">`
    + `<defs>${markerMarkup}</defs>`
    + linkMarkup
    + `</svg>`;
}

function validateGeometry(network: VisualLinkNetwork, geometry: BlueprintGeometry): void {
  if (!blueprintGeometryIsFinite(geometry)) throw new BlueprintSvgError("non-finite-geometry");
  if (geometry.links.length !== network.links.length) {
    throw new BlueprintSvgError("geometry-count-mismatch");
  }

  const expected = new Map(network.links.map((link) => [link.key, link] as const));
  const seen = new Set<VisualKey>();
  for (const link of geometry.links) {
    const declared = expected.get(link.key);
    if (declared === undefined || seen.has(link.key)) {
      throw new BlueprintSvgError("geometry-key-mismatch", link.key);
    }
    seen.add(link.key);
    if (link.startKey !== declared.startKey || link.endKey !== declared.endKey) {
      throw new BlueprintSvgError("geometry-pole-mismatch", link.key);
    }
    if (link.segments.length === 0) throw new BlueprintSvgError("empty-path", link.key);
  }
  for (const key of expected.keys()) {
    if (!seen.has(key)) throw new BlueprintSvgError("geometry-key-mismatch", key);
  }
}

function cubicPathData(segments: readonly CubicBezierSegment[]): string {
  const first = segments[0];
  if (first === undefined) throw new BlueprintSvgError("empty-path");
  const commands = [`M ${pointText(first.p0)}`];
  for (const segment of segments) {
    commands.push(`C ${pointText(segment.p1)} ${pointText(segment.p2)} ${pointText(segment.p3)}`);
  }
  return commands.join(" ");
}

function computeBounds(geometry: BlueprintGeometry, padding: number): BlueprintSvgBounds {
  const points = geometry.links.flatMap((link) => [
    link.center,
    link.startAnchor,
    link.endAnchor,
    ...link.segments.flatMap((segment) => [segment.p0, segment.p1, segment.p2, segment.p3]),
  ]);

  if (points.length === 0) {
    const half = 0.5 + padding;
    return {
      minX: -half,
      minY: -half,
      maxX: half,
      maxY: half,
      width: half * 2,
      height: half * 2,
    };
  }

  let minX = Math.min(...points.map((point) => point.x));
  let minY = Math.min(...points.map((point) => point.y));
  let maxX = Math.max(...points.map((point) => point.x));
  let maxY = Math.max(...points.map((point) => point.y));
  if (maxX === minX) {
    minX -= 0.5;
    maxX += 0.5;
  }
  if (maxY === minY) {
    minY -= 0.5;
    maxY += 0.5;
  }
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function serializeStartMarker(marker: BlueprintSvgMarker): string {
  return `<marker id="${escapeXml(marker.id)}" data-role="blueprint-start-marker" viewBox="0 0 100 100" markerWidth="10" markerHeight="10" refX="50" refY="50" orient="auto" markerUnits="strokeWidth">`
    + `<line x1="50" y1="34" x2="50" y2="66" stroke="${escapeXml(marker.color)}" stroke-width="6" stroke-linecap="round"/>`
    + `</marker>`;
}

function serializeEndMarker(marker: BlueprintSvgMarker): string {
  return `<marker id="${escapeXml(marker.id)}" data-role="blueprint-end-marker" viewBox="-2 0 102 100" markerWidth="10" markerHeight="10" refX="10" refY="50" orient="auto" markerUnits="strokeWidth">`
    + `<polyline points="0,40 10,50 0,60" fill="none" stroke="${escapeXml(marker.color)}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`
    + `</marker>`;
}

function encodeVisualKey(key: VisualKey): string {
  return [...key].map((character) => character.codePointAt(0)!.toString(16)).join("_");
}

function resolvePadding(value: number | undefined): number {
  if (value === undefined) return 36;
  if (!Number.isFinite(value) || value < 0) throw new BlueprintSvgError("invalid-padding");
  return value;
}

function pointText(point: Point2D): string {
  return `${canonicalNumber(point.x)} ${canonicalNumber(point.y)}`;
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new BlueprintSvgError("non-finite-geometry");
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return "0";
  return Number(value.toFixed(9)).toString();
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function freezeSvgLink(link: BlueprintSvgLink): BlueprintSvgLink {
  return Object.freeze({ ...link, center: Object.freeze({ x: link.center.x, y: link.center.y }) });
}

function freezeMarker(marker: BlueprintSvgMarker): BlueprintSvgMarker {
  return Object.freeze({ ...marker });
}

function freezeBounds(bounds: BlueprintSvgBounds): BlueprintSvgBounds {
  return Object.freeze({ ...bounds });
}
