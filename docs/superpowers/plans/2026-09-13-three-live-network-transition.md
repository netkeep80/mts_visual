# Three Live Network Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mounted Three live-network transition that reuses accepted U1 physics transition while preserving canvas, camera, controls, pointer/picking and RAF lifecycle.

**Architecture:** `src/three/index.ts` owns a weak current-network binding for live renderers and projects through that mutable authority. `src/three/renderer.ts` stays network-neutral: it verifies exact live-controller identity, reconciles interaction against a replaced key-space, repopulates the existing scene and schedules live work without recreating renderer resources.

**Tech Stack:** TypeScript 5.9, Three.js 0.185.1, existing fake browser/surface/controls/RAF probes, GitHub Actions CI, blocking repo-guard.

**Spec:** `docs/superpowers/specs/2026-09-13-three-live-network-transition-design.md`

## Global Constraints

- Baseline main is `0b8ca15af04a07c5b97608943802e93f2245cc31` unless a governance refresh moves main before a write.
- Implement issue #11 U2 only; accepted U1 must be reused, not duplicated.
- Public API: `transitionVisualThreeLiveNetwork(container, nextNetwork): boolean`.
- No renderer destroy/recreate, auto-fit, parser roles, MTS semantics, root special case, random/time logic or second physics transition implementation.
- Do not modify root physics, package/version, README, governance, workflows or downstream consumer code in U2.
- TDD RED before production implementation.
- Before every GitHub write/lifecycle transition refresh exact main, open issues/PRs, workflows and `repo-policy.json`.

---

### Task 1: Define U2 RED renderer contract

**Files:**
- Modify: `test/three-renderer.test.ts`
- Modify: `test/three-presentation.test.ts`

**Interfaces:**
- Consumes: `createVisualThreeLiveRenderer`, accepted `createLivePhysics3D`, existing fake surface/controls/RAF/pointer probes.
- Produces: executable contract for `transitionVisualThreeLiveNetwork(container, nextNetwork): boolean`.

- [ ] **Step 1: Import the wished-for public API before it exists**

```ts
import {
  createVisualThreeLiveRenderer,
  setVisualThreeLivePaused,
  transitionVisualThreeLiveNetwork,
} from "../src/three/index.js";
```

- [ ] **Step 2: Add a generic `N -> N+1 -> N` live fixture**

Use two self-links `A`, `B` as N and add `C: A -> B` as N+1. Create one live renderer with fake surface, controls and RAF queue.

Assert immediately after N -> N+1:

```text
nodeCount 2 -> 3
arcCount 4 -> 6
arrowCount 2 -> 3
container child count remains 1
same surface object remains mounted and is not disposed
controller.model contains C
controller state contains C
cameraPosition exactly unchanged
controls not disposed/recreated
```

Then transition back and assert C disappears from scene/model/state while surface/camera/controls remain continuous.

- [ ] **Step 3: Prove stale projector closure is gone**

After N -> N+1, execute the queued RAF callback. Assert the scene still has 3 nodes/6 arcs and `C` remains present after the physics tick. If the old projector is still captured, the next live tick will collapse scene data back to N.

Also assert transition schedules at most one RAF when physics is awake.

- [ ] **Step 4: Prove pause continuity**

Pause a mounted live renderer, transition N -> N+1, assert scene/model update immediately but no RAF is queued. Resume and assert one RAF is scheduled against the new topology.

- [ ] **Step 5: Prove picking continuity**

After adding C, position the fixture so C can be hit independently and simulate a tap/drag through the existing pointer probe. Assert C activates/drags as a current key.

After removing C, repeat the same pointer coordinates and assert C can no longer activate or pin because no stale center mesh remains.

- [ ] **Step 6: Prove active-drag removal recovery**

Start dragging C so controls are disabled and C is pinned, then transition back to N. Assert:

```text
C pin is absent (U1)
controls.enabled becomes true
pointer capture is released
later pointermove/up does not throw or resurrect C
```

- [ ] **Step 7: Add presentation transition tests**

In `test/three-presentation.test.ts`, create N+1 with labels. Apply retained presentation to A and selected/halo/label presentation to C. Track dispose events on C halo/label resources.

Transition N+1 -> N and assert:

```text
A presentation remains
C halo/label/object absent and disposed
setVisualThreePresentation(...C...) rejects unknown-key
```

Transition N -> N+1 again and assert C returns with default presentation (no stale selected/halo/label override), then a fresh presentation for C is accepted.

- [ ] **Step 8: Add missing/stale mount safety**

Assert transition returns false for:

```text
never-mounted container
live container after destroy
container whose low-level renderer/live attachment replaced the recorded managed binding
```

No controller model/state may change in these cases.

- [ ] **Step 9: Commit RED tests only**

```text
test: define Three live topology transition contract
```

- [ ] **Step 10: Verify RED in GitHub Actions**

Expected project CI failure: TypeScript cannot import/export `transitionVisualThreeLiveNetwork`. Governance/setup must remain green. Do not write production code until this exact RED is observed.

---

### Task 2: Implement managed current-network authority

**Files:**
- Modify: `src/three/index.ts`

