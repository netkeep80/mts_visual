import {
  RIGID_SECTION_WEBGPU_RENDER_UNIFORM_BYTES,
  RIGID_SECTION_WEBGPU_RENDER_WGSL,
  createRigidSectionWebGpuZeroCopyRenderer3D,
  estimateRigidSectionWebGpuRender3D,
  type RigidSectionWebGpuCompute3D,
  type WebGpuBufferLike,
  type WebGpuRenderDeviceLike,
} from "../src/webgpu/index.js";
import {
  buildOctahedralLinkTopology3D,
  getRigidSectionTemplate3D,
  type VisualLinkNetwork,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual v0.5/P4 renderer: ${message}`);
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

  async mapAsync(): Promise<void> {
    throw new Error("rigid renderer test must not map GPU state");
  }

  getMappedRange(): ArrayBuffer {
    throw new Error("rigid renderer test must not read mapped GPU state");
  }

  unmap(): void {
    throw new Error("rigid renderer test must not unmap GPU state");
  }
}

class FakeQueue {
  readonly writes: { readonly label: string; readonly bytes: number }[] = [];
  submissions = 0;

  writeBuffer(
    buffer: WebGpuBufferLike,
    _offset: number,
    data: ArrayBuffer | ArrayBufferView,
    _dataOffset?: number,
    size?: number,
  ): void {
    this.writes.push({
      label: buffer.label ?? "",
      bytes: size ?? data.byteLength,
    });
  }

  submit(_buffers: readonly object[]): void {
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
  readonly queue = new FakeQueue();
  readonly buffers: FakeBuffer[] = [];
  readonly bindGroups: { readonly label: string; readonly entries: readonly object[] }[] = [];
  readonly draws: DrawRecord[] = [];
  readonly pipelineDescriptors: {
    readonly label: string;
    readonly depthStencil?: {
      readonly depthWriteEnabled?: boolean;
      readonly depthCompare?: string;
    };
  }[] = [];

  createBuffer(descriptor: {
    readonly label?: string;
    readonly size: number;
    readonly usage: number;
  }): FakeBuffer {
    const result = new FakeBuffer(descriptor.size, descriptor.label ?? "");
    this.buffers.push(result);
    return result;
  }

  createShaderModule(descriptor: {
    readonly label?: string;
    readonly code: string;
  }): object {
    return descriptor;
  }

  createBindGroupLayout(descriptor: {
    readonly label?: string;
    readonly entries: readonly object[];
  }): object {
    return descriptor;
  }

  createPipelineLayout(descriptor: {
    readonly label?: string;
    readonly bindGroupLayouts: readonly object[];
  }): object {
    return descriptor;
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
    readonly depthStencil?: {
      readonly depthWriteEnabled?: boolean;
      readonly depthCompare?: string;
    };
  }): Promise<{ readonly label?: string }> {
    this.pipelineDescriptors.push({
      label: descriptor.label ?? "",
      ...(descriptor.depthStencil === undefined
        ? {}
        : { depthStencil: descriptor.depthStencil }),
    });
    return descriptor.label === undefined ? {} : { label: descriptor.label };
  }

  createBindGroup(descriptor: {
    readonly label?: string;
    readonly layout: object;
    readonly entries: readonly object[];
  }): object {
    const result = {
      label: descriptor.label ?? "",
      entries: descriptor.entries,
    };
    this.bindGroups.push(result);
    return result;
  }

  createCommandEncoder() {
    const device = this;
    return {
      beginRenderPass() {
        let pipeline = "";
        return {
          setPipeline(value: { readonly label?: string }) {
            pipeline = value.label ?? "";
          },
          setBindGroup(_index: number, _group: object) {},
          draw(vertexCount: number, instanceCount = 1) {
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
  }
}

const network: VisualLinkNetwork = {
  links: [
    { key: "R", startKey: "R", endKey: "R" },
    { key: "O", startKey: "O", endKey: "R" },
  ],
};

function fakeCompute(): RigidSectionWebGpuCompute3D {
  const topology = buildOctahedralLinkTopology3D(network);
  const template = getRigidSectionTemplate3D(Math.SQRT2);
  const bodyCount = topology.linkCount * template.sectionCount;
  const centerBytes = bodyCount * 4 * 4;
  const orientationBytes = bodyCount * 4 * 4;
  const velocityBytes = bodyCount * 4 * 4;
  const angularVelocityBytes = bodyCount * 4 * 4;
  const centerBuffer = new FakeBuffer(centerBytes, "rigid-section-centers");
  const orientationBuffer = new FakeBuffer(orientationBytes, "rigid-section-orientations");
  const linearVelocityBuffer = new FakeBuffer(velocityBytes, "rigid-section-linear-velocities");
  const angularVelocityBuffer = new FakeBuffer(angularVelocityBytes, "rigid-section-angular-velocities");
  let destroyed = false;

  return {
    topology,
    template,
    centerBuffer,
    orientationBuffer,
    linearVelocityBuffer,
    angularVelocityBuffer,
    stiffness: 5,
    longitudinalStiffness: 5,
    transverseStiffness: 5,
    nonlinearity: 0,
    nodeMass: 1,
    linearDampingRate: 1.5,
    angularDampingRate: 1.5,
    simulationSpeed: 1,
    step: () => ({
      relationBatchDispatches: 2,
      hingeDispatches: 2,
      computePasses: 6,
      dynamicStateUploadBytes: 0,
    }),
    setStiffness: () => {},
    setLongitudinalStiffness: () => {},
    setTransverseStiffness: () => {},
    setNonlinearity: () => {},
    setNodeMass: () => {},
    setLinearDampingRate: () => {},
    setAngularDampingRate: () => {},
    setSimulationSpeed: () => {},
    writeCenterOverrides: () => ({
      bodyCount: 0,
      bufferWrites: 0,
      centerBytes: 0,
      velocityBytes: 0,
    }),
    readBackCenters: async () => {
      throw new Error("zero-copy renderer test must never read back centers");
    },
    readBackState: async () => {
      throw new Error("zero-copy renderer test must never read back compute state");
    },
    snapshot: () => ({
      status: destroyed ? "destroyed" : "available",
      deviceLostReason: null,
      linkCount: topology.linkCount,
      sectionCount: template.sectionCount,
      bodyCount,
      centerBytes,
      orientationBytes,
      velocityBytes,
      angularVelocityBytes,
      forceBytes: bodyCount * 4 * 4,
      torqueBytes: bodyCount * 4 * 4,
      stiffness: 5,
      longitudinalStiffness: 5,
      transverseStiffness: 5,
      nonlinearity: 0,
      nodeMass: 1,
      linearDampingRate: 1.5,
      angularDampingRate: 1.5,
      simulationSpeed: 1,
    }),
    destroy: () => {
      destroyed = true;
      centerBuffer.destroy();
      orientationBuffer.destroy();
      linearVelocityBuffer.destroy();
      angularVelocityBuffer.destroy();
    },
  };
}

const compute = fakeCompute();
same(compute.template.octahedronCount, 2, "fixture uses minimum two-octa rigid body");
same(compute.template.sectionCount, 3, "two octahedra have three rigid triangular sections");

const million = estimateRigidSectionWebGpuRender3D(1_000_000, compute.template);
same(million.surfaceVerticesPerLink, 42, "two-octa capless rigid surface uses 42 triangle-list vertices");
same(million.surfaceVertexInvocations, 42_000_000, "million rigid Links imply 42M surface vertex invocations");
same(million.centerVertexInvocations, 60_000_000, "million rigid Links imply 60M solid CENTER icosahedron vertices");
same(million.arrowVertexInvocations, 18_000_000, "million rigid Links imply 18M six-sided END cone vertices");
same(million.drawCalls, 3, "non-empty rigid renderer stays at three draw calls");
same(million.rendererDynamicStateBytes, 0, "renderer owns zero duplicated dynamic rigid state");
same(million.dynamicStateUploadBytesPerFrame, 0, "ordinary rigid frames upload zero dynamic state");

for (const needle of [
  "@group(0) @binding(0) var<storage, read> centers",
  "@group(0) @binding(1) var<storage, read> orientations",
  "fn material_vertex",
  "q_rotate(orientations[body], local_triangle_vertex(corner))",
  "let radius = 2.0 * scene.geometry.w * scene.viewport.z;",
  "let axis = safe_normalize3(",
  "tip - lower_center",
  "let marker_scale = scene.viewport.w;",
  "let height = 3.0 * edge * marker_scale;",
  "let base_radius = 1.5 * edge * marker_scale;",
]) {
  assert(
    RIGID_SECTION_WEBGPU_RENDER_WGSL.includes(needle),
    `rigid renderer shader contains ${needle}`,
  );
}
assert(
  !RIGID_SECTION_WEBGPU_RENDER_WGSL.includes("projected_pixel_distance"),
  "CENTER and END marker size no longer depends on projected pixel scale",
);

const device = new FakeRenderDevice();
const renderer = await createRigidSectionWebGpuZeroCopyRenderer3D(
  device,
  compute,
  {
    colorFormat: "bgra8unorm",
    depthFormat: "depth24plus",
  },
);

same(renderer.centerBuffer, compute.centerBuffer, "renderer shares exact compute centerBuffer");
same(renderer.orientationBuffer, compute.orientationBuffer, "renderer shares exact compute orientationBuffer");

const surfacePipelineDescriptor = device.pipelineDescriptors.find(
  (descriptor) => descriptor.label === "rigid-section-webgpu-surface-pipeline",
);
const centerPipelineDescriptor = device.pipelineDescriptors.find(
  (descriptor) => descriptor.label === "rigid-section-webgpu-center-pipeline",
);
const arrowPipelineDescriptor = device.pipelineDescriptors.find(
  (descriptor) => descriptor.label === "rigid-section-webgpu-arrow-pipeline",
);
assert(surfacePipelineDescriptor !== undefined, "surface pipeline descriptor captured");
assert(centerPipelineDescriptor !== undefined, "CENTER pipeline descriptor captured");
assert(arrowPipelineDescriptor !== undefined, "END pipeline descriptor captured");
same(
  surfacePipelineDescriptor.depthStencil?.depthWriteEnabled,
  true,
  "material surface remains depth-writing",
);
same(
  surfacePipelineDescriptor.depthStencil?.depthCompare,
  "less-equal",
  "material surface remains normally depth-tested",
);
same(
  centerPipelineDescriptor.depthStencil?.depthWriteEnabled,
  false,
  "CENTER handle is an overlay and cannot disappear inside the Link surface",
);
same(
  centerPipelineDescriptor.depthStencil?.depthCompare,
  "always",
  "CENTER handle remains visible through material depth",
);
same(
  arrowPipelineDescriptor.depthStencil?.depthWriteEnabled,
  false,
  "END marker is also a non-destructive overlay",
);
same(
  arrowPipelineDescriptor.depthStencil?.depthCompare,
  "always",
  "END marker remains visible through material depth",
);

const bindGroup = device.bindGroups.find(
  (group) => group.label === "rigid-section-webgpu-zero-copy-render-bind-group",
);
assert(bindGroup !== undefined, "renderer creates rigid zero-copy bind group");
const storageBuffers = bindGroup.entries
  .slice(0, 2)
  .map((entry) => (entry as { resource?: { buffer?: WebGpuBufferLike } }).resource?.buffer);
same(storageBuffers[0], compute.centerBuffer, "binding 0 is exact compute centerBuffer");
same(storageBuffers[1], compute.orientationBuffer, "binding 1 is exact compute orientationBuffer");

device.resetFrame();
const identity = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);
const stats = renderer.render({
  targetView: {},
  depthView: {},
  viewProjection: identity,
  width: 1280,
  height: 720,
  wireframe: false,
});

same(stats.drawCalls, 3, "filled rigid frame uses surface + center + arrow draws");
same(stats.dynamicStateUploadBytes, 0, "filled rigid frame uploads no dynamic state");
same(stats.bufferCopies, 0, "filled rigid frame performs no buffer copies");
same(stats.readbacks, 0, "filled rigid frame performs no readbacks");
same(device.draws.length, 3, "device sees exactly three filled draws");
same(device.draws[0]!.vertexCount, 42, "surface draw reconstructs capless two-octa material");
same(device.draws[0]!.instanceCount, 2, "surface draw instances equal semantic Link count");
same(device.draws[1]!.vertexCount, 60, "CENTER marker is one solid 20-triangle icosahedron per Link");
same(device.draws[2]!.vertexCount, 18, "END marker is one six-triangle cone per Link");
same(device.queue.writes.length, 1, "ordinary frame writes only renderer control uniforms");
same(device.queue.writes[0]!.label, "rigid-section-render-uniforms", "ordinary control upload targets only uniform buffer");
same(device.queue.writes[0]!.bytes, RIGID_SECTION_WEBGPU_RENDER_UNIFORM_BYTES, "uniform upload has fixed size");

const snapshot = renderer.snapshot();
same(snapshot.sharedCenterBuffer, true, "snapshot proves center state is shared");
same(snapshot.sharedOrientationBuffer, true, "snapshot proves orientation state is shared");
same(snapshot.dynamicStateUploadBytesPerFrame, 0, "snapshot proves zero dynamic upload");
assert(snapshot.wireframeVerticesPerLink > 0, "wireframe topology is cached");

device.resetFrame();
const wireStats = renderer.render({
  targetView: {},
  depthView: {},
  viewProjection: identity,
  width: 1280,
  height: 720,
  wireframe: true,
});
same(wireStats.drawCalls, 3, "wireframe rigid frame preserves diagnostics draws");
same(device.draws[0]!.vertexCount, snapshot.wireframeVerticesPerLink, "wireframe draw uses cached line-list topology");

device.resetFrame();
const noCenterStats = renderer.render({
  targetView: {},
  depthView: {},
  viewProjection: identity,
  width: 1280,
  height: 720,
  showCenterMarkers: false,
  showEndCones: true,
  centerMarkerScale: 0.25,
  endConeScale: 8,
});
same(noCenterStats.drawCalls, 2, "hidden CENTER layer skips its instanced draw call");
same(noCenterStats.centerVertexInvocations, 0, "hidden CENTER layer reports zero CENTER vertex invocations");
same(noCenterStats.arrowVertexInvocations, 36, "visible END layer still renders both Link instances");
same(device.draws.length, 2, "device sees surface + END only when CENTER is hidden");
same(device.draws[1]!.pipeline, "rigid-section-webgpu-arrow-pipeline", "remaining diagnostic draw is END cone");

device.resetFrame();
const noMarkersStats = renderer.render({
  targetView: {},
  depthView: {},
  viewProjection: identity,
  width: 1280,
  height: 720,
  showCenterMarkers: false,
  showEndCones: false,
  centerMarkerScale: 8,
  endConeScale: 0.25,
});
same(noMarkersStats.drawCalls, 1, "hiding both marker layers leaves only material draw");
same(noMarkersStats.centerVertexInvocations, 0, "hidden CENTER layer performs no marker work");
same(noMarkersStats.arrowVertexInvocations, 0, "hidden END layer performs no marker work");
same(device.draws.length, 1, "device sees exactly one draw when both markers are disabled");

try {
  renderer.render({
    targetView: {},
    depthView: {},
    viewProjection: identity,
    width: 1280,
    height: 720,
    centerMarkerScale: 0,
  });
  throw new Error("zero CENTER scale should reject");
} catch (error) {
  assert(
    error instanceof Error && /centerMarkerScale/.test(error.message),
    "CENTER scale must remain positive",
  );
}

const centerBeforeDestroy = compute.centerBuffer as FakeBuffer;
const orientationBeforeDestroy = compute.orientationBuffer as FakeBuffer;
renderer.destroy();
assert(!centerBeforeDestroy.destroyed, "destroying renderer does not destroy shared centerBuffer");
assert(!orientationBeforeDestroy.destroyed, "destroying renderer does not destroy shared orientationBuffer");
for (const buffer of device.buffers) {
  assert(buffer.destroyed, `renderer-owned buffer ${buffer.label} is destroyed`);
}

console.log(
  `[v0.5 P4 rigid renderer] PASS links=${compute.topology.linkCount} `
  + `surface=${million.surfaceVerticesPerLink} wire=${snapshot.wireframeVerticesPerLink} `
  + `draws=${stats.drawCalls} zeroUpload=${stats.dynamicStateUploadBytes}`,
);
