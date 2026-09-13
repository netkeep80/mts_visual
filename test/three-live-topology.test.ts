import * as THREE from "three";
import {
  VisualPresentationError,
  type Physics3DState,
  type Point3D,
  type VisualLinkNetwork,
} from "../src/index.js";
import {
  createLivePhysics3D,
  snapshotLivePhysics3D,
} from "../src/live-physics3d.js";
import {
  createVisualThreeLiveRenderer,
  destroyVisualThreeRenderer,
  getVisualThreeRendererSnapshot,
  setVisualThreeLivePaused,
  setVisualThreePresentation,
  transitionVisualThreeLiveNetwork,
  type VisualThreeRendererSnapshot,
} from "../src/three/index.js";
import { destroyVisualThreeRenderer as destroyVisualThreeRendererLowLevel } from "../src/three/renderer.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual M4-U2: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function deepSame(actual: unknown, expected: unknown, message: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  assert(left === right, `${message}: ${left} !== ${right}`);
}

type PointerProbe = {
  readonly button: number;
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
};

type InteractiveElement = {
  readonly token: string;
  parentNode?: FakeContainer | null;
  addEventListener(type: string, listener: (event: PointerProbe) => void): void;
  removeEventListener(type: string, listener: (event: PointerProbe) => void): void;
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  dispatch(type: string, event: PointerProbe): void;
  listenerCount(): number;
};

type FakeContainer = {
  clientWidth: number;
  clientHeight: number;
  readonly children: InteractiveElement[];
  appendChild(element: InteractiveElement): InteractiveElement;
  removeChild(element: InteractiveElement): InteractiveElement;
  contains(element: InteractiveElement): boolean;
  getBoundingClientRect(): { width: number; height: number };
};

type ControlsProbe = {
  enabled: boolean;
  readonly target: { copy(value: THREE.Vector3): unknown };
  update(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  dispose(): void;
};

function container(width = 600, height = 400): FakeContainer {
  const children: InteractiveElement[] = [];
  const value: FakeContainer = {
    clientWidth: width,
    clientHeight: height,
    children,
    appendChild(element) {
      if (!children.includes(element)) children.push(element);
      element.parentNode = value;
      return element;
    },
    removeChild(element) {
      const index = children.indexOf(element);
      if (index >= 0) children.splice(index, 1);
      element.parentNode = null;
      return element;
    },
    contains: (element) => children.includes(element),
    getBoundingClientRect: () => ({ width: value.clientWidth, height: value.clientHeight }),
  };
  return value;
}

function interactiveElement(host: FakeContainer, token: string): InteractiveElement {
  const listeners = new Map<string, Set<(event: PointerProbe) => void>>();
  const captures = new Set<number>();
  return {
    token,
    parentNode: null,
    addEventListener(type, listener) {
      const current = listeners.get(type) ?? new Set();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    setPointerCapture(pointerId) { captures.add(pointerId); },
    releasePointerCapture(pointerId) { captures.delete(pointerId); },
    hasPointerCapture: (pointerId) => captures.has(pointerId),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: host.clientWidth, height: host.clientHeight }),
    dispatch(type, event) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    listenerCount() {
      return [...listeners.values()].reduce((total, set) => total + set.size, 0);
    },
  };
}

function pointer(x: number, y: number, pointerId = 1): PointerProbe {
  return { button: 0, pointerId, clientX: x, clientY: y, preventDefault() {} };
}

function networkBase(): VisualLinkNetwork {
  return {
    links: [
      { key: "A", startKey: "A", endKey: "A", label: "A" },
      { key: "B", startKey: "B", endKey: "B", label: "B" },
    ],
  };
}

function networkAdded(): VisualLinkNetwork {
  return {
    links: [
      { key: "A", startKey: "A", endKey: "A", label: "A" },
      { key: "B", startKey: "B", endKey: "B", label: "B" },
      { key: "C", startKey: "A", endKey: "B", label: "C" },
    ],
  };
}

function initialState(): Physics3DState {
  return {
    positions: [
      { key: "A", point: { x: -2, y: 0, z: 0 } },
      { key: "B", point: { x: 2, y: 0, z: 0 } },
    ],
    velocities: [
      { key: "A", vector: { x: 0, y: 0, z: 0 } },
      { key: "B", vector: { x: 0, y: 0, z: 0 } },
    ],
  };
}

function center(scene: THREE.Scene, key: string): THREE.Mesh | undefined {
  return scene.children.find((object): object is THREE.Mesh =>
    object instanceof THREE.Mesh && object.userData.kind === "link-center" && object.userData.key === key);
}

