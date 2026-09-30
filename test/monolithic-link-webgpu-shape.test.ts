import {
  buildOctahedralLinkTopology3D,
} from "../src/octahedral-link3d.js";
import type { VisualLinkNetwork } from "../src/index.js";
import {
  MONOLITHIC_LINK_SHAPE_PARAMETER_WGSL,
  createMonolithicLinkWebGpuShape3D,
  type MonolithicLinkWebGpuCompute3D,
  type WebGpuBufferLike,
  type WebGpuDeviceLike,
} from "../src/webgpu/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`@mts/visual v0.5/#92 monolithic GPU shape: ${message}`);
  }
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(
    Object.is(actual, expected),
    `${message}: ${String(actual)} !== ${String(expected)}`,
  );
}

class FakeBuffer implements WebGpuBufferLike {
  readonly bytes: ArrayBuffer;
  destroyed = false;

  constructor(readonly size: number, readonly label = "") {
    this.bytes = new ArrayBuffer(size);
  }

  destroy(): void {
    this.destroyed = true;
  }

  async mapAsync(_mode: number, _offset?: number, _size?: number): Promise<void> {}

  getMappedRange(offset = 0, size = this.size - offset): ArrayBuffer {
    return this.bytes.slice(offset, offset + size);
  }

  unmap(): void {}
}

class FakeQueue {
  readonly writes: { label: string; bytes: number; offset: number }[] = [];
  submissions = 0;

  writeBuffer(
    buffer: WebGpuBufferLike,
    bufferOffset: number,
    data: ArrayBuffer | ArrayBufferView,
    dataOffset = 0,
    size?: number,
  ): void {
    const source = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const byteLength = size ?? source.byteLength - dataOffset;
    new Uint8Array((buffer as FakeBuffer).bytes).set(
      source.subarray(dataOffset, dataOffset + byteLength),
      bufferOffset,
    );
    this.writes.push({
      label: buffer.label ?? "",
      bytes: byteLength,
      offset: bufferOffset,
    });
  }

  submit(_commandBuffers: readonly object[]): void {
    this.submissions += 1;
  }
}

class FakeDevice implements WebGpuDeviceLike {
  readonly queue = new FakeQueue();
  readonly buffers: FakeBuffer[] = [];
  readonly dispatches: {
    entryPoint: string;
    x: number;
    y: number;
    z: number;
  }[] = [];
  readonly limits = {
    maxComputeWorkgroupsPerDimension: 65_535,
    maxStorageBufferBindingSize: 256 * 1024 * 1024,
    maxStorageBuffersPerShaderStage: 8,
  };

  createBuffer(descriptor: {
    readonly label?: string;
    readonly size: number;
    readonly usage: number;
    readonly mappedAtCreation?: boolean;
  }): FakeBuffer {
    const buffer = new FakeBuffer(descriptor.size, descriptor.label ?? "");
    this.buffers.push(buffer);
    return buffer;
  }

