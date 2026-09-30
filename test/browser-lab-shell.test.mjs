import {
  LAB_MODE_DEFINITIONS,
  assertLabModeId,
  createLabModeLifecycle,
  labModeDefinition,
} from "../browser/webgpu-witness/lab-shell.js";

function assert(condition, message) {
  if (!condition) throw new Error(`lab-shell: ${message}`);
}

assert(
  LAB_MODE_DEFINITIONS.map((mode) => mode.id).join(",")
    === "structural-2d,blueprint-2d,document-2d,classic-3d,mechanical-3d",
  "primary mode order must remain stable",
);
assert(labModeDefinition("classic-3d")?.issue === 128, "Classic 3D issue binding");
assert(labModeDefinition("mechanical-3d")?.ready === true, "Mechanical 3D is initially ready");

let unknownRejected = false;
try {
  assertLabModeId("unknown");
} catch {
  unknownRejected = true;
}
assert(unknownRejected, "unknown mode must fail closed");

const events = [];
const lifecycle = createLabModeLifecycle({
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

await lifecycle.activate("mechanical-3d");
assert(lifecycle.activeMode === "mechanical-3d", "mechanical activation");
await lifecycle.activate("classic-3d");
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

console.log("lab-shell lifecycle: PASS");