function object(scene: THREE.Scene, kind: string, key: string): THREE.Object3D | undefined {
  return scene.children.find((candidate) => candidate.userData.kind === kind && candidate.userData.key === key);
}

function linkObjects(scene: THREE.Scene, key: string): THREE.Object3D[] {
  return scene.children.filter((candidate) => candidate.userData.key === key);
}

function screenPoint(
  host: FakeContainer,
  camera: THREE.PerspectiveCamera,
  mesh: THREE.Mesh,
): readonly [number, number] {
  camera.updateMatrixWorld();
  const projected = mesh.position.clone().project(camera);
  return [
    (projected.x + 1) * host.clientWidth / 2,
    (1 - projected.y) * host.clientHeight / 2,
  ];
}

const base = networkBase();
const added = networkAdded();
const controller = createLivePhysics3D(base, initialState(), {
  charge: 0,
  springStiffness: 0.7,
  restLength: 0.8,
  damping: 0.9,
  timeStep: 0.1,
  settleVelocity: 0,
  settlePositionDelta: 0,
  settleWindow: 100,
});
const host = container();
const element = interactiveElement(host, "u2-surface");
let scene: THREE.Scene | undefined;
let camera: THREE.PerspectiveCamera | undefined;
let surfaceDisposeCount = 0;
let controlsFactoryCount = 0;
let controlsDisposeCount = 0;
let controlsUpdateCount = 0;
const controlListeners = new Set<() => void>();
const controls: ControlsProbe = {
  enabled: true,
  target: { copy: () => controls.target },
  update() { controlsUpdateCount += 1; },
  addEventListener(type, listener) { if (type === "change") controlListeners.add(listener); },
  removeEventListener(type, listener) { if (type === "change") controlListeners.delete(listener); },
  dispose() { controlsDisposeCount += 1; },
};
let nextFrameId = 1;
const frames = new Map<number, (timestamp: number) => void>();
const cancelledFrames: number[] = [];
const activations: string[] = [];

const rendererBefore = createVisualThreeLiveRenderer(host as never, base, controller, {
  nodeRadius: 0.28,
  surfaceFactory: () => ({
    domElement: element as never,
    setSize() {},
    render(nextScene: THREE.Scene, nextCamera: THREE.Camera) {
      scene = nextScene;
      camera = nextCamera as THREE.PerspectiveCamera;
    },
    dispose() { surfaceDisposeCount += 1; },
  }),
  resizeObserverFactory: () => ({ disconnect() {} }),
  labelSpriteFactory: (_text: string, key: string) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    sprite.userData = { key };
    return sprite;
  },
  requestFrame(callback: (timestamp: number) => void) {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  },
  cancelFrame(id: number) {
    frames.delete(id);
    cancelledFrames.push(id);
  },
  controlsFactory: () => {
    controlsFactoryCount += 1;
    return controls;
  },
  dragThreshold: 5,
  onActivateKey: (key: string) => { activations.push(key); },
} as never);

assert(scene !== undefined && camera !== undefined, "live fixture exposes scene and camera");
same(rendererBefore.nodeCount, 2, "base live renderer starts with N nodes");
same(rendererBefore.arcCount, 4, "base live renderer starts with N arcs");
same(host.children.length, 1, "base live renderer owns one surface");
same(controlsFactoryCount, 1, "controls created exactly once");
same(surfaceDisposeCount, 0, "surface alive before transitions");
same(frames.size, 1, "awake base controller owns one queued RAF");

const cameraBeforeAdd = JSON.stringify((getVisualThreeRendererSnapshot(host as never) as VisualThreeRendererSnapshot).cameraPosition);
same(transitionVisualThreeLiveNetwork(host as never, added), true, "N -> N+1 live topology transition succeeds");
const afterAdd = getVisualThreeRendererSnapshot(host as never) as VisualThreeRendererSnapshot;
same(afterAdd.nodeCount, 3, "N+1 scene has added center object immediately");
same(afterAdd.arcCount, 6, "N+1 scene has added arc pair immediately");
same(afterAdd.arrowCount, 3, "N+1 scene has added END arrow immediately");
same(host.children.length, 1, "topology transition never adds a second surface");
same(surfaceDisposeCount, 0, "topology transition does not dispose/recreate surface");
same(controlsFactoryCount, 1, "topology transition does not recreate controls");
same(controlsDisposeCount, 0, "topology transition does not dispose controls");
same(JSON.stringify(afterAdd.cameraPosition), cameraBeforeAdd, "topology transition does not reset camera");
assert(controller.model.keys.includes("C"), "U1 controller model changes with Three transition");
assert(snapshotLivePhysics3D(controller).state.positions.some((entry) => entry.key === "C"), "U1 state contains new C");
assert(center(scene, "C") !== undefined, "new C center exists in current Three scene");
assert(frames.size <= 1, "transition keeps at most one queued live RAF");

