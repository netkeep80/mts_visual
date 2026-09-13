# LivePhysics3D Network Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an atomic consumer-neutral `VisualLinkNetwork` transition to `LivePhysics3D` so only the current topology participates in presentation physics.

**Architecture:** Rebuild a candidate `PhysicalModel3D` from the complete next network, preserve state for retained keys, deterministically seed added keys, retain only surviving pins, validate the full candidate, and commit it atomically. Physical-topology equality is defined by model keys and springs, so metadata-only changes do not wake physics.

**Tech Stack:** TypeScript 5.9, Node.js test script, `@mts/visual` presentation model/physics APIs, GitHub Actions CI, blocking repo-guard.

**Spec:** `docs/superpowers/specs/2026-09-13-live-physics3d-network-transition-design.md`

## Global Constraints

- Baseline main is `b4c29085f65e76e85dd49c74ed64cfa439366ab7` unless governance refresh shows a newer main before a write.
- Implement issue `#11`, U1 only; U2 Three renderer work is out of scope.
- Public API is `transitionLivePhysics3DNetwork(controller, nextNetwork): LivePhysics3DSnapshot`.
- `MTS semantic Link != VisualKey != Three object != physics coordinate`.
- No `@mts/core`, parser/debugger roles, root special case, random/wall-clock placement, or hidden future-node compatibility mode.
- Expected implementation files are only `src/live-physics3d.ts` and `test/live-physics3d.test.ts`; `src/physics3d.ts`, `src/index.ts`, Three files, package files, governance and workflows stay untouched.
- TDD order is mandatory: RED test commit, observed expected CI failure, then production implementation.
- Before every GitHub write/lifecycle transition refresh exact main, open issues/PRs, workflows, and `repo-policy.json`.

---

### Task 1: Add the complete U1 RED contract suite

**Files:**
- Modify: `test/live-physics3d.test.ts`

**Interfaces:**
- Consumes: existing `createLivePhysics3D`, `snapshotLivePhysics3D`, `stepLivePhysics3D`, pin/sleep APIs, `buildPhysicalModel3D`, `stepPhysics3D`.
- Produces: executable behavioral contract for `transitionLivePhysics3DNetwork(controller, nextNetwork): LivePhysics3DSnapshot`.

- [ ] **Step 1: Import the wished-for public API before it exists**

```ts
import {
  LivePhysics3DError,
  createLivePhysics3D,
  // existing imports...
  transitionLivePhysics3DNetwork,
} from "../src/live-physics3d.js";
```

- [ ] **Step 2: Add an add/remove fixture and exact model/state assertions**

Use a two-link base and a third link that connects the retained endpoints:

```ts
const transitionBaseNetwork: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "A" },
    { key: "B", startKey: "B", endKey: "B" },
  ],
};
const transitionNextNetwork: VisualLinkNetwork = {
  links: [
    ...transitionBaseNetwork.links,
    { key: "C", startKey: "A", endKey: "B" },
  ],
};
```

Assert after `base -> next`:

```ts
const before = snapshot(controller);
const transitioned = transitionLivePhysics3DNetwork(controller, transitionNextNetwork) as SnapshotProbe;
deepSame(positionOf(transitioned, "A"), positionOf(before, "A"), "retained A position survives transition");
deepSame(positionOf(transitioned, "B"), positionOf(before, "B"), "retained B position survives transition");
deepSame(velocityOf(transitioned, "A"), velocityOf(before, "A"), "retained A velocity survives transition");
deepSame(velocityOf(transitioned, "B"), velocityOf(before, "B"), "retained B velocity survives transition");
deepSame(velocityOf(transitioned, "C"), point(0, 0, 0), "new key starts with zero velocity");
assert(Number.isFinite(norm(positionOf(transitioned, "C"))), "new key receives finite deterministic position");
deepSame(controller.model, buildPhysicalModel3D(transitionNextNetwork), "controller model is rebuilt exactly from next network");
```

Then transition back and assert `C` is absent from positions, velocities, model keys, springs, and `pinnedKeys`.

- [ ] **Step 3: Add lifecycle/state preservation tests**

Cover:

```text
retained pin survives exactly
removed pin disappears
existing physics options still govern first post-transition tick
settled controller wakes on real topology change
metadata/input-order-only equivalent physical topology does not wake/reset
transition preserves tick and reports stepped=false
```

For option preservation, compare the first post-transition tick with `stepPhysics3D(buildPhysicalModel3D(nextNetwork), transitioned.state, originalOptions)`.

- [ ] **Step 4: Add determinism and recursive-topology tests**

Create two identical controllers and transition them to equivalent networks with different input link ordering. Assert identical snapshots and identical models.

Add finite/deterministic cases for:

```ts
// link-of-link chain
C: A -> B
D: C -> A

// mutual recursive cycle
C: D -> A
D: C -> A

// self-link
S: S -> S
```

All returned positions must be finite and equivalent transitions must serialize identically.

- [ ] **Step 5: Add the causality regression**

Use spring-only physics so the proof is unambiguous:

```ts
const causalOptions = {
  charge: 0,
  springStiffness: 1,
  restLength: 0.5,
  damping: 1,
  timeStep: 0.1,
  settleVelocity: 0,
  settlePositionDelta: 0,
  settleWindow: 100,
};
```

Before adding `C: A -> B`, the base self-link model has no springs, so a live tick must equal the base offline tick and leave A/B unaffected by C. After transition, `controller.model` must contain C and its springs; the next tick must allow A/B to react to those newly introduced springs.

