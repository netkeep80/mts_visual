import type { Point3D, VisualLinkNetwork } from "../src/index.js";
import { createOctahedralLivePhysics3D } from "../src/index.js";
import {
  createOctahedralThreeLiveRenderer,
  destroyOctahedralThreeLiveRenderer,
  fitOctahedralThreeLiveRenderer,
  getOctahedralThreeLiveRendererSnapshot,
  resizeOctahedralThreeLiveRenderer,
  setOctahedralThreeLivePaused,
  setOctahedralThreeLiveSimulationSpeed,
  setOctahedralThreeLiveStiffness,
  transitionOctahedralThreeLiveNetwork,
} from "../src/three/index.js";

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

type ControlsProbe = {
  enabled: boolean;
  readonly target: { copy: (value: unknown) => unknown };
  update: () => void;
  addEventListener: (type: "change", listener: () => void) => void;
  removeEventListener: (type: "change", listener: () => void) => void;
  dispose: () => void;
};

type CameraProbe = {
  readonly position: Point3D;
  readonly aspect: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual M5/P3b: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function finitePoint(value: Point3D): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function host(width = 640, height = 360): FakeContainer {
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

function selfNetwork(count: number, prefix = "L"): VisualLinkNetwork {
  return {
    links: Array.from({ length: count }, (_, index) => {
      const key = `${prefix}${index}`;
      return { key, startKey: key, endKey: key };
    }),
  };
}

const container = host();
const element: FakeElement = { token: "octahedral-live", parentNode: null };
let latestScene: unknown;
let latestCamera: CameraProbe | undefined;
let renderCount = 0;
let surfaceDisposeCount = 0;
const sizes: Array<readonly [number, number, boolean | undefined]> = [];
const surface: SurfaceProbe = {
  domElement: element,
  setSize(width, height, updateStyle) {
    sizes.push([width, height, updateStyle]);
  },
  render(scene, camera) {
    latestScene = scene;
    latestCamera = camera as CameraProbe;
    renderCount += 1;
  },
  dispose() {
    surfaceDisposeCount += 1;
  },
};

let observerDisconnectCount = 0;
let observerCallback: (() => void) | undefined;

let controlsDisposed = 0;
let controlsUpdated = 0;
let controlsTargetCopies = 0;
const controlListeners = new Set<() => void>();
const controls: ControlsProbe = {
  enabled: true,
  target: {
    copy(value) {
      void value;
      controlsTargetCopies += 1;
      return controls.target;
    },
  },
  update() { controlsUpdated += 1; },
  addEventListener(type, listener) {
    if (type === "change") controlListeners.add(listener);
  },
  removeEventListener(type, listener) {
    if (type === "change") controlListeners.delete(listener);
  },
  dispose() { controlsDisposed += 1; },
};

let nextFrame = 1;
const frames = new Map<number, (timestamp: number) => void>();
const cancelledFrames: number[] = [];
const requestFrame = (callback: (timestamp: number) => void): number => {
  const handle = nextFrame++;
  frames.set(handle, callback);
  return handle;
};
const cancelFrame = (handle: number): void => {
  frames.delete(handle);
  cancelledFrames.push(handle);
};

const controller = createOctahedralLivePhysics3D(selfNetwork(1, "R"), {
  aspectRatio: 2 * Math.SQRT2,
  stiffness: 1,
  simulationSpeed: 1,
});

const initial = createOctahedralThreeLiveRenderer(container as never, controller, {
  surfaceFactory: () => surface as never,
  resizeObserverFactory: (callback) => {
    observerCallback = callback;
    return { disconnect() { observerDisconnectCount += 1; } };
  },
  controlsFactory: () => controls as never,
  requestFrame,
  cancelFrame,
});

same(container.children.length, 1, "create appends exactly one rendering surface");
assert(latestScene !== undefined, "create renders a real Three scene");
assert(latestCamera !== undefined, "create renders with a PerspectiveCamera");
same(initial.mounted, true, "snapshot mounted");
same(initial.linkCount, 1, "initial Link count");
same(initial.drawCallProxy, 3, "initial renderer uses three batched draw calls");
same(initial.tick, 0, "initial tick is zero");
same(initial.paused, false, "live renderer starts active");
same(frames.size, 1, "active renderer schedules exactly one RAF");
same(renderCount >= 1, true, "create renders immediately");
same(controlListeners.size, 1, "controls change listener attached");
assert(controlsTargetCopies > 0 && controlsUpdated > 0, "fit synchronizes controls target");
assert(finitePoint(initial.cameraPosition), "initial fitted camera is finite");

const surfaceIdentity = surface;
const cameraIdentity = latestCamera;
const rendersBeforeFrame = renderCount;
const firstFrame = [...frames.entries()][0]!;
frames.delete(firstFrame[0]);
firstFrame[1](123456789);
const afterFrame = getOctahedralThreeLiveRendererSnapshot(container as never)!;
same(afterFrame.tick, 1, "one RAF performs exactly one physics tick independent of timestamp");
same(renderCount, rendersBeforeFrame + 1, "one RAF performs one render");
same(frames.size, 1, "completed active RAF schedules exactly one successor");

const staleEntry = [...frames.entries()][0]!;
const tickBeforePause = afterFrame.tick;
same(setOctahedralThreeLivePaused(container as never, true), true, "pause mounted renderer");
same(frames.size, 0, "pause cancels pending RAF");
same(getOctahedralThreeLiveRendererSnapshot(container as never)!.paused, true, "pause reflected in snapshot");
staleEntry[1](999999999);
same(
  getOctahedralThreeLiveRendererSnapshot(container as never)!.tick,
  tickBeforePause,
  "stale callback captured before pause cannot tick",
);

same(setOctahedralThreeLivePaused(container as never, false), true, "resume mounted renderer");
same(frames.size, 1, "resume schedules exactly one RAF");
same(getOctahedralThreeLiveRendererSnapshot(container as never)!.paused, false, "resume reflected in snapshot");

const tickBeforeControls = getOctahedralThreeLiveRendererSnapshot(container as never)!.tick;
const rendersBeforeControls = renderCount;
for (const listener of [...controlListeners]) listener();
same(renderCount, rendersBeforeControls + 1, "controls change renders current batch");
same(
  getOctahedralThreeLiveRendererSnapshot(container as never)!.tick,
  tickBeforeControls,
  "controls change does not step physics",
);

container.clientWidth = 900;
container.clientHeight = 450;
same(resizeOctahedralThreeLiveRenderer(container as never), true, "explicit resize succeeds");
const resized = getOctahedralThreeLiveRendererSnapshot(container as never)!;
same(resized.width, 900, "resize snapshot width");
same(resized.height, 450, "resize snapshot height");
same(latestCamera!.aspect, 2, "resize updates camera aspect");
assert(sizes.some(([w, h]) => w === 900 && h === 450), "surface receives resized dimensions");

container.clientWidth = 720;
container.clientHeight = 480;
observerCallback!();
const observed = getOctahedralThreeLiveRendererSnapshot(container as never)!;
same(observed.width, 720, "observer resize width");
same(observed.height, 480, "observer resize height");

same(fitOctahedralThreeLiveRenderer(container as never), true, "fit packed octahedral positions");
assert(
  finitePoint(getOctahedralThreeLiveRendererSnapshot(container as never)!.cameraPosition),
  "fit camera remains finite",
);

const renderBeforeTransition = renderCount;
same(
  transitionOctahedralThreeLiveNetwork(container as never, selfNetwork(2, "N")),
  true,
  "whole-network transition succeeds",
);
const transitioned = getOctahedralThreeLiveRendererSnapshot(container as never)!;
same(transitioned.linkCount, 2, "transition updates current Link count");
same(transitioned.drawCallProxy, 3, "transition preserves constant batch draw count");
same(renderCount, renderBeforeTransition + 1, "transition renders exactly once immediately");
assert(surface === surfaceIdentity, "transition preserves rendering surface");
assert(latestCamera === cameraIdentity, "transition preserves camera");
same(controlsDisposed, 0, "transition preserves controls");

same(setOctahedralThreeLiveSimulationSpeed(container as never, 0), true, "set simulation speed through renderer");
same(controller.simulationSpeed, 0, "renderer delegates simulationSpeed to controller");
same(setOctahedralThreeLiveStiffness(container as never, 2), true, "set stiffness through renderer");
same(controller.stiffness, 2, "renderer delegates stiffness to controller");
same(container.children.length, 1, "runtime setters never replace rendering surface");

const destroyTick = getOctahedralThreeLiveRendererSnapshot(container as never)!.tick;
const staleDestroyCallbacks = [...frames.values()];
same(destroyOctahedralThreeLiveRenderer(container as never), true, "destroy mounted octahedral renderer");
same(container.children.length, 0, "destroy removes rendering surface");
same(surfaceDisposeCount, 1, "destroy disposes rendering surface exactly once");
same(observerDisconnectCount, 1, "destroy disconnects observer exactly once");
same(controlsDisposed, 1, "destroy disposes controls exactly once");
same(controlListeners.size, 0, "destroy removes controls listener");
same(frames.size, 0, "destroy cancels pending RAF");
assert(cancelledFrames.length > 0, "RAF cancellation observable");

for (const callback of staleDestroyCallbacks) callback(777777777);
same(getOctahedralThreeLiveRendererSnapshot(container as never), undefined, "destroy removes mount snapshot");
same(destroyOctahedralThreeLiveRenderer(container as never), false, "destroy is idempotent");
same(resizeOctahedralThreeLiveRenderer(container as never), false, "resize missing mount is safe false");
same(fitOctahedralThreeLiveRenderer(container as never), false, "fit missing mount is safe false");
same(setOctahedralThreeLivePaused(container as never, true), false, "pause missing mount is safe false");
same(transitionOctahedralThreeLiveNetwork(container as never, selfNetwork(1)), false, "transition missing mount is safe false");
same(destroyTick >= 1, true, "destroy occurred after at least one live tick");
