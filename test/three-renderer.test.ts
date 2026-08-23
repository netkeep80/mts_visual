import {
  type Physics3DState,
  type Point3D,
  type VisualLinkNetwork,
} from "../src/index.js";
import {
  VISUAL_THREE_COLORS,
  buildVisualThreeSceneData,
  type VisualThreeSceneData,
} from "../src/three/index.js";
import {
  createVisualThreeRenderer,
  destroyVisualThreeRenderer,
  fitVisualThreeRenderer,
  getVisualThreeRendererSnapshot,
  resizeVisualThreeRenderer,
  updateVisualThreeRenderer,
  zoomVisualThreeRenderer,
} from "../src/three/renderer.js";

type DisposableProbe = {
  addEventListener?: (type: string, listener: () => void) => void;
};

type GeometryProbe = DisposableProbe & {
  getAttribute?: (name: string) => { readonly array: ArrayLike<number> } | undefined;
};

type MaterialProbe = DisposableProbe;

type ObjectProbe = {
  readonly userData?: Readonly<Record<string, unknown>>;
  readonly position?: Point3D;
  readonly quaternion?: Readonly<{ x: number; y: number; z: number; w: number }>;
  readonly scale?: Point3D;
  readonly geometry?: GeometryProbe;
  readonly material?: MaterialProbe | readonly MaterialProbe[];
};

type SceneProbe = {
  readonly children: readonly ObjectProbe[];
};

type CameraProbe = {
  readonly position: Point3D;
  readonly aspect: number;
};

type RendererSnapshotProbe = {
  readonly mounted: true;
  readonly nodeCount: number;
  readonly arcCount: number;
  readonly arrowCount: number;
  readonly width: number;
  readonly height: number;
  readonly cameraPosition: Point3D;
};

type FakeElement = { readonly token: string; parentNode?: FakeContainer | null };

type FakeContainer = {
  clientWidth: number;
  clientHeight: number;
  readonly children: FakeElement[];
  appendChild: (element: FakeElement) => FakeElement;
  removeChild: (element: FakeElement) => FakeElement;
  contains: (element: FakeElement) => boolean;
  getBoundingClientRect: () => { width: number; height: number };
};

type SurfaceProbe = {
  readonly domElement: FakeElement;
  setSize: (width: number, height: number, updateStyle?: boolean) => void;
  render: (scene: unknown, camera: unknown) => void;
  dispose: () => void;
};

type ObserverProbe = { disconnect: () => void };

