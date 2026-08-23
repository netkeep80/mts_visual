import * as THREE from "three";
import {
  VisualPresentationError,
  validateVisualPresentationState,
  type Physics3DState,
  type VisualLinkNetwork,
} from "../src/index.js";
import { createLivePhysics3D, snapshotLivePhysics3D } from "../src/live-physics3d.js";
import {
  buildVisualThreeSceneData,
  createVisualThreeLiveRenderer,
  createVisualThreeRenderer,
  destroyVisualThreeRenderer,
  setVisualThreeLivePaused,
  setVisualThreePresentation,
  updateVisualThreeRenderer,
  type VisualThreeSceneData,
} from "../src/three/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V2g-B: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

type PointerProbe = {
  readonly button: number;
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
};

type FakeElement = {
  readonly token: string;
  parentNode?: FakeContainer | null;
  addEventListener?: (type: string, listener: (event: PointerProbe) => void) => void;
  removeEventListener?: (type: string, listener: (event: PointerProbe) => void) => void;
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
  hasPointerCapture?: (pointerId: number) => boolean;
  dispatch?: (type: string, event: PointerProbe) => void;
};

type FakeContainer = {
  clientWidth: number;
  clientHeight: number;
  readonly children: FakeElement[];
  appendChild: (element: FakeElement) => FakeElement;
  removeChild: (element: FakeElement) => FakeElement;
  contains: (element: FakeElement) => boolean;
  getBoundingClientRect: () => { width: number; height: number };
};

type SceneProbe = THREE.Scene;

type SurfaceProbe = {
  readonly domElement: FakeElement;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
};

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

function interactiveElement(token: string): FakeElement {
  const listeners = new Map<string, Set<(event: PointerProbe) => void>>();
  const captures = new Set<number>();
  const element: FakeElement = {
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
  };
  return element;
}

function pointer(clientX: number, clientY: number, pointerId = 7): PointerProbe {
  return { button: 0, pointerId, clientX, clientY, preventDefault() {} };
}

function network(): VisualLinkNetwork {
  return {
    links: [
      { key: "R", startKey: "R", endKey: "R", label: "∞", tags: ["root"] },
      { key: "O", startKey: "O", endKey: "R", label: "ordinary" },
    ],
  };
}

function physicsState(): Physics3DState {
  return {
    positions: [
      { key: "R", point: { x: 0, y: 0, z: 0 } },
      { key: "O", point: { x: 2, y: 0, z: 0 } },
    ],
    velocities: [
      { key: "R", vector: { x: 0, y: 0, z: 0 } },
      { key: "O", vector: { x: 0, y: 0, z: 0 } },
    ],
  };
}

function sceneData(): VisualThreeSceneData {
  return buildVisualThreeSceneData(network(), physicsState());
}

function rootOnlyScene(): VisualThreeSceneData {
  const rootNetwork: VisualLinkNetwork = {
    links: [{ key: "R", startKey: "R", endKey: "R", label: "∞", tags: ["root"] }],
  };
  return buildVisualThreeSceneData(rootNetwork, {
    positions: [{ key: "R", point: { x: 0, y: 0, z: 0 } }],
    velocities: [{ key: "R", vector: { x: 0, y: 0, z: 0 } }],
  });
}

function findObject(scene: SceneProbe, kind: string, key: string): THREE.Object3D | undefined {
  return scene.children.find((object) => object.userData.kind === kind && object.userData.key === key);
}

function linkObjects(scene: SceneProbe, key: string): THREE.Object3D[] {
  return scene.children.filter((object) =>
    object.userData.key === key && ["link-center", "link-arc", "end-arrow"].includes(String(object.userData.kind)));
}

const data = sceneData();
validateVisualPresentationState({ links: data.nodes }, { links: [] });

