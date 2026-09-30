# mts_visual

Standalone presentation/visualization authority for MTS link asets, published as the `@mts/visual` package.


## Five-mode visualization laboratory

**[Open the real-browser mts_visual laboratory](https://netkeep80.github.io/mts_visual/)**

The published GitHub Pages laboratory exposes five first-class views over one exact `VisualLinkNetwork` input snapshot:

1. **Structural 2D** — renderer-neutral topology/debug projection with deterministic SCC/depth layers, START/END role arcs and bounded crossing minimization.
2. **Blueprint 2D** — interactive continuous Link geometry with labels, CENTER drag, pan/zoom and SVG export.
3. **Document 2D** — deterministic publication renderer. Every Link owns a pose `(x, y, theta)`; its two outward CENTER tangents are exactly antiparallel (180°) while the oriented START→CENTER→END path remains C1. Profiles `formal`, `article` and `debug` produce canonical SVG.
4. **Classic 3D** — the retained charge + incidence-spring model. Link centers repel one another, so nearby/similar Links tend to remain spatially distinguishable instead of visually collapsing onto the same trajectory.
5. **Mechanical 3D** — the current monolithic/WebGPU Link mechanics and zero-copy renderer.

Classic 3D and Mechanical 3D intentionally remain separate models: Classic is useful as a force-directed spatial view, while Mechanical models one semantic Link as one monolithic semi-rigid physical object.

All five modes consume the same selected immutable input object. The lab includes built-in renderer-neutral fixtures and accepts pasted or local JSON files using the versioned input envelope:

```json
{
  "schema": "mts-visual-document-input/v1",
  "links": [
    { "key": "R", "startKey": "R", "endKey": "R", "label": "ROOT" }
  ]
}
```

The page exposes shared diagnostics, build SHA/version, selected-Link presentation state, per-mode metrics, 2D SVG export, Document provenance manifest export, and an in-page **five-mode resource-cycle self-test** that checks renderer ownership while preserving exact input identity.

### Deterministic Document 2D CLI

The same Document engine used by the browser is available headlessly:

```bash
npm run build
node bin/mts-visual.mjs render-2d \
  --input fixtures/document2d/article-root.input.json \
  --output article.svg \
  --manifest article.manifest.json \
  --profile article \
  --strategy auto \
  --root R \
  --format svg \
  --renderer-sha <exact-git-sha>
```

The render manifest records the SHA-256 of the exact input bytes and exact SVG bytes together with renderer version/SHA and resolved layout provenance. It deliberately contains no wall-clock timestamp, so identical invocations are byte-stable.

The repository-owned canonical article fixture currently pins:

```text
SVG SHA-256 = 173ebc20ece915c401eb3647f7b4402ae356ba510046336b4842cc1b4d0f7955
auto seed   = layered
```

This repository owns renderer-neutral visual DTOs, Structural/Blueprint/Document geometry and layout, presentation state, Classic/Mechanical physics, interaction, and the optional Three.js browser companion. It does **not** own MTS semantic truth, proof semantics, parser semantics, or `@mts/core`.

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
△ ≡ octa ≡ octa ≡ ... ≡ octa ≡ octa ≡ △
```

The octahedron count is always even. A Link with N octahedra contains exactly N+1 physical triangular sections and no terminal apex particles or tetrahedral caps. The virtual Link center is the centroid of the central shared triangle; START and END are likewise the geometric centroids of the first and last triangular sections. Those virtual endpoint points hinge to the virtual centers of the Links referenced by `startKey` / `endKey`. Self-incidence remains finite.

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

### 0.4.2 physical-sanity correction

Package version `0.4.2` fixed a second live-initialization defect exposed by a real 333-Link hub-heavy A-network. In the historical capped carrier, the mast body started close to its undeformed rest shape and final hinge projection could move only the terminal incidence handles across large semantic-target distances. The result was exact topology but extreme spring strain concentrated near Link ends. The current capless carrier supersedes those terminal apex handles with terminal-triangle centroids.

The corrected initializer distributes START/CENTER/END fitting across every longitudinal module before hinge projection. Seed-center spacing is now based on cross-section only:

```text
spacing = 1.5 * diameter
```

and does not grow with mast rest length. Increasing octahedron count therefore makes Links longer/slenderer instead of expanding the whole seed volume by the same factor.

The recommended live/presentation baseline is:

```text
20 octahedra
aspectRatio = sqrt(2) * 10 ≈ 14.14
```

The low-level two-octahedron template remains legal for low-detail/testing. The 333-Link regression suite now gates hinge accuracy, p95/max spring strain, severe-strain fraction, spring energy over 360 damped ticks, 3D bounds, and exact O(N*E) work. CPU and WebGPU initializers share the same distributed fitting contract.

### 0.5.0 monolithic Link / WebGPU release

Package version `0.5.0` accepts the current monolithic Link path and its real-browser WebGPU witness.

The authoritative live physical state is reduced to semantic Link interaction points and derived carrier state:

```text
START / CENTER / END
        |
        v
monolithic Link physics
        |
        +--> GPU-derived carrier/section frames
        +--> zero-copy WebGPU renderer
```

The release includes:

- monolithic stretch + straightening dynamics with semantic CENTER mass/damping;
- derived octahedral carrier with stable roll gauge and no fake per-octahedron angular body state;
- self-incidence geometry with a positional hinge instead of a welded terminal tangent;
- CPU ↔ WebGPU differential coverage for ordinary and self-incidence fixtures;
- START→CENTER→END red→green→blue material gradient;
- hover-only L2 wireframe icosahedron for semantic CENTER selection/drag;
- wireframe-only END cones with deterministic proportions;
- global wireframe and smooth-normal render controls;
- browser witness default simulation speed of 10×;
- Russian browser witness UI and exact-build GitHub Pages verification.

The older scalable octahedral APIs remain available for compatibility and current consumers. The `0.5.0` acceptance slice itself changes only package metadata and documentation; runtime behavior is the already-tested `main` state accepted immediately before the version bump.

### Capless terminal geometry

Current octahedral geometry has no START/END tetrahedral caps. The terminal physical objects are ordinary triangular sections of the first/last octahedron. Incidence constrains only their geometric centroids:

```text
START = centroid(first triangle)
CENTER = centroid(middle triangle)
END = centroid(last triangle)
```

For N octahedra, `vertexCount = 3 * (N + 1)` and `restLength = N * moduleHeight`. Endpoint projection translates each terminal triangle as a whole, preserving its finite shape, while force transfer removes only its net translational reaction so residual torque/deformation remains physical.

The development and migration roadmap is tracked in issue #1.
