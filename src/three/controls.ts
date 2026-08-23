import {
  getVisualThreeRendererSnapshot,
  hasVisualThreeLiveController,
  resizeVisualThreeRenderer,
  setVisualThreeLivePhysicsOptions,
  type VisualThreeContainer,
} from "./renderer.js";

type Listener = () => void;

export interface VisualThreeControlNode {
  textContent: string | null;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  setAttribute?(name: string, value: string): void;
}

export interface VisualThreeControlInput extends VisualThreeControlNode {
  value: string;
}

export interface VisualThreeControlHost {
  appendChild(node: VisualThreeControlNode): unknown;
  removeChild(node: VisualThreeControlNode): unknown;
  contains(node: VisualThreeControlNode): boolean;
}

export interface VisualThreeControlBarElements {
  readonly root: VisualThreeControlNode;
  readonly chargeInput: VisualThreeControlInput;
  readonly springStiffnessInput: VisualThreeControlInput;
  readonly fullscreenButton: VisualThreeControlNode;
}

export interface VisualThreeFullscreenDocument {
  readonly fullscreenElement: unknown | null;
  exitFullscreen?(): Promise<void>;
  addEventListener(type: "fullscreenchange", listener: Listener): void;
  removeEventListener(type: "fullscreenchange", listener: Listener): void;
}

export interface VisualThreeControlBarOptions {
  readonly charge: number;
  readonly springStiffness: number;
  readonly elementsFactory?: () => VisualThreeControlBarElements;
  readonly fullscreenDocument?: VisualThreeFullscreenDocument;
}

export interface VisualThreeControlBarSnapshot {
  readonly mounted: true;
  readonly charge: number;
  readonly springStiffness: number;
  readonly fullscreen: boolean;
}

interface MountedControlBar {
  readonly container: VisualThreeContainer;
  readonly host: VisualThreeControlHost;
  readonly elements: VisualThreeControlBarElements;
  readonly fullscreenDocument: VisualThreeFullscreenDocument | undefined;
  readonly onChargeInput: Listener;
  readonly onSpringInput: Listener;
  readonly onFullscreenClick: Listener;
  readonly onFullscreenChange: Listener;
  charge: number;
  springStiffness: number;
  fullscreen: boolean;
  destroyed: boolean;
}

const controlBars = new WeakMap<object, MountedControlBar>();

function key(container: VisualThreeContainer): object {
  return container as object;
}

function finitePresentationValue(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`@mts/visual/three: ${name} presentation value must be finite`);
  }
  return value;
}

function defaultFullscreenDocument(): VisualThreeFullscreenDocument | undefined {
  if (typeof document === "undefined") return undefined;
  return document as unknown as VisualThreeFullscreenDocument;
}

function defaultElements(): VisualThreeControlBarElements {
  if (typeof document === "undefined") {
    throw new Error("@mts/visual/three: document is unavailable for default control bar elements");
  }

  const root = document.createElement("div");
  root.setAttribute("data-mts-visual-three-controls", "true");

  const chargeLabel = document.createElement("label");
  chargeLabel.textContent = "Charge ";
  const chargeInput = document.createElement("input");
  chargeInput.type = "range";
  chargeInput.min = "0";
  chargeInput.step = "0.05";
  chargeInput.setAttribute("aria-label", "Charge");
  chargeLabel.appendChild(chargeInput);

  const springLabel = document.createElement("label");
  springLabel.textContent = "Spring stiffness ";
  const springStiffnessInput = document.createElement("input");
  springStiffnessInput.type = "range";
  springStiffnessInput.min = "0";
  springStiffnessInput.step = "0.005";
  springStiffnessInput.setAttribute("aria-label", "Spring stiffness");
  springLabel.appendChild(springStiffnessInput);

  const fullscreenButton = document.createElement("button");
  fullscreenButton.type = "button";
  fullscreenButton.textContent = "Fullscreen";

  root.append(chargeLabel, springLabel, fullscreenButton);
  return {
    root: root as unknown as VisualThreeControlNode,
    chargeInput: chargeInput as unknown as VisualThreeControlInput,
    springStiffnessInput: springStiffnessInput as unknown as VisualThreeControlInput,
    fullscreenButton: fullscreenButton as unknown as VisualThreeControlNode,
  };
}

function snapshot(state: MountedControlBar): VisualThreeControlBarSnapshot {
  return Object.freeze({
    mounted: true as const,
    charge: state.charge,
    springStiffness: state.springStiffness,
    fullscreen: state.fullscreen,
  });
}

