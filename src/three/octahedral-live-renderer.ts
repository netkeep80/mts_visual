import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type {
  OctahedralLivePhysics3D,
  Point3D,
  VisualLinkNetwork,
} from "../index.js";
import { createOctahedralThreeBatch, type OctahedralThreeBatch } from "./octahedral-batch.js";
import type {
  VisualThreeContainer,
  VisualThreeControls,
  VisualThreeRenderingSurface,
  VisualThreeResizeObserver,
} from "./renderer.js";

export interface OctahedralThreeLiveRendererOptions {
  readonly surfaceFactory?: () => VisualThreeRenderingSurface;
  readonly resizeObserverFactory?: (callback: () => void) => VisualThreeResizeObserver;
  readonly requestFrame?: (callback: (timestamp: number) => void) => number;
  readonly cancelFrame?: (handle: number) => void;
  readonly controlsFactory?: (camera: THREE.PerspectiveCamera, element: Node) => VisualThreeControls;
  readonly paused?: boolean;
}

export interface OctahedralThreeLiveRendererSnapshot {
  readonly mounted: true;
  readonly linkCount: number;
  readonly drawCallProxy: number;
  readonly width: number;
  readonly height: number;
  readonly cameraPosition: Point3D;
  readonly paused: boolean;
  readonly tick: number;
}