const host = container();
let staticScene: SceneProbe | undefined;
let renderCount = 0;
const staticSurface: SurfaceProbe = {
  domElement: { token: "static", parentNode: null },
  setSize() {},
  render(scene) { staticScene = scene; renderCount += 1; },
  dispose() {},
};
createVisualThreeRenderer(host as never, data, {
  nodeRadius: 0.2,
  surfaceFactory: () => staticSurface as never,
  resizeObserverFactory: () => ({ disconnect() {} }),
});
assert(staticScene !== undefined, "static renderer exposes scene");

const rootCenter = findObject(staticScene, "link-center", "R") as THREE.Mesh;
const rootArcs = staticScene.children.filter((object) => object.userData.kind === "link-arc" && object.userData.key === "R") as THREE.Line[];
const rootArrow = findObject(staticScene, "end-arrow", "R");
assert(rootCenter !== undefined && rootArcs.length === 2 && rootArrow !== undefined, "root has center/two arcs/END arrow");
const rootColorBefore = (rootCenter.material as THREE.MeshBasicMaterial).color.getHex();
const arcColorsBefore = rootArcs.map((arc) => Array.from((arc.geometry.getAttribute("color") as THREE.BufferAttribute).array));
const renderBeforePresentation = renderCount;

same(setVisualThreePresentation(host as never, {
  links: [
    { key: "R", visible: false, emphasis: 1.4, selected: true },
    { key: "O", halo: { color: 0x336699, scale: 1.7, opacity: 0.4 } },
  ],
}), true, "mounted renderer accepts presentation state");
same(renderCount, renderBeforePresentation + 1, "presentation setter renders exactly once");
for (const object of linkObjects(staticScene, "R")) same(object.visible, false, "visible=false hides whole represented Link");
same(rootCenter.scale.x, 1.4, "emphasis scales center only");
const hiddenRootHalo = findObject(staticScene, "presentation-halo", "R") as THREE.Mesh | undefined;
assert(hiddenRootHalo !== undefined, "selected root creates neutral presentation halo");
same(hiddenRootHalo.visible, false, "halo follows Link visibility");
const ordinaryHalo = findObject(staticScene, "presentation-halo", "O") as THREE.Mesh | undefined;
assert(ordinaryHalo !== undefined, "explicit halo may exist without selected role");
same((ordinaryHalo.material as THREE.MeshBasicMaterial).color.getHex(), 0x336699, "explicit halo color retained");
same(ordinaryHalo.scale.x, 1.7, "explicit halo scale retained");
same((ordinaryHalo.material as THREE.MeshBasicMaterial).opacity, 0.4, "explicit halo opacity retained");
same((rootCenter.material as THREE.MeshBasicMaterial).color.getHex(), rootColorBefore, "presentation never recolors GREEN center");
for (let index = 0; index < rootArcs.length; index += 1) {
  same(
    JSON.stringify(Array.from((rootArcs[index]!.geometry.getAttribute("color") as THREE.BufferAttribute).array)),
    JSON.stringify(arcColorsBefore[index]),
    "presentation never mutates RGB arc colors",
  );
}

let haloDisposeEvents = 0;
ordinaryHalo.geometry.addEventListener("dispose", () => { haloDisposeEvents += 1; });
(ordinaryHalo.material as THREE.Material).addEventListener("dispose", () => { haloDisposeEvents += 1; });
same(setVisualThreePresentation(host as never, { links: [{ key: "R", visible: true, emphasis: 1.2 }] }), true, "presentation can replace prior state");
assert(haloDisposeEvents >= 2, "replacing presentation disposes halo resources");
same(findObject(staticScene, "presentation-halo", "O"), undefined, "removed halo leaves scene");
same(rootCenter.visible, true, "replacement restores root visibility");
same(rootCenter.scale.x, 1.2, "replacement updates root emphasis");

const acceptedRenderCount = renderCount;
try {
  setVisualThreePresentation(host as never, { links: [{ key: "missing", selected: true }] });
  throw new Error("@mts/visual V2g-B: unknown presentation key should reject");
} catch (error) {
  assert(error instanceof VisualPresentationError, "unknown Three presentation key uses typed V2g-A error");
  same(error.code, "unknown-key", "unknown Three presentation key classification");
}
same(renderCount, acceptedRenderCount, "rejected presentation does not render/mutate accepted state");
same(rootCenter.scale.x, 1.2, "rejected presentation preserves previous accepted state");

