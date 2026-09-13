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

The development and migration roadmap is tracked in issue #1.