interface MountedOctahedralRenderer {
  readonly container: VisualThreeContainer;
  readonly controller: OctahedralLivePhysics3D;
  readonly batch: OctahedralThreeBatch;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly surface: VisualThreeRenderingSurface;
  readonly controls: VisualThreeControls;
  readonly target: THREE.Vector3;
  readonly requestFrame: (callback: (timestamp: number) => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly onControlsChange: () => void;
  observer?: VisualThreeResizeObserver;
  width: number;
  height: number;
  paused: boolean;
  destroyed: boolean;
  frameHandle: number | undefined;
  frameEpoch: number;
  tick: number;
}

const mounts = new WeakMap<object, MountedOctahedralRenderer>();

function defaultSurface(): VisualThreeRenderingSurface {
  return new THREE.WebGLRenderer({ antialias: true });
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

function viewport(container: VisualThreeContainer): readonly [number, number] {
  const rect = container.getBoundingClientRect();
  const width = Number.isFinite(container.clientWidth) && container.clientWidth > 0
    ? container.clientWidth
    : rect.width;
  const height = Number.isFinite(container.clientHeight) && container.clientHeight > 0
    ? container.clientHeight
    : rect.height;
  return [
    Math.max(1, Number.isFinite(width) ? width : 1),
    Math.max(1, Number.isFinite(height) ? height : 1),
  ];
}

function render(state: MountedOctahedralRenderer): void {
  state.surface.render(state.scene, state.camera);
}

function syncControls(state: MountedOctahedralRenderer): void {
  state.controls.target.copy(state.target);
  state.controls.update();
}

function snapshot(state: MountedOctahedralRenderer): OctahedralThreeLiveRendererSnapshot {
  const batch = state.batch.snapshot();
  return Object.freeze({
    mounted: true as const,
    linkCount: batch.linkCount,
    drawCallProxy: batch.drawCallProxy,
    width: state.width,
    height: state.height,
    cameraPosition: Object.freeze({
      x: state.camera.position.x,
      y: state.camera.position.y,
      z: state.camera.position.z,
    }),
    paused: state.paused,
    tick: state.tick,
  });
}

function resizeMounted(state: MountedOctahedralRenderer): void {
  const [width, height] = viewport(state.container);
  state.width = width;
  state.height = height;
  state.surface.setSize(width, height, false);
  state.camera.aspect = width / height;
  state.camera.updateProjectionMatrix();
  render(state);
}

function fitMounted(state: MountedOctahedralRenderer, padding: number): boolean {
  if (!Number.isFinite(padding) || padding <= 0) return false;
  const positions = state.controller.positions;
  if (positions.length === 0) return false;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let offset = 0; offset < positions.length; offset += 3) {
    const x = positions[offset]!;
    const y = positions[offset + 1]!;
    const z = positions[offset + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  let radius = 0;
  for (let offset = 0; offset < positions.length; offset += 3) {
    radius = Math.max(
      radius,
      Math.hypot(
        positions[offset]! - centerX,
        positions[offset + 1]! - centerY,
        positions[offset + 2]! - centerZ,
      ),
    );
  }

  const halfFov = THREE.MathUtils.degToRad(state.camera.fov) / 2;
  const minimumDistance = Math.max(state.controller.template.diameter * 2, 1);
  const distance = Math.max(
    radius / Math.max(Math.sin(halfFov), 1e-6),
    minimumDistance,
  ) * padding;

  state.target.set(centerX, centerY, centerZ);
  state.camera.position.set(centerX, centerY, centerZ + distance);
  state.camera.lookAt(state.target);
  state.camera.updateMatrixWorld();
  syncControls(state);
  render(state);
  return true;
}

function scheduleFrame(state: MountedOctahedralRenderer): void {
  if (state.destroyed || state.paused || state.frameHandle !== undefined) return;
  const epoch = state.frameEpoch;
  state.frameHandle = state.requestFrame(() => {
    runFrame(state, epoch);
  });
}

function runFrame(state: MountedOctahedralRenderer, epoch: number): void {
  if (
    state.destroyed
    || state.paused
    || epoch !== state.frameEpoch
    || mounts.get(state.container) !== state
  ) {
    return;
  }

  state.frameHandle = undefined;
  state.controller.step();
  state.batch.sync();
  state.tick += 1;
  render(state);
  scheduleFrame(state);
}

export function createOctahedralThreeLiveRenderer(
  container: VisualThreeContainer,
  controller: OctahedralLivePhysics3D,
  options: OctahedralThreeLiveRendererOptions = {},
): OctahedralThreeLiveRendererSnapshot {
  destroyOctahedralThreeLiveRenderer(container);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
  camera.position.set(0, 0, 5);
  const surface = options.surfaceFactory?.() ?? defaultSurface();
  const controls = options.controlsFactory?.(camera, surface.domElement)
    ?? defaultControls(camera, surface.domElement);
  const batch = createOctahedralThreeBatch(controller);
  scene.add(batch.group);

  const state = {} as MountedOctahedralRenderer;
  Object.assign(state, {
    container,
    controller,
    batch,
    scene,
    camera,
    surface,
    controls,
    target: new THREE.Vector3(),
    requestFrame: options.requestFrame ?? browserRequestFrame,
    cancelFrame: options.cancelFrame ?? browserCancelFrame,
    width: 1,
    height: 1,
    paused: options.paused ?? false,
    destroyed: false,
    frameHandle: undefined,
    frameEpoch: 0,
    tick: 0,
    onControlsChange: () => {
      if (!state.destroyed && mounts.get(container) === state) render(state);
    },
  } satisfies Partial<MountedOctahedralRenderer>);

  mounts.set(container, state);
  container.appendChild(surface.domElement);
  controls.addEventListener("change", state.onControlsChange);

  resizeMounted(state);
  fitMounted(state, 1.15);

  if (options.resizeObserverFactory) {
    state.observer = options.resizeObserverFactory(() => {
      if (!state.destroyed && mounts.get(container) === state) resizeMounted(state);
    });
  } else if (typeof ResizeObserver !== "undefined" && container instanceof Element) {
    const observer = new ResizeObserver(() => {
      if (!state.destroyed && mounts.get(container) === state) resizeMounted(state);
    });
    observer.observe(container);
    state.observer = observer;
  }

  scheduleFrame(state);
  return snapshot(state);
}

export function getOctahedralThreeLiveRendererSnapshot(
  container: VisualThreeContainer,
): OctahedralThreeLiveRendererSnapshot | undefined {
  const state = mounts.get(container);
  return state && !state.destroyed ? snapshot(state) : undefined;
}

export function setOctahedralThreeLivePaused(
  container: VisualThreeContainer,
  paused: boolean,
): boolean {
  const state = mounts.get(container);
  if (!state || state.destroyed) return false;
  state.paused = paused;
  state.frameEpoch += 1;
  if (state.frameHandle !== undefined) {
    state.cancelFrame(state.frameHandle);
    state.frameHandle = undefined;
  }
  scheduleFrame(state);
  return true;
}

export function setOctahedralThreeLiveSimulationSpeed(
  container: VisualThreeContainer,
  simulationSpeed: number,
): boolean {
  const state = mounts.get(container);
  if (!state || state.destroyed) return false;
  state.controller.setSimulationSpeed(simulationSpeed);
  return true;
}

export function setOctahedralThreeLiveStiffness(
  container: VisualThreeContainer,
  stiffness: number,
): boolean {
  const state = mounts.get(container);
  if (!state || state.destroyed) return false;
  state.controller.setStiffness(stiffness);
  return true;
}

export function transitionOctahedralThreeLiveNetwork(
  container: VisualThreeContainer,
  network: VisualLinkNetwork,
): boolean {
  const state = mounts.get(container);
  if (!state || state.destroyed) return false;
  state.controller.transition(network);
  state.batch.sync();
  render(state);
  return true;
}

export function resizeOctahedralThreeLiveRenderer(container: VisualThreeContainer): boolean {
  const state = mounts.get(container);
  if (!state || state.destroyed) return false;
  resizeMounted(state);
  return true;
}

export function fitOctahedralThreeLiveRenderer(
  container: VisualThreeContainer,
  padding = 1.15,
): boolean {
  const state = mounts.get(container);
  if (!state || state.destroyed) return false;
  return fitMounted(state, padding);
}

export function destroyOctahedralThreeLiveRenderer(container: VisualThreeContainer): boolean {
  const state = mounts.get(container);
  if (!state) return false;

  state.destroyed = true;
  state.frameEpoch += 1;
  if (state.frameHandle !== undefined) {
    state.cancelFrame(state.frameHandle);
    state.frameHandle = undefined;
  }

  state.observer?.disconnect();
  state.controls.removeEventListener("change", state.onControlsChange);
  state.controls.dispose();
  state.scene.remove(state.batch.group);
  state.batch.dispose();

  if (container.contains(state.surface.domElement)) {
    container.removeChild(state.surface.domElement);
  }
  state.surface.dispose();
  mounts.delete(container);
  return true;
}
