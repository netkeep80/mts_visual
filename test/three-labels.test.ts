import * as THREE from "three";
import {
  type Physics3DState,
  type VisualLinkNetwork,
} from "../src/index.js";
import { createLivePhysics3D, snapshotLivePhysics3D } from "../src/live-physics3d.js";
import {
  buildVisualThreeSceneData,
  createVisualThreeLiveRenderer,
  createVisualThreeRenderer,
  destroyVisualThreeRenderer,
  getVisualThreeRendererSnapshot,
  setVisualThreeLivePaused,
  setVisualThreePresentation,
  updateVisualThreeRenderer,
  type VisualThreeSceneData,
} from "../src/three/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V2g-C: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

type FakeElement = {
  parentNode?: FakeContainer | null;
  addEventListener?: (type: string, listener: (...args: never[]) => void) => void;
  removeEventListener?: (type: string, listener: (...args: never[]) => void) => void;
};
type FakeContainer = {
  clientWidth: number;
  clientHeight: number;
  readonly children: FakeElement[];
  appendChild(element: FakeElement): FakeElement;
  removeChild(element: FakeElement): FakeElement;
  contains(element: FakeElement): boolean;
  getBoundingClientRect(): { width: number; height: number };
};

type SurfaceProbe = {
  readonly domElement: FakeElement;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
};

function container(): FakeContainer {
  const children: FakeElement[] = [];
  const host: FakeContainer = {
    clientWidth: 640,
    clientHeight: 360,
    children,
    appendChild(element) { if (!children.includes(element)) children.push(element); element.parentNode = host; return element; },
    removeChild(element) { const index = children.indexOf(element); if (index >= 0) children.splice(index, 1); element.parentNode = null; return element; },
    contains: (element) => children.includes(element),
    getBoundingClientRect: () => ({ width: host.clientWidth, height: host.clientHeight }),
  };
  return host;
}

function network(rootLabel = "∞", ordinaryLabel: string | null = "ordinary"): VisualLinkNetwork {
  return {
    links: [
      { key: "R", startKey: "R", endKey: "R", label: rootLabel, tags: ["root"] },
      { key: "O", startKey: "O", endKey: "R", ...(ordinaryLabel === null ? {} : { label: ordinaryLabel }) },
    ],
  };
}

function physics(rootX = 0, ordinaryX = 2): Physics3DState {
  return {
    positions: [
      { key: "R", point: { x: rootX, y: 0, z: 0 } },
      { key: "O", point: { x: ordinaryX, y: 0, z: 0 } },
    ],
    velocities: [
      { key: "R", vector: { x: 0, y: 0, z: 0 } },
      { key: "O", vector: { x: 0, y: 0, z: 0 } },
    ],
  };
}

function data(rootLabel = "∞", ordinaryLabel: string | null = "ordinary", rootX = 0): VisualThreeSceneData {
  return buildVisualThreeSceneData(network(rootLabel, ordinaryLabel), physics(rootX));
}

function rootOnly(label = "∞", x = 0): VisualThreeSceneData {
  return buildVisualThreeSceneData(
    { links: [{ key: "R", startKey: "R", endKey: "R", label, tags: ["root"] }] },
    { positions: [{ key: "R", point: { x, y: 0, z: 0 } }], velocities: [{ key: "R", vector: { x: 0, y: 0, z: 0 } }] },
  );
}

function label(scene: THREE.Scene, key: string): THREE.Sprite | undefined {
  return scene.children.find((object) => object.userData.kind === "presentation-label" && object.userData.key === key) as THREE.Sprite | undefined;
}

const created: string[] = [];
let disposeEvents = 0;
function labelSpriteFactory(text: string, key: string): THREE.Sprite {
  created.push(`${key}:${text}`);
  const texture = new THREE.Texture();
  const material = new THREE.SpriteMaterial({ map: texture });
  texture.addEventListener("dispose", () => { disposeEvents += 1; });
  material.addEventListener("dispose", () => { disposeEvents += 1; });
  const sprite = new THREE.Sprite(material);
  sprite.userData.text = text;
  return sprite;
}

const host = container();
let scene: THREE.Scene | undefined;
const surface: SurfaceProbe = {
  domElement: { parentNode: null },
  setSize() {},
  render(nextScene) { scene = nextScene; },
  dispose() {},
};
createVisualThreeRenderer(host as never, data(), {
  nodeRadius: 0.2,
  surfaceFactory: () => surface as never,
  resizeObserverFactory: () => ({ disconnect() {} }),
  labelSpriteFactory,
});
assert(scene !== undefined, "renderer exposes scene");
same(label(scene, "R"), undefined, "labels are quiet by default");

