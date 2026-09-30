import {
  VISUAL_LAB_MODE_IDS,
  assertVisualLabModeId,
  createVisualLabLifecycle,
} from "../src/lab-lifecycle.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`lab-lifecycle: ${message}`);
}

assert(
  VISUAL_LAB_MODE_IDS.join(",")
    === "structural-2d,blueprint-2d,document-2d,classic-3d,mechanical-3d",
  "primary mode order must remain stable",
);

let unknownRejected = false;
try {
  assertVisualLabModeId("unknown");
} catch {
  unknownRejected = true;
}
assert(unknownRejected, "unknown mode must fail closed");

const events: string[] = [];
const lifecycle = createVisualLabLifecycle<void>({
  mount: async (modeId) => {
    events.push(`mount:${modeId}`);
    return () => {
      events.push(`dispose:${modeId}`);
    };
  },
  onStateChange: ({ state, modeId }) => {
    events.push(`state:${state}:${modeId ?? "-"}`);
  },
});

await lifecycle.activate("mechanical-3d", undefined);
assert(lifecycle.snapshot().activeMode === "mechanical-3d", "mechanical activation");
await lifecycle.activate("classic-3d", undefined);
assert(lifecycle.snapshot().activeMode === "classic-3d", "classic activation");
await lifecycle.dispose();
assert(lifecycle.snapshot().activeMode === null, "dispose clears active mode");

const expected = [
  "state:mounting:mechanical-3d",
  "mount:mechanical-3d",
  "state:mounted:mechanical-3d",
  "dispose:mechanical-3d",
  "state:mounting:classic-3d",
  "mount:classic-3d",
  "state:mounted:classic-3d",
  "dispose:classic-3d",
  "state:disposed:-",
];
assert(events.join("|") === expected.join("|"), "dispose-before-mount ordering");

let failOnce = true;
const recovery = createVisualLabLifecycle<void>({
  mount: async (modeId) => {
    if (modeId === "document-2d" && failOnce) {
      failOnce = false;
      throw new Error("synthetic mount failure");
    }
    return () => {};
  },
});

let mountRejected = false;
try {
  await recovery.activate("document-2d", undefined);
} catch {
  mountRejected = true;
}
assert(mountRejected, "failed mount must reject its activation");
await recovery.activate("structural-2d", undefined);
assert(
  recovery.snapshot().activeMode === "structural-2d",
  "later activation must recover after a failed mount",
);