same(updateVisualThreeRenderer(host as never, rootOnlyScene()), true, "scene update reconciles stale presentation keys");
assert(staticScene.children.every((object) => object.userData.key !== "O"), "removed key has no presentation residue");
same(updateVisualThreeRenderer(host as never, data), true, "later scene update can reintroduce topology key");
const restoredOrdinaryCenter = findObject(staticScene, "link-center", "O") as THREE.Mesh | undefined;
assert(restoredOrdinaryCenter !== undefined, "ordinary center reintroduced");
same(restoredOrdinaryCenter.scale.x, 1, "stale O presentation override is not transferred/revived");
same(destroyVisualThreeRenderer(host as never), true, "static presentation renderer destroys cleanly");

const liveNetwork: VisualLinkNetwork = {
  links: [{ key: "R", startKey: "R", endKey: "R", label: "∞", tags: ["root"] }],
};
const liveInitialState: Physics3DState = {
  positions: [{ key: "R", point: { x: 0, y: 0, z: 0 } }],
  velocities: [{ key: "R", vector: { x: 0, y: 0, z: 0 } }],
};
const controller = createLivePhysics3D(liveNetwork, liveInitialState, { settleWindow: 1 });
const liveHost = container(400, 300);
const liveElement = interactiveElement("live");
const liveSurface: SurfaceProbe = {
  domElement: liveElement,
  setSize() {},
  render() {},
  dispose() {},
};
const callbacks: string[] = [];
let nextFrame = 1;
const frames = new Map<number, (timestamp: number) => void>();
const controls = {
  enabled: true,
  target: { copy: () => controls.target },
  update() {},
  addEventListener() {},
  removeEventListener() {},
  dispose() {},
};
createVisualThreeLiveRenderer(liveHost as never, liveNetwork, controller, {
  nodeRadius: 0.4,
  surfaceFactory: () => liveSurface as never,
  resizeObserverFactory: () => ({ disconnect() {} }),
  requestFrame(callback: (timestamp: number) => void) { const id = nextFrame++; frames.set(id, callback); return id; },
  cancelFrame(id: number) { frames.delete(id); },
  controlsFactory: () => controls,
  dragThreshold: 5,
  onActivateKey: (key: string) => { callbacks.push(key); },
} as never);
same(setVisualThreeLivePaused(liveHost as never, true), true, "activation fixture pauses physics RAF");
const tickBeforeTap = snapshotLivePhysics3D(controller).tick;
liveElement.dispatch?.("pointerdown", pointer(200, 150));
same(callbacks.length, 0, "pointerdown alone never activates");
liveElement.dispatch?.("pointerup", pointer(200, 150));
same(callbacks.join(","), "R", "simple root tap activates exact VisualKey once");
same(snapshotLivePhysics3D(controller).tick, tickBeforeTap, "tap activation never ticks physics");
same(snapshotLivePhysics3D(controller).pinnedKeys.length, 0, "tap activation never pins physics");

callbacks.length = 0;
liveElement.dispatch?.("pointerdown", pointer(200, 150, 9));
liveElement.dispatch?.("pointermove", pointer(220, 150, 9));
liveElement.dispatch?.("pointermove", pointer(201, 150, 9));
liveElement.dispatch?.("pointerup", pointer(201, 150, 9));
same(callbacks.length, 0, "gesture that crossed drag threshold never reclassifies as click");

liveElement.dispatch?.("pointerdown", pointer(200, 150, 11));
liveElement.dispatch?.("pointercancel", pointer(200, 150, 11));
same(callbacks.length, 0, "pointercancel never activates");
same(destroyVisualThreeRenderer(liveHost as never), true, "activation renderer destroys cleanly");