function parseInput(input: VisualThreeControlInput): number | undefined {
  const raw = input.value.trim();
  if (raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function syncFullscreen(state: MountedControlBar, resize: boolean): void {
  if (state.destroyed) return;
  state.fullscreen = state.fullscreenDocument?.fullscreenElement === state.container;
  state.elements.fullscreenButton.setAttribute?.("aria-pressed", state.fullscreen ? "true" : "false");
  state.elements.fullscreenButton.textContent = state.fullscreen ? "Exit fullscreen" : "Fullscreen";
  if (resize) resizeVisualThreeRenderer(state.container);
}

export function createVisualThreeControlBar(
  container: VisualThreeContainer,
  host: VisualThreeControlHost,
  options: VisualThreeControlBarOptions,
): VisualThreeControlBarSnapshot {
  if (!getVisualThreeRendererSnapshot(container)) {
    throw new Error("@mts/visual/three: cannot mount controls without renderer");
  }
  if (!hasVisualThreeLiveController(container)) {
    throw new Error("@mts/visual/three: cannot mount live controls without V2e controller");
  }
  if (controlBars.has(key(container))) {
    throw new Error("@mts/visual/three: control bar already mounted for container");
  }

  const elements = options.elementsFactory?.() ?? defaultElements();
  const fullscreenDocument = options.fullscreenDocument ?? defaultFullscreenDocument();
  const charge = finitePresentationValue(options.charge, "charge");
  const springStiffness = finitePresentationValue(options.springStiffness, "springStiffness");
  const state = {} as MountedControlBar;

  Object.assign(state, {
    container,
    host,
    elements,
    fullscreenDocument,
    charge,
    springStiffness,
    fullscreen: false,
    destroyed: false,
    onChargeInput: () => {
      const value = parseInput(elements.chargeInput);
      if (value === undefined) return;
      if (setVisualThreeLivePhysicsOptions(container, { charge: value })) state.charge = value;
    },
    onSpringInput: () => {
      const value = parseInput(elements.springStiffnessInput);
      if (value === undefined) return;
      if (setVisualThreeLivePhysicsOptions(container, { springStiffness: value })) state.springStiffness = value;
    },
    onFullscreenClick: () => {
      void toggleVisualThreeFullscreen(container).catch(() => { syncFullscreen(state, false); });
    },
    onFullscreenChange: () => { syncFullscreen(state, true); },
  } satisfies Partial<MountedControlBar>);

  elements.chargeInput.value = String(charge);
  elements.springStiffnessInput.value = String(springStiffness);
  elements.chargeInput.addEventListener("input", state.onChargeInput);
  elements.springStiffnessInput.addEventListener("input", state.onSpringInput);
  elements.fullscreenButton.addEventListener("click", state.onFullscreenClick);
  fullscreenDocument?.addEventListener("fullscreenchange", state.onFullscreenChange);
  host.appendChild(elements.root);
  controlBars.set(key(container), state);
  syncFullscreen(state, false);
  return snapshot(state);
}

export function getVisualThreeControlBarSnapshot(
  container: VisualThreeContainer,
): VisualThreeControlBarSnapshot | undefined {
  const state = controlBars.get(key(container));
  return state && !state.destroyed ? snapshot(state) : undefined;
}

export async function toggleVisualThreeFullscreen(container: VisualThreeContainer): Promise<boolean> {
  const state = controlBars.get(key(container));
  if (!state || state.destroyed || !getVisualThreeRendererSnapshot(container)) return false;
  const fullscreenDocument = state.fullscreenDocument;
  if (!fullscreenDocument) return false;

  const current = fullscreenDocument.fullscreenElement;
  if (current !== null && current !== container) return false;

  if (current === container) {
    if (typeof fullscreenDocument.exitFullscreen !== "function") return false;
    await fullscreenDocument.exitFullscreen();
    syncFullscreen(state, true);
    return true;
  }

  const target = container as VisualThreeContainer & { requestFullscreen?: () => Promise<void> };
  if (typeof target.requestFullscreen !== "function") return false;
  await target.requestFullscreen();
  syncFullscreen(state, true);
  return true;
}

export function destroyVisualThreeControlBar(container: VisualThreeContainer): boolean {
  const state = controlBars.get(key(container));
  if (!state || state.destroyed) return false;
  state.destroyed = true;
  state.elements.chargeInput.removeEventListener("input", state.onChargeInput);
  state.elements.springStiffnessInput.removeEventListener("input", state.onSpringInput);
  state.elements.fullscreenButton.removeEventListener("click", state.onFullscreenClick);
  state.fullscreenDocument?.removeEventListener("fullscreenchange", state.onFullscreenChange);
  if (state.host.contains(state.elements.root)) state.host.removeChild(state.elements.root);
  controlBars.delete(key(container));
  return true;
}
