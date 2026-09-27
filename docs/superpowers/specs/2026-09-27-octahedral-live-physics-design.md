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

Runtime adds one global control:

```text
simulationSpeed
```

`simulationSpeed` is not a material parameter. It scales the fixed internal integration step. Zero means paused integration while hinge constraints remain valid.

Numerical damping and base timestep are fixed engine constants, not user-visible physics parameters.

## Initial embedding

Each Link receives one copy of the cached normalized template translated to a deterministic presentation center.

After placement, START and END apexes are projected to the virtual geometric centers named by `start[i]` and `end[i]`.

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
