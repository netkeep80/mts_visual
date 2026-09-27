# M5 P2 — Octahedral live physics contract

Date: 2026-09-27  
Parent: #15  
Depends on accepted P1 at `e409850604ef11b4373d9b53dd71d7be9a903d43`.

## State

All Links in one live controller use one resolved cached octahedral template.

Runtime state is packed:

```text
positions  Float32Array[linkCount * vertexCount * 3]
velocities Float32Array[linkCount * vertexCount * 3]
forces     Float32Array[linkCount * vertexCount * 3]   // private scratch
```

No per-vertex JS object graph is authoritative.

## Parameters

Link physics has exactly two controls inherited from P1:

```text
aspectRatio
stiffness
```

The low-level template remains legal down to two octahedra, but the accepted live/presentation baseline is **20 octahedra**:

```text
OCTAHEDRAL_PRESENTATION_BASELINE_OCTAHEDRA = 20
OCTAHEDRAL_PRESENTATION_BASELINE_ASPECT_RATIO = sqrt(2) * 11 ≈ 15.56
```

This is a recommended baseline, not a third physical parameter.

Runtime adds one global control:

```text
simulationSpeed
```

`simulationSpeed` is not a material parameter. It scales the fixed internal integration step. Zero means paused integration while hinge constraints remain valid.

Numerical damping and base timestep are fixed engine constants, not user-visible physics parameters.

## Initial embedding

Each Link receives one copy of the cached normalized template placed into a deterministic **volumetric** presentation seed.

The accepted seed layout is a centered cubic lattice:

```text
side  = ceil(cuberoot(linkCount))
depth = ceil(linkCount / (side * side))
spacing = template.diameter * 1.5

x = linkIndex % side
y = floor(linkIndex / side) % side
z = floor(linkIndex / (side * side))
```

Coordinates are centered around the used lattice extents. Seed density depends only on Link cross-section diameter, never on mast rest length. This is essential: increasing octahedron count must make a Link longer/slenderer instead of expanding the whole seed volume by the same factor.

For fixed template geometry this is O(N) to materialize and the scene extent grows O(cuberoot(N)), not O(N).

A one-dimensional seed such as `[(i-(N-1)/2)*spacing,0,0]` is forbidden: it creates a symmetry trap in which large A-networks initialize as a string.

The normalized mast transverse frame is oriented from:

```text
seedCenter(end[i]) - seedCenter(start[i])
```

when that vector is nonzero. Coincident target centers, including self-incidence, use a deterministic finite fallback axis based only on Link index.

The mast's virtual center remains exactly at its own seeded center.

The longitudinal fit is **distributed across the complete two half-masts before hinge projection**. For every rest vertex with longitudinal coordinate `z`:

```text
halfLength = template.restLength / 2
fraction   = abs(z) / halfLength

target = z < 0 ? seedCenter(start[i]) : seedCenter(end[i])
centerline(z) = seedCenter(i)
              + fraction * (target - seedCenter(i))

position = centerline(z) + unchanged transverse rest offset
```

Therefore:
- the central triangle remains centered on `seedCenter(i)`;
- START/END apexes already land on their target seed centers;
- required incidence deformation is spread across every longitudinal module;
- a late hinge projection is only the authoritative positional constraint, not the mechanism that tears three cap springs across the entire target distance.

This replaces the rejected initialization in which an undeformed rigid mast was placed at its own center and then only the two apexes were teleported to semantic targets.

Self-incidence therefore starts finite:

```text
START apex(i) == center(i)   when start[i] == i
END apex(i)   == center(i)   when end[i] == i
```

while non-apex material vertices retain finite spatial extent.

## Tick

One tick is:

```text
forces = 0
for each Link:
    accumulate every cached two-point spring once
transfer START/END apex reaction forces to referenced virtual centers
integrate non-apex physical vertices
project START/END apex positions to referenced virtual centers
set apex velocities to referenced center velocities
```

The two apex vertices are kinematic hinge points and are not independently integrated.

The referenced center velocity is the arithmetic mean of its three central physical vertex velocities.

## Integrator

Use semi-implicit Euler with unit vertex mass:

```text
dt = BASE_DT * simulationSpeed
v <- damping(dt) * (v + F * dt)
x <- x + v * dt
```

Internal damping is deterministic and time-scaled. No additional public damping, max-velocity or max-step controls are introduced in P2.

Non-finite state fails closed.

## Complexity

For fixed template size:

```text
spring work     = N * edgeCount
hinge transfers = 2N
vertex updates  = N * (vertexCount - 2) when simulationSpeed > 0; otherwise 0
hinge projects  = 2N
```

No semantic-Link all-pairs loop is allowed.

The hot tick must not construct Maps or per-vertex objects.

## Topology transition

A whole-network transition may allocate new packed arrays and use a temporary key->index Map.

Retained VisualKeys preserve all internal vertex positions and velocities.

Removed VisualKeys disappear completely.

Added VisualKeys receive deterministic finite template state.

After transition, all apex hinges are reprojected against the new current topology.

Transition is not a hot tick and is allowed to be O(N).

## Acceptance

Tests must prove:

- packed array sizes are exact;
- initial double-self Link is finite and non-collapsed;
- representative multi-Link seed centers are non-collinear and have genuine 3D span;
- seed spacing is exactly 1.5x diameter and independent of mast rest length;
- the 20-octahedron 333-Link hub-heavy witness has initial p95 relative spring strain <= 0.6, max <= 1.0, and zero edges above 100% strain;
- after 360 damped ticks hub-heavy spring energy does not exceed its initial value by more than 5%;
- seed spatial extent follows the cubic O(cuberoot(N)) bound rather than the former linear string layout;
- non-self mast longitudinal orientation follows START-target -> END-target seed direction before apex projection;
- zero stiffness produces no free internal motion;
- nonzero stiffness deforms a projected self-Link and remains finite;
- speed 0 pauses integration;
- larger simulationSpeed advances farther from the same initial state;
- apex positions equal referenced virtual centers after every tick;
- apex velocities equal referenced center velocities;
- arrays are reused across ordinary ticks;
- exact linear operation counters;
- retained full internal state survives topology transition;
- removed state disappears and added state is finite;
- legacy `Physics3D` and Three renderer remain untouched in P2.
