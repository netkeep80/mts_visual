export const LAB_MODE_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "structural-2d", label: "Структурный 2D", issue: 126, ready: false }),
  Object.freeze({ id: "blueprint-2d", label: "Blueprint 2D", issue: 127, ready: false }),
  Object.freeze({ id: "document-2d", label: "Документный 2D", issue: 123, ready: false }),
  Object.freeze({ id: "classic-3d", label: "Классический 3D", issue: 128, ready: false }),
  Object.freeze({ id: "mechanical-3d", label: "Механический 3D", issue: 129, ready: true }),
]);

const MODE_IDS = new Set(LAB_MODE_DEFINITIONS.map((mode) => mode.id));

export function labModeDefinition(modeId) {
  return LAB_MODE_DEFINITIONS.find((mode) => mode.id === modeId) ?? null;
}

export function assertLabModeId(modeId) {
  if (!MODE_IDS.has(modeId)) throw new Error(`Неизвестный режим визуализации: ${modeId}`);
  return modeId;
}

/**
 * Serial lifecycle for browser renderers.
 *
 * Every activation disposes the currently mounted renderer before mounting the
 * next one. Async mounts are generation-guarded, so a superseded mount cannot
 * become current after a newer mode request.
 */
export function createLabModeLifecycle({ mount, onStateChange = () => {} } = {}) {
  if (typeof mount !== "function") {
    throw new TypeError("createLabModeLifecycle: mount должен быть функцией");
  }

  let activeMode = null;
  let cleanup = null;
  let generation = 0;
  let queue = Promise.resolve();

  const snapshot = () => Object.freeze({
    activeMode,
    generation,
    mounted: cleanup !== null,
  });

  async function runCleanup() {
    const current = cleanup;
    cleanup = null;
    activeMode = null;
    if (current) await current();
  }

  function activate(modeId, context) {
    assertLabModeId(modeId);
    const requestedGeneration = ++generation;

    queue = queue.then(async () => {
      if (requestedGeneration !== generation) return snapshot();

      await runCleanup();
      onStateChange(Object.freeze({ state: "mounting", modeId }));

      let nextCleanup = null;
      try {
        const mounted = await mount(modeId, context);
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
  }

  function dispose() {
    generation += 1;
    queue = queue.then(async () => {
      await runCleanup();
      onStateChange(Object.freeze({ state: "disposed", modeId: null }));
      return snapshot();
    });
    return queue;
  }

  return Object.freeze({
    activate,
    dispose,
    snapshot,
    get activeMode() {
      return activeMode;
    },
  });
}