  createShaderModule(descriptor: {
    readonly label?: string;
    readonly code: string;
  }) {
    return {
      label: descriptor.label,
      code: descriptor.code,
      async getCompilationInfo() {
        return { messages: [] };
      },
    };
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

  async createComputePipelineAsync(descriptor: {
    readonly label?: string;
    readonly layout: object;
    readonly compute: {
      readonly module: object;
      readonly entryPoint: string;
    };
  }): Promise<{ readonly label?: string; readonly entryPoint: string }> {
    return descriptor.label === undefined
      ? { entryPoint: descriptor.compute.entryPoint }
      : {
          label: descriptor.label,
          entryPoint: descriptor.compute.entryPoint,
        };
  }

  createBindGroup(descriptor: {
    readonly label?: string;
    readonly layout: object;
    readonly entries: readonly object[];
  }): object {
    return descriptor;
  }

  createCommandEncoder(_descriptor?: { readonly label?: string }) {
    const device = this;
    return {
      beginComputePass() {
        let entryPoint = "";
        return {
          setPipeline(pipeline: { readonly entryPoint?: string; readonly label?: string }) {
            entryPoint = pipeline.entryPoint ?? pipeline.label ?? "";
          },
          setBindGroup(_index: number, _bindGroup: object) {},
          dispatchWorkgroups(x: number, y = 1, z = 1) {
            device.dispatches.push({ entryPoint, x, y, z });
          },
          end() {},
        };
      },
      copyBufferToBuffer(
        _source: WebGpuBufferLike,
        _sourceOffset: number,
        _destination: WebGpuBufferLike,
        _destinationOffset: number,
        _size: number,
      ) {},
      finish() {
        return {};
      },
    };
  }
}

function networkOfSize(count: number): VisualLinkNetwork {
  const links = Array.from({ length: count }, (_, index) => {
    const key = `L${index}`;
    const previous = `L${index === 0 ? 0 : index - 1}`;
    const next = `L${index === count - 1 ? index : index + 1}`;
    return { key, startKey: previous, endKey: next };
  });
  return { links };
}

function fakeCompute(
  device: FakeDevice,
  network: VisualLinkNetwork,
  restLength: number,
): MonolithicLinkWebGpuCompute3D {
  const topology = buildOctahedralLinkTopology3D(network);
  const centerBuffer = device.createBuffer({
    label: "fake-semantic-centers",
    size: Math.max(4, topology.linkCount * 16),
    usage: 0,
  });
  const velocityBuffer = device.createBuffer({
    label: "fake-semantic-velocities",
    size: Math.max(4, topology.linkCount * 16),
    usage: 0,
  });
  const forceBuffer = device.createBuffer({
    label: "fake-link-forces",
    size: Math.max(4, topology.linkCount * 3 * 16),
    usage: 0,
  });

  return {
    topology,
    centerBuffer,
    velocityBuffer,
    linkForceBuffer: forceBuffer,
    restLength,
    stretchStiffness: 1,
    straighteningStiffness: 1,
    nonlinearity: 0,
    centerMass: 1,
    dampingRate: 1,
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
      return {
        centers: new Float32Array(topology.linkCount * 3),
        velocities: new Float32Array(topology.linkCount * 3),
      };
    },
    snapshot() {
      return {
        status: "available" as const,
        deviceLostReason: null,
        linkCount: topology.linkCount,
        centerBytes: topology.linkCount * 16,
        velocityBytes: topology.linkCount * 16,
        linkForceBytes: topology.linkCount * 3 * 16,
        topologyBytes: topology.linkCount * 2 * 4,
        stretchStiffness: 1,
        straighteningStiffness: 1,
        nonlinearity: 0,
        centerMass: 1,
        dampingRate: 1,
        simulationSpeed: 1,
        restLength,
      };
    },
    destroy() {},
  };
}

for (const needle of [
  "fn shape_parameter_main",
  "fn shape_detail_select_main",
  "fn detail_candidate_better",
  "fn shape_detail_main",
  "fn solve_amplitude",
  "fn half_arc_length",
  "buckling_basis_derivative",
  "for (var iteration = 0u; iteration < 24u;",
  "shape_parameters[link] = vec4<f32>(",
  "var<storage, read_write> roll_gauge",
  "var<storage, read_write> detail_link_indices",
  "var<uniform> detail_selection: DetailSelectionGlobals",
  "candidate = candidate + detail_count",
  "selected_link % detail_count == slot",
  "var<storage, read_write> section_frames",
  "fn update_roll_gauge",
  "fn curve_polyline_length",
  "fn transport_x",
  "let arc_samples = max(256u, half_segments * 8u);",
  "let frame_base = slot * section_count;",
  "if (dot(geometric, previous) < 0.0)",
  "let raw_weight = (bend_sine - 0.015) / (0.08 - 0.015);",
  "let hinge_opening = 3.141592653589793 * t * (1.0 - t);",
  "+ 3.141592653589793 * (1.0 - 2.0 * t),",
  "globals.geometry.y / 8.448334738583334",
  "if (first_self && !second_self)",
  "shared_direction = second_direction;",
  "else if (second_self && !first_self)",
  "shared_direction = first_direction;",
]) {
  assert(
    MONOLITHIC_LINK_SHAPE_PARAMETER_WGSL.includes(needle),
    `WGSL includes ${needle}`,
  );
}
same(
  [...MONOLITHIC_LINK_SHAPE_PARAMETER_WGSL.matchAll(/var<storage/g)].length,
  6,
  "shape solve exposes four global buffers plus detail index/frame cache",
);
assert(
  !/velocity|mass|damping|integrate/i.test(MONOLITHIC_LINK_SHAPE_PARAMETER_WGSL),
  "shape solve contains no physical integration state",
);

