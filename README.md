# mts_visual

Standalone presentation/visualization authority for MTS link asets, published as the `@mts/visual` package.

This repository owns renderer-neutral visual DTOs, blueprint/3D geometry, presentation state, physics, interaction, and the optional Three.js browser companion. It does **not** own MTS semantic truth, proof semantics, parser semantics, or `@mts/core`.

## Provenance

The standalone baseline is extracted from the exact accepted visual seed:

`netkeep80/anum_docs@86b2c7dd228694195847ece2901d659e4a37a9da/packages/visual`

The accepted `src/**` and `test/**` content is retained byte-for-byte; repository extraction changes package ownership/build independence, not visual semantics.

## Dependency boundary

`@mts/visual` and `@mts/core` are mutually dependency-independent:

- `@mts/visual` does not depend on `@mts/core`, `anum_docs`, `anum_parser`, or `aprover`.
- `@mts/core` does not depend on `@mts/visual`.
- Consumers integrate semantic and visual authorities through separate exact commit locks/adapters rather than floating cross-repository dependencies.

## Package boundary

- `@mts/visual` — browser-neutral package root.
- `@mts/visual/three` — explicit Three.js/browser companion; it is not re-exported from the package root.

## Live topology transitions

Starting with package version `0.3.0`, live presentation topology can change without pre-creating future links.

The browser-neutral root exports:

```ts
transitionLivePhysics3DNetwork(controller, nextNetwork)
```

This atomically replaces the current physical `VisualLinkNetwork`. Retained links keep their position, velocity, and pin state; removed links leave the physical model completely; added links receive deterministic finite initial positions with zero velocity. Physics evaluates only the current network after the transition.

The Three.js companion exports:

```ts
transitionVisualThreeLiveNetwork(container, nextNetwork)
```

For a mounted live renderer this applies the same current network to physics and Three presentation without recreating the rendering surface, camera, controls, pointer lifecycle, or RAF binding. Removed keys also leave picking and presentation key-space; newly added keys become ordinary current scene objects.

The consumer remains responsible for deciding **when** topology changes and **which** complete `VisualLinkNetwork` is current. These APIs do not introduce parser/debugger roles or MTS semantic authority into `@mts/visual`.


## Scalable octahedral live path

Starting with package version `0.4.0`, `@mts/visual` also exposes a scalable Link-physics/rendering path designed to replace the legacy all-pairs charge + per-Link Three object hot path.

One represented Link is one continuous elastic body:

```text
tetra ≡ octa ≡ octa ≡ ... ≡ octa ≡ octa ≡ tetra
```

The octahedron count is always even. The virtual Link center is the centroid of the central shared triangle; it is not an extra particle or semantic entity. START/END tetrahedral apexes hinge to the virtual centers of the Links referenced by `startKey` / `endKey`. Self-incidence remains finite.

The Link physics contract has exactly two user-facing parameters:

```text
aspectRatio = rest length / diameter
stiffness   = two-point edge-spring stiffness
```

Every physical lattice edge is a two-point unit-rest-length spring. Extension, compression, bending and torsion emerge from the regular octahedral geometry. There is no scalable-path all-pairs charge force and no explicit three-point bending force.

The browser-neutral root exports the template/live boundaries, including:

```ts
resolveOctahedralAspectRatio(aspectRatio)
getOctahedralLinkTemplate3D(aspectRatio)
createOctahedralLivePhysics3D(network, {
  aspectRatio,
  stiffness,
  simulationSpeed,
})
transitionOctahedralLivePhysics3DNetwork(controller, nextNetwork)
```

`simulationSpeed` is a global integrator control, not a third Link material parameter.

The Three.js companion exports the persistent batched path:

```ts
createOctahedralThreeBatch(controller)
createOctahedralThreeLiveRenderer(container, controller, options)
transitionOctahedralThreeLiveNetwork(container, nextNetwork)
setOctahedralThreeLiveSimulationSpeed(container, speed)
setOctahedralThreeLiveStiffness(container, stiffness)
```

The batched surface stores one cached template topology and reads deformed packed positions from one dynamic Float32 position texture. Surface, virtual-center markers, and END arrows are three shader-instanced draw objects total for any non-empty Link count; ordinary physics frames update texture contents instead of recreating per-Link Three resources. START is red, END is blue, with the gradient carried continuously by the same Link surface.

The legacy `Physics3D` / `createVisualThreeLiveRenderer` APIs remain available for compatibility. New high-scale consumers should use the octahedral path.

### 0.4.1 live-initialization correction

Package version `0.4.1` fixes the accepted octahedral live path's initial embedding for large networks. `0.4.0` placed every Link center on one X axis, which could trap real A-networks in a string-like configuration.

The corrected initializer is still deterministic and O(N), but places centers in a compact centered 3D lattice with extent O(cuberoot(N)). Before hinge projection, each mast is rotated so its local longitudinal axis follows the seed direction from its START target center to its END target center; coincident/self targets use a deterministic finite fallback orientation.

This is presentation initialization only. START/END hinge projection, Link semantics, the two Link physics parameters, and the no-all-pairs scalable-path contract are unchanged.

The development and migration roadmap is tracked in issue #1.