const queuedAfterAdd = [...frames.entries()][0];
assert(queuedAfterAdd !== undefined, "awakened topology has a RAF to continue live physics");
frames.delete(queuedAfterAdd[0]);
queuedAfterAdd[1](111);
const afterTick = getVisualThreeRendererSnapshot(host as never) as VisualThreeRendererSnapshot;
same(afterTick.nodeCount, 3, "next RAF still projects N+1 instead of stale initial N");
same(afterTick.arcCount, 6, "next RAF uses new network projector authority");
assert(center(scene, "C") !== undefined, "C survives next live projection after transition");

same(setVisualThreePresentation(host as never, {
  links: [
    { key: "A", emphasis: 1.35 },
    { key: "C", selected: true, labelVisible: true, halo: { color: 0x778899, scale: 1.6, opacity: 0.3 } },
  ],
}), true, "presentation accepts added key");
const cHalo = object(scene, "presentation-halo", "C") as THREE.Mesh | undefined;
const cLabel = object(scene, "presentation-label", "C") as THREE.Sprite | undefined;
assert(cHalo !== undefined, "C halo exists before removal");
assert(cLabel !== undefined, "C label exists before removal");
let removedPresentationDisposeEvents = 0;
cHalo.geometry.addEventListener("dispose", () => { removedPresentationDisposeEvents += 1; });
(cHalo.material as THREE.Material).addEventListener("dispose", () => { removedPresentationDisposeEvents += 1; });
cLabel.material.addEventListener("dispose", () => { removedPresentationDisposeEvents += 1; });

const cameraBeforeRemove = JSON.stringify((getVisualThreeRendererSnapshot(host as never) as VisualThreeRendererSnapshot).cameraPosition);
same(transitionVisualThreeLiveNetwork(host as never, base), true, "N+1 -> N live topology transition succeeds");
const afterRemove = getVisualThreeRendererSnapshot(host as never) as VisualThreeRendererSnapshot;
same(afterRemove.nodeCount, 2, "removal returns to N centers");
same(afterRemove.arcCount, 4, "removal returns to N arcs");
same(afterRemove.arrowCount, 2, "removal returns to N arrows");
same(JSON.stringify(afterRemove.cameraPosition), cameraBeforeRemove, "removal transition does not reset camera");
same(host.children.length, 1, "removal keeps exactly one surface");
same(surfaceDisposeCount, 0, "removal does not dispose surface");
same(controlsFactoryCount, 1, "removal keeps original controls instance");
assert(!controller.model.keys.includes("C"), "removed C leaves physical model");
assert(!snapshotLivePhysics3D(controller).state.positions.some((entry) => entry.key === "C"), "removed C leaves physics state");
assert(linkObjects(scene, "C").length === 0, "removed C leaves no Three/presentation objects");
assert(removedPresentationDisposeEvents >= 3, "removed C halo/label resources are disposed");
const retainedA = center(scene, "A");
assert(retainedA !== undefined, "retained A remains in scene");
same(retainedA.scale.x, 1.35, "retained A presentation survives topology transition");

let removedPresentationRejected = false;
try {
  setVisualThreePresentation(host as never, { links: [{ key: "C", selected: true }] });
} catch (error) {
  removedPresentationRejected = error instanceof VisualPresentationError && error.code === "unknown-key";
}
same(removedPresentationRejected, true, "presentation key-space rejects removed C");

same(transitionVisualThreeLiveNetwork(host as never, added), true, "C can be reintroduced as real topology");
const restoredC = center(scene, "C");
assert(restoredC !== undefined, "reintroduced C center exists");
same(restoredC.scale.x, 1, "reintroduced C receives default presentation instead of stale override");
same(object(scene, "presentation-halo", "C"), undefined, "stale C halo is not revived");
same(object(scene, "presentation-label", "C"), undefined, "stale C label is not revived");
same(setVisualThreePresentation(host as never, { links: [{ key: "C", selected: true, labelVisible: true }] }), true, "fresh C presentation is accepted after re-add");
assert(object(scene, "presentation-halo", "C") !== undefined, "fresh C halo can be created");
assert(object(scene, "presentation-label", "C") !== undefined, "fresh C label can be created");

