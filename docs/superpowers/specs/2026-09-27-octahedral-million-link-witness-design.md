# M5 P4a — Million-Link resource and throughput witness

Date: 2026-09-27  
Issue: #15  
Baseline: @mts/visual 0.4.0 / `9f7da95ddabc99b5e25bf17aaf876335caa89495`

## Purpose

The accepted octahedral path is algorithmically linear, but linear complexity alone does not prove that one million semantic Links can run interactively.

P4a makes the cost of the accepted P1/P2/P3 representation explicit without allocating the target state or depending on unstable wall-clock benchmarks.

The witness is derived from the exact cached template selected by `aspectRatio`.

## Accepted runtime layout

For one template with:

```text
V = physical vertices / Link
E = spring edges / Link
```

P2 owns three dense XYZ Float32 fields:

```text
positions  = 3 * V * 4 bytes / Link
velocities = 3 * V * 4 bytes / Link
forces     = 3 * V * 4 bytes / Link
```

and topology owns:

```text
startIndices = 4 bytes / Link
endIndices   = 4 bytes / Link
```

Therefore current CPU numeric state is exactly:

```text
cpuDynamicBytes = N * (36 * V + 8)
```

This deliberately excludes JS string/object overhead for `VisualKey`, because that overhead is engine-dependent.

## Physics work

For `N` semantic Links:

```text
springEdgeEvaluations / tick = N * E
hingeTransfers / tick        = 2N
hingeProjections / tick      = 2N
integratedVertices / tick    = N * (V - 2)
pairwise Link evaluations    = 0
```

The witness therefore proves exact O(N) operation growth for a fixed template.

## P3 GPU upload cost

The accepted P3 renderer packs every physical vertex into one RGBA Float32 DataTexture.

For:

```text
totalVertices = N * V
width  = ceil(sqrt(max(1,totalVertices)))
height = ceil(totalVertices / width)
capacityVertices = width * height
```

the texture allocation is exactly:

```text
positionTextureBytes = capacityVertices * 4 channels * 4 bytes
```

The per-instance texel address attribute is:

```text
instanceAddressBytes = N * 2 Float32 * 4 bytes
```

The current `fillTexture()` CPU staging loop writes four floats for every actual physical vertex each rendered frame:

```text
cpuTextureStagingBytesPerFrame = totalVertices * 16
```

and `texture.needsUpdate = true` makes the whole DataTexture the upload unit:

```text
gpuTextureUploadBytesPerFrame = positionTextureBytes
```

The witness may project upload bandwidth at an explicitly supplied frame rate, but it MUST NOT call that projection an achieved frame rate.

## Minimum accepted Link template

At the minimum legal aspect ratio:

```text
aspectRatio = 2 * sqrt(2)
octahedra   = 2
V           = 11
E           = 27
```

For one million Links:

```text
CPU numeric dynamic state = 404,000,000 bytes

total physical vertices    = 11,000,000
position texture           = 3317 * 3317 RGBA32F
position texture bytes     = 176,039,824 bytes
instance address bytes     =   8,000,000 bytes

spring evaluations/tick    = 27,000,000
integrated vertices/tick   =  9,000,000
hinge transfers/tick       =  2,000,000
hinge projections/tick     =  2,000,000
```

At 60 requested rendered updates per second, full-texture upload alone projects to:

```text
10,562,389,440 bytes/s
```

before driver overhead and before any physics work.

This is a design witness, not a hardware benchmark.

## Required ladder

The public estimator returns deterministic rows for:

```text
100
1,000
10,000
100,000
1,000,000 Links
```

No row allocates runtime state proportional to its Link count.

## Consequence for P4

The accepted CPU path remains useful and is linear, but million-Link interactive execution requires reducing at least:

1. CPU dynamic-state residency;
2. CPU staging copy;
3. full CPU -> GPU position upload each frame.

P4 GPU work should therefore target GPU-resident positions/velocities/forces and update the renderer from the same GPU-resident state rather than copying every vertex through JavaScript each frame.

## Acceptance

P4a is accepted when tests prove:

- the minimum-template one-million values above exactly;
- the 100 -> 1M ladder is deterministic and allocation-free with respect to target N;
- spring/hinge/integration operation counts scale exactly with N;
- `pairwiseSemanticLinkEvaluations` remains zero;
- texture dimensions/bytes use the same packing formula as P3;
- bandwidth projection is pure arithmetic over bytes/frame and requested FPS;
- no runtime physics or renderer behavior changes.
