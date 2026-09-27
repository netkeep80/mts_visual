import {
  OCTAHEDRAL_WEBGPU_RENDER_UNIFORM_BYTES,
  OCTAHEDRAL_WEBGPU_RENDER_WGSL,
  buildOctahedralWireframeIndices3D,
  createOctahedralWebGpuZeroCopyRenderer3D,
  estimateOctahedralWebGpuRender3D,
  type OctahedralWebGpuCompute3D,
  type WebGpuBufferLike,
  type WebGpuRenderDeviceLike,
} from "../src/webgpu/index.js";
import {
  buildOctahedralLinkTopology3D,
  getOctahedralLinkTemplate3D,
  type VisualLinkNetwork,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual M5/P4c: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

class FakeBuffer implements WebGpuBufferLike {
  destroyed = false;

  constructor(
    readonly size: number,
    readonly label = "",
  ) {}

  destroy(): void {
    this.destroyed = true;
  }

  async mapAsync(_mode: number, _offset?: number, _size?: number): Promise<void> {
    throw new Error("renderer test must never map a buffer");
  }

  getMappedRange(_offset?: number, _size?: number): ArrayBuffer {
    throw new Error("renderer test must never read mapped GPU state");
  }

  unmap(): void {
    throw new Error("renderer test must never unmap GPU state");
  }
}

class FakeRenderQueue {
  readonly writes: { buffer: WebGpuBufferLike; label: string; bytes: number }[] = [];
  submissions = 0;

  writeBuffer(
    buffer: WebGpuBufferLike,
    _bufferOffset: number,
    data: ArrayBuffer | ArrayBufferView,
    _dataOffset?: number,
    size?: number,
  ): void {
    this.writes.push({
      buffer,
      label: buffer.label ?? "",
      bytes: size ?? data.byteLength,
    });
  }

  submit(_commandBuffers: readonly object[]): void {
    this.submissions += 1;
  }

  reset(): void {
    this.writes.length = 0;
    this.submissions = 0;
  }
}

interface DrawRecord {
  readonly pipeline: string;
  readonly vertexCount: number;
  readonly instanceCount: number;
}

class FakeRenderDevice implements WebGpuRenderDeviceLike {
  readonly queue = new FakeRenderQueue();
  readonly buffers: FakeBuffer[] = [];
  readonly bindGroups: { label: string; entries: readonly object[] }[] = [];
  readonly draws: DrawRecord[] = [];
  renderPasses = 0;

  createBuffer(descriptor: {
    readonly label?: string;
    readonly size: number;
    readonly usage: number;
  }): FakeBuffer {
    const buffer = new FakeBuffer(descriptor.size, descriptor.label ?? "");
    this.buffers.push(buffer);
    return buffer;
  }

  createShaderModule(descriptor: {
    readonly label?: string;
    readonly code: string;
  }): object {
    return { label: descriptor.label, code: descriptor.code };
  }

  createBindGroupLayout(descriptor: {
    readonly label?: string;
    readonly entries: readonly object[];
  }): object {
    return { label: descriptor.label, entries: descriptor.entries };
  }

  createPipelineLayout(descriptor: {
    readonly label?: string;
    readonly bindGroupLayouts: readonly object[];
  }): object {
    return { label: descriptor.label, bindGroupLayouts: descriptor.bindGroupLayouts };
  }

  async createRenderPipelineAsync(descriptor: {
    readonly label?: string;
    readonly layout: object;
    readonly vertex: {
      readonly module: object;
      readonly entryPoint: string;
    };
    readonly fragment: {
      readonly module: object;
      readonly entryPoint: string;
      readonly targets: readonly { readonly format: string }[];
    };
    readonly primitive?: object;
    readonly depthStencil?: object;
  }): Promise<{ readonly label?: string; readonly entryPoint: string }> {
    return descriptor.label === undefined
      ? { entryPoint: descriptor.vertex.entryPoint }
      : { label: descriptor.label, entryPoint: descriptor.vertex.entryPoint };
  }

  createBindGroup(descriptor: {
    readonly label?: string;
    readonly layout: object;
    readonly entries: readonly object[];
  }): object {
    const record = {
      label: descriptor.label ?? "",
      entries: descriptor.entries,
    };
    this.bindGroups.push(record);
    return record;
  }

  createCommandEncoder(_descriptor?: { readonly label?: string }) {
    const device = this;
    return {
      beginRenderPass(_descriptor: {
        readonly colorAttachments: readonly object[];
        readonly depthStencilAttachment?: object;
      }) {
        device.renderPasses += 1;
        let pipeline = "";
        return {
          setPipeline(value: { readonly label?: string }) {
            pipeline = value.label ?? "";
          },
          setBindGroup(_index: number, _bindGroup: object) {},
          draw(
            vertexCount: number,
            instanceCount = 1,
            _firstVertex = 0,
            _firstInstance = 0,
          ) {
            device.draws.push({ pipeline, vertexCount, instanceCount });
          },
          end() {},
        };
      },
      finish() {
        return {};
      },
    };
  }

  resetFrame(): void {
    this.queue.reset();
    this.draws.length = 0;
    this.renderPasses = 0;
  }
}

function fakeCompute(
  network: VisualLinkNetwork,
  status: "available" | "device-lost" | "destroyed" = "available",
): OctahedralWebGpuCompute3D {
  const template = getOctahedralLinkTemplate3D(2 * Math.SQRT2);
  const topology = buildOctahedralLinkTopology3D(network);
  const fieldBytes = topology.linkCount * template.vertexCount * 3 * 4;
  const positionBuffer = new FakeBuffer(Math.max(4, fieldBytes), "compute-position-buffer");
  const velocityBuffer = new FakeBuffer(Math.max(4, fieldBytes), "compute-velocity-buffer");
  const forceBuffer = new FakeBuffer(Math.max(4, fieldBytes), "compute-force-buffer");
  let destroyed = status === "destroyed";

  const controller: OctahedralWebGpuCompute3D = {
    template,
    topology,
    positionBuffer,
    velocityBuffer,
    forceBuffer,
    stiffness: 1,
    simulationSpeed: 1,
    step: () => ({
      springBatchDispatches: template.edgeBatches.length,
      computePasses: template.edgeBatches.length + 5,
      dynamicStateUploadBytes: 0,
    }),
    setStiffness: (_stiffness) => {},
    setSimulationSpeed: (_simulationSpeed) => {},
    readBackPositions: async () => {
      throw new Error("zero-copy renderer must never call readBackPositions");
    },
    readBackVelocities: async () => {
      throw new Error("zero-copy renderer must never call readBackVelocities");
    },
    snapshot: () => ({
      status: destroyed ? "destroyed" : status,
      deviceLostReason: status === "device-lost" ? "synthetic loss" : null,
      linkCount: topology.linkCount,
      vertexCount: template.vertexCount,
      edgeCount: template.edgeCount,
      totalPhysicalVertices: topology.linkCount * template.vertexCount,
      positionBytes: fieldBytes,
      velocityBytes: fieldBytes,
      forceBytes: fieldBytes,
      gpuDynamicXyzBytes: fieldBytes * 3,
      springBatchCount: template.edgeBatches.length,
      stiffness: 1,
      simulationSpeed: 1,
      destroyed,
    }),
    destroy: () => {
      destroyed = true;
      positionBuffer.destroy();
      velocityBuffer.destroy();
      forceBuffer.destroy();
    },
  };
  return controller;
}

const network: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "B" },
    { key: "B", startKey: "C", endKey: "D" },
    { key: "C", startKey: "A", endKey: "C" },
    { key: "D", startKey: "D", endKey: "D" },
  ],
};