const countsBefore = getVisualThreeRendererSnapshot(host as never);
same(setVisualThreePresentation(host as never, { links: [{ key: "R", selected: true, emphasis: 1.4 }] }), true, "selection applies without label");
same(label(scene, "R"), undefined, "selection/emphasis do not imply label visibility");

same(setVisualThreePresentation(host as never, { links: [{ key: "R", labelVisible: true }] }), true, "label visibility applies");
const rootLabel = label(scene, "R");
assert(rootLabel !== undefined, "root label sprite created");
same(rootLabel.userData.text, "∞", "label text comes from exact VisualLink.label");
same(created.at(-1), "R:∞", "factory receives exact key and label");
assert(rootLabel.position.y > 0, "label has presentation-only center offset");
const countsWithLabel = getVisualThreeRendererSnapshot(host as never);
same(countsWithLabel?.nodeCount, countsBefore?.nodeCount, "label does not change node count");
same(countsWithLabel?.arcCount, countsBefore?.arcCount, "label does not change arc count");
same(countsWithLabel?.arrowCount, countsBefore?.arrowCount, "label does not change arrow count");
same(scene.children.filter((object) => object.userData.kind === "link-center").length, 2, "label is not a link-center picking target");

same(setVisualThreePresentation(host as never, { links: [{ key: "R", visible: false, labelVisible: true }] }), true, "whole-Link visibility dominates label");
same(label(scene, "R")?.visible, false, "visible=false hides label");

same(updateVisualThreeRenderer(host as never, data("ROOT", null, 4)), true, "scene update refreshes label source and position");
const moved = label(scene, "R");
assert(moved !== undefined, "root label survives same-key scene update");
same(moved.userData.text, "ROOT", "same key uses refreshed exact label text");
assert(moved.position.x === 4, "label follows updated center x position");
same(created.some((entry) => entry === "O:O"), false, "missing label never falls back to key");

same(setVisualThreePresentation(host as never, { links: [{ key: "R", labelVisible: true }, { key: "O", labelVisible: true }] }), true, "missing-label key is accepted presentation state");
same(label(scene, "O"), undefined, "labelVisible without node.label creates no label");

same(updateVisualThreeRenderer(host as never, rootOnly("ROOT", 5)), true, "stale topology key removed");
assert(scene.children.every((object) => object.userData.key !== "O"), "stale key leaves no label residue");
same(updateVisualThreeRenderer(host as never, data("ROOT", "ordinary", 6)), true, "topology key can return");
same(label(scene, "O"), undefined, "dropped stale labelVisible override does not revive");
assert(disposeEvents > 0, "replacement disposes owned label resources");
same(destroyVisualThreeRenderer(host as never), true, "static label renderer destroys cleanly");
const disposeAfterDestroy = disposeEvents;
assert(disposeAfterDestroy > 1, "destroy disposes remaining owned label resources");

const liveHost = container();
const liveNetwork: VisualLinkNetwork = { links: [{ key: "R", startKey: "R", endKey: "R", label: "∞" }] };
const liveState: Physics3DState = {
  positions: [{ key: "R", point: { x: 0, y: 0, z: 0 } }],
  velocities: [{ key: "R", vector: { x: 0, y: 0, z: 0 } }],
};
const controller = createLivePhysics3D(liveNetwork, liveState, { settleWindow: 1 });
const liveSurface: SurfaceProbe = {
  domElement: { parentNode: null, addEventListener() {}, removeEventListener() {} },
  setSize() {},
  render() {},
  dispose() {},
};
createVisualThreeLiveRenderer(liveHost as never, liveNetwork, controller, {
  surfaceFactory: () => liveSurface as never,
  resizeObserverFactory: () => ({ disconnect() {} }),
  requestFrame: () => 1,
  cancelFrame() {},
  controlsFactory: () => ({ enabled: true, target: { copy() {} }, update() {}, addEventListener() {}, removeEventListener() {}, dispose() {} }) as never,
  labelSpriteFactory,
});
same(setVisualThreeLivePaused(liveHost as never, true), true, "live label fixture pauses physics");
const beforeLabelUpdate = snapshotLivePhysics3D(controller);
same(setVisualThreePresentation(liveHost as never, { links: [{ key: "R", labelVisible: true }] }), true, "live renderer accepts label presentation");
const afterLabelUpdate = snapshotLivePhysics3D(controller);
same(afterLabelUpdate.tick, beforeLabelUpdate.tick, "label update does not tick physics");
same(afterLabelUpdate.awake, beforeLabelUpdate.awake, "label update does not wake/sleep physics");
same(afterLabelUpdate.pinnedKeys.length, beforeLabelUpdate.pinnedKeys.length, "label update does not pin physics");
same(destroyVisualThreeRenderer(liveHost as never), true, "live label renderer destroys cleanly");
