# M5 P1 — Octahedral Link physics contract

Date: 2026-09-27  
Issue: #15  
Consumer-neutral visual/physics contract only.

## 1. Purpose

Replace the non-scalable all-pairs visual physics path with a data-oriented Link representation whose deformation is produced only by local two-point springs.

This contract does not change MTS semantics. A `VisualLink` remains one semantic/presentation Link regardless of how many internal physics vertices are used.

## 2. One Link, one elastic mast

The physical discretization of one Link is:

```text
tetra ≡ octa ≡ octa ≡ ... ≡ octa ≡ octa ≡ tetra
```

The octahedron count is always even.

The internal octahedral chain is the regular three-fold-axis representation also used by `netkeep80/mast-calculator`:

- every transverse level is an equilateral triangle with three physical vertices;
- adjacent levels rotate by 60 degrees;
- every level owns its three ring edges;
- adjacent levels are connected by six unit diagonal edges;
- START and END caps are regular tetrahedra sharing the first/last transverse triangle and contributing one physical apex each.

Internal vertices and springs are physics discretization only. They are not semantic Links, visual centers or proof entities.

## 3. Normalized geometry

Every spring rest edge has unit length:

```text
edgeRestLength = 1
triangleSide   = 1
triangleRadius = 1 / sqrt(3)
diameter       = 2 / sqrt(3)
moduleHeight   = sqrt(2/3)
```

For `p >= 1` octahedron pairs:

```text
octahedronCount = 2p
restLength      = (2p + 2) * sqrt(2/3)
aspectRatio     = restLength / diameter
                = sqrt(2) * (p + 1)
```

The normalized template is centered at Z=0.

START apex has longitudinal gradient coordinate `t=0`.
END apex has `t=1`.

## 4. Exactly two Link parameters

The physical Link contract exposes exactly:

```text
aspectRatio
stiffness
```

### aspectRatio

`aspectRatio` selects the regular discrete template.

Because only an even number of octahedra is legal, arbitrary input ratios resolve to the nearest legal pair count:

```text
pairCount = max(1, round(aspectRatio / sqrt(2) - 1))
resolvedAspectRatio = sqrt(2) * (pairCount + 1)
```

Resolution is deterministic and is returned to the caller; it is never a hidden approximation.

### stiffness

`stiffness >= 0` is the Hooke stiffness shared by every physical edge of the Link template.

There is no separate Link parameter for:
- spring rest length;
- octahedron count;
- axial stiffness;
- bending stiffness;
- torsional stiffness.

Those macroscopic behaviors emerge from regular geometry plus edge stiffness.

### simulationSpeed

`simulationSpeed` is not a Link parameter. It belongs to the future live integrator/runtime boundary.

## 5. Virtual geometric center

For `2p` octahedra, transverse level `p` is exactly the middle shared triangle.

If its three physical vertices are `P0,P1,P2`, the Link center is:

```text
C = (P0 + P1 + P2) / 3
```

The center:
- has no stored particle;
- has no mass;
- has no independent velocity;
- has no semantic identity;
- is derived from the three physical vertices every time it is needed.

A force `F` applied at the virtual center is transferred back using the same barycentric map:

```text
P0 += F/3
P1 += F/3
P2 += F/3
```

This preserves net force exactly.

## 6. Hinged Link incidence

For semantic Link `i`:

```text
START apex(i) == geometricCenter(start[i])
END apex(i)   == geometricCenter(end[i])
```

The equality is a positional hinge constraint.

The hinge transfers force but not orientation. It introduces no bending-moment constraint between Links.

Apex reaction force is transferred to the referenced Link's virtual center, then barycentrically to that center triangle.

## 7. Self-incidence

All forms are legal:

```text
start[i] == i
end[i] == i
start[i] == i && end[i] == i
```

A self-incidence constraint may make a physical apex coincide spatially with the Link's own virtual center, but those remain distinct material coordinates.

Therefore self-incidence must not imply zero total Link length or collapse every physical vertex to the center.

## 8. Cached immutable templates

Templates are cached by resolved pair count.

One immutable template contains at least:

```text
restPositions        Float32 XYZ
edgeA                Uint32
edgeB                Uint32
surfaceTriangles     Uint32 triplets
gradientT            Float32
centerTriangle       3 indices
startApex
endApex
edgeBatches          conflict-free edge-index batches
```

Two requests resolving to the same pair count return the same template object.

### Edge batches

Within one edge batch no physical vertex may appear in two edges.

All template edges occur in exactly one batch.

This permits a future GPU solver to process a batch without atomic accumulation, with batches executed sequentially.

## 9. Spring kernel

For physical edge `a-b`:

```text
d = Pb - Pa
L = |d|
extension = L - 1
F = stiffness * extension * normalize(d)
```

Equal and opposite force is added to the two endpoints.

The kernel:
- evaluates every physical edge exactly once;
- has no semantic-Link all-pairs loop;
- has no explicit three-point bending force;
- has no global charge/gravity force;
- reports an evaluation count equal to `edgeCount`.

## 10. Surface / rendering data

The template surface excludes internal shared triangular faces.

It contains:
- 3 exposed side triangles for START tetrahedron;
- 6 exposed side triangles per octahedron;
- 3 exposed side triangles for END tetrahedron.

Thus for `n` octahedra:

```text
surfaceTriangleCount = 6n + 6
```

The cached `gradientT` is the canonical START-red -> END-blue interpolation coordinate for later batched rendering.

The END arrow and center marker are presentation instances and are not additional Link physics vertices.

## 11. P1 acceptance

P1 is accepted only if tests prove:

1. resolved octahedron count is even and at least 2;
2. every rest spring length is 1 within numeric tolerance;
3. central triangle centroid is at the normalized origin;
4. template is symmetric START/END in longitudinal extent;
5. cache identity is stable for equivalent ratios;
6. every physical edge occurs once and only once;
7. edge batches contain no vertex conflicts;
8. surface triangle count matches `6n+6`;
9. gradient is exactly START=0 and END=1;
10. spring forces are equal/opposite and zero at rest;
11. virtual-center force distribution conserves total force;
12. hinge force transfer conserves force, including self-incidence;
13. hinge projection of a double self-Link keeps finite non-apex geometry;
14. operation count is O(total physical edges), with no pairwise semantic-Link counter/path.

## 12. Out of scope for P1

- live time integration;
- user-facing `simulationSpeed`;
- replacement of legacy `LivePhysics3D`;
- persistent Three buffers;
- WebGPU execution;
- LOD.

Those are follow-on slices under #15 and must reuse this exact template/center/incidence contract rather than inventing a second physical model.