- [ ] **Step 6: Add failed-transition atomicity test**

Capture model identity and full snapshot, then transition to an invalid network with a missing endpoint. Assert it throws and leaves:

```text
controller.model identity unchanged
snapshot byte-for-byte unchanged
pins/lifecycle unchanged
```

- [ ] **Step 7: Commit the RED test-only change**

Expected commit message:

```text
test: define LivePhysics3D network transition contract
```

- [ ] **Step 8: Verify RED in the draft PR**

Run through GitHub Actions by pushing the test-only head. Expected result: project CI fails because `transitionLivePhysics3DNetwork` is not exported/implemented yet. Confirm the failure is specifically the missing API, not a typo or unrelated regression.

---

### Task 2: Implement atomic whole-network transition

**Files:**
- Modify: `src/live-physics3d.ts`

**Interfaces:**
- Consumes: `normalizeVisualLinkNetwork`, `buildPhysicalModel3D`, `createInitialPhysics3DState`, existing resolved live options and snapshot machinery.
- Produces: `transitionLivePhysics3DNetwork(controller: LivePhysics3DController, nextNetwork: VisualLinkNetwork): LivePhysics3DSnapshot`.

- [ ] **Step 1: Extend only the private mutable representation**

Keep the public controller readonly, but permit internal model replacement:

```ts
interface MutableLivePhysics3DController extends LivePhysics3DController {
  model: PhysicalModel3D;
  state: Physics3DState;
  options: ResolvedLivePhysics3DOptions;
  readonly pinned: Map<VisualKey, Point3D>;
  // existing lifecycle fields
}
```

- [ ] **Step 2: Add deterministic candidate-building helpers**

Import:

```ts
import { normalizeVisualLinkNetwork, type VisualKey, type VisualLinkNetwork } from "./index.js";
import {
  buildPhysicalModel3D,
  createInitialPhysics3DState,
  // existing imports...
} from "./physics3d.js";
```

Build a canonical fallback map from `createInitialPhysics3DState(normalizedNextNetwork)`. Preserve retained positions first. For unresolved added links, iterate normalized links in key order and place any link whose start/end positions are already available:

```ts
base = midpoint(start, end)
seed = base + fallbackPoint * 0.05
```

Repeat until fixed point. Remaining self-links/cycles use their canonical fallback positions directly. Added velocities are exactly `zero()`.

- [ ] **Step 3: Add structural physical-topology equality**

Compare `PhysicalModel3D.keys` and every spring field (`linkKey`, `role`, `sourceKey`, `targetKey`) in deterministic order. Labels/tags are intentionally ignored because they are not physical topology.

- [ ] **Step 4: Prepare the complete transition before mutation**

Inside the new public function:

```ts
const value = mutable(controller);
const normalized = normalizeVisualLinkNetwork(nextNetwork);
const nextModel = buildPhysicalModel3D(normalized);
const candidateState = buildTransitionState(value, normalized, nextModel);
const candidatePins = retainedPins(value, nextModel);
validatePhysics(nextModel, candidateState, value.options);
const topologyChanged = !samePhysicalTopology(value.model, nextModel);
```

No controller field may be changed before all statements above succeed.

- [ ] **Step 5: Commit candidate atomically and update lifecycle**

Commit model, state and pins. On real physical topology change:

```ts
value.awake = nextModel.keys.length > 0;
value.stableTicks = 0;
value.maxVelocity = 0;
value.maxPositionDelta = 0;
```

Preserve `tick`. For equivalent physical topology, preserve awake/stability/metrics instead of forcing a wake/reset. Return `snapshot(value, false)`.

- [ ] **Step 6: Commit implementation**

Expected commit message:

```text
feat: transition LivePhysics3D network atomically
```

- [ ] **Step 7: Verify GREEN in GitHub Actions**

Expected result: project CI and the complete existing test suite pass. If any new U1 contract assertion fails, fix production code rather than weakening the test unless the assertion contradicts the approved spec.

---

### Task 3: Review, repo-guard and exact acceptance readiness

**Files:**
- Review only: PR diff, `src/live-physics3d.ts`, `test/live-physics3d.test.ts`, spec and this plan.

**Interfaces:**
- Consumes: GREEN implementation from Task 2.
- Produces: exact-head U1 PR ready for merge, without merging U2 or downstream consumer work.

- [ ] **Step 1: Check scope**

The final diff must contain only:

```text
docs/superpowers/specs/2026-09-13-live-physics3d-network-transition-design.md
docs/superpowers/plans/2026-09-13-live-physics3d-network-transition.md
src/live-physics3d.ts
test/live-physics3d.test.ts
```

- [ ] **Step 2: Update PR ChangeIntent to match the real diff**

Use `max_new_files: 2`, `max_new_docs: 2`, include both docs plus source/test in `scope`, and require both `src/live-physics3d.ts` and `test/live-physics3d.test.ts` in `must_touch`. Keep Three, physics3d, index, package, README, governance and workflows in `must_not_touch`.

- [ ] **Step 3: Run final verification**

Require full project CI GREEN and blocking repo-guard GREEN on the exact PR head. Confirm no `@mts/core`, parser-specific role, random/wall-clock logic, root special case, or stale model/state key can enter the diff.

- [ ] **Step 4: Confirm merge preconditions without merging prematurely**

Before merge require:

```text
behind_by = 0
mergeable = true
draft = false
full CI = GREEN
blocking repo-guard = GREEN
head SHA unchanged during verification
```

U1 merge does not close #11 because U2/U3 remain outstanding.