type RendererOptionsProbe = {
  readonly samples?: number;
  readonly nodeRadius?: number;
  readonly surfaceFactory?: () => SurfaceProbe;
  readonly resizeObserverFactory?: (callback: () => void) => ObserverProbe;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V2f-B: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function close(actual: number, expected: number, message: string, epsilon = 1e-6): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} != ${expected}`);
}

function finitePoint(value: Point3D): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function container(width = 640, height = 360): FakeContainer {
  const children: FakeElement[] = [];
  const result: FakeContainer = {
    clientWidth: width,
    clientHeight: height,
    children,
    appendChild(element) {
      if (!children.includes(element)) children.push(element);
      element.parentNode = result;
      return element;
    },
    removeChild(element) {
      const index = children.indexOf(element);
      if (index >= 0) children.splice(index, 1);
      element.parentNode = null;
      return element;
    },
    contains: (element) => children.includes(element),
    getBoundingClientRect: () => ({ width: result.clientWidth, height: result.clientHeight }),
  };
  return result;
}

function sceneData(): VisualThreeSceneData {
  const network: VisualLinkNetwork = {
    links: [
      { key: "R", startKey: "R", endKey: "R", label: "∞", tags: ["root"] },
      { key: "O", startKey: "O", endKey: "R" },
      { key: "C", startKey: "R", endKey: "C" },
      { key: "L", startKey: "O", endKey: "C" },
      { key: "U", startKey: "C", endKey: "O" },
      { key: "X", startKey: "L", endKey: "U" },
    ],
  };
  const points: Readonly<Record<string, Point3D>> = {
    R: { x: 0, y: 0, z: 0 },
    O: { x: -2, y: 1, z: 0.5 },
    C: { x: 2, y: -1, z: -0.5 },
    L: { x: -1, y: 2, z: 1.5 },
    U: { x: 1, y: -2, z: -1.5 },
    X: { x: 0.5, y: 0.75, z: 2.5 },
  };
  const keys = Object.keys(points);
  const state: Physics3DState = {
    positions: keys.map((key) => ({ key, point: points[key]! })),
    velocities: keys.map((key) => ({ key, vector: { x: 0, y: 0, z: 0 } })),
  };
  return buildVisualThreeSceneData(network, state);
}

function rootOnlyScene(): VisualThreeSceneData {
  const network: VisualLinkNetwork = {
    links: [{ key: "R", startKey: "R", endKey: "R", label: "∞", tags: ["root"] }],
  };
  return buildVisualThreeSceneData(network, {
    positions: [{ key: "R", point: { x: 0, y: 0, z: 0 } }],
    velocities: [{ key: "R", vector: { x: 0, y: 0, z: 0 } }],
  });
}

const host = container();
let latestScene: SceneProbe | undefined;
let latestCamera: CameraProbe | undefined;
const sizes: Array<readonly [number, number, boolean | undefined]> = [];
let renderCount = 0;
let surfaceDisposeCount = 0;
let observerDisconnectCount = 0;
let observerCallback: (() => void) | undefined;

function surface(): SurfaceProbe {
  return {
    domElement: { token: `surface-${surfaceDisposeCount}-${renderCount}`, parentNode: null },
    setSize(width, height, updateStyle) {
      sizes.push([width, height, updateStyle]);
    },
    render(scene, camera) {
      latestScene = scene as SceneProbe;
      latestCamera = camera as CameraProbe;
      renderCount += 1;
    },
    dispose() {
      surfaceDisposeCount += 1;
    },
  };
}

const options: RendererOptionsProbe = {
  samples: 12,
  nodeRadius: 0.12,
  surfaceFactory: surface,
  resizeObserverFactory(callback) {
    observerCallback = callback;
    return { disconnect: () => { observerDisconnectCount += 1; } };
  },
};

const initialScene = sceneData();
const first = createVisualThreeRenderer(host as never, initialScene, options as never) as RendererSnapshotProbe;
same(first.nodeCount, 6, "one center mesh per represented Link");
same(first.arcCount, 12, "two graphical arc lines per represented Link");
same(first.arrowCount, 6, "one direction arrow per END arc");
same(first.width, 640, "initial viewport width");
same(first.height, 360, "initial viewport height");
assert(finitePoint(first.cameraPosition), "initial camera position finite");
same(host.children.length, 1, "rendering surface attached once");
assert(renderCount > 0, "create renders at least once");
assert(latestScene !== undefined, "create supplies real Three scene to rendering surface");
assert(latestCamera !== undefined, "create supplies real Three camera to rendering surface");

const centers = latestScene.children.filter((object) => object.userData?.kind === "link-center");
const arcs = latestScene.children.filter((object) => object.userData?.kind === "link-arc");
const arrows = latestScene.children.filter((object) => object.userData?.kind === "end-arrow");
same(centers.length, 6, "scene has exactly one center Mesh per Link");
same(arcs.length, 12, "scene has exact arc Line count");
same(arrows.length, 6, "scene has END arrows only");

const rootMesh = centers.find((object) => object.userData?.key === "R");
assert(rootMesh !== undefined, "root center mesh present");
same(rootMesh.userData?.kind, "link-center", "root has ordinary center kind");
same(rootMesh.userData?.key, "R", "root key remains presentation identity");
close(rootMesh.scale?.x ?? 1, 1, "root gets no special scale.x");
close(rootMesh.scale?.y ?? 1, 1, "root gets no special scale.y");
close(rootMesh.scale?.z ?? 1, 1, "root gets no special scale.z");

function line(role: "start" | "end", key: string): ObjectProbe {
  const result = arcs.find((object) => object.userData?.role === role && object.userData?.key === key);
  assert(result !== undefined, `missing ${role} line ${key}`);
  return result;
}

function colors(object: ObjectProbe): ArrayLike<number> {
  const attribute = object.geometry?.getAttribute?.("color");
  assert(attribute !== undefined, "gradient line has color attribute");
  return attribute.array;
}

function colorAt(values: ArrayLike<number>, vertex: number): readonly [number, number, number] {
  const offset = vertex * 3;
  return [values[offset]!, values[offset + 1]!, values[offset + 2]!];
}

const startLine = line("start", "X");
const endLine = line("end", "X");
const startColors = colors(startLine);
const endColors = colors(endLine);
const startLast = startColors.length / 3 - 1;
const endLast = endColors.length / 3 - 1;
const [sr, sg, sb] = colorAt(startColors, 0);
close(sr, 1, "START outer is red.r"); close(sg, 0, "START outer is red.g"); close(sb, 0, "START outer is red.b");
const [scr, scg, scb] = colorAt(startColors, startLast);
close(scr, 0, "START center is green.r"); close(scg, 1, "START center is green.g"); close(scb, 0, "START center is green.b");
const [ecr, ecg, ecb] = colorAt(endColors, 0);
close(ecr, 0, "END center is green.r"); close(ecg, 1, "END center is green.g"); close(ecb, 0, "END center is green.b");
const [er, eg, eb] = colorAt(endColors, endLast);
close(er, 0, "END outer is blue.r"); close(eg, 0, "END outer is blue.g"); close(eb, 1, "END outer is blue.b");
same(VISUAL_THREE_COLORS.startOuter, 0xff0000, "shared RED identity retained");
same(VISUAL_THREE_COLORS.center, 0x00ff00, "shared GREEN identity retained");
same(VISUAL_THREE_COLORS.endOuter, 0x0000ff, "shared BLUE identity retained");

const firstSnapshot = getVisualThreeRendererSnapshot(host as never) as RendererSnapshotProbe | undefined;
assert(firstSnapshot !== undefined, "mounted snapshot available");
const beforeInvalidZoom = JSON.stringify(firstSnapshot.cameraPosition);
same(zoomVisualThreeRenderer(host as never, 0), false, "zero zoom rejected");
same(zoomVisualThreeRenderer(host as never, Number.NaN), false, "NaN zoom rejected");
same(JSON.stringify((getVisualThreeRendererSnapshot(host as never) as RendererSnapshotProbe).cameraPosition), beforeInvalidZoom, "invalid zoom does not mutate camera");
same(zoomVisualThreeRenderer(host as never, 0.5), true, "positive finite zoom accepted");
assert(finitePoint((getVisualThreeRendererSnapshot(host as never) as RendererSnapshotProbe).cameraPosition), "zoomed camera finite");

host.clientWidth = 800;
host.clientHeight = 500;
same(resizeVisualThreeRenderer(host as never), true, "resize mounted renderer");
same(sizes.at(-1)?.[0], 800, "resize width propagated");
same(sizes.at(-1)?.[1], 500, "resize height propagated");
close(latestCamera?.aspect ?? 0, 1.6, "camera aspect updated");
observerCallback?.();
same(sizes.at(-1)?.[0], 800, "observer callback uses current width");

same(fitVisualThreeRenderer(host as never, 1.2), true, "fit finite non-coplanar scene");
assert(finitePoint((getVisualThreeRendererSnapshot(host as never) as RendererSnapshotProbe).cameraPosition), "fit camera finite");

const disposableObjects = [...latestScene.children];
let objectDisposeEvents = 0;
for (const object of disposableObjects) {
  object.geometry?.addEventListener?.("dispose", () => { objectDisposeEvents += 1; });
  const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
  for (const material of materials) material.addEventListener?.("dispose", () => { objectDisposeEvents += 1; });
}

same(updateVisualThreeRenderer(host as never, rootOnlyScene()), true, "scene data update succeeds");
const updated = getVisualThreeRendererSnapshot(host as never) as RendererSnapshotProbe;
same(updated.nodeCount, 1, "update replaces center meshes");
same(updated.arcCount, 2, "update replaces arc lines");
same(updated.arrowCount, 1, "update retains END-only arrow count");
assert(objectDisposeEvents > 0, "update disposes replaced Three resources");
same(fitVisualThreeRenderer(host as never), true, "self-loop-only scene fits finitely");
assert(finitePoint((getVisualThreeRendererSnapshot(host as never) as RendererSnapshotProbe).cameraPosition), "self-loop fit finite");

const disposedBeforeReplace = surfaceDisposeCount;
createVisualThreeRenderer(host as never, initialScene, options as never);
same(surfaceDisposeCount, disposedBeforeReplace + 1, "second create destroys previous rendering surface");
same(observerDisconnectCount, 1, "second create disconnects previous observer");
same(host.children.length, 1, "second create leaves one attached surface");

same(destroyVisualThreeRenderer(host as never), true, "destroy mounted renderer");
same(surfaceDisposeCount, disposedBeforeReplace + 2, "destroy disposes current rendering surface");
same(observerDisconnectCount, 2, "destroy disconnects current observer");
same(host.children.length, 0, "destroy removes owned rendering element");
same(destroyVisualThreeRenderer(host as never), false, "destroy is idempotent");
same(getVisualThreeRendererSnapshot(host as never), undefined, "destroy removes mount snapshot");
same(resizeVisualThreeRenderer(host as never), false, "resize missing mount is safe false");
same(fitVisualThreeRenderer(host as never), false, "fit missing mount is safe false");
same(zoomVisualThreeRenderer(host as never, 1.1), false, "zoom missing mount is safe false");
same(updateVisualThreeRenderer(host as never, initialScene), false, "update missing mount is safe false");

import {
  createLivePhysics3D,
  snapshotLivePhysics3D,
} from "../src/live-physics3d.js";
import {
  createVisualThreeLiveRenderer,
  setVisualThreeLivePaused,
} from "../src/three/index.js";

type PointerProbe = {
  readonly button: number;
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  preventDefault: () => void;
};

type InteractiveElement = FakeElement & {
  addEventListener: (type: string, listener: (event: PointerProbe) => void) => void;
  removeEventListener: (type: string, listener: (event: PointerProbe) => void) => void;
  setPointerCapture: (pointerId: number) => void;
  releasePointerCapture: (pointerId: number) => void;
  hasPointerCapture: (pointerId: number) => boolean;
  dispatch: (type: string, event: PointerProbe) => void;
  listenerCount: () => number;
};

type ControlsProbe = {
  enabled: boolean;
  readonly target: { copy: (value: unknown) => unknown };
  update: () => void;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  dispose: () => void;
};

function interactiveElement(token: string): InteractiveElement {
  const listeners = new Map<string, Set<(event: PointerProbe) => void>>();
  const captures = new Set<number>();
  return {
    token,
    parentNode: null,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    setPointerCapture(pointerId) { captures.add(pointerId); },
    releasePointerCapture(pointerId) { captures.delete(pointerId); },
    hasPointerCapture: (pointerId) => captures.has(pointerId),
    dispatch(type, event) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    listenerCount() {
      return [...listeners.values()].reduce((total, set) => total + set.size, 0);
    },
  };
}

function pointer(clientX: number, clientY: number, pointerId = 7): PointerProbe {
  return { button: 0, pointerId, clientX, clientY, preventDefault() {} };
}

const liveNetwork: VisualLinkNetwork = {
  links: [{ key: "R", startKey: "R", endKey: "R", label: "∞", tags: ["root"] }],
};
const liveInitialState: Physics3DState = {
  positions: [{ key: "R", point: { x: 0, y: 0, z: 0 } }],
  velocities: [{ key: "R", vector: { x: 0, y: 0, z: 0 } }],
};
const liveController = createLivePhysics3D(liveNetwork, liveInitialState, { settleWindow: 1 });
const liveHost = container(400, 300);
const liveElement = interactiveElement("live-surface");
let liveScene: SceneProbe | undefined;
let liveCamera: CameraProbe | undefined;
let liveDisposed = 0;
let controlDisposed = 0;
let controlUpdates = 0;
const controlListeners = new Set<() => void>();
const liveControls: ControlsProbe = {
  enabled: true,
  target: { copy: () => liveControls.target },
  update() { controlUpdates += 1; },
  addEventListener(type, listener) { if (type === "change") controlListeners.add(listener); },
  removeEventListener(type, listener) { if (type === "change") controlListeners.delete(listener); },
  dispose() { controlDisposed += 1; },
};
let nextFrameId = 1;
const frames = new Map<number, (timestamp: number) => void>();
const cancelledFrames: number[] = [];
const requestFrame = (callback: (timestamp: number) => void): number => {
  const id = nextFrameId++;
  frames.set(id, callback);
  return id;
};
const cancelFrame = (id: number): void => {
  frames.delete(id);
  cancelledFrames.push(id);
};
const liveSurface: SurfaceProbe = {
  domElement: liveElement,
  setSize() {},
  render(scene, camera) {
    liveScene = scene as SceneProbe;
    liveCamera = camera as CameraProbe;
  },
  dispose() { liveDisposed += 1; },
};

createVisualThreeLiveRenderer(liveHost as never, liveNetwork, liveController, {
  nodeRadius: 0.4,
  surfaceFactory: () => liveSurface,
  resizeObserverFactory: () => ({ disconnect() {} }),
  requestFrame,
  cancelFrame,
  controlsFactory: () => liveControls,
  dragThreshold: 5,
} as never);
assert(liveScene !== undefined && liveCamera !== undefined, "V2f-C live renderer uses real Three scene/camera");
same(frames.size, 1, "awake controller schedules one RAF");
const stalePausedFrame = [...frames.values()][0]!;
same(setVisualThreeLivePaused(liveHost as never, true), true, "pause mounted live renderer");
same(frames.size, 0, "pause cancels pending RAF");
stalePausedFrame(123456789);
same(snapshotLivePhysics3D(liveController).tick, 0, "stale paused RAF cannot tick physics");
same(setVisualThreeLivePaused(liveHost as never, false), true, "resume mounted live renderer");
same(frames.size, 1, "resume awake controller schedules RAF");
const resumedFrame = [...frames.entries()][0]!;
frames.delete(resumedFrame[0]);
resumedFrame[1](987654321);
const settled = snapshotLivePhysics3D(liveController);
same(settled.tick, 1, "one RAF means one V2e tick independent of timestamp");
same(settled.awake, false, "settled V2e controller sleeps");
same(frames.size, 0, "sleeping controller stops continuous RAF");

liveElement.dispatch("pointerdown", pointer(200, 150));
same(snapshotLivePhysics3D(liveController).pinnedKeys.length, 0, "pointerdown alone does not pin");
same(liveControls.enabled, true, "pointerdown alone leaves OrbitControls enabled");
liveElement.dispatch("pointerup", pointer(200, 150));
same(snapshotLivePhysics3D(liveController).pinnedKeys.length, 0, "simple tap never pins");

liveElement.dispatch("pointerdown", pointer(200, 150));
liveElement.dispatch("pointermove", pointer(220, 150));
let dragged = snapshotLivePhysics3D(liveController);
same(dragged.pinnedKeys.length, 1, "movement over threshold pins one exact key");
same(dragged.pinnedKeys[0], "R", "root follows ordinary draggable VisualKey path");
same(liveControls.enabled, false, "OrbitControls disabled only during active center drag");
const draggedRoot = dragged.state.positions.find((entry) => entry.key === "R")!.point;
assert(Math.abs(draggedRoot.x) + Math.abs(draggedRoot.y) + Math.abs(draggedRoot.z) > 1e-9, "drag moves V2e pinned presentation point");
liveElement.dispatch("pointerup", pointer(220, 150));
dragged = snapshotLivePhysics3D(liveController);
same(dragged.pinnedKeys.length, 0, "pointerup releases V2e pin");
same(liveControls.enabled, true, "pointerup restores OrbitControls");
assert(frames.size <= 1, "release keeps at most one live RAF scheduled");

for (const id of [...frames.keys()]) { frames.delete(id); }
liveElement.dispatch("pointerdown", pointer(200, 150, 9));
liveElement.dispatch("pointermove", pointer(218, 150, 9));
same(snapshotLivePhysics3D(liveController).pinnedKeys[0], "R", "second root drag can activate");
same(liveControls.enabled, false, "second active drag disables controls");
liveElement.dispatch("pointercancel", pointer(218, 150, 9));
same(snapshotLivePhysics3D(liveController).pinnedKeys.length, 0, "pointercancel releases V2e pin");
same(liveControls.enabled, true, "pointercancel restores controls");

liveElement.dispatch("pointerdown", pointer(200, 150, 11));
liveElement.dispatch("pointermove", pointer(215, 150, 11));
same(snapshotLivePhysics3D(liveController).pinnedKeys[0], "R", "destroy test begins with active pin");
const tickBeforeDestroy = snapshotLivePhysics3D(liveController).tick;
const staleDestroyFrames = [...frames.values()];
same(destroyVisualThreeRenderer(liveHost as never), true, "destroy tears down live renderer through common lifecycle");
same(snapshotLivePhysics3D(liveController).pinnedKeys.length, 0, "destroy releases active V2e pin");
same(liveControls.enabled, true, "destroy restores controls before disposal");
same(controlDisposed, 1, "destroy disposes controls exactly once");
same(controlListeners.size, 0, "destroy removes controls change listener");
same(liveElement.listenerCount(), 0, "destroy removes pointer listeners");
same(frames.size, 0, "destroy cancels pending RAF");
assert(cancelledFrames.length > 0, "RAF cancellation is observable");
same(liveDisposed, 1, "common renderer surface disposed once");
for (const callback of staleDestroyFrames) callback(555555555);
liveElement.dispatch("pointermove", pointer(260, 150, 11));
same(snapshotLivePhysics3D(liveController).tick, tickBeforeDestroy, "stale callbacks/events cannot tick after destroy");
assert(controlUpdates >= 0, "controls probe remains finite and deterministic");
same(setVisualThreeLivePaused(liveHost as never, true), false, "pause missing live mount is safe false");