const compute = fakeCompute(network);
const device = new FakeRenderDevice();
const renderer = await createOctahedralWebGpuZeroCopyRenderer3D(
  device,
  compute,
  {
    colorFormat: "bgra8unorm",
    depthFormat: "depth24plus",
  },
);

same(renderer.positionBuffer, compute.positionBuffer, "renderer exposes exact compute position buffer");

const bindGroup = device.bindGroups.find(
  (candidate) => candidate.label === "octahedral-webgpu-zero-copy-render-bind-group",
);
assert(bindGroup !== undefined, "renderer creates zero-copy bind group");
const positionEntry = bindGroup.entries.find(
  (entry) => (entry as { binding?: number }).binding === 0,
) as { resource?: { buffer?: WebGpuBufferLike } } | undefined;
assert(positionEntry !== undefined, "render bind group has position binding");
same(
  positionEntry.resource?.buffer,
  compute.positionBuffer,
  "binding 0 is exact compute.positionBuffer object",
);

const rendererOwnedLabels = device.buffers.map((buffer) => buffer.label);
same(
  JSON.stringify(rendererOwnedLabels.sort()),
  JSON.stringify([
    "octahedral-render-gradient",
    "octahedral-render-surface-indices",
    "octahedral-render-wireframe-indices",
    "octahedral-render-uniforms",
  ].sort()),
  "renderer owns three static template buffers plus one fixed uniform",
);
assert(
  !rendererOwnedLabels.some((label) => /position|instance-address/.test(label)),
  "renderer owns no dynamic position or O(N) instance-address buffer",
);

const creationWriteLabels = device.queue.writes.map((write) => write.label);
same(
  JSON.stringify(creationWriteLabels.sort()),
  JSON.stringify([
    "octahedral-render-gradient",
    "octahedral-render-surface-indices",
    "octahedral-render-wireframe-indices",
  ].sort()),
  "renderer construction uploads only immutable template data",
);

