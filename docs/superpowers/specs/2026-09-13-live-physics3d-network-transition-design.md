# LivePhysics3D Network Transition Design

Date: 2026-09-13

Issue: #11

Baseline main: `b4c29085f65e76e85dd49c74ed64cfa439366ab7`

## Purpose

Add a consumer-neutral, atomic whole-network transition to the root `@mts/visual` live physics controller so the physical model contains exactly the current `VisualLinkNetwork` and never hidden future links.

This design covers U1 only. Three renderer transition remains a separate U2 slice after U1 is accepted.

## Root cause

`createLivePhysics3D(network, initialState, options)` currently builds `PhysicalModel3D` once. The controller can step, pin, move/release pins, change options, sleep/wake, and snapshot, but it cannot replace its topology.

A consumer that wants stepwise topology therefore has to create physics for the final network and hide future links at presentation level. Those future keys still participate in charge and spring evaluation, so future topology can influence the layout of an earlier debugger step.

## Architectural boundary

`@mts/visual` owns only renderer-neutral presentation topology and presentation physics.

Strict invariants:

```text
MTS semantic Link != VisualKey != Three object != physics coordinate
@mts/visual MUST NOT depend on @mts/core
@mts/visual MUST NOT know parser/debugger roles
R / infinity remains an ordinary VisualKey with no root special case
```

The consumer decides when the current `VisualLinkNetwork` changes. U1 only performs `previous network -> next network`.

## Public API

Add:

```ts
transitionLivePhysics3DNetwork(
  controller: LivePhysics3DController,
  nextNetwork: VisualLinkNetwork,
): LivePhysics3DSnapshot
```

`LivePhysics3DController.model` remains readonly to consumers. The implementation may replace the model through the existing private mutable-controller representation.

The operation is a whole-network transition. Do not add incremental domain APIs such as `addLink`, `removeProducedLink`, or debugger-specific operations.

## Atomicity

The transition must be prepared completely before mutating the controller.

Preparation order:

1. normalize and validate `nextNetwork`;
2. build a new `PhysicalModel3D` exclusively from `nextNetwork`;
3. derive the candidate state and candidate retained pins;
4. validate the candidate model/state against the existing resolved physics options;
5. only after all preparation succeeds, replace controller model/state/pins and lifecycle counters.

If validation or preparation throws, the original controller must remain unchanged.

## Physical topology equality

Whether a real physics-topology change occurred is defined by the resulting `PhysicalModel3D`, not by presentation metadata.

Therefore changes only to `label` or `tags` do not wake/reset physics. A change to keys or spring structure does.

The implementation may compare normalized model keys and springs structurally.

## Retained keys

For every key present in both old and next models, preserve exactly at the transition instant:

```text
position
velocity
pin position, if pinned
```

No initial-layout recomputation may move a retained key during the transition itself.

## Removed keys

For every key absent from the next model:

```text
remove from positions
remove from velocities
remove from model.keys
remove every spring that references it
remove any pin for it
```

Because the new model is rebuilt exclusively from `nextNetwork`, stale springs must be impossible after commit.

## Added keys

Every new key receives:

```text
finite deterministic position
velocity = { x: 0, y: 0, z: 0 }
no implicit pin
```

A new key participates in charge/spring evaluation only after the transition commits.

## Deterministic position seeding

Use the normalized next network so input link order cannot influence the result.

Prepare a deterministic canonical fallback map using the existing `createInitialPhysics3DState(nextNetwork)` result. The fallback remains presentation-only and introduces no new semantic authority.

Then seed added keys in two phases.

### Phase A: topology-local placement

Start with the preserved positions of retained keys.

Iterate unresolved added links in normalized key order. A link is locally resolvable when both `startKey` and `endKey` already have positions and neither unresolved endpoint requires the link's own still-missing position.

For a locally resolvable link:

```text
base = midpoint(startPosition, endPosition)
seed = base + deterministicSmallOffset(link.key)
```

The offset must be finite, stable from `VisualKey`, independent of wall clock/randomness, and small relative to the existing default initial radius so coincident endpoints do not place multiple new keys at exactly the same point.

Repeat passes until no additional key becomes locally resolvable. This supports chains and links-of-links without depending on input order.

### Phase B: unresolved recursive fallback

Any unresolved keys after the fixed point, including self-links and mutually recursive cycles/SCCs, take their positions from the canonical fallback map returned by `createInitialPhysics3DState(nextNetwork)`.

This guarantees finite deterministic placement without inventing SCC semantic authority or requiring an ordinary acyclic graph model.

## Lifecycle state after transition

On a real physical topology change:

```text
controller.model = next model
controller.state = candidate state
controller.pinned = retained pins only
controller.awake = next model is non-empty
controller.stableTicks = 0
controller.maxVelocity = 0
controller.maxPositionDelta = 0
controller.tick is preserved
```

A topology transition is not a physics tick, so it must not increment `tick`.

If the resulting physical model is structurally identical to the current model, the operation still returns an exact snapshot but must not perform an unnecessary wake/reset merely because labels/tags or input ordering changed.

## Post-transition invariants

Immediately after a successful transition:

```text
controller.model.keys == keys(nextNetwork)
state.positions.keys == keys(nextNetwork)
state.velocities.keys == keys(nextNetwork)
all state vectors are finite
all springs reference only next-network keys
removed pins are absent
retained pins are preserved
added velocities are exactly zero
```

## Causality regression invariant

The critical proof is:

```text
if key X is absent from the current VisualLinkNetwork,
then X is absent from controller.model and controller.state,
therefore X cannot contribute to charge pairs or spring evaluations.
```

This is the direct regression guard for the original debugger defect.

## TDD acceptance for U1

Start with RED tests in `test/live-physics3d.test.ts` before implementation.

Required cases:

1. Add one key: retained positions and velocities are unchanged; new position finite; new velocity zero; model keys/springs match next network.
2. Remove one key: removed state/pin/springs are absent.
3. Retained pin survives exactly.
4. Existing physics options continue to govern the first tick after transition.
5. Sleeping/settled controller wakes on a real topology change.
6. Same normalized physical topology does not corrupt state or force an unnecessary wake/reset.
7. Same transition from identical state is deterministic.
8. Batch add with links-of-links is deterministic and finite.
9. Recursive cycle fallback is deterministic and finite.
10. Self-link fallback is deterministic and finite.
11. Causality regression: a future/non-current key cannot affect force evaluation before transition, then does participate after transition.
12. Failed transition is atomic: invalid next network leaves model/state/pins/lifecycle snapshot unchanged.

## Expected U1 files

Implementation scope should remain:

```text
src/live-physics3d.ts
test/live-physics3d.test.ts
```

`src/index.ts` already re-exports `./live-physics3d.js`, so no separate export edit is expected.

Do not change `src/physics3d.ts` unless RED tests prove a reusable lower-level helper is necessary. Do not touch Three files in U1.

## U1 non-goals

```text
NO Three renderer transition in this slice
NO parser/anum_parser changes
NO parser-specific roles
NO MTS semantic changes
NO @mts/core dependency
NO AST/ordinary graph authority
NO root special case
NO random or wall-clock placement
NO hidden future-node compatibility mode
NO second physics implementation
NO package version bump unless repository policy independently requires it
NO governance/workflow changes
```

## Follow-on U2 boundary

After U1 is independently GREEN and accepted, U2 will make the Three live binding hold mutable current-network/projector authority and invoke this U1 API as one coordinated transition boundary, preserving the existing canvas, camera, controls, pointer lifecycle, and RAF lifecycle.
