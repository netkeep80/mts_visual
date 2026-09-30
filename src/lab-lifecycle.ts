export const VISUAL_LAB_MODE_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "structural-2d", label: "Структурный 2D", issue: 126, ready: false }),
  Object.freeze({ id: "blueprint-2d", label: "Blueprint 2D", issue: 127, ready: false }),
  Object.freeze({ id: "document-2d", label: "Документный 2D", issue: 123, ready: false }),
  Object.freeze({ id: "classic-3d", label: "Классический 3D", issue: 128, ready: false }),
  Object.freeze({ id: "mechanical-3d", label: "Механический 3D", issue: 129, ready: true }),
] as const);

export type VisualLabModeId = typeof VISUAL_LAB_MODE_DEFINITIONS[number]["id"];

export interface VisualLabModeDefinition {
  readonly id: VisualLabModeId;
  readonly label: string;
  readonly issue: number;
  readonly ready: boolean;
}

export type VisualLabCleanup = () => void | Promise<void>;

export interface VisualLabLifecycleSnapshot {
  readonly activeMode: VisualLabModeId | null;
  readonly generation: number;
  readonly mounted: boolean;
}

export interface VisualLabLifecycleStateEvent {
  readonly state: "mounting" | "mounted" | "disposed" | "error";
  readonly modeId: VisualLabModeId | null;
  readonly error?: unknown;
}

export interface VisualLabLifecycle<TContext = undefined> {
  readonly activeMode: VisualLabModeId | null;
  activate(modeId: VisualLabModeId, context: TContext): Promise<VisualLabLifecycleSnapshot>;
  dispose(): Promise<VisualLabLifecycleSnapshot>;
  snapshot(): VisualLabLifecycleSnapshot;
}

const MODE_IDS = new Set<string>(VISUAL_LAB_MODE_DEFINITIONS.map((mode) => mode.id));

export function visualLabModeDefinition(modeId: string): VisualLabModeDefinition | null {
  return VISUAL_LAB_MODE_DEFINITIONS.find((mode) => mode.id === modeId) ?? null;
}

export function assertVisualLabModeId(modeId: string): VisualLabModeId {
  if (!MODE_IDS.has(modeId)) throw new Error(`unknown visual lab mode: ${modeId}`);
  return modeId as VisualLabModeId;
}

export function createVisualLabLifecycle<TContext = undefined>(options: Readonly<{
  mount: (
    modeId: VisualLabModeId,
    context: TContext,
  ) => VisualLabCleanup | { readonly dispose: VisualLabCleanup } | void
    | Promise<VisualLabCleanup | { readonly dispose: VisualLabCleanup } | void>;
  onStateChange?: (event: VisualLabLifecycleStateEvent) => void;
}>): VisualLabLifecycle<TContext> {
  if (typeof options?.mount !== "function") {
    throw new TypeError("createVisualLabLifecycle: mount must be a function");
  }

  const onStateChange = options.onStateChange ?? (() => {});
  let activeMode: VisualLabModeId | null = null;
  let cleanup: VisualLabCleanup | null = null;
  let generation = 0;
  let queue: Promise<VisualLabLifecycleSnapshot> = Promise.resolve(
    Object.freeze({ activeMode: null, generation: 0, mounted: false }),
  );

  const snapshot = (): VisualLabLifecycleSnapshot => Object.freeze({
    activeMode,
    generation,
    mounted: cleanup !== null,
  });

  const runCleanup = async (): Promise<void> => {
    const current = cleanup;
    cleanup = null;
    activeMode = null;
    if (current) await current();
  };

  const activate = (
    modeId: VisualLabModeId,
    context: TContext,
  ): Promise<VisualLabLifecycleSnapshot> => {
    assertVisualLabModeId(modeId);
    const requestedGeneration = ++generation;

    queue = queue.then(async () => {
      if (requestedGeneration !== generation) return snapshot();

      await runCleanup();
      onStateChange(Object.freeze({ state: "mounting", modeId }));

      let nextCleanup: VisualLabCleanup | null = null;
      try {
        const mounted = await options.mount(modeId, context);
        if (typeof mounted === "function") nextCleanup = mounted;
        else if (mounted && typeof mounted.dispose === "function") {
          nextCleanup = () => mounted.dispose();
        }
      } catch (error) {
        onStateChange(Object.freeze({ state: "error", modeId, error }));
        throw error;
      }

      if (requestedGeneration !== generation) {
        if (nextCleanup) await nextCleanup();
        return snapshot();
      }

      activeMode = modeId;
      cleanup = nextCleanup ?? (() => {});
      onStateChange(Object.freeze({ state: "mounted", modeId }));
      return snapshot();
    });

    return queue;
  };

  const dispose = (): Promise<VisualLabLifecycleSnapshot> => {
    generation += 1;
    queue = queue.then(async () => {
      await runCleanup();
      onStateChange(Object.freeze({ state: "disposed", modeId: null }));
      return snapshot();
    });
    return queue;
  };

  return Object.freeze({
    activate,
    dispose,
    snapshot,
    get activeMode() {
      return activeMode;
    },
  });
}