for (const reservedDeclaration of [
  "let from =",
  "let to =",
  "let target =",
]) {
  assert(
    !MONOLITHIC_LINK_SHAPE_PARAMETER_WGSL.includes(reservedDeclaration),
    `WGSL does not declare reserved identifier: ${reservedDeclaration}`,
  );
}

const aspect32 = 16 * Math.SQRT2;
const rest32 = 32 * Math.sqrt(2 / 3);
const device = new FakeDevice();
const compute = fakeCompute(device, networkOfSize(5), rest32);
const shape = await createMonolithicLinkWebGpuShape3D(
  device,
  compute,
  aspect32,
);
const snapshot = shape.snapshot();

same(snapshot.linkCount, 5, "shape owns one compact parameter record per Link");
same(snapshot.detailedLinkCount, 5, "small scene defaults to full detail");
same(snapshot.detailCapacity, 5, "small scene detail cache covers every Link");
same(snapshot.octahedronCount, 32, "shape template resolves requested octahedra");
same(snapshot.sectionCount, 33, "derived presentation has N+1 connecting triangles");
same(snapshot.parameterBytes, 5 * 16, "one vec4 shape parameter record per Link");
same(snapshot.gaugeBytes, 5 * 16, "one vec4 persistent roll gauge per Link");
same(snapshot.detailLinkIndexBytes, 5 * 4, "detail mapping stores one u32 per cache slot");
same(
  snapshot.sectionFrameBytes,
  5 * 33 * 16,
  "full-detail small scene retains one transported frame per derived section",
);
same(
  snapshot.compactDynamicStateBytes,
  5 * 32,
  "global shape state is exactly params + roll gauge",
);
same(
  snapshot.detailDynamicStateBytes,
  5 * 4 + 5 * 33 * 16,
  "detail cache state is mapping + bounded section frames",
);
same(
  snapshot.dynamicStateBytes,
  5 * 32 + 5 * 4 + 5 * 33 * 16,
  "shape dynamic state reports compact plus allocated detail cache",
);
same(shape.gaugeBuffer.size, 5 * 16, "gauge buffer is exactly one vec4 per Link");
same(shape.detailLinkIndexBuffer.size, 5 * 4, "detail mapping buffer covers all small-scene Links");
same(
  shape.sectionFrameBuffer.size,
  5 * 33 * 16,
  "small-scene section frame cache retains exact legacy extent",
);
same(shape.detailSelectionControlBuffer.size, 96, "GPU detail selector uses one fixed 96-byte uniform");
same(snapshot.selectionMode, "manual", "small full-detail scene starts in manual identity mode");
same(snapshot.selectionControlBytes, 96, "snapshot reports fixed selector control bytes");

const setupWriteCount = device.queue.writes.length;
const step = shape.update();
same(step.compactDispatches, 1, "shape update has one compact all-Link dispatch");
same(step.selectorDispatches, 0, "full-detail identity mode does not dispatch GPU selector");
same(step.detailDispatches, 1, "shape update has one bounded detail dispatch");
same(step.dispatches, 2, "shape update is split into compact + detail dispatches");
same(step.computePasses, 2, "shape update is exactly two compute passes with detail active");
same(step.selectionMode, "manual", "small full-detail update remains manual identity");
same(step.detailedLinkCount, 5, "shape step reports active detail slots");
same(step.dynamicStateUploadBytes, 0, "shape update uploads no CPU dynamic state");
same(device.queue.writes.length, setupWriteCount, "ordinary shape update performs no queue.writeBuffer");
same(device.dispatches.length, 2, "device sees compact and detail shape dispatches");
same(device.dispatches[0]!.entryPoint, "shape_parameter_main", "compact parameter kernel is first");
same(device.dispatches[1]!.entryPoint, "shape_detail_main", "detail frame kernel is second");

shape.destroy();
same(shape.snapshot().status, "destroyed", "shape destroy updates status");

