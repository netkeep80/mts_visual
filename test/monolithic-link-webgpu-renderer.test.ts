import {
  MONOLITHIC_LINK_WEBGPU_RENDER_WGSL,
  createMonolithicLinkWebGpuZeroCopyRenderer3D,
  type MonolithicLinkWebGpuCompute3D,
  type MonolithicLinkWebGpuShape3D,
  type WebGpuBufferLike,
  type WebGpuRenderDeviceLike,
} from "../src/webgpu/index.js";
import {
  buildOctahedralLinkTopology3D,
  getMonolithicLinkSpringTemplate3D,
  type VisualLinkNetwork,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error("@mts/visual v0.5/#92 monolithic renderer: " + message);
  }
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(
    Object.is(actual, expected),
    message + ": " + String(actual) + " !== " + String(expected),
  );
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
    throw new Error("renderer test must not map");
  }

  getMappedRange(): ArrayBuffer {
    throw new Error("renderer test must not map");
  }

  unmap(): void {
    throw new Error("renderer test must not unmap");
  }
}

class FakeQueue {
  readonly writes: { label: string; bytes: number }[] = [];
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
  readonly firstInstance: number;
}

class FakeRenderDevice implements WebGpuRenderDeviceLike {
  readonly queue = new FakeQueue();
  readonly buffers: FakeBuffer[] = [];
  readonly bindGroups: {
    readonly label: string;
    readonly entries: readonly object[];
  }[] = [];
  readonly bindGroupLayouts: {
    readonly label: string;
    readonly entries: readonly {
      readonly binding?: number;
      readonly visibility?: number;
    }[];
  }[] = [];
  readonly draws: DrawRecord[] = [];
  readonly pipelineDescriptors: {
    readonly label: string;
    readonly fragmentEntryPoint: string;
    readonly primitiveTopology: string | null;
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
    const buffer = new FakeBuffer(
      descriptor.size,
      descriptor.label ?? "",
    );
    this.buffers.push(buffer);
    return buffer;
  }

  createShaderModule(descriptor: {
    readonly label?: string;
    readonly code: string;
  }): object {
    return descriptor;
  }

