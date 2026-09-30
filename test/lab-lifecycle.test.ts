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


const cycleEvents: string[] = [];
let activeMounts = 0;
let maximumActiveMounts = 0;
const mountCounts = new Map<string, number>();
const disposeCounts = new Map<string, number>();

const cycleLifecycle = createVisualLabLifecycle<void>({
  mount: async (modeId) => {
    activeMounts += 1;
    maximumActiveMounts = Math.max(maximumActiveMounts, activeMounts);
    mountCounts.set(modeId, (mountCounts.get(modeId) ?? 0) + 1);
    cycleEvents.push(`mount:${modeId}`);
    return () => {
      activeMounts -= 1;
      disposeCounts.set(modeId, (disposeCounts.get(modeId) ?? 0) + 1);
      cycleEvents.push(`dispose:${modeId}`);
    };
  },
});

const fullCycle = [
  "structural-2d",
  "blueprint-2d",
  "document-2d",
  "classic-3d",
  "mechanical-3d",
  "classic-3d",
  "document-2d",
  "blueprint-2d",
  "structural-2d",
] as const;

for (let iteration = 0; iteration < 3; iteration += 1) {
  for (const modeId of fullCycle) {
    await cycleLifecycle.activate(modeId, undefined);
    assert(cycleLifecycle.snapshot().activeMode === modeId, `cycle active mode ${modeId}`);
    assert(activeMounts === 1, `exactly one active renderer after ${modeId}`);
  }
}
await cycleLifecycle.dispose();

assert(maximumActiveMounts === 1, "mode cycling never overlaps mounted renderers");
assert(activeMounts === 0, "final lifecycle dispose releases the active renderer");

const totalMounts = [...mountCounts.values()].reduce((sum, value) => sum + value, 0);
const totalDisposes = [...disposeCounts.values()].reduce((sum, value) => sum + value, 0);
assert(totalMounts === fullCycle.length * 3, "all requested mode mounts executed");
assert(totalDisposes === totalMounts, "every mounted renderer was disposed exactly once");

for (let index = 1; index < cycleEvents.length; index += 1) {
  if (!cycleEvents[index]!.startsWith("mount:")) continue;
  assert(
    cycleEvents[index - 1]!.startsWith("dispose:"),
    `mount at event ${index} must be immediately preceded by disposal`,
  );
}