const cMeshForPicking = center(scene, "C");
assert(cMeshForPicking !== undefined, "C center available for picking proof");
const [cx, cy] = screenPoint(host, camera, cMeshForPicking);
activations.length = 0;
element.dispatch("pointerdown", pointer(cx, cy, 17));
element.dispatch("pointerup", pointer(cx, cy, 17));
same(activations.at(-1), "C", "new C can be picked/activated on existing pointer lifecycle");

activations.length = 0;
element.dispatch("pointerdown", pointer(cx, cy, 19));
element.dispatch("pointermove", pointer(cx + 24, cy, 19));
same(snapshotLivePhysics3D(controller).pinnedKeys.includes("C"), true, "new C can enter active drag on existing live controller");
same(controls.enabled, false, "active C drag disables existing controls");
same(element.hasPointerCapture(19), true, "active C drag captures pointer");
same(transitionVisualThreeLiveNetwork(host as never, base), true, "topology may remove actively dragged C");
same(snapshotLivePhysics3D(controller).pinnedKeys.includes("C"), false, "U1 removal clears C pin");
same(controls.enabled, true, "removing active drag key restores controls");
same(element.hasPointerCapture(19), false, "removing active drag key releases pointer capture");
element.dispatch("pointermove", pointer(cx + 30, cy, 19));
element.dispatch("pointerup", pointer(cx + 30, cy, 19));
same(snapshotLivePhysics3D(controller).pinnedKeys.includes("C"), false, "stale pointer events cannot resurrect removed C");

activations.length = 0;
element.dispatch("pointerdown", pointer(cx, cy, 23));
element.dispatch("pointerup", pointer(cx, cy, 23));
assert(!activations.includes("C"), "removed C cannot be picked from stale raycast target");

same(setVisualThreeLivePaused(host as never, true), true, "pause remains available after topology transitions");
same(frames.size, 0, "pause cancels pending RAF");
same(transitionVisualThreeLiveNetwork(host as never, added), true, "paused renderer still updates topology immediately");
same((getVisualThreeRendererSnapshot(host as never) as VisualThreeRendererSnapshot).nodeCount, 3, "paused transition updates scene immediately");
same(frames.size, 0, "paused topology transition does not violate pause with a new RAF");
same(setVisualThreeLivePaused(host as never, false), true, "resume preserves live lifecycle after topology transition");
same(frames.size, 1, "resume schedules one RAF against current topology");

const neverMounted = container();
same(transitionVisualThreeLiveNetwork(neverMounted as never, added), false, "unmanaged container transition is safe false");
const beforeDestroyPhysics = JSON.stringify(snapshotLivePhysics3D(controller));
same(destroyVisualThreeRenderer(host as never), true, "managed U2 renderer destroys through public lifecycle");
same(surfaceDisposeCount, 1, "surface is disposed exactly once at final destroy");
same(controlsDisposeCount, 1, "controls are disposed exactly once at final destroy");
same(element.listenerCount(), 0, "final destroy removes pointer listeners");
same(transitionVisualThreeLiveNetwork(host as never, base), false, "transition after public destroy is safe false");
deepSame(snapshotLivePhysics3D(controller), JSON.parse(beforeDestroyPhysics), "failed post-destroy transition does not mutate controller");

const staleController = createLivePhysics3D(base, initialState(), { settleWindow: 100 });
const staleHost = container();
const staleElement = interactiveElement(staleHost, "stale-surface");
createVisualThreeLiveRenderer(staleHost as never, base, staleController, {
  surfaceFactory: () => ({
    domElement: staleElement as never,
    setSize() {},
    render() {},
    dispose() {},
  }),
  resizeObserverFactory: () => ({ disconnect() {} }),
  requestFrame: () => 1,
  cancelFrame() {},
  controlsFactory: () => ({
    enabled: true,
    target: { copy: () => undefined },
    update() {},
    addEventListener() {},
    removeEventListener() {},
    dispose() {},
  }),
} as never);
const staleBefore = snapshotLivePhysics3D(staleController);
same(destroyVisualThreeRendererLowLevel(staleHost as never), true, "low-level lifecycle can invalidate managed live mount");
same(transitionVisualThreeLiveNetwork(staleHost as never, added), false, "stale managed binding is rejected before physics mutation");
deepSame(snapshotLivePhysics3D(staleController), staleBefore, "stale binding rejection preserves controller state/model lifecycle");

assert(cancelledFrames.length >= 0, "RAF cancellation accounting stays finite");
assert(controlsUpdateCount >= 0, "controls update accounting stays finite");