  createBindGroupLayout(descriptor: {
    readonly label?: string;
    readonly entries: readonly {
      readonly binding?: number;
      readonly visibility?: number;
    }[];
  }): object {
    this.bindGroupLayouts.push({
      label: descriptor.label ?? "",
      entries: descriptor.entries,
    });
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
    readonly primitive?: {
      readonly topology?: string;
    };
    readonly depthStencil?: {
      readonly depthWriteEnabled?: boolean;
      readonly depthCompare?: string;
    };
  }): Promise<{ readonly label?: string }> {
    this.pipelineDescriptors.push({
      label: descriptor.label ?? "",
      fragmentEntryPoint: descriptor.fragment.entryPoint,
      primitiveTopology: descriptor.primitive?.topology ?? null,
      ...(descriptor.depthStencil === undefined
        ? {}
        : { depthStencil: descriptor.depthStencil }),
    });
    return descriptor.label === undefined
      ? {}
      : { label: descriptor.label };
  }

  createBindGroup(descriptor: {
    readonly label?: string;
    readonly layout: object;
    readonly entries: readonly object[];
  }): object {
    const group = {
      label: descriptor.label ?? "",
      entries: descriptor.entries,
    };
    this.bindGroups.push(group);
    return group;
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
          draw(
            vertexCount: number,
            instanceCount = 1,
            _firstVertex = 0,
            firstInstance = 0,
          ) {
            device.draws.push({
              pipeline,
              vertexCount,
              instanceCount,
              firstInstance,
            });
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
const topology = buildOctahedralLinkTopology3D(network);
const template = getMonolithicLinkSpringTemplate3D(Math.SQRT2);

function fakeCompute(): MonolithicLinkWebGpuCompute3D {
  const centerBuffer = new FakeBuffer(
    topology.linkCount * 16,
    "monolithic-link-centers",
  );
  const velocityBuffer = new FakeBuffer(
    topology.linkCount * 16,
    "monolithic-link-velocities",
  );
  const forceBuffer = new FakeBuffer(
    topology.linkCount * 3 * 16,
    "monolithic-link-force-contributions",
  );
  let destroyed = false;

  return {
    topology,
    centerBuffer,
    velocityBuffer,
    linkForceBuffer: forceBuffer,
    restLength: template.restLength,
    stretchStiffness: 5,
    straighteningStiffness: 2,
    nonlinearity: 0,
    centerMass: 1,
    dampingRate: 1.5,
    simulationSpeed: 1,
    setStretchStiffness() {},
    setStraighteningStiffness() {},
    setNonlinearity() {},
    setCenterMass() {},
    setDampingRate() {},
    setSimulationSpeed() {},
    step() {
      return {
        linkForceDispatches: 1,
        gatherIntegrateDispatches: 1,
        computePasses: 2,
        dynamicStateUploadBytes: 0 as const,
      };
    },
    writeCenterOverrides() {
      return {
        linkCount: 0,
        bufferWrites: 0,
        centerBytes: 0,
        velocityBytes: 0,
      };
    },
    async readBackState() {
      throw new Error("zero-copy renderer must not read back physics");
    },
    snapshot() {
      return {
        status: destroyed ? "destroyed" as const : "available" as const,
        deviceLostReason: null,
        linkCount: topology.linkCount,
        centerBytes: topology.linkCount * 16,
        velocityBytes: topology.linkCount * 16,
        linkForceBytes: topology.linkCount * 3 * 16,
        topologyBytes: topology.linkCount * 2 * 4,
        stretchStiffness: 5,
        straighteningStiffness: 2,
        nonlinearity: 0,
        centerMass: 1,
        dampingRate: 1.5,
        simulationSpeed: 1,
        restLength: template.restLength,
      };
    },
    destroy() {
      destroyed = true;
    },
  };
}

function fakeShape(
  compute: MonolithicLinkWebGpuCompute3D,
): MonolithicLinkWebGpuShape3D {
  const parameterBuffer = new FakeBuffer(
    topology.linkCount * 16,
    "monolithic-link-shape-parameters",
  );
  const gaugeBuffer = new FakeBuffer(
    topology.linkCount * 16,
    "monolithic-link-roll-gauge",
  );
  const detailLinkIndexBuffer = new FakeBuffer(
    topology.linkCount * 4,
    "monolithic-link-detail-indices",
  );
  const sectionFrameBuffer = new FakeBuffer(
    topology.linkCount * (template.octahedronCount + 1) * 16,
    "monolithic-link-section-frames",
  );
  let destroyed = false;
  let detailCount = topology.linkCount;
  return {
    compute,
    template,
    parameterBuffer,
    gaugeBuffer,
    detailLinkIndexBuffer,
    sectionFrameBuffer,
    setDetailLinkIndices(indices) {
      detailCount = indices.length;
      return {
        detailedLinkCount: detailCount,
        detailCapacity: topology.linkCount,
        indexUploadBytes: indices.length * 4,
        globalsUploadBytes: 32,
      };
    },
    update() {
      return {
        compactDispatches: 1,
        detailDispatches: detailCount > 0 ? 1 : 0,
        dispatches: detailCount > 0 ? 2 : 1,
        computePasses: detailCount > 0 ? 2 : 1,
        detailedLinkCount: detailCount,
        dynamicStateUploadBytes: 0 as const,
      };
    },
    snapshot() {
      const detailLinkIndexBytes = topology.linkCount * 4;
      const sectionFrameBytes =
        topology.linkCount * (template.octahedronCount + 1) * 16;
      return {
        status: destroyed ? "destroyed" as const : "available" as const,
        linkCount: topology.linkCount,
        detailedLinkCount: detailCount,
        detailCapacity: topology.linkCount,
        octahedronCount: template.octahedronCount,
        sectionCount: template.octahedronCount + 1,
        parameterBytes: topology.linkCount * 16,
        gaugeBytes: topology.linkCount * 16,
        detailLinkIndexBytes,
        sectionFrameBytes,
        topologyBytes: topology.linkCount * 2 * 4,
        compactDynamicStateBytes: topology.linkCount * 32,
        detailDynamicStateBytes:
          detailLinkIndexBytes + sectionFrameBytes,
        dynamicStateBytes:
          topology.linkCount * 32
          + detailLinkIndexBytes
          + sectionFrameBytes,
      };
    },
    destroy() {
      destroyed = true;
      parameterBuffer.destroy();
      gaugeBuffer.destroy();
      detailLinkIndexBuffer.destroy();
      sectionFrameBuffer.destroy();
    },
  };
}

for (const needle of [
  "@group(0) @binding(0) var<storage, read> semantic_centers",
  "@group(0) @binding(1) var<storage, read> shape_parameters",
  "@group(0) @binding(2) var<storage, read> roll_gauge",
  "@group(0) @binding(3) var<storage, read> section_frames",
  "@group(0) @binding(4) var<storage, read> detail_link_indices",
  "fn sample_section",
  "detail_slot * scene.counts.w + section",
  "let link = detail_link_indices[detail_slot];",
  "let twist = select(0.0, PI / 3.0, (section & 1u) == 1u);",
  "if (params.z > 0.5 && params.w <= 0.5)",
  "shared_direction = second_direction;",
  "else if (params.w > 0.5 && params.z <= 0.5)",
  "shared_direction = first_direction;",
  "fn ordinary_sample",
  "fn self_sample",
  "let hinge_opening = PI * t * (1.0 - t);",
  "+ PI * (1.0 - 2.0 * t),",
  "let center = semantic_centers[instance_index].xyz;",
  "let tip = section_center(instance_index, end_section);",
  "fn link_gradient(t_value: f32)",
  "return vec3<f32>(1.0 - u, u, 0.0);",
  "return vec3<f32>(0.0, 1.0 - u, u);",
  "fn center_ico_child_vertex",
  "let child_triangle = line_index / 3u;",
  "let radius = 2.0 * scene.geometry.x * scene.viewport.z;",
  "let base_radius = 2.0 * scene.geometry.x * marker_scale;",
  "let height = 8.0 * scene.geometry.x * marker_scale;",
  "fn fragment_surface",
  "if (scene.shape.y < 0.5)",
]) {
  assert(
    MONOLITHIC_LINK_WEBGPU_RENDER_WGSL.includes(needle),
    "shader contains " + needle,
  );
}

assert(
  !/orientation|quaternion|angular_velocity|omega/i.test(
    MONOLITHIC_LINK_WEBGPU_RENDER_WGSL,
  ),
  "renderer contains no per-section physical rotation state",
);
assert(
  !MONOLITHIC_LINK_WEBGPU_RENDER_WGSL.includes(
    "f32(section) / f32(scene.counts.z)",
  ),
  "renderer does not use raw curve parameter as arc-length section coordinate",
);
assert(
  !MONOLITHIC_LINK_WEBGPU_RENDER_WGSL.includes(
    "f32(section) * PI / 3.0",
  ),
  "renderer does not cumulatively relabel octahedral triangle corners",
);

const compute = fakeCompute();
const shape = fakeShape(compute);
const device = new FakeRenderDevice();
const renderer = await createMonolithicLinkWebGpuZeroCopyRenderer3D(
  device,
  compute,
  shape,
  {
    colorFormat: "bgra8unorm",
    depthFormat: "depth24plus",
  },
);

same(
  renderer.semanticCenterBuffer,
  compute.centerBuffer,
  "renderer shares exact semantic CENTER buffer",
);
same(
  renderer.shapeParameterBuffer,
  shape.parameterBuffer,
  "renderer shares exact compact shape-parameter buffer",
);
same(
  renderer.shapeGaugeBuffer,
  shape.gaugeBuffer,
  "renderer shares exact persistent roll-gauge buffer",
);
same(
  renderer.shapeDetailLinkIndexBuffer,
  shape.detailLinkIndexBuffer,
  "renderer shares exact detail-slot to semantic-Link mapping buffer",
);
same(
  renderer.shapeSectionFrameBuffer,
  shape.sectionFrameBuffer,
  "renderer shares exact GPU-derived arc/frame buffer",
);

const renderLayout = device.bindGroupLayouts.find(
  (entry) => entry.label === "monolithic-link-render-layout",
);
assert(renderLayout !== undefined, "render bind-group layout captured");
const sceneUniformBinding = renderLayout.entries.find(
  (entry) => entry.binding === 8,
);
assert(sceneUniformBinding !== undefined, "scene uniform binding 8 exists");
same(
  sceneUniformBinding.visibility,
  0x0001 | 0x0002,
  "scene uniforms are visible to both vertex and fragment stages",
);

const surfacePipeline = device.pipelineDescriptors.find(
  (entry) => entry.label === "monolithic-link-surface-pipeline",
);
const centerPipeline = device.pipelineDescriptors.find(
  (entry) => entry.label === "monolithic-link-center-pipeline",
);
const arrowPipeline = device.pipelineDescriptors.find(
  (entry) => entry.label === "monolithic-link-arrow-pipeline",
);
const wireframePipeline = device.pipelineDescriptors.find(
  (entry) => entry.label === "monolithic-link-wireframe-pipeline",
);
assert(surfacePipeline !== undefined, "surface pipeline captured");
assert(centerPipeline !== undefined, "CENTER pipeline captured");
assert(arrowPipeline !== undefined, "END arrow pipeline captured");
assert(wireframePipeline !== undefined, "wireframe pipeline captured");
same(
  surfacePipeline.fragmentEntryPoint,
  "fragment_surface",
  "filled material uses normal-aware fragment shading",
);
same(
  wireframePipeline.fragmentEntryPoint,
  "fragment_unlit",
  "wireframe material remains unlit",
);
same(
  centerPipeline.primitiveTopology,
  "line-list",
  "CENTER L2 icosahedron is wireframe-only",
);
same(
  arrowPipeline.primitiveTopology,
  "line-list",
  "END cone is wireframe-only",
);
same(
  surfacePipeline.depthStencil?.depthWriteEnabled,
  true,
  "material writes depth",
);
same(
  centerPipeline.depthStencil?.depthWriteEnabled,
  false,
  "CENTER remains overlay",
);
same(
  centerPipeline.depthStencil?.depthCompare,
  "always",
  "CENTER remains visible through material",
);

const bind = device.bindGroups.find(
  (entry) => entry.label === "monolithic-link-surface-bind",
);
assert(bind !== undefined, "surface bind group exists");
const bound = bind.entries.map(
  (entry) =>
    (entry as { resource?: { buffer?: WebGpuBufferLike } })
      .resource?.buffer,
);
same(bound[0], compute.centerBuffer, "binding 0 is semantic CENTER buffer");
same(bound[1], shape.parameterBuffer, "binding 1 is compact shape buffer");
same(bound[2], shape.gaugeBuffer, "binding 2 is persistent roll gauge");
same(bound[3], shape.sectionFrameBuffer, "binding 3 is derived section frame buffer");
same(bound[4], shape.detailLinkIndexBuffer, "binding 4 is detail-slot mapping buffer");

const identity = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

device.resetFrame();
const stats = renderer.render({
  targetView: {},
  depthView: {},
  viewProjection: identity,
  width: 1280,
  height: 720,
  wireframe: false,
  hoveredCenterLink: 1,
  smoothNormals: false,
});

same(stats.linkCount, 2, "renderer keeps full semantic Link count");
same(stats.detailedLinkCount, 2, "renderer draws only active detail slots");
same(stats.drawCalls, 3, "filled frame uses material + hovered CENTER + END");
same(stats.dynamicStateUploadBytes, 0, "frame uploads no dynamic state");
same(stats.bufferCopies, 0, "frame performs no buffer copies");
same(stats.readbacks, 0, "frame performs no readbacks");
same(device.draws.length, 3, "device sees exactly three draws");
same(device.draws[0]!.instanceCount, 2, "material draw is instanced per Link");
same(
  device.draws[1]!.vertexCount,
  80 * 3 * 2,
  "CENTER is L2 wireframe icosahedron with 80 subdivided triangles",
);
same(
  device.draws[1]!.instanceCount,
  1,
  "only the hovered CENTER handle is drawn",
);
same(
  device.draws[1]!.firstInstance,
  1,
  "hovered CENTER draw addresses the selected semantic Link",
);
same(
  device.draws[2]!.vertexCount,
  12 * 4,
  "END is a 12-segment wireframe cone",
);
same(device.queue.writes.length, 1, "frame writes only renderer uniforms");
same(
  device.queue.writes[0]!.label,
  "monolithic-render-uniforms",
  "control write targets uniform buffer only",
);
same(
  device.queue.writes[0]!.bytes,
  128,
  "renderer uniform upload has fixed size",
);

device.resetFrame();
const noMarkers = renderer.render({
  targetView: {},
  depthView: {},
  viewProjection: identity,
  width: 1280,
  height: 720,
  wireframe: true,
  showCenterMarkers: false,
  showEndCones: false,
  hoveredCenterLink: 0,
  centerMarkerScale: 2,
  endConeScale: 3,
});
same(noMarkers.drawCalls, 1, "hidden marker layers leave one material draw");
same(noMarkers.centerVertexInvocations, 0, "hidden CENTER performs no work");
same(noMarkers.arrowVertexInvocations, 0, "hidden END performs no work");
same(device.draws.length, 1, "wireframe-only frame is one draw");

device.resetFrame();
const noHover = renderer.render({
  targetView: {},
  depthView: {},
  viewProjection: identity,
  width: 1280,
  height: 720,
  wireframe: false,
  showCenterMarkers: true,
  showEndCones: false,
  hoveredCenterLink: -1,
});
same(
  noHover.drawCalls,
  1,
  "CENTER overlay is absent until the two-octa neighborhood is hovered",
);
same(
  noHover.centerVertexInvocations,
  0,
  "non-hovered CENTER performs no overlay work",
);

const snapshot = renderer.snapshot();
same(snapshot.linkCount, 2, "snapshot retains semantic Link count");
same(snapshot.detailedLinkCount, 2, "snapshot reports active detail slots");
same(snapshot.detailCapacity, 2, "snapshot reports bounded detail capacity");
same(snapshot.sharedSemanticCenterBuffer, true, "snapshot proves semantic centers are shared");
same(snapshot.sharedShapeParameterBuffer, true, "snapshot proves shape parameters are shared");
same(snapshot.rendererDynamicStateBytes, 0, "renderer owns zero dynamic duplicate state");
same(snapshot.dynamicStateUploadBytesPerFrame, 0, "ordinary frame uploads zero dynamic state");
same(snapshot.octahedronCount, 2, "minimum fixture is two octahedra");
same(snapshot.sectionCount, 3, "two octahedra expose three connecting triangles");

shape.setDetailLinkIndices([1]);
device.resetFrame();
const oneDetail = renderer.render({
  targetView: {},
  depthView: {},
  viewProjection: identity,
  width: 1280,
  height: 720,
  wireframe: false,
  showCenterMarkers: false,
  showEndCones: true,
});
same(oneDetail.linkCount, 2, "detail filtering does not change semantic Link count");
same(oneDetail.detailedLinkCount, 1, "renderer follows live detail-slot selection");
same(device.draws[0]!.instanceCount, 1, "surface draw uses detail-slot count");
same(device.draws[1]!.instanceCount, 1, "END draw uses detail-slot count");

renderer.destroy();
same(renderer.snapshot().status, "destroyed", "renderer destroy updates status");

console.log(
  "[v0.6 #153 bounded-detail renderer] PASS links="
  + snapshot.linkCount
  + " octa="
  + snapshot.octahedronCount
  + " draws="
  + stats.drawCalls,
);
