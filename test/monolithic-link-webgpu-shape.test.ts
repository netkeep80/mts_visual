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
  "fn solve_amplitude",
  "fn half_arc_length",
  "buckling_basis_derivative",
  "for (var iteration = 0u; iteration < 24u;",
  "shape_parameters[link] = vec4<f32>(",
  "var<storage, read_write> roll_gauge",
  "fn update_roll_gauge",
  "if (dot(geometric, previous) < 0.0)",
  "let raw_weight = (bend_sine - 0.015) / (0.08 - 0.015);",
]) {
  assert(
    MONOLITHIC_LINK_SHAPE_PARAMETER_WGSL.includes(needle),
    `WGSL includes ${needle}`,
  );
}
same(
  [...MONOLITHIC_LINK_SHAPE_PARAMETER_WGSL.matchAll(/var<storage/g)].length,
  4,
  "shape solve needs centers, topology, compact parameters and one persistent roll gauge",
);
assert(
  !/velocity|mass|damping|integrate/i.test(MONOLITHIC_LINK_SHAPE_PARAMETER_WGSL),
  "shape solve contains no physical integration state",
);

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
same(snapshot.octahedronCount, 32, "shape template resolves requested octahedra");
same(snapshot.sectionCount, 33, "derived presentation has N+1 connecting triangles");
same(snapshot.parameterBytes, 5 * 16, "one vec4 shape parameter record per Link");
same(snapshot.gaugeBytes, 5 * 16, "one vec4 persistent roll gauge per Link");
same(
  snapshot.dynamicStateBytes,
  5 * 32,
  "derived GPU state stays O(linkCount): shape vec4 + gauge vec4",
);
same(shape.gaugeBuffer.size, 5 * 16, "gauge buffer is exactly one vec4 per Link");

const setupWriteCount = device.queue.writes.length;
const step = shape.update();
same(step.dispatches, 1, "shape update is one monolithic dispatch");
same(step.computePasses, 1, "shape update is exactly one compute pass");
same(step.dynamicStateUploadBytes, 0, "shape update uploads no CPU dynamic state");
same(device.queue.writes.length, setupWriteCount, "ordinary shape update performs no queue.writeBuffer");
same(device.dispatches.length, 1, "device sees one shape dispatch");
same(device.dispatches[0]!.entryPoint, "shape_parameter_main", "shape parameter kernel is dispatched");

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
same(largeDevice.dispatches.length, 1, "1000 Links still use one shape dispatch");
same(largeDevice.dispatches[0]!.x, 16, "1000 Links require 16 workgroups at 64 threads");
same(largeDevice.dispatches[0]!.y, 1, "1000-Link shape remains one dispatch row");
same(
  largeShape.snapshot().parameterBytes,
  1000 * 16,
  "1000-Link shape parameter state is 16 kB",
);
same(
  largeShape.snapshot().gaugeBytes,
  1000 * 16,
  "1000-Link roll gauge state adds only 16 kB",
);
same(
  largeShape.snapshot().dynamicStateBytes,
  1000 * 32,
  "1000-Link total derived shape+gauge state is 32 kB",
);
largeShape.destroy();

console.log(
  `[v0.5 #100 monolithic GPU gauge] PASS links=${snapshot.linkCount} params=${snapshot.parameterBytes}B gauge=${snapshot.gaugeBytes}B large=${1000 * 32}B`,
);
