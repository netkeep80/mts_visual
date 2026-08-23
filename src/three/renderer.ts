import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { sampleCenterline3D, type Point3D } from "../geometry3d.js";
import {
  movePinnedLivePhysics3D,
  pinLivePhysics3D,
  releaseLivePhysics3D,
  setLivePhysics3DOptions,
  snapshotLivePhysics3D,
  stepLivePhysics3D,
  type LivePhysics3DController,
} from "../live-physics3d.js";
import type { Physics3DOptions, Physics3DState } from "../physics3d.js";
import {
  normalizeVisualPresentationState,
  type VisualPresentationKeySpace,
  type VisualPresentationState,
} from "../presentation.js";
import type { VisualKey } from "../index.js";
import type { VisualThreeArcData, VisualThreeSceneData } from "./index.js";

export interface VisualThreeContainer {
  readonly clientWidth: number;
  readonly clientHeight: number;
  appendChild(node: Node): Node;
  removeChild(node: Node): Node;
  contains(node: Node): boolean;
  getBoundingClientRect(): { readonly width: number; readonly height: number };
}

export interface VisualThreeRenderingSurface {
  readonly domElement: Node;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

export interface VisualThreeResizeObserver {
  disconnect(): void;
}

export interface VisualThreeRendererOptions {
  readonly samples?: number;
  readonly nodeRadius?: number;
  readonly surfaceFactory?: () => VisualThreeRenderingSurface;
  readonly resizeObserverFactory?: (callback: () => void) => VisualThreeResizeObserver;
  readonly labelSpriteFactory?: (text: string, key: VisualKey) => THREE.Sprite;
}

export interface VisualThreeControls {
  enabled: boolean;
  readonly target: { copy(value: THREE.Vector3): unknown };
  update(): void;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
  dispose(): void;
}

export interface VisualThreeLiveRendererOptions extends VisualThreeRendererOptions {
  readonly requestFrame?: (callback: (timestamp: number) => void) => number;
  readonly cancelFrame?: (handle: number) => void;
  readonly controlsFactory?: (camera: THREE.PerspectiveCamera, element: Node) => VisualThreeControls;
  readonly dragThreshold?: number;
  readonly onActivateKey?: (key: VisualKey) => void;
}

export interface VisualThreeRendererSnapshot {
  readonly mounted: true;
  readonly nodeCount: number;
  readonly arcCount: number;
  readonly arrowCount: number;
  readonly width: number;
  readonly height: number;
  readonly cameraPosition: Point3D;
}

export type VisualThreeLivePhysicsPatch = Pick<Physics3DOptions, "charge" | "springStiffness">;

type PresentationObject = THREE.Mesh | THREE.Line;
type SceneProjector = (state: Physics3DState) => VisualThreeSceneData;

interface VisualThreePointerEvent {
  readonly button: number;
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
}

interface VisualThreePointerSurface {
  addEventListener(type: string, listener: (event: VisualThreePointerEvent) => void): void;
  removeEventListener(type: string, listener: (event: VisualThreePointerEvent) => void): void;
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  hasPointerCapture?(pointerId: number): boolean;
  getBoundingClientRect?(): {
    readonly left?: number;
    readonly top?: number;
    readonly width: number;
    readonly height: number;
  };
}

interface DragCandidate {
  readonly key: VisualKey;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly plane: THREE.Plane;
  readonly offset: THREE.Vector3;
  crossedThreshold: boolean;
}

interface LiveBinding {
  readonly controller: LivePhysics3DController;
  readonly project: SceneProjector;
  readonly requestFrame: (callback: (timestamp: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly controls: VisualThreeControls;
  readonly element: VisualThreePointerSurface;
  readonly dragThreshold: number;
  readonly onActivateKey: ((key: VisualKey) => void) | undefined;
  readonly raycaster: THREE.Raycaster;
  readonly pointer: THREE.Vector2;
  readonly onPointerDown: (event: VisualThreePointerEvent) => void;
  readonly onPointerMove: (event: VisualThreePointerEvent) => void;
  readonly onPointerUp: (event: VisualThreePointerEvent) => void;
  readonly onPointerCancel: (event: VisualThreePointerEvent) => void;
  readonly onControlsChange: () => void;
  paused: boolean;
  destroyed: boolean;
  frameHandle: number | undefined;
  candidate: DragCandidate | undefined;
  active: DragCandidate | undefined;
}

interface MountedRenderer {
  readonly container: VisualThreeContainer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly surface: VisualThreeRenderingSurface;
  readonly samples: number;
  readonly nodeRadius: number;
  readonly labelSpriteFactory: (text: string, key: VisualKey) => THREE.Sprite;
  readonly objects: PresentationObject[];
  readonly halos: THREE.Mesh[];
  readonly labels: THREE.Sprite[];
  readonly fitPoints: THREE.Vector3[];
  readonly target: THREE.Vector3;
  observer?: VisualThreeResizeObserver;
  live: LiveBinding | undefined;
  presentation: VisualPresentationState;
  keySpace: VisualPresentationKeySpace;
  nodes: VisualThreeSceneData["nodes"];
  nodeCount: number;
  arcCount: number;
  arrowCount: number;
  width: number;
  height: number;
}

const mounts = new WeakMap<object, MountedRenderer>();
const UP = new THREE.Vector3(0, 1, 0);
const EMPTY_PRESENTATION: VisualPresentationState = Object.freeze({ links: Object.freeze([]) });
const EMPTY_NODES: VisualThreeSceneData["nodes"] = Object.freeze([]);

function positiveFinite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function segmentCount(value: number | undefined): number {
  return Math.max(1, Math.floor(positiveFinite(value, 16)));
}

function viewport(container: VisualThreeContainer): readonly [number, number] {
  const rect = container.getBoundingClientRect();
  const width = Number.isFinite(container.clientWidth) && container.clientWidth > 0
    ? container.clientWidth : rect.width;
  const height = Number.isFinite(container.clientHeight) && container.clientHeight > 0
    ? container.clientHeight : rect.height;
  return [Math.max(1, Number.isFinite(width) ? width : 1), Math.max(1, Number.isFinite(height) ? height : 1)];
}

function render(state: MountedRenderer): void {
  state.surface.render(state.scene, state.camera);
}

function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function disposeObject(object: PresentationObject): void {
  object.geometry.dispose();
  for (const material of materialList(object.material)) material.dispose();
}

function disposeLabel(sprite: THREE.Sprite): void {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

function clearHalos(state: MountedRenderer): void {
  for (const halo of state.halos) {
    state.scene.remove(halo);
    disposeObject(halo);
  }
  state.halos.length = 0;
}

function clearLabels(state: MountedRenderer): void {
  for (const label of state.labels) {
    state.scene.remove(label);
    disposeLabel(label);
  }
  state.labels.length = 0;
}

function clearPresentation(state: MountedRenderer): void {
  clearHalos(state);
  clearLabels(state);
  for (const object of state.objects) {
    state.scene.remove(object);
    disposeObject(object);
  }
  state.objects.length = 0;
  state.fitPoints.length = 0;
  state.nodeCount = 0;
  state.arcCount = 0;
  state.arrowCount = 0;
}

function threePoint(point: Point3D): THREE.Vector3 {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function point3D(point: THREE.Vector3): Point3D {
  return Object.freeze({ x: point.x, y: point.y, z: point.z });
}

function addNode(state: MountedRenderer, node: VisualThreeSceneData["nodes"][number]): void {
  const geometry = new THREE.SphereGeometry(state.nodeRadius, 12, 8);
  const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(node.position.x, node.position.y, node.position.z);
  mesh.userData = { kind: "link-center", key: node.key };
  state.scene.add(mesh);
  state.objects.push(mesh);
  state.fitPoints.push(threePoint(node.position));
  state.nodeCount += 1;
}

function addArc(state: MountedRenderer, arc: VisualThreeArcData): readonly THREE.Vector3[] {
  const sampled = sampleCenterline3D(arc.centerline, state.samples);
  const points = sampled.map(threePoint);
  const positions = new Float32Array(points.length * 3);
  const colors = new Float32Array(points.length * 3);
  const from = new THREE.Color(arc.colorFrom);
  const to = new THREE.Color(arc.colorTo);
  const mixed = new THREE.Color();

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const offset = index * 3;
    positions[offset] = point.x;
    positions[offset + 1] = point.y;
    positions[offset + 2] = point.z;
    mixed.copy(from).lerp(to, points.length === 1 ? 0 : index / (points.length - 1));
    colors[offset] = mixed.r;
    colors[offset + 1] = mixed.g;
    colors[offset + 2] = mixed.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.LineBasicMaterial({ vertexColors: true });
  const line = new THREE.Line(geometry, material);
  line.userData = { kind: "link-arc", key: arc.linkKey, role: arc.role };
  state.scene.add(line);
  state.objects.push(line);
  state.fitPoints.push(...points.map((point) => point.clone()));
  state.arcCount += 1;
  return points;
}

function addEndArrow(state: MountedRenderer, arc: VisualThreeArcData, points: readonly THREE.Vector3[]): void {
  if (arc.role !== "end" || points.length < 2) return;
  const tip = points.at(-1)!;
  const before = points.at(-2)!;
  const direction = tip.clone().sub(before);
  const length = direction.length();
  if (!Number.isFinite(length) || length <= 1e-12) return;
  direction.multiplyScalar(1 / length);

  const height = Math.max(state.nodeRadius * 1.3, 0.08);
  const geometry = new THREE.ConeGeometry(Math.max(state.nodeRadius * 0.45, 0.025), height, 8);
  const material = new THREE.MeshBasicMaterial({ color: arc.colorTo });
  const arrow = new THREE.Mesh(geometry, material);
  arrow.position.copy(tip).addScaledVector(direction, -height * 0.35);
  arrow.quaternion.setFromUnitVectors(UP, direction);
  arrow.userData = { kind: "end-arrow", key: arc.linkKey, role: arc.role };
  state.scene.add(arrow);
  state.objects.push(arrow);
  state.fitPoints.push(tip.clone());
  state.arrowCount += 1;
}

function reconcilePresentation(state: MountedRenderer, data: VisualThreeSceneData): void {
  const knownKeys = new Set(data.nodes.map((node) => node.key));
  state.keySpace = Object.freeze({ links: data.nodes });
  const retained = state.presentation.links.filter((entry) => knownKeys.has(entry.key));
  if (retained.length !== state.presentation.links.length) {
    state.presentation = Object.freeze({ links: Object.freeze(retained) });
  }
}

function applyPresentation(state: MountedRenderer): void {
  clearHalos(state);
  clearLabels(state);
  const byKey = new Map(state.presentation.links.map((entry) => [entry.key, entry] as const));
  const centers = new Map<VisualKey, THREE.Mesh>();

  for (const object of state.objects) {
    const key = object.userData.key;
    if (typeof key !== "string") continue;
    const entry = byKey.get(key);
    object.visible = entry?.visible ?? true;
    if (object instanceof THREE.Mesh && object.userData.kind === "link-center") {
      object.scale.setScalar(entry?.emphasis ?? 1);
      centers.set(key, object);
    }
  }

  for (const entry of state.presentation.links) {
    if (!entry.selected && entry.halo === undefined) continue;
    const center = centers.get(entry.key);
    if (!center) continue;
    const halo = entry.halo;
    const geometry = new THREE.SphereGeometry(state.nodeRadius, 12, 8);
    const material = new THREE.MeshBasicMaterial({
      color: halo?.color ?? 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: halo?.opacity ?? 0.22,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(center.position);
    mesh.scale.setScalar(halo?.scale ?? 1.55);
    mesh.visible = entry.visible ?? true;
    mesh.userData = { kind: "presentation-halo", key: entry.key };
    state.scene.add(mesh);
    state.halos.push(mesh);
  }

  for (const node of state.nodes) {
    const entry = byKey.get(node.key);
    if (entry?.labelVisible !== true || node.label === undefined) continue;
    const sprite = state.labelSpriteFactory(node.label, node.key);
    sprite.position.set(node.position.x, node.position.y + state.nodeRadius * 2.2, node.position.z);
    sprite.scale.set(state.nodeRadius * 4, state.nodeRadius * 1.5, 1);
    sprite.visible = entry.visible ?? true;
    sprite.userData = { ...sprite.userData, kind: "presentation-label", key: node.key };
    state.scene.add(sprite);
    state.labels.push(sprite);
  }
}

function populate(state: MountedRenderer, data: VisualThreeSceneData): void {
  reconcilePresentation(state, data);
  clearPresentation(state);
  state.nodes = data.nodes;
  for (const node of data.nodes) addNode(state, node);
  for (const arc of data.arcs) {
    const points = addArc(state, arc);
    addEndArrow(state, arc, points);
  }
  applyPresentation(state);
}

function defaultSurface(): VisualThreeRenderingSurface {
  return new THREE.WebGLRenderer({ antialias: true });
}

function defaultLabelSpriteFactory(text: string, _key: VisualKey): THREE.Sprite {
  if (typeof document === "undefined") {
    throw new Error("@mts/visual/three: document is unavailable for label rendering");
  }
  const canvas = document.createElement("canvas");
  const measureContext = canvas.getContext("2d");
  if (!measureContext) {
    throw new Error("@mts/visual/three: canvas 2D context is unavailable for label rendering");
  }
  measureContext.font = "48px sans-serif";
  canvas.width = Math.max(64, Math.ceil(measureContext.measureText(text).width) + 24);
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("@mts/visual/three: canvas 2D context is unavailable for label rendering");
  }
  context.font = "48px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#ffffff";
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  return new THREE.Sprite(material);
}

function defaultControls(camera: THREE.PerspectiveCamera, element: Node): VisualThreeControls {
  const controls = new OrbitControls(camera, element as HTMLElement);
  return {
    get enabled() { return controls.enabled; },
    set enabled(value: boolean) { controls.enabled = value; },
    target: controls.target,
    update: () => { controls.update(); },
    addEventListener: (_type, listener) => { controls.addEventListener("change", listener as never); },
    removeEventListener: (_type, listener) => { controls.removeEventListener("change", listener as never); },
    dispose: () => { controls.dispose(); },
  };
}

function browserRequestFrame(callback: (timestamp: number) => void): number {
  if (typeof requestAnimationFrame === "undefined") {
    throw new Error("@mts/visual/three: requestAnimationFrame is unavailable");
  }
  return requestAnimationFrame(callback);
}

function browserCancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(handle);
}

function snapshot(state: MountedRenderer): VisualThreeRendererSnapshot {
  return Object.freeze({
    mounted: true as const,
    nodeCount: state.nodeCount,
    arcCount: state.arcCount,
    arrowCount: state.arrowCount,
    width: state.width,
    height: state.height,
    cameraPosition: Object.freeze({ x: state.camera.position.x, y: state.camera.position.y, z: state.camera.position.z }),
  });
}

function liveProject(state: MountedRenderer, physicsState?: Physics3DState): void {
  const live = state.live;
  if (!live || live.destroyed) return;
  const current = physicsState ?? snapshotLivePhysics3D(live.controller).state;
  populate(state, live.project(current));
  render(state);
}

function scheduleLiveFrame(state: MountedRenderer): void {
  const live = state.live;
  if (!live || live.destroyed || live.frameHandle !== undefined) return;
  const current = snapshotLivePhysics3D(live.controller);
  if (!live.active && (live.paused || !current.awake)) return;
  live.frameHandle = live.requestFrame(() => { runLiveFrame(state); });
}

function runLiveFrame(state: MountedRenderer): void {
  const live = state.live;
  if (!live || live.destroyed) return;
  live.frameHandle = undefined;
  if (!live.paused) {
    const current = snapshotLivePhysics3D(live.controller);
    if (current.awake) {
      const stepped = stepLivePhysics3D(live.controller);
      liveProject(state, stepped.state);
    } else if (live.active) render(state);
  } else if (live.active) render(state);
  scheduleLiveFrame(state);
}

function pointerSurface(state: MountedRenderer): VisualThreePointerSurface {
  return state.surface.domElement as unknown as VisualThreePointerSurface;
}

function pointerRect(state: MountedRenderer, live: LiveBinding): Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}> {
  const raw = (live.element.getBoundingClientRect?.() ?? state.container.getBoundingClientRect()) as {
    readonly left?: number;
    readonly top?: number;
    readonly width: number;
    readonly height: number;
  };
  const width = Number.isFinite(raw.width) && raw.width > 0 ? raw.width : state.width;
  const height = Number.isFinite(raw.height) && raw.height > 0 ? raw.height : state.height;
  const left = typeof raw.left === "number" && Number.isFinite(raw.left) ? raw.left : 0;
  const top = typeof raw.top === "number" && Number.isFinite(raw.top) ? raw.top : 0;
  return { left, top, width: Math.max(1, width), height: Math.max(1, height) };
}

function setPointerRay(state: MountedRenderer, live: LiveBinding, event: VisualThreePointerEvent): void {
  const rect = pointerRect(state, live);
  live.pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  state.camera.updateMatrixWorld();
  state.scene.updateMatrixWorld(true);
  live.raycaster.setFromCamera(live.pointer, state.camera);
}

function centerMeshes(state: MountedRenderer): THREE.Mesh[] {
  return state.objects.filter((object): object is THREE.Mesh =>
    object instanceof THREE.Mesh && object.userData.kind === "link-center");
}

function currentPoint(controller: LivePhysics3DController, key: VisualKey): Point3D | undefined {
  return snapshotLivePhysics3D(controller).state.positions.find((entry) => entry.key === key)?.point;
}

function beginCandidate(state: MountedRenderer, event: VisualThreePointerEvent): void {
  const live = state.live;
  if (!live || live.destroyed || event.button !== 0 || live.candidate || live.active) return;
  setPointerRay(state, live, event);
  const hit = live.raycaster.intersectObjects(centerMeshes(state), false)[0];
  if (!hit) return;
  const mesh = hit.object as THREE.Mesh;
  const key = mesh.userData.key;
  if (typeof key !== "string") return;
  const normal = state.camera.getWorldDirection(new THREE.Vector3());
  if (normal.lengthSq() <= 1e-24) return;
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), mesh.position);
  const intersection = live.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  if (!intersection) return;
  live.candidate = {
    key,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    plane,
    offset: mesh.position.clone().sub(intersection),
    crossedThreshold: false,
  };
}

function activateCandidate(state: MountedRenderer, live: LiveBinding, candidate: DragCandidate): boolean {
  const current = currentPoint(live.controller, candidate.key);
  if (!current) return false;
  pinLivePhysics3D(live.controller, candidate.key, current);
  live.active = candidate;
  live.controls.enabled = false;
  live.element.setPointerCapture?.(candidate.pointerId);
  return true;
}

function moveActive(state: MountedRenderer, event: VisualThreePointerEvent): boolean {
  const live = state.live;
  const active = live?.active;
  if (!live || !active || active.pointerId !== event.pointerId) return false;
  setPointerRay(state, live, event);
  const intersection = live.raycaster.ray.intersectPlane(active.plane, new THREE.Vector3());
  if (!intersection) return false;
  const target = intersection.add(active.offset);
  movePinnedLivePhysics3D(live.controller, active.key, point3D(target));
  liveProject(state);
  event.preventDefault();
  scheduleLiveFrame(state);
  return true;
}

function continueCandidate(state: MountedRenderer, event: VisualThreePointerEvent): void {
  const live = state.live;
  const candidate = live?.candidate;
  if (!live || !candidate || candidate.pointerId !== event.pointerId) return;
  if (!live.active) {
    const distance = Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY);
    if (distance < live.dragThreshold) return;
    candidate.crossedThreshold = true;
    if (!activateCandidate(state, live, candidate)) return;
  }
  moveActive(state, event);
}

function releaseCapture(live: LiveBinding, pointerId: number): void {
  if (!live.element.hasPointerCapture || live.element.hasPointerCapture(pointerId)) {
    live.element.releasePointerCapture?.(pointerId);
  }
}

function finishCandidate(state: MountedRenderer, event: VisualThreePointerEvent, finalMove: boolean): void {
  const live = state.live;
  const candidate = live?.candidate;
  if (!live || !candidate || candidate.pointerId !== event.pointerId) return;
  const active = live.active;
  const shouldActivate = finalMove && !active && !candidate.crossedThreshold;
  const onActivateKey = live.onActivateKey;
  if (active) {
    if (finalMove) moveActive(state, event);
    if (snapshotLivePhysics3D(live.controller).pinnedKeys.includes(active.key)) {
      releaseLivePhysics3D(live.controller, active.key);
    }
    live.controls.enabled = true;
    releaseCapture(live, active.pointerId);
    live.active = undefined;
    liveProject(state);
    scheduleLiveFrame(state);
  }
  live.candidate = undefined;
  if (shouldActivate && onActivateKey) onActivateKey(candidate.key);
}

function detachLive(state: MountedRenderer): void {
  const live = state.live;
  if (!live) return;
  live.destroyed = true;
  if (live.frameHandle !== undefined) {
    live.cancelFrame(live.frameHandle);
    live.frameHandle = undefined;
  }
  if (live.active) {
    if (snapshotLivePhysics3D(live.controller).pinnedKeys.includes(live.active.key)) {
      releaseLivePhysics3D(live.controller, live.active.key);
    }
    releaseCapture(live, live.active.pointerId);
    live.active = undefined;
  }
  live.candidate = undefined;
  live.controls.enabled = true;
  live.element.removeEventListener("pointerdown", live.onPointerDown);
  live.element.removeEventListener("pointermove", live.onPointerMove);
  live.element.removeEventListener("pointerup", live.onPointerUp);
  live.element.removeEventListener("pointercancel", live.onPointerCancel);
  live.controls.removeEventListener("change", live.onControlsChange);
  live.controls.dispose();
  state.live = undefined;
}

function syncControls(state: MountedRenderer): void {
  const live = state.live;
  if (!live || live.destroyed) return;
  live.controls.target.copy(state.target);
  live.controls.update();
}

export function createVisualThreeRenderer(
  container: VisualThreeContainer,
  data: VisualThreeSceneData,
  options: VisualThreeRendererOptions = {},
): VisualThreeRendererSnapshot {
  destroyVisualThreeRenderer(container);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
  camera.position.set(0, 0, 5);
  const surface = options.surfaceFactory?.() ?? defaultSurface();
  const state: MountedRenderer = {
    container,
    scene,
    camera,
    surface,
    samples: segmentCount(options.samples),
    nodeRadius: positiveFinite(options.nodeRadius, 0.12),
    labelSpriteFactory: options.labelSpriteFactory ?? defaultLabelSpriteFactory,
    objects: [],
    halos: [],
    labels: [],
    fitPoints: [],
    target: new THREE.Vector3(),
    live: undefined,
    presentation: EMPTY_PRESENTATION,
    keySpace: Object.freeze({ links: Object.freeze([]) }),
    nodes: EMPTY_NODES,
    nodeCount: 0,
    arcCount: 0,
    arrowCount: 0,
    width: 1,
    height: 1,
  };
  mounts.set(container, state);
  container.appendChild(surface.domElement);
  populate(state, data);
  resizeVisualThreeRenderer(container);
  fitVisualThreeRenderer(container);

  if (options.resizeObserverFactory) {
    state.observer = options.resizeObserverFactory(() => { resizeVisualThreeRenderer(container); });
  } else if (typeof ResizeObserver !== "undefined" && container instanceof Element) {
    const observer = new ResizeObserver(() => { resizeVisualThreeRenderer(container); });
    observer.observe(container);
    state.observer = observer;
  }
  return snapshot(state);
}

export function attachVisualThreeLiveController(
  container: VisualThreeContainer,
  controller: LivePhysics3DController,
  project: SceneProjector,
  options: VisualThreeLiveRendererOptions = {},
): boolean {
  const state = mounts.get(container);
  if (!state) return false;
  detachLive(state);
  const element = pointerSurface(state);
  if (typeof element.addEventListener !== "function" || typeof element.removeEventListener !== "function") {
    throw new Error("@mts/visual/three: rendering surface does not support pointer events");
  }
  const controls = options.controlsFactory?.(state.camera, state.surface.domElement)
    ?? defaultControls(state.camera, state.surface.domElement);
  const requestFrame = options.requestFrame ?? browserRequestFrame;
  const cancelFrame = options.cancelFrame ?? browserCancelFrame;
  const live = {} as LiveBinding;
  Object.assign(live, {
    controller,
    project,
    requestFrame,
    cancelFrame,
    controls,
    element,
    dragThreshold: positiveFinite(options.dragThreshold, 4),
    onActivateKey: options.onActivateKey,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    paused: false,
    destroyed: false,
    frameHandle: undefined,
    candidate: undefined,
    active: undefined,
    onPointerDown: (event: VisualThreePointerEvent) => { beginCandidate(state, event); },
    onPointerMove: (event: VisualThreePointerEvent) => { continueCandidate(state, event); },
    onPointerUp: (event: VisualThreePointerEvent) => { finishCandidate(state, event, true); },
    onPointerCancel: (event: VisualThreePointerEvent) => { finishCandidate(state, event, false); },
    onControlsChange: () => { if (state.live === live && !live.destroyed) render(state); },
  } satisfies Partial<LiveBinding>);
  state.live = live;
  element.addEventListener("pointerdown", live.onPointerDown);
  element.addEventListener("pointermove", live.onPointerMove);
  element.addEventListener("pointerup", live.onPointerUp);
  element.addEventListener("pointercancel", live.onPointerCancel);
  controls.addEventListener("change", live.onControlsChange);
  syncControls(state);
  scheduleLiveFrame(state);
  return true;
}

export function hasVisualThreeLiveController(container: VisualThreeContainer): boolean {
  const live = mounts.get(container)?.live;
  return !!live && !live.destroyed;
}

export function setVisualThreeLivePhysicsOptions(
  container: VisualThreeContainer,
  patch: VisualThreeLivePhysicsPatch,
): boolean {
  const state = mounts.get(container);
  const live = state?.live;
  if (!state || !live || live.destroyed) return false;
  setLivePhysics3DOptions(live.controller, patch);
  live.paused = false;
  scheduleLiveFrame(state);
  return true;
}

export function setVisualThreeLivePaused(container: VisualThreeContainer, paused: boolean): boolean {
  const state = mounts.get(container);
  const live = state?.live;
  if (!state || !live || live.destroyed) return false;
  live.paused = paused;
  if (paused && live.frameHandle !== undefined) {
    live.cancelFrame(live.frameHandle);
    live.frameHandle = undefined;
  }
  scheduleLiveFrame(state);
  return true;
}

export function setVisualThreePresentation(
  container: VisualThreeContainer,
  presentation: VisualPresentationState,
): boolean {
  const state = mounts.get(container);
  if (!state) return false;
  const normalized = normalizeVisualPresentationState(state.keySpace, presentation);
  state.presentation = normalized;
  applyPresentation(state);
  render(state);
  return true;
}

export function updateVisualThreeRenderer(container: VisualThreeContainer, data: VisualThreeSceneData): boolean {
  const state = mounts.get(container);
  if (!state) return false;
  populate(state, data);
  render(state);
  return true;
}

export function resizeVisualThreeRenderer(container: VisualThreeContainer): boolean {
  const state = mounts.get(container);
  if (!state) return false;
  const [width, height] = viewport(container);
  state.width = width;
  state.height = height;
  state.surface.setSize(width, height, false);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  render(state);
  return true;
}

export function fitVisualThreeRenderer(container: VisualThreeContainer, padding = 1.15): boolean {
  const state = mounts.get(container);
  if (!state || state.fitPoints.length === 0 || !Number.isFinite(padding) || padding <= 0) return false;
  const box = new THREE.Box3().setFromPoints(state.fitPoints);
  const center = box.getCenter(new THREE.Vector3());
  let radius = 0;
  for (const point of state.fitPoints) radius = Math.max(radius, point.distanceTo(center));
  const halfFov = THREE.MathUtils.degToRad(state.camera.fov) / 2;
  const distance = Math.max(radius / Math.max(Math.sin(halfFov), 1e-6), state.nodeRadius * 4, 1) * padding;
  state.target.copy(center);
  state.camera.position.set(center.x, center.y, center.z + distance);
  state.camera.lookAt(center);
  state.camera.updateMatrixWorld();
  syncControls(state);
  render(state);
  return true;
}

export function zoomVisualThreeRenderer(container: VisualThreeContainer, factor: number): boolean {
  const state = mounts.get(container);
  if (!state || !Number.isFinite(factor) || factor <= 0) return false;
  const offset = state.camera.position.clone().sub(state.target);
  if (offset.lengthSq() <= 1e-24) offset.set(0, 0, 1);
  state.camera.position.copy(state.target).add(offset.multiplyScalar(factor));
  state.camera.lookAt(state.target);
  state.camera.updateMatrixWorld();
  render(state);
  return true;
}

export function getVisualThreeRendererSnapshot(container: VisualThreeContainer): VisualThreeRendererSnapshot | undefined {
  const state = mounts.get(container);
  return state ? snapshot(state) : undefined;
}

export function destroyVisualThreeRenderer(container: VisualThreeContainer): boolean {
  const state = mounts.get(container);
  if (!state) return false;
  detachLive(state);
  state.observer?.disconnect();
  clearPresentation(state);
  if (container.contains(state.surface.domElement)) container.removeChild(state.surface.domElement);
  state.surface.dispose();
  mounts.delete(container);
  return true;
}
