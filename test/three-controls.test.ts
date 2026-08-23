import {
  createLivePhysics3D,
  sleepLivePhysics3D,
  snapshotLivePhysics3D,
  LivePhysics3DError,
} from "../src/live-physics3d.js";
import type { Physics3DState } from "../src/physics3d.js";
import type { VisualLinkNetwork } from "../src/index.js";
import {
  createVisualThreeLiveRenderer,
  createVisualThreeControlBar,
  destroyVisualThreeControlBar,
  destroyVisualThreeRenderer,
  getVisualThreeControlBarSnapshot,
  setVisualThreeLivePhysicsOptions,
  toggleVisualThreeFullscreen,
} from "../src/three/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V2f-D: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

type Listener = () => void;

type EventProbe = {
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  dispatch(type: string): void;
  listenerCount(): number;
};

function eventProbe<T extends object>(base: T): T & EventProbe {
  const listeners = new Map<string, Set<Listener>>();
  return Object.assign(base, {
    addEventListener(type: string, listener: Listener) {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    listenerCount() {
      return [...listeners.values()].reduce((total, set) => total + set.size, 0);
    },
  });
}

type NodeProbe = EventProbe & {
  token: string;
  parentNode: HostProbe | null;
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | undefined;
};

type InputProbe = NodeProbe & { value: string };
type HostProbe = {
  clientWidth: number;
  clientHeight: number;
  readonly children: NodeProbe[];
  appendChild(node: NodeProbe): NodeProbe;
  removeChild(node: NodeProbe): NodeProbe;
  contains(node: NodeProbe): boolean;
  getBoundingClientRect(): { width: number; height: number };
  requestFullscreen?: () => Promise<void>;
};

function node(token: string): NodeProbe {
  const attributes = new Map<string, string>();
  return eventProbe({
    token,
    parentNode: null as HostProbe | null,
    textContent: null as string | null,
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    getAttribute(name: string) { return attributes.get(name); },
  });
}

function input(token: string): InputProbe {
  return Object.assign(node(token), { value: "" });
}

function host(width = 400, height = 300): HostProbe {
  const children: NodeProbe[] = [];
  const value: HostProbe = {
    clientWidth: width,
    clientHeight: height,
    children,
    appendChild(child) {
      if (!children.includes(child)) children.push(child);
      child.parentNode = value;
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    contains: (child) => children.includes(child),
    getBoundingClientRect: () => ({ width: value.clientWidth, height: value.clientHeight }),
  };
  return value;
}

type FullscreenDocumentProbe = EventProbe & {
  fullscreenElement: unknown | null;
  exitFullscreen(): Promise<void>;
};

function fullscreenDocument(): FullscreenDocumentProbe {
  const value = eventProbe({
    fullscreenElement: null as unknown | null,
    async exitFullscreen() {
      value.fullscreenElement = null;
      value.dispatch("fullscreenchange");
    },
  });
  return value;
}

const network: VisualLinkNetwork = {
  links: [{ key: "R", startKey: "R", endKey: "R", label: "∞", tags: ["root"] }],
};
const initial: Physics3DState = {
  positions: [{ key: "R", point: { x: 0, y: 0, z: 0 } }],
  velocities: [{ key: "R", vector: { x: 0, y: 0, z: 0 } }],
};
const controller = createLivePhysics3D(network, initial, { settleWindow: 1 });
const rendererHost = host();
const surfaceElement = node("surface");
const frames = new Map<number, (timestamp: number) => void>();
let nextFrame = 1;
let resizeCount = 0;

createVisualThreeLiveRenderer(rendererHost as never, network, controller, {
  surfaceFactory: () => ({
    domElement: surfaceElement as never,
    setSize() { resizeCount += 1; },
    render() {},
    dispose() {},
  }),
  resizeObserverFactory: () => ({ disconnect() {} }),
  controlsFactory: () => ({
    enabled: true,
    target: { copy() { return this; } },
    update() {},
    addEventListener() {},
    removeEventListener() {},
    dispose() {},
  }),
  requestFrame(callback: (timestamp: number) => void) {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  },
  cancelFrame(id: number) { frames.delete(id); },
} as never);

const firstFrame = [...frames.entries()][0]!;
frames.delete(firstFrame[0]);
firstFrame[1](123456);
same(snapshotLivePhysics3D(controller).awake, false, "settled controller sleeps before option update");

const positionsBeforeCharge = JSON.stringify(snapshotLivePhysics3D(controller).state.positions);
same(setVisualThreeLivePhysicsOptions(rendererHost as never, { charge: 2 }), true, "charge patch accepted by live renderer");
same(snapshotLivePhysics3D(controller).awake, true, "charge patch wakes existing V2e controller");
same(JSON.stringify(snapshotLivePhysics3D(controller).state.positions), positionsBeforeCharge, "charge patch preserves coordinates immediately");
same(frames.size, 1, "charge patch schedules one RAF after wake");

sleepLivePhysics3D(controller);
frames.clear();
const positionsBeforeSpring = JSON.stringify(snapshotLivePhysics3D(controller).state.positions);
same(setVisualThreeLivePhysicsOptions(rendererHost as never, { springStiffness: 0.2 }), true, "spring patch accepted by live renderer");
same(snapshotLivePhysics3D(controller).awake, true, "spring patch wakes existing V2e controller");
same(JSON.stringify(snapshotLivePhysics3D(controller).state.positions), positionsBeforeSpring, "spring patch preserves coordinates immediately");

sleepLivePhysics3D(controller);
frames.clear();
const beforeInvalid = JSON.stringify(snapshotLivePhysics3D(controller));
let invalidCode: string | undefined;
try {
  setVisualThreeLivePhysicsOptions(rendererHost as never, { charge: -1 });
} catch (error) {
  assert(error instanceof LivePhysics3DError, "negative charge fails through V2e error boundary");
  invalidCode = error.code;
}
same(invalidCode, "invalid-physics-option", "negative charge is validated by accepted V2e/V2d boundary");
same(JSON.stringify(snapshotLivePhysics3D(controller)), beforeInvalid, "rejected physics patch leaves live state untouched");

const { attachVisualThreeLiveController, buildVisualThreeSceneData } = await import("../src/three/index.js");
const replacementController = createLivePhysics3D(network, initial, { settleWindow: 1 });
sleepLivePhysics3D(controller);
sleepLivePhysics3D(replacementController);
frames.clear();
const replacementPositions = JSON.stringify(snapshotLivePhysics3D(replacementController).state.positions);
const reattachOptions = {
  controlsFactory: () => ({
    enabled: true,
    target: { copy() { return this; } },
    update() {},
    addEventListener() {},
    removeEventListener() {},
    dispose() {},
  }),
  requestFrame(callback: (timestamp: number) => void) {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  },
  cancelFrame(id: number) { frames.delete(id); },
} as never;
same(
  attachVisualThreeLiveController(
    rendererHost as never,
    replacementController,
    (state) => buildVisualThreeSceneData(network, state),
    reattachOptions,
  ),
  true,
  "public reattach replaces current V2e controller",
);
same(setVisualThreeLivePhysicsOptions(rendererHost as never, { charge: 4 }), true, "D patch accepted after public reattach");
same(snapshotLivePhysics3D(replacementController).awake, true, "D patch targets current reattached V2e controller");
same(snapshotLivePhysics3D(controller).awake, false, "D patch does not wake stale former V2e controller");
same(
  JSON.stringify(snapshotLivePhysics3D(replacementController).state.positions),
  replacementPositions,
  "D patch preserves current controller coordinates after reattach",
);
same(
  attachVisualThreeLiveController(
    rendererHost as never,
    controller,
    (state) => buildVisualThreeSceneData(network, state),
    reattachOptions,
  ),
  true,
  "original controller restored for remaining control-bar checks",
);

const controlHost = host();
const root = node("controls");
const chargeInput = input("charge");
const springInput = input("spring");
const fullscreenButton = node("fullscreen");
const documentProbe = fullscreenDocument();
rendererHost.requestFullscreen = async () => {
  documentProbe.fullscreenElement = rendererHost;
  documentProbe.dispatch("fullscreenchange");
};

const beforeCreate = JSON.stringify(snapshotLivePhysics3D(controller));
createVisualThreeControlBar(rendererHost as never, controlHost as never, {
  charge: 2,
  springStiffness: 0.2,
  elementsFactory: () => ({ root, chargeInput, springStiffnessInput: springInput, fullscreenButton }),
  fullscreenDocument: documentProbe,
} as never);
same(controlHost.children.length, 1, "control bar attaches one owned root");
same(JSON.stringify(snapshotLivePhysics3D(controller)), beforeCreate, "control bar creation is presentation-only");
let controlSnapshot = getVisualThreeControlBarSnapshot(rendererHost as never)!;
same(controlSnapshot.charge, 2, "control bar displays caller presentation charge");
same(controlSnapshot.springStiffness, 0.2, "control bar displays caller presentation spring stiffness");
same(controlSnapshot.fullscreen, false, "control bar starts outside fullscreen");

chargeInput.value = "not-a-number";
chargeInput.dispatch("input");
same(JSON.stringify(snapshotLivePhysics3D(controller)), beforeCreate, "non-numeric input does not mutate live controller");
same(getVisualThreeControlBarSnapshot(rendererHost as never)!.charge, 2, "non-numeric input does not change displayed accepted value");

chargeInput.value = "3";
chargeInput.dispatch("input");
same(snapshotLivePhysics3D(controller).awake, true, "charge input delegates to V2e and wakes network");
same(getVisualThreeControlBarSnapshot(rendererHost as never)!.charge, 3, "accepted charge input updates presentation value");

sleepLivePhysics3D(controller);
frames.clear();
springInput.value = "0.12";
springInput.dispatch("input");
same(snapshotLivePhysics3D(controller).awake, true, "spring input delegates to V2e and wakes network");
same(getVisualThreeControlBarSnapshot(rendererHost as never)!.springStiffness, 0.12, "accepted spring input updates presentation value");

sleepLivePhysics3D(controller);
frames.clear();
chargeInput.value = "-4";
let controlInvalidCode: string | undefined;
try {
  chargeInput.dispatch("input");
} catch (error) {
  assert(error instanceof LivePhysics3DError, "negative slider value reaches accepted V2e validation");
  controlInvalidCode = error.code;
}
same(controlInvalidCode, "invalid-physics-option", "control bar does not duplicate negative physics validation");
same(getVisualThreeControlBarSnapshot(rendererHost as never)!.charge, 3, "rejected slider value is not committed to presentation state");

const resizeBeforeEnter = resizeCount;
same(await toggleVisualThreeFullscreen(rendererHost as never), true, "native fullscreen enter accepted");
controlSnapshot = getVisualThreeControlBarSnapshot(rendererHost as never)!;
same(controlSnapshot.fullscreen, true, "fullscreenchange synchronizes entered state");
assert(resizeCount > resizeBeforeEnter, "fullscreen enter triggers renderer resize");
same(fullscreenButton.getAttribute("aria-pressed"), "true", "fullscreen button aria state synchronized");

const resizeBeforeExit = resizeCount;
same(await toggleVisualThreeFullscreen(rendererHost as never), true, "native fullscreen exit accepted for owned container");
same(getVisualThreeControlBarSnapshot(rendererHost as never)!.fullscreen, false, "fullscreen exit synchronizes state");
assert(resizeCount > resizeBeforeExit, "fullscreen exit triggers renderer resize");

const foreignFullscreen = {};
documentProbe.fullscreenElement = foreignFullscreen;
same(await toggleVisualThreeFullscreen(rendererHost as never), false, "foreign fullscreen element is not exited or replaced");
same(documentProbe.fullscreenElement, foreignFullscreen, "foreign fullscreen ownership is preserved");
documentProbe.fullscreenElement = null;
documentProbe.dispatch("fullscreenchange");

same(destroyVisualThreeControlBar(rendererHost as never), true, "explicit control bar destroy succeeds");
same(controlHost.children.length, 0, "explicit destroy removes owned control DOM");
same(documentProbe.listenerCount(), 0, "explicit destroy removes fullscreen listener");
same(destroyVisualThreeControlBar(rendererHost as never), false, "control bar destroy is idempotent");

createVisualThreeControlBar(rendererHost as never, controlHost as never, {
  charge: 3,
  springStiffness: 0.12,
  elementsFactory: () => ({ root, chargeInput, springStiffnessInput: springInput, fullscreenButton }),
  fullscreenDocument: documentProbe,
} as never);
same(documentProbe.listenerCount(), 1, "recreated control bar owns one fullscreen listener");
same(destroyVisualThreeRenderer(rendererHost as never), true, "renderer destroy succeeds with attached control bar");
same(controlHost.children.length, 0, "renderer destroy removes attached control bar DOM");
same(documentProbe.listenerCount(), 0, "renderer destroy removes attached fullscreen listener");
same(getVisualThreeControlBarSnapshot(rendererHost as never), undefined, "renderer destroy clears control bar state");
same(setVisualThreeLivePhysicsOptions(rendererHost as never, { charge: 1 }), false, "physics patch on missing renderer is safe false");
same(await toggleVisualThreeFullscreen(rendererHost as never), false, "fullscreen toggle on missing control bar is safe false");