device.resetFrame();
const identity = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);
const stats = renderer.render({
  targetView: { kind: "color-view" },
  depthView: { kind: "depth-view" },
  viewProjection: identity,
  width: 1280,
  height: 720,
});

same(device.queue.writes.length, 1, "ordinary render performs one small control write");
same(device.queue.writes[0]!.label, "octahedral-render-uniforms", "ordinary render writes only uniform controls");
same(device.queue.writes[0]!.bytes, OCTAHEDRAL_WEBGPU_RENDER_UNIFORM_BYTES, "control upload has fixed size");
assert(
  device.queue.writes[0]!.buffer !== compute.positionBuffer,
  "ordinary render never writes compute.positionBuffer",
);
same(device.renderPasses, 1, "ordinary render uses one WebGPU render pass");
same(device.queue.submissions, 1, "ordinary render submits one command buffer");

same(stats.drawCalls, 3, "non-empty zero-copy render emits exactly three draws");
same(stats.dynamicStateUploadBytes, 0, "render reports zero dynamic Link-state upload");
same(stats.bufferCopies, 0, "render reports zero buffer copies");
same(stats.readbacks, 0, "render reports zero GPU readbacks");
same(stats.controlUploadBytes, OCTAHEDRAL_WEBGPU_RENDER_UNIFORM_BYTES, "render reports fixed control upload");

same(device.draws.length, 3, "fake GPU observes exactly three draw commands");
same(
  device.draws[0]!.vertexCount,
  compute.template.surfaceTriangles.length,
  "surface draw expands only cached template triangle indices",
);
same(device.draws[0]!.instanceCount, network.links.length, "surface draw instances semantic Links");
same(device.draws[1]!.vertexCount, 6, "center marker is six procedural billboard vertices");
same(device.draws[1]!.instanceCount, network.links.length, "center draw instances semantic Links");
same(device.draws[2]!.vertexCount, 6, "END arrow is a six-vertex procedural kite");
same(device.draws[2]!.instanceCount, network.links.length, "arrow draw instances semantic Links");

const wireframeIndices = buildOctahedralWireframeIndices3D(
  compute.template.surfaceTriangles,
);
assert(wireframeIndices.length > 0, "wireframe template contains cached edge vertices");
same(wireframeIndices.length % 2, 0, "wireframe template is a line-list");

device.resetFrame();
const wireframeStats = renderer.render({
  targetView: { kind: "color-view" },
  depthView: { kind: "depth-view" },
  viewProjection: identity,
  width: 1280,
  height: 720,
  wireframe: true,
});
same(wireframeStats.drawCalls, 3, "wireframe render keeps exactly three draws");
same(device.draws.length, 3, "wireframe frame still emits three draw commands");
same(
  device.draws[0]!.pipeline,
  "octahedral-webgpu-wireframe-pipeline",
  "wireframe frame selects dedicated line-list pipeline",
);
same(
  device.draws[0]!.vertexCount,
  wireframeIndices.length,
  "wireframe draw expands cached unique surface edges",
);
same(
  device.queue.writes.length,
  1,
  "wireframe toggle still writes only fixed render uniforms",
);
assert(
  device.queue.writes[0]!.buffer !== compute.positionBuffer,
  "wireframe mode never writes shared dynamic positions",
);

assert(
  OCTAHEDRAL_WEBGPU_RENDER_WGSL.includes("@group(0) @binding(0) var<storage, read> positions: array<f32>;"),
  "WGSL reads shared packed XYZ positions directly as storage",
);
assert(
  OCTAHEDRAL_WEBGPU_RENDER_WGSL.includes("surface_indices[vertex_index]"),
  "surface vertex shader uses cached template triangle indices",
);
assert(
  OCTAHEDRAL_WEBGPU_RENDER_WGSL.includes("gradient_t[local_vertex]"),
  "surface vertex shader uses cached START->END gradient coordinate",
);
assert(
  OCTAHEDRAL_WEBGPU_RENDER_WGSL.includes("vec3<f32>(1.0 - t, 0.0, t)"),
  "surface shader maps START red to END blue",
);
assert(
  OCTAHEDRAL_WEBGPU_RENDER_WGSL.includes("fn center_position"),
  "center marker derives virtual center from accepted central triangle",
);
assert(
  OCTAHEDRAL_WEBGPU_RENDER_WGSL.includes("fn end_ring_center"),
  "END arrow derives direction from last transverse triangle",
);
assert(
  OCTAHEDRAL_WEBGPU_RENDER_WGSL.includes("fn end_ring_projected_diameter_pixels"),
  "END arrow measures Link diameter after projection",
);
assert(
  OCTAHEDRAL_WEBGPU_RENDER_WGSL.includes("link_diameter_pixels * 3.0"),
  "END arrow is at least three projected Link diameters long",
);
assert(
  OCTAHEDRAL_WEBGPU_RENDER_WGSL.includes("max(scene.viewport_sizes.w, link_diameter_pixels * 3.0)"),
  "END arrow keeps configured pixel size only as a lower bound",
);
assert(
  OCTAHEDRAL_WEBGPU_RENDER_WGSL.includes("let local = vertex_index % 6u;"),
  "END marker is rendered as a six-vertex kite",
);
assert(
  OCTAHEDRAL_WEBGPU_RENDER_WGSL.includes("vec3<f32>(0.0, 0.95, 1.0)"),
  "END marker uses high-contrast cyan distinct from the blue Link surface",
);
assert(
  !/texture_/.test(OCTAHEDRAL_WEBGPU_RENDER_WGSL),
  "zero-copy WGSL has no position texture bridge",
);