**Interfaces:**
- Consumes: accepted `transitionLivePhysics3DNetwork`, `normalizeVisualLinkNetwork`, `hasVisualThreeLiveController`, `updateVisualThreeRenderer`.
- Produces: `transitionVisualThreeLiveNetwork(container, nextNetwork): boolean` and mutable projector authority per managed live renderer.

- [ ] **Step 1: Import accepted U1 and renderer preflight/update primitives**

```ts
import {
  snapshotLivePhysics3D,
  transitionLivePhysics3DNetwork,
  type LivePhysics3DController,
} from "../live-physics3d.js";
```

Use existing `normalizeVisualLinkNetwork` before storing current network.

- [ ] **Step 2: Add an index-level weak managed binding**

```ts
interface ManagedVisualThreeLiveBinding {
  readonly controller: LivePhysics3DController;
  network: VisualLinkNetwork;
}

const liveNetworks = new WeakMap<object, ManagedVisualThreeLiveBinding>();
```

- [ ] **Step 3: Make live projector read mutable current network**

In `createVisualThreeLiveRenderer()` normalize initial network, create a managed binding, and attach projector as:

```ts
(state) => buildVisualThreeSceneData(binding.network, state)
```

Store the binding only after attachment succeeds. On failure delete it and use existing renderer cleanup.

- [ ] **Step 4: Implement transition API**

```ts
export function transitionVisualThreeLiveNetwork(
  container: VisualThreeContainer,
  nextNetwork: VisualLinkNetwork,
): boolean
```

Algorithm:

```text
lookup managed binding
return false if absent
verify exact attached controller before mutation
normalize nextNetwork
call accepted U1 transition on binding.controller
build next scene data from transitioned.state
replace binding.network
update existing renderer from scene data
return true
```

If exact controller preflight fails, delete stale managed binding and return false before U1.

- [ ] **Step 5: Clean managed binding on public destroy**

Delete `liveNetworks` entry in the Three public destroy wrapper before/after delegating to existing renderer destroy, keeping destroy idempotent.

- [ ] **Step 6: Commit index implementation**

```text
feat: bind Three live projector to current network
```

---

### Task 3: Preserve renderer lifecycle across topology replacement

**Files:**
- Modify: `src/three/renderer.ts`

**Interfaces:**
- Consumes: existing mounted/live state, `populate`, `scheduleLiveFrame`.
- Produces: exact live-controller preflight and safe interaction/RAF reconciliation after ordinary scene updates.

- [ ] **Step 1: Extend live-controller query with optional identity**

```ts
export function hasVisualThreeLiveController(
  container: VisualThreeContainer,
  controller?: LivePhysics3DController,
): boolean {
  const live = mounts.get(container)?.live;
  return !!live && !live.destroyed && (controller === undefined || live.controller === controller);
}
```

- [ ] **Step 2: Add interaction reconciliation after topology replacement**

After `populate`, derive known current keys. If `live.candidate` references a removed key, clear it. If `live.active` references a removed key:

```text
release pointer capture
clear active/candidate
restore controls.enabled = true
```

Do not call `releaseLivePhysics3D` for a key already removed by U1.

Retained active key continues unchanged.

- [ ] **Step 3: Schedule live frame from ordinary scene update**

Update `updateVisualThreeRenderer()` to:

```ts
populate(state, data);
reconcileLiveInteraction(state);
render(state);
scheduleLiveFrame(state);
return true;
```

For static renderer `scheduleLiveFrame` is a no-op. For paused live renderer it preserves pause because existing scheduler checks `live.paused`.

- [ ] **Step 4: Commit renderer lifecycle implementation**

```text
feat: preserve Three live lifecycle across topology updates
```

- [ ] **Step 5: Verify full GREEN**

Require complete existing project test suite plus new U2 contracts to pass in GitHub Actions. Fix implementation, not tests, unless an assertion contradicts the approved spec.

---

### Task 4: Scope review and exact-head acceptance

**Files:**
- Review only: two U2 docs, `src/three/index.ts`, `src/three/renderer.ts`, two Three tests.

**Interfaces:**
- Consumes: GREEN U2 implementation.
- Produces: exact-head PR ready for merge, issue #11 still open for U3 bookkeeping.

- [ ] **Step 1: Confirm exact diff**

Expected only:

```text
docs/superpowers/specs/2026-09-13-three-live-network-transition-design.md
docs/superpowers/plans/2026-09-13-three-live-network-transition.md
src/three/index.ts
src/three/renderer.ts
test/three-renderer.test.ts
test/three-presentation.test.ts
```

- [ ] **Step 2: Confirm architecture non-regressions**

Diff must contain no `@mts/core`, parser/debugger roles, root special case, second physics implementation, random/time placement, camera fit/reset, renderer recreation or control reattachment on transition.

- [ ] **Step 3: Verify exact head**

Require full CI GREEN and blocking repo-guard GREEN on the same SHA.

- [ ] **Step 4: Merge only with exact preconditions**

```text
behind_by = 0
mergeable = true
draft = false
head unchanged
CI GREEN
repo-guard GREEN
```

Merge with `expected_head_sha`. Do not close #11 yet; U3 records final upstream acceptance and downstream lock identities.
