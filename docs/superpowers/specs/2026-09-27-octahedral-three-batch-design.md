# M5 P3 — Persistent batched octahedral Three renderer

Date: 2026-09-27
Parent: #15
Depends on P1/P2 accepted through `e8a071a9b705aa0db9e02f2290200dfd321bc53c`.

## Purpose

Render the P2 packed octahedral live state without constructing one Three object, geometry or material per semantic Link and without rebuilding resources on ordinary physics ticks.

P3 introduces a browser-companion batch object. It does not replace the legacy renderer lifecycle yet; consumer cutover is a separate acceptance step.

## Steady-state draw topology

One batch owns exactly three GPU draw objects:

```text
1. surface  — all Link tetra/octa surface triangles
2. centers  — all virtual-center markers
3. arrows   — all END arrows
```

For a non-empty network the target draw-call proxy is therefore exactly 3, independent of semantic Link count.

No per-Link `THREE.Mesh`, `THREE.Line`, geometry or material is created.

## Surface

The surface uses one `THREE.InstancedBufferGeometry` containing only the cached P1 template topology:

```text
template rest vertex slots
template surface triangle index
template gradientT
```

Each semantic Link is one instance.

The vertex shader reads the actual deformed physical vertex position from one dynamic float position texture populated from the P2 packed `Float32Array`.

Color is produced in the shader from cached `gradientT`:

```text
t=0 -> red
t=1 -> blue
mix(red, blue, t)
```

There is no GREEN center color in the new octahedral renderer.

## Position texture

The renderer maintains one RGBA Float32 `DataTexture`.

Each physical vertex occupies one texel:

```text
R=x G=y B=z A=1
```

The texture storage is allocated once and reused while capacity is sufficient.

An ordinary P2 tick followed by renderer sync:
- copies current packed XYZ into existing texture storage;
- sets `needsUpdate`;
- does not recreate texture, geometry, material or draw objects.

Topology growth may increase texture capacity and replace the texture. Topology changes are not ordinary frame updates.

## Instance addressing

Do not encode a global packed vertex index in one Float32 scalar because million-Link templates can exceed exact 24-bit integer range.

Instead each instance carries the texel coordinate of its first physical vertex:

```text
instanceTexel = (baseX, baseY)
```

Both values remain small exactly representable integers. The shader adds a small local template vertex index and handles row wrapping.

The same `InstancedBufferAttribute` is shared by surface/center/arrow geometries.

## Center markers

Centers are rendered by one instanced low-order icosahedral geometry.

Its vertex shader derives the virtual center directly from the three current central-triangle vertices in the position texture.

The marker is presentation only and creates no physics vertex or DOF.

## END arrows

END arrows are rendered by one instanced cone geometry.

Its vertex shader reads:
- the physical END apex;
- the three vertices of the final transverse triangle.

The arrow axis is the current vector from final-triangle centroid to END apex. The arrow tip coincides with the physical END apex.

No CPU per-Link arrow matrix is maintained.

## Resource stability

For ordinary `sync()` calls with unchanged topology capacity, all of these identities are stable:

```text
surface Mesh
surface geometry
surface material
position DataTexture
center Mesh
center geometry/material
arrow Mesh
arrow geometry/material
instance-address attribute
```

Only texture contents/version change.

## Complexity

CPU sync work is:

```text
O(N * physicalVertexCount)
```

for packed XYZ -> RGBA texture upload preparation.

It performs no per-spring calculation, no surface resampling and no per-Link object creation.

GPU draw-object count is O(1).

## Presentation constants

P3 presentation defaults are not Link-physics parameters:

```text
center marker: low-order icosahedron
arrow: low-sided cone
START color: red
END color: blue
```

They do not alter P1/P2 physics.

## Disposal

`dispose()` must release:
- position texture;
- all three geometries;
- all three materials;
and remove batch objects from their group.

Disposal is idempotent.

## P3 acceptance

Tests prove:

1. N Links create exactly three batch draw objects, including N=1000;
2. surface geometry contains only one template copy and `instanceCount=N`;
3. surface gradient attribute is the P1 cached gradient;
4. position texture contains current P2 packed XYZ values;
5. ordinary physics tick + `sync()` preserves all resource object identities;
6. texture version advances after sync;
7. center and arrow geometries are instanced, not per-Link objects;
8. instance texel addressing exactly covers every Link without a global float index;
9. same-count topology transition reuses all GPU resources;
10. topology growth changes instance count and grows texture only when required;
11. draw-call proxy remains <=3 independent of N;
12. dispose releases every owned GPU resource exactly once;
13. legacy renderer remains unchanged in P3.