const snapshot = renderer.snapshot();
same(snapshot.status, "available", "live renderer snapshot is available");
same(
  snapshot.wireframeVerticesPerLink,
  wireframeIndices.length,
  "snapshot exposes cached wireframe line-list size",
);
same(snapshot.sharedPositionBuffer, true, "snapshot records shared position-buffer invariant");
same(snapshot.rendererDynamicPositionBytes, 0, "renderer owns zero dynamic position bytes");
same(snapshot.rendererInstanceAddressBytes, 0, "renderer owns zero O(N) instance-address bytes");
same(snapshot.dynamicStateUploadBytesPerFrame, 0, "snapshot proves zero dynamic upload per frame");
same(snapshot.drawCalls, 3, "snapshot draw-call proxy is three");

const million = estimateOctahedralWebGpuRender3D(1_000_000, compute.template);
same(million.surfaceVerticesPerLink, 54, "minimum template renders 54 surface vertices per Link");
same(million.surfaceVertexInvocations, 54_000_000, "million Links imply 54M surface vertex invocations");
same(million.centerVertexInvocations, 6_000_000, "million Links imply 6M center billboard vertices");
same(million.arrowVertexInvocations, 6_000_000, "million Links imply 6M arrow vertices");
same(million.drawCalls, 3, "million-Link structural witness remains three draws");
same(million.rendererDynamicPositionBytes, 0, "million-Link renderer owns zero dynamic position bytes");
same(million.rendererInstanceAddressBytes, 0, "million-Link renderer owns zero instance-address bytes");
same(million.dynamicStateUploadBytesPerFrame, 0, "million-Link renderer uploads zero dynamic state per frame");

const positionBeforeDestroy = compute.positionBuffer as FakeBuffer;
const velocityBeforeDestroy = compute.velocityBuffer as FakeBuffer;
const forceBeforeDestroy = compute.forceBuffer as FakeBuffer;
renderer.destroy();
renderer.destroy();

assert(!positionBeforeDestroy.destroyed, "renderer destroy does not destroy compute position buffer");
assert(!velocityBeforeDestroy.destroyed, "renderer destroy does not destroy compute velocity buffer");
assert(!forceBeforeDestroy.destroyed, "renderer destroy does not destroy compute force buffer");
assert(
  device.buffers.every((buffer) => buffer.destroyed),
  "renderer destroy releases every renderer-owned buffer",
);
same(renderer.snapshot().status, "destroyed", "destroyed renderer snapshot is explicit");

try {
  renderer.render({
    targetView: {},
    depthView: {},
    viewProjection: identity,
    width: 1,
    height: 1,
  });
  throw new Error("destroyed renderer should reject render");
} catch (error) {
  assert(error instanceof Error && /destroyed/.test(error.message), "destroyed renderer fails closed");
}

const emptyCompute = fakeCompute({ links: [] });
const emptyDevice = new FakeRenderDevice();
const emptyRenderer = await createOctahedralWebGpuZeroCopyRenderer3D(
  emptyDevice,
  emptyCompute,
  { colorFormat: "rgba8unorm" },
);
emptyDevice.resetFrame();
const emptyStats = emptyRenderer.render({
  targetView: {},
  viewProjection: identity,
  width: 320,
  height: 200,
});
same(emptyStats.drawCalls, 0, "empty topology encodes zero draw calls");
same(emptyDevice.draws.length, 0, "fake GPU sees no empty-topology draw");
same(emptyStats.dynamicStateUploadBytes, 0, "empty render still has zero dynamic-state upload");
emptyRenderer.destroy();

const lostCompute = fakeCompute(network, "device-lost");
const lostDevice = new FakeRenderDevice();
try {
  await createOctahedralWebGpuZeroCopyRenderer3D(
    lostDevice,
    lostCompute,
    { colorFormat: "bgra8unorm" },
  );
  throw new Error("device-lost compute should reject renderer creation");
} catch (error) {
  assert(
    error instanceof Error && /device-lost/.test(error.message),
    "renderer creation fails closed on compute device loss",
  );
}