const largeDevice = new FakeDevice();
const largeCompute = fakeCompute(largeDevice, networkOfSize(1000), rest32);
const largeShape = await createMonolithicLinkWebGpuShape3D(
  largeDevice,
  largeCompute,
  aspect32,
);
largeShape.update();
same(largeDevice.dispatches.length, 2, "1000 Links use compact and detail dispatches");
same(largeDevice.dispatches[0]!.x, 16, "1000 compact Links require 16 workgroups");
same(largeDevice.dispatches[0]!.y, 1, "1000-Link compact shape remains one dispatch row");
same(largeDevice.dispatches[1]!.x, 16, "1000 detail slots require 16 workgroups when fully detailed");
same(
  largeShape.snapshot().parameterBytes,
  1000 * 16,
  "1000-Link compact parameter state is 16 kB",
);
same(
  largeShape.snapshot().gaugeBytes,
  1000 * 16,
  "1000-Link roll gauge state adds only 16 kB",
);
same(
  largeShape.snapshot().sectionFrameBytes,
  1000 * 33 * 16,
  "small enough scene still defaults to full detail",
);
largeShape.destroy();

const boundedDevice = new FakeDevice();
const boundedCompute = fakeCompute(
  boundedDevice,
  networkOfSize(1000),
  rest32,
);
const boundedShape = await createMonolithicLinkWebGpuShape3D(
  boundedDevice,
  boundedCompute,
  aspect32,
  {
    detailCapacity: 7,
    detailLinkIndices: [999, 500, 0],
  },
);
const boundedSnapshot = boundedShape.snapshot();
same(boundedSnapshot.linkCount, 1000, "bounded shape retains all semantic Links");
same(boundedSnapshot.detailCapacity, 7, "detail cache capacity is independent of total Link count");
same(boundedSnapshot.detailedLinkCount, 3, "only explicit initial detail selection is active");
same(
  boundedSnapshot.sectionFrameBytes,
  7 * 33 * 16,
  "section-frame allocation follows detail capacity, not 1000 Links",
);
same(
  boundedSnapshot.compactDynamicStateBytes,
  1000 * 32,
  "global shape state remains O(LinkCount)",
);
const boundedStep = boundedShape.update();
same(boundedStep.compactDispatches, 1, "bounded shape still updates every compact Link");
same(boundedStep.selectorDispatches, 0, "explicit bounded mapping remains manual");
same(boundedStep.detailDispatches, 1, "bounded shape updates selected detail slots");
same(boundedStep.selectionMode, "manual", "explicit bounded mapping reports manual mode");
same(boundedStep.detailedLinkCount, 3, "bounded step reports selected detail slots");
same(boundedDevice.dispatches[0]!.x, 16, "bounded compact pass covers all 1000 Links");
same(boundedDevice.dispatches[1]!.x, 1, "three detailed Links need one workgroup");

const writesBeforeSelection = boundedDevice.queue.writes.length;
const selection = boundedShape.setDetailLinkIndices([2, 4]);
same(selection.detailedLinkCount, 2, "detail selection can be changed without remount");
same(selection.detailCapacity, 7, "selection does not resize cache");
same(selection.selectionMode, "manual", "CPU-provided detail mapping is explicit manual mode");
same(selection.indexUploadBytes, 2 * 4, "selection uploads only semantic Link indices");
same(selection.globalsUploadBytes, 32, "selection updates only shape globals");
same(selection.selectionControlUploadBytes, 0, "manual mapping uploads no GPU selector control");
same(
  boundedDevice.queue.writes.length,
  writesBeforeSelection + 2,
  "detail selection performs one index write and one globals write",
);
boundedDevice.dispatches.length = 0;
const selectedStep = boundedShape.update();
same(selectedStep.detailedLinkCount, 2, "next detail pass follows new selection");
same(boundedDevice.dispatches.length, 2, "compact + detail dispatch remain serialized");
same(boundedDevice.dispatches[1]!.x, 1, "two detail slots remain one workgroup");

