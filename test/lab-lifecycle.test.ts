import {
  VISUAL_LAB_MODE_DEFINITIONS,
  assertVisualLabModeId,
  createVisualLabLifecycle,
  visualLabModeDefinition,
} from "../src/lab-lifecycle.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`lab-lifecycle: ${message}`);
}

assert(
  VISUAL_LAB_MODE_DEFINITIONS.map((mode) => mode.id).join(",")
    === "structural-2d,blueprint-2d,document-2d,classic-3d,mechanical-3d",
  "primary mode order must remain stable",
);
assert(visualLabModeDefinition("classic-3d")?.issue === 128, "Classic 3D issue binding");
assert(visualLabModeDefinition("mechanical-3d")?.ready === true, "Mechanical 3D ready baseline");

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
assert(lifecycle.activeMode === "mechanical-3d", "mechanical activation");
await lifecycle.activate("classic-3d", undefined);
assert(lifecycle.activeMode === "classic-3d", "classic activation");
await lifecycle.dispose();
assert(lifecycle.activeMode === null, "dispose clears active mode");

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
