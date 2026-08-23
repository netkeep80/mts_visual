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

The development and migration roadmap is tracked in issue #1.
