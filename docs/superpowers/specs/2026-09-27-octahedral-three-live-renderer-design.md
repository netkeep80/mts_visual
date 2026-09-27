# M5 P3b — Octahedral browser live renderer lifecycle

Date: 2026-09-27
Parent: #15
Depends on accepted P1/P2/P3 through `085f267021a3a78d98509106ec0e39d4983bbd54`.

## Purpose

Mount the persistent P3 batch into a real Three scene/surface and drive it directly from the P2 live controller.

The new path must never call the legacy `buildVisualThreeSceneData -> populate -> clearPresentation` frame pipeline.

## Owned objects

One mounted octahedral live renderer owns:

```text
one rendering surface
one THREE.Scene
one PerspectiveCamera
one OrbitControls-compatible controller
one persistent OctahedralThreeBatch
one resize observer (when available)
one RAF lifecycle
```

Creating the same octahedral renderer again for one container destroys the previous octahedral mount first.

## Frame

Every active RAF callback performs exactly:

```text
controller.step()
batch.sync()
surface.render(scene, camera)
tick++
schedule next frame
```

The RAF timestamp does not change physics dt. `simulationSpeed` remains the only public runtime speed control.

No scene topology, Three geometry, material or DataTexture is recreated on an ordinary frame.

## Pause / stale callback safety

Pausing:
- cancels the current scheduled RAF;
- invalidates already captured/stale callbacks;
- does not destroy surface/camera/controls/batch.

Resuming schedules at most one RAF.

Destroying invalidates all stale callbacks permanently.

## Topology transition

`transitionOctahedralThreeLiveNetwork(container, network)` delegates to the P2 controller whole-network transition, then calls `batch.sync()` and renders once.

The surface, scene, camera and controls remain the same objects.

Camera is not implicitly refit on every topology transition; consumers may request fit explicitly.

## Controls

OrbitControls only changes the camera. A controls `change` event renders the current batch without stepping physics.

P3b intentionally does not implement semantic Link picking/dragging. That requires instance-aware/GPU picking and is a later slice; it must not reintroduce one center Mesh per Link.

## Resize / fit

Resize updates surface size and camera aspect.

Fit derives bounds directly from packed physical vertex positions and never materializes per-vertex JS objects.

## Runtime setters

The renderer delegates:

```text
setOctahedralThreeLiveSimulationSpeed
setOctahedralThreeLiveStiffness
```

to the P2 controller without rebuilding GPU resources.

## Snapshot

Snapshot exposes at least:

```text
mounted
linkCount
drawCallProxy
width
height
cameraPosition
paused
tick
```

## Disposal

Destroy must:
- invalidate/cancel RAF;
- disconnect observer;
- detach controls listener;
- dispose controls;
- remove/dispose the P3 batch;
- remove/dispose rendering surface;
- remove the mount.

Repeated destroy is safe and returns false.

## Acceptance

Tests prove:

1. create appends one surface and renders one three-draw batch;
2. active mount schedules at most one RAF;
3. one RAF performs one P2 tick and one render, independent of timestamp;
4. pause cancels and stale callbacks cannot tick;
5. resume restarts exactly one RAF;
6. controls change renders but does not tick;
7. resize updates size/aspect and observer callback uses same path;
8. fit produces finite camera state from packed positions;
9. topology transition changes Link count without replacing surface/camera/controls;
10. runtime stiffness/speed changes do not replace rendering resources;
11. destroy releases owned lifecycle exactly once;
12. stale callbacks cannot act after destroy;
13. legacy renderer remains unchanged.
