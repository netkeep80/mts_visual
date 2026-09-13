# Three Live Network Transition Design

Date: 2026-09-13

Issue: #11

Baseline main: `0b8ca15af04a07c5b97608943802e93f2245cc31`

Accepted dependency: U1 `transitionLivePhysics3DNetwork()` merged by PR #12.

## Purpose

Add a consumer-neutral transition to an already mounted `@mts/visual/three` live renderer so its physical controller, projector authority, scene key-space and Three objects all move to the same current `VisualLinkNetwork` without destroy/recreate.

This design covers U2. It does not change MTS semantics, parser/debugger roles, root physics, package versioning, or downstream consumers.

## Public API

Add at `@mts/visual/three`:

```ts
transitionVisualThreeLiveNetwork(
  container: VisualThreeContainer,
  nextNetwork: VisualLinkNetwork,
): boolean
```

Return `false` when the container is not currently managed by `createVisualThreeLiveRenderer()` with the same attached live controller. A missing/stale mount must not mutate physics.

## Current defect

`createVisualThreeLiveRenderer()` currently creates this projector:

```ts
(state) => buildVisualThreeSceneData(network, state)
```

The callback closes over the initial network forever. U1 can now replace `LivePhysics3DController.model`, but without U2 the next RAF tick would still rebuild Three scene data from the old network.

## Ownership boundary

`src/three/index.ts` owns current-network authority because it already combines `VisualLinkNetwork`, `LivePhysics3DController` and Three scene projection.

`src/three/renderer.ts` remains network-neutral. It owns mounted Three lifecycle only: scene objects, presentation key-space, camera, controls, pointer interaction, picking and RAF scheduling.

No parser roles or semantic-link identity enter either layer.

## Live network authority

For each live renderer created through `createVisualThreeLiveRenderer()`, keep an index-level weak binding:

```text
container -> {
  controller,
  current network
}
```

The projector attached to `renderer.ts` must read the current network from that mutable binding rather than closing over the original function argument.

Normalize/freeze the network before storing it so input order and later caller mutation cannot change projector authority implicitly.

The weak binding is replaced on live create and removed by the public Three destroy wrapper. If low-level renderer lifecycle invalidates/replaces the mount, transition must detect that the recorded controller is no longer the currently attached live controller and return `false` before calling U1.

## Coordinated transition sequence

For an accepted mounted live binding:

1. normalize/validate `nextNetwork`;
2. verify the recorded controller is still the currently attached controller;
3. call accepted U1 `transitionLivePhysics3DNetwork(controller, nextNetwork)`;
4. project the returned exact physics state into scene data for `nextNetwork`;
5. replace the binding's current-network authority;
6. repopulate the existing mounted renderer from the new scene data;
7. render once and request/schedule live RAF according to the existing paused/awake rules.

The same `LivePhysics3DController`, mounted `THREE.Scene`, camera, rendering surface and OrbitControls instance remain alive.

No second canvas/surface is created. No `attachVisualThreeLiveController()` call is made during network transition.

## Renderer support changes

`renderer.ts` needs two narrow lifecycle changes.

### Exact controller preflight

Extend the existing live-binding query so the index layer can verify identity before mutating physics:

```ts
hasVisualThreeLiveController(
  container: VisualThreeContainer,
  controller?: LivePhysics3DController,
): boolean
```

With no second argument it preserves existing behavior. With a controller it returns true only for the exact currently attached controller object.

### Scene update schedules live work

`updateVisualThreeRenderer()` already calls `populate()` and `render()` without recreating camera/surface. After an update it should also call the existing `scheduleLiveFrame(state)` helper. Static renderers are unaffected because they have no live binding.

Scheduling must preserve pause semantics: calling the scheduler while paused is allowed, but no RAF is requested until unpaused.

## Interaction reconciliation

Topology may change while pointer interaction is in progress.

After scene/key-space replacement:

- retained active/candidate key may continue normally;
- candidate for a removed key is cleared;
- active drag for a removed key is cleared, pointer capture is released and controls are re-enabled;
- do not try to release a removed physics pin after U1 has already removed that key;
- stale removed meshes are not available to raycasting because `populate()` replaces `state.objects`.

This reconciliation belongs in renderer lifecycle, not in parser or consumer code.

## Presentation behavior

Existing renderer behavior is intentionally reused:

- `reconcilePresentation()` filters presentation entries to the new key-space;
- retained key presentation remains when compatible;
- removed key presentation is dropped;
- new keys receive default presentation because they have no override;
- `clearPresentation()` disposes old halos, labels and scene objects;
- subsequent `setVisualThreePresentation()` validates against the new key-space.

No new presentation roles are introduced.

## Camera and controls invariants

Network transition must not call `createVisualThreeRenderer()`, `fitVisualThreeRenderer()`, `attachVisualThreeLiveController()` or `detachLive()`.

Therefore at transition instant:

```text
same surface / canvas object
same camera object and camera position
same controls object
same pointer listeners
same onActivateKey callback
same resize observer
same RAF binding/request/cancel functions
```

Only scene contents/key-space and physics topology change.

## Picking invariant

Picking always derives from current `state.objects` center meshes. After transition:

```text
removed key -> no center mesh -> cannot be hit/activated/dragged
added key -> new center mesh -> can be hit/activated/dragged
```

No stale raycast target registry may exist outside the scene objects.

## TDD acceptance

Start RED before implementation.

Required cases on one mounted renderer:

1. `N -> N+1` changes node/arc/arrow counts immediately and keeps exactly one surface child.
2. `N+1 -> N` removes the added key from Three objects and physics model/state.
3. renderer remains mounted and surface is not disposed/recreated.
4. camera position is byte-for-byte unchanged by topology transition itself.
5. controls instance is neither disposed nor recreated and remains operational.
6. an already queued/live next RAF projects the new network, proving no stale initial-network closure remains.
7. transition wakes/schedules physics when U1 wakes it; paused live renderer remains paused without losing new topology.
8. removed key cannot be picked/activated after transition; newly added key can.
9. retained presentation survives; removed halo/label resources are disposed; added key has default presentation.
10. subsequent `setVisualThreePresentation()` rejects a removed key and accepts a newly added key.
11. active drag removed by topology restores controls and does not leave pointer capture/pin residue.
12. transition on an unmanaged/stale/non-live container returns `false` without mutating a controller.

## Expected files

```text
src/three/index.ts
src/three/renderer.ts
test/three-renderer.test.ts
test/three-presentation.test.ts
docs/superpowers/specs/2026-09-13-three-live-network-transition-design.md
docs/superpowers/plans/2026-09-13-three-live-network-transition.md
```

Do not touch:

```text
src/live-physics3d.ts
src/physics3d.ts
src/index.ts
package.json
package-lock.json
README.md
repo-policy.json
.github/workflows/**
anum_parser or semantic MTS repositories
```

## Non-goals

```text
NO renderer destroy/recreate per debugger step
NO second LivePhysics3D implementation
NO duplicate physics transition logic in Three
NO parser-specific current/produced/reused roles
NO MTS semantic authority
NO root special case
NO camera auto-fit during transition
NO controls recreation
NO screenshot-only correctness proof
```

## Acceptance boundary

U2 is accepted only when the exact PR head has full CI GREEN, blocking repo-guard GREEN, `behind_by=0`, stable mergeable head, and issue #11 remains open until U3/exact upstream acceptance bookkeeping is completed.
