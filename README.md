# mts_visual

Standalone presentation/visualization authority for MTS link asets, published as the `@mts/visual` package.


## Five-mode visualization laboratory

**[Open the published mts_visual laboratory](https://netkeep80.github.io/mts_visual/)**

The GitHub Pages laboratory is one shared consumer of `@mts/visual`. One immutable `VisualLinkNetwork` snapshot can be switched between five first-class presentation modes without reparsing or reinterpreting MTS semantics:

| Mode | Purpose |
| --- | --- |
| **Structural 2D** | Deterministic topology/debug projection with SCC/depth structure, START/END role arcs and bounded crossing reduction. A displayed center is the presentation point of a Link, not a claim that an MTS Link is ontologically an ordinary graph node. |
| **Blueprint 2D** | Interactive continuous START → CENTER → END Link geometry with labels, finite self-incidence, CENTER dragging, pan/zoom and SVG export. |
| **Document 2D** | Deterministic one-shot publication renderer for articles/docs. Each Link has pose `(x,y,theta)`; the two outward CENTER tangents are exactly 180° apart while the oriented cubic path is C1 through CENTER. Small networks use bounded deterministic search to minimize crossings. |
| **Classic 3D** | Retained `Physics3D` / charge + incidence-spring model. All Link centers repel each other, which helps similar Links remain spatially distinguishable instead of visually collapsing onto one trajectory. |
| **Mechanical 3D** | Current monolithic Link mechanics with the WebGPU zero-copy renderer, live material/physics controls, wireframe/smooth normals and CENTER/END diagnostic layers. |

Classic 3D and Mechanical 3D are intentionally both supported. They model different questions:

```text
Classic 3D:
center repulsion + incidence springs
=> exploratory graph-like spatial separation

Mechanical 3D:
one semantic Link = one monolithic semi-rigid body
=> physical Link-shape behavior
```

The public UI is Russian by default. Technical identifiers such as `VisualLinkNetwork`, mode IDs, SHA and WebGPU remain unchanged where they are actual API concepts.

### Shared fixtures and JSON input

All five modes use the same renderer-neutral fixture/input path. Built-in fixtures cover basic recursive forms, self-incidence, links-of-links, article examples, Classic separation and hub-heavy stress cases.

The lab accepts pasted or local-file JSON using the versioned input envelope:

```json
{
  "schema": "mts-visual-document-input/v1",
  "links": [
    {
      "key": "R",
      "startKey": "R",
      "endKey": "R",
      "label": "ROOT"
    }
  ]
}
```

Optional `sourceRepository` and exact `sourceSha` fields may be supplied for provenance. Malformed input fails closed. Importing a network creates one normalized snapshot which is then retained while switching renderers.

The common diagnostics panel exposes the active mode, input identity, Link count, selected Link, package version, exact build SHA and mode-specific metrics. The current input manifest and diagnostics can be copied directly from the page.

### Deterministic Document 2D

Document 2D does not run physics and does not stop when a wall-clock convergence condition happens. Seed generation, candidate ordering, optimization budgets, tie-breaking, label placement, coordinate quantization and SVG serialization are deterministic.

For the same normalized network and the same options:

```text
same input + same options
=> same layout
=> byte-identical canonical SVG
```

The quality order is lexicographic: crossings first, then center overlaps, label overlaps, then path length/compactness. For the basic `R/O/C/L/U` fixture the accepted regression requires zero crossings.

Three output profiles are supported:

```text
formal | article | debug
```

Headless rendering uses the same core engine as the browser:

```bash
mts-visual render-2d \
  --input input.json \
  --output article.svg \
  --manifest article.manifest.json \
  --profile article \
  --strategy auto \
  --root R \
  --format svg \
  --renderer-sha <exact-git-sha>
```

The render manifest records the SHA-256 of the exact input bytes and exact SVG bytes, renderer package version/SHA, requested layout options, selected deterministic seed strategy and final quality metrics. It intentionally contains no current-time field that would make identical renders differ.

### Lifecycle/resource self-test

The page contains a real five-mode lifecycle self-test. It uses the same production `activateLabMode(...)` path as the normal UI and repeatedly executes:

```text
Structural -> Blueprint -> Document -> Classic -> Mechanical
           -> Classic -> Document -> Blueprint -> Structural
```

It checks shared input identity/manifest/selection plus mode-specific ownership of SVG roots, Three renderer resources, RAF/listener scopes and the Mechanical WebGPU canvas. Leaving Mechanical releases its renderer and unconfigures the WebGPU canvas context.

Run it from the UI with **«Проверить цикл 5 режимов»**, or address the shipped browser harness directly:

```text
https://netkeep80.github.io/mts_visual/?selftest=mode-cycle
```

The versioned browser/Pages acceptance contract is:

```text
five-mode-resource-cycle/v1
```

`build-info.json` carries that contract together with package version and the exact build SHA, and the Pages pipeline verifies the same contract again in the deployed artifact.

### WGSL validation in CI

Every production WGSL module exported by `src/webgpu/index.ts` is validated from the exact compiled JavaScript shader string with pinned `naga-wasi-cli@0.1.0`.

```bash
npm run validate:wgsl
```

The validator gate is also part of `npm run check`, so both ordinary PR CI and the Pages build fail before deployment if Naga rejects a shipped shader. The test enumerates the complete exported `*_WGSL` set and includes an invalid-shader negative control so the external validator cannot silently become a no-op.

This catches portable WGSL parsing/type/validation failures before the browser. Device/adapter-specific behavior still belongs to the live WebGPU witness and `GPUShaderModule.getCompilationInfo()`; static Naga validation does not replace real-device execution.

This repository owns renderer-neutral visual DTOs, structural/blueprint/document geometry and layout, presentation state, physics, interaction, the WebGPU path and the optional Three.js browser companion. It does **not** own MTS semantic truth, proof semantics, parser semantics, or `@mts/core`.

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
