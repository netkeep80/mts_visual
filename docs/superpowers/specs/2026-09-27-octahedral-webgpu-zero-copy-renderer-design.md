# M5 P4c — WebGPU zero-copy octahedral renderer

Date: 2026-09-27  
Parent: #15  
Baseline: @mts/visual 0.4.1 / 57732424778613aca6d865fbb986b64d960042e6

## 1. Goal

Render the accepted octahedral live state directly from the exact GPU-resident positionBuffer owned by P4b compute.

Ordinary rendered frames must not perform:

~~~text
GPU -> CPU readback
CPU Float32 staging of vertex positions
CPU -> GPU dynamic position upload
WebGL DataTexture refresh
per-Link position/instance buffer rebuild
~~~

P4c is a WebGPU-native render core. The accepted Three/WebGL P3 path remains a compatibility fallback.

## 2. Shared state invariant

The renderer receives an existing OctahedralWebGpuCompute3D and binds:

~~~text
compute.positionBuffer
~~~

directly as a read-only storage buffer in the vertex stage.

The renderer MUST NOT create, mirror or own another dynamic position buffer.

For a fixed topology/template:

~~~text
renderPositionBuffer === compute.positionBuffer
~~~

for the entire renderer lifetime.

## 3. Static renderer-owned data

The renderer may upload immutable template-sized data once at construction:

~~~text
surfaceTriangles : Uint32[template.surfaceTriangles.length]
gradientT        : Float32[template.vertexCount]
~~~

These buffers are O(template size), not O(Link count).

No O(N) renderer-owned instance-address buffer is allowed.

## 4. Draw model

For non-empty topology one render pass emits exactly three instanced draws.

### 4.1 Surface

~~~text
vertexCount   = template.surfaceTriangles.length
instanceCount = linkCount
~~~

For every vertex invocation:

1. surfaceTriangles[vertex_index] selects the local physical vertex;
2. instance_index * template.vertexCount + localVertex selects packed XYZ in the shared position buffer;
3. gradientT[localVertex] generates START-red -> END-blue color.

No expanded per-Link mesh exists.

### 4.2 Virtual center marker

One six-vertex screen-facing quad is generated procedurally per Link.

Its world anchor is:

~~~text
(Pcenter0 + Pcenter1 + Pcenter2) / 3
~~~

The marker is presentation-only and introduces no physics particle.

### 4.3 END arrow

One three-vertex screen-facing arrowhead is generated procedurally per Link.

Its tip is the END apex. Its screen direction is derived from:

~~~text
centroid(last transverse triangle) -> END apex
~~~

The arrow remains blue / END-coded.

## 5. Camera/control upload

The only ordinary render-time CPU -> GPU write is one small fixed-size uniform block containing:

~~~text
viewProjection matrix
link/template indices
viewport width/height
marker pixel size
arrow pixel size
~~~

This is control state, not dynamic Link state.

Required stats:

~~~text
dynamicStateUploadBytes = 0
controlUploadBytes      = fixed uniform byte size
drawCalls               = linkCount == 0 ? 0 : 3
~~~

## 6. Synchronization

Compute and render use the same WebGPU device/queue.

P4b step submission followed by P4c render submission relies on WebGPU queue ordering. No CPU fence/readback is inserted between them.

The render core does not call mapAsync, copyBufferToBuffer, readBackPositions, or readBackVelocities.

## 7. Depth

The renderer supports a depth attachment using a caller-specified depth format.

The low-level core receives target/depth texture views. A convenience canvas wrapper may own context/depth texture lifecycle, but dynamic positions still remain shared with compute.

## 8. Empty topology

For zero Links:
- renderer creation remains valid;
- no surface/center/arrow draw is encoded;
- no dynamic-state upload occurs.

## 9. Lifecycle

Renderer owns and destroys only:
- immutable template render buffers;
- render uniform buffer;
- renderer-created depth texture in the optional canvas wrapper.

It MUST NOT destroy compute controller or compute.positionBuffer / velocityBuffer / forceBuffer.

Destroy is idempotent.

After renderer destroy, render calls fail closed.

## 10. Device-loss interaction

P4c snapshots mirror compute availability: available / device-lost / destroyed.

If the compute controller is destroyed or device-lost, rendering fails closed.

## 11. Million-Link structural witness

For minimum template:

~~~text
surface triangles / Link = 18
surface vertex invocations / Link = 54
center vertex invocations / Link = 6
arrow vertex invocations / Link = 3
~~~

At 1,000,000 Links:

~~~text
surface vertex invocations = 54,000,000
center vertex invocations  =  6,000,000
arrow vertex invocations   =  3,000,000

renderer dynamic position bytes owned = 0
renderer O(N) instance-address bytes  = 0
dynamic upload bytes / frame          = 0
draw calls                            = 3
~~~

This does not claim 60 FPS. It proves removal of the P4a CPU -> GPU position bandwidth bottleneck. LOD/visibility work remains a later optimization if vertex throughput becomes the next measured bottleneck.

## 12. P4c acceptance

CI must prove without a physical GPU:

1. render bind group references the exact compute.positionBuffer object;
2. no renderer-owned O(N) dynamic position/instance buffer exists;
3. ordinary render performs zero dynamic-state uploads;
4. ordinary render performs no buffer copy/readback/map;
5. surface draw = template triangle vertices x Link instances;
6. center draw = 6 vertices x Link instances;
7. arrow draw = 3 vertices x Link instances;
8. non-empty render has exactly 3 draw calls;
9. zero-Link render has 0 draw calls;
10. WGSL surface path reads packed XYZ directly from storage;
11. START-red -> END-blue comes from cached gradientT;
12. center is computed from the accepted central triangle;
13. END arrow uses END apex and last transverse triangle;
14. renderer destroy never destroys compute-owned position/velocity/force buffers;
15. one-million structural witness reports zero renderer dynamic-position bytes and zero dynamic upload bytes/frame.

A real-browser WebGPU render remains required before final P4 acceptance/public 0.5.0 publication.