const gpuWritesBefore = boundedDevice.queue.writes.length;
const identityView = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];
const gpuSelection = boundedShape.setGpuDetailSelectionView({
  viewProjection: identityView,
  selectedLink: 999,
  frustumMargin: 0.18,
});
same(gpuSelection.detailedLinkCount, 7, "GPU selector activates every bounded detail slot");
same(gpuSelection.detailCapacity, 7, "GPU selector preserves allocated detail capacity");
same(gpuSelection.selectionMode, "gpu-partition", "GPU selector reports partition mode");
same(gpuSelection.indexUploadBytes, 0, "GPU selector uploads no semantic Link index list");
same(gpuSelection.globalsUploadBytes, 32, "GPU selector updates only shape globals");
same(gpuSelection.selectionControlUploadBytes, 96, "GPU selector uploads one fixed camera uniform");
same(
  boundedDevice.queue.writes.length,
  gpuWritesBefore + 2,
  "GPU selector camera change performs exactly globals + control writes",
);
const selectorWrite = [...boundedDevice.queue.writes].reverse().find(
  (write) => write.label === "monolithic-link-detail-selection",
);
assert(selectorWrite !== undefined, "GPU selector writes its fixed control buffer");
same(selectorWrite.bytes, 96, "GPU selector control upload is exactly 96 bytes");
const selectorBuffer = boundedDevice.buffers.find(
  (buffer) => buffer.label === "monolithic-link-detail-selection",
);
assert(selectorBuffer !== undefined, "GPU selector control buffer exists");
same(
  new Uint32Array(selectorBuffer.bytes)[18],
  999,
  "GPU selector control encodes selected semantic Link",
);
same(
  new Float32Array(selectorBuffer.bytes)[20],
  Math.fround(0.18),
  "GPU selector control encodes frustum margin",
);

boundedDevice.dispatches.length = 0;
const gpuStep = boundedShape.update();
same(gpuStep.compactDispatches, 1, "GPU mode keeps compact all-Link pass");
same(gpuStep.selectorDispatches, 1, "GPU mode adds exactly one selector pass");
same(gpuStep.detailDispatches, 1, "GPU mode keeps one detail-frame pass");
same(gpuStep.dispatches, 3, "GPU mode has compact + selector + detail dispatches");
same(gpuStep.computePasses, 3, "GPU mode has exactly three shape compute passes");
same(gpuStep.selectionMode, "gpu-partition", "GPU step exposes selector mode");
same(boundedDevice.dispatches.length, 3, "device sees compact, selector and detail dispatches");
same(boundedDevice.dispatches[0]!.entryPoint, "shape_parameter_main", "compact kernel remains first");
same(boundedDevice.dispatches[1]!.entryPoint, "shape_detail_select_main", "selector kernel runs second");
same(boundedDevice.dispatches[2]!.entryPoint, "shape_detail_main", "detail frame kernel runs after selector");
same(
  boundedShape.snapshot().selectionMode,
  "gpu-partition",
  "snapshot exposes active GPU selector mode",
);

const manualAgain = boundedShape.setDetailLinkIndices([6, 5, 4]);
same(manualAgain.selectionMode, "manual", "manual mapping disables GPU selector mode");
boundedDevice.dispatches.length = 0;
const manualAgainStep = boundedShape.update();
same(manualAgainStep.selectorDispatches, 0, "manual fallback removes selector dispatch");
same(manualAgainStep.computePasses, 2, "manual fallback returns to compact + detail passes");

for (const invalid of [
  [1, 1],
  [-1],
  [1000],
]) {
  try {
    boundedShape.setDetailLinkIndices(invalid);
    throw new Error(`invalid detail selection accepted: ${invalid.join(",")}`);
  } catch (error) {
    assert(
      String(error).includes("monolithic shape detail"),
      `invalid detail selection fails closed: ${invalid.join(",")}`,
    );
  }
}

for (const invalidView of [
  { viewProjection: identityView.slice(0, 15) },
  { viewProjection: identityView, selectedLink: 1000 },
  { viewProjection: identityView, frustumMargin: -0.1 },
]) {
  try {
    boundedShape.setGpuDetailSelectionView(invalidView);
    throw new Error("invalid GPU detail selection view accepted");
  } catch (error) {
    assert(
      String(error).includes("monolithic shape detail"),
      "invalid GPU detail selection fails closed",
    );
  }
}

boundedShape.destroy();

console.log(
  `[v0.6 #153 bounded GPU carrier] PASS links=${snapshot.linkCount} `
  + `compact=${snapshot.compactDynamicStateBytes}B detail=${snapshot.detailDynamicStateBytes}B`,
);
