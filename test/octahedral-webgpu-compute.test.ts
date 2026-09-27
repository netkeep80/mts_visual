import {
  OCTAHEDRAL_WEBGPU_WGSL,
  buildOctahedralReverseIncidence3D,
  computeOctahedralWebGpuDispatch2D,
  createOctahedralWebGpuCompute3D,
  packOctahedralWebGpuTemplate3D,
  type WebGpuBufferLike,
  type WebGpuDeviceLike,
} from "../src/webgpu/index.js";
import { getOctahedralSeedGrid3D } from "../src/octahedral-layout3d.js";
import {
  buildOctahedralLinkTopology3D,
  getOctahedralLinkTemplate3D,
  type VisualLinkNetwork,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual M5/P4b: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

class FakeBuffer implements WebGpuBufferLike {
  readonly bytes: ArrayBuffer;
  destroyed = false;

  constructor(
    readonly size: number,
    readonly label = "",
  ) {
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
  readonly writes: { label: string; bytes: number }[] = [];
  submissions = 0;

  writeBuffer(
    buffer: WebGpuBufferLike,
    _bufferOffset: number,
    data: ArrayBuffer | ArrayBufferView,
    _dataOffset?: number,
    size?: number,
  ): void {
    const byteLength = size ?? data.byteLength;
    this.writes.push({ label: buffer.label ?? "", bytes: byteLength });
  }

  submit(_commandBuffers: readonly object[]): void {
    this.submissions += 1;
  }

  resetWrites(): void {
    this.writes.length = 0;
  }
}

class FakeDevice implements WebGpuDeviceLike {
  readonly queue = new FakeQueue();
  readonly limits = {
    maxComputeWorkgroupsPerDimension: 65_535,
    maxStorageBufferBindingSize: 256 * 1024 * 1024,
  };
  readonly buffers: FakeBuffer[] = [];
  readonly dispatches: { entryPoint: string; x: number; y: number; z: number }[] = [];
  readonly copiedBytes: number[] = [];

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

  createShaderModule(descriptor: { readonly label?: string; readonly code: string }): object {
    return { label: descriptor.label, code: descriptor.code };
  }

  createBindGroupLayout(descriptor: { readonly label?: string; readonly entries: readonly object[] }): object {
    return { label: descriptor.label, entries: descriptor.entries };
  }

  createPipelineLayout(descriptor: { readonly label?: string; readonly bindGroupLayouts: readonly object[] }): object {
    return { label: descriptor.label, bindGroupLayouts: descriptor.bindGroupLayouts };
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
      : { label: descriptor.label, entryPoint: descriptor.compute.entryPoint };
  }

  createBindGroup(descriptor: {
    readonly label?: string;
    readonly layout: object;
    readonly entries: readonly object[];
  }): object {
    return { label: descriptor.label, entries: descriptor.entries };
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
        size: number,
      ) {
        device.copiedBytes.push(size);
      },
      finish() {
        return {};
      },
    };
  }

  resetDispatches(): void {
    this.dispatches.length = 0;
  }
}

const fanInNetwork: VisualLinkNetwork = {
  links: [
    { key: "A", startKey: "A", endKey: "B" },
    { key: "B", startKey: "A", endKey: "B" },
    { key: "C", startKey: "A", endKey: "B" },
    { key: "D", startKey: "A", endKey: "B" },
  ],
};
const fanInTopology = buildOctahedralLinkTopology3D(fanInNetwork);
const reverse = buildOctahedralReverseIncidence3D(fanInTopology);
same(reverse.incomingRefs.length, fanInTopology.linkCount * 2, "reverse CSR stores exactly 2N incoming refs");
same(
  JSON.stringify([...reverse.incomingOffsets]),
  JSON.stringify([0, 4, 8, 8, 8]),
  "high fan-in reverse CSR offsets are exact",
);
same(
  JSON.stringify([...reverse.incomingRefs]),
  JSON.stringify([0, 2, 4, 6, 1, 3, 5, 7]),
  "reverse CSR preserves START/END encoded source refs",
);

const selfNetwork: VisualLinkNetwork = {
  links: [{ key: "R", startKey: "R", endKey: "R" }],
};
const selfReverse = buildOctahedralReverseIncidence3D(buildOctahedralLinkTopology3D(selfNetwork));
same(JSON.stringify([...selfReverse.incomingOffsets]), JSON.stringify([0, 2]), "double-self CSR has two incoming refs");
same(JSON.stringify([...selfReverse.incomingRefs]), JSON.stringify([0, 1]), "double-self CSR retains START and END roles");

const ratio = 2 * Math.SQRT2;
const template = getOctahedralLinkTemplate3D(ratio);
const packed = packOctahedralWebGpuTemplate3D(template);
same(packed.restBase, 0, "packed template rest positions start at zero");
same(packed.edgeABase, template.restPositions.length, "packed edgeA follows rest bits");
same(packed.edgeBBase, packed.edgeABase + template.edgeCount, "packed edgeB follows edgeA");
same(packed.batchEdgesBase, packed.edgeBBase + template.edgeCount, "packed batch edges follow edgeB");

const restBits = new Uint32Array(
  template.restPositions.buffer,
  template.restPositions.byteOffset,
  template.restPositions.length,
);
for (let index = 0; index < restBits.length; index += 1) {
  same(packed.words[packed.restBase + index]!, restBits[index]!, `rest Float32 bit pattern ${index}`);
}

const batchEdges: number[] = [];
for (const batch of packed.batches) {
  for (let index = 0; index < batch.count; index += 1) {
    batchEdges.push(packed.words[packed.batchEdgesBase + batch.offset + index]!);
  }
}
same(batchEdges.length, template.edgeCount, "packed batches cover every physical spring");
same(new Set(batchEdges).size, template.edgeCount, "packed batches contain every spring exactly once");

const millionVertices = computeOctahedralWebGpuDispatch2D(11_000_000);
same(millionVertices.workgroupsX, 65_535, "million workload uses full first dispatch dimension");
same(millionVertices.workgroupsY, 3, "million workload spills deterministically into second dispatch dimension");
assert(millionVertices.coveredInvocations >= 11_000_000, "million dispatch covers every physical vertex");
assert(
  millionVertices.coveredInvocations - 11_000_000 < 65_535 * 64,
  "2D dispatch overrun is bounded by one first-dimension slab",
);

const zeroDispatch = computeOctahedralWebGpuDispatch2D(0);
same(zeroDispatch.workgroupsX, 0, "zero workload has zero x groups");
same(zeroDispatch.workgroupsY, 0, "zero workload has zero y groups");

for (const entryPoint of [
  "init_main",
  "clear_forces_main",
  "spring_batch_main",
  "hinge_gather_main",
  "hinge_zero_main",
  "integrate_main",
  "project_hinges_main",
]) {
  assert(
    OCTAHEDRAL_WEBGPU_WGSL.includes(`fn ${entryPoint}`),
    `WGSL exposes ${entryPoint}`,
  );
}
same(
  [...OCTAHEDRAL_WEBGPU_WGSL.matchAll(/@group\(0\) @binding\([0-6]\) var<storage/g)].length,
  7,
  "WGSL uses exactly seven storage-buffer bindings",
);
assert(!/atomic</.test(OCTAHEDRAL_WEBGPU_WGSL), "WGSL uses no atomic force buffer");
assert(!/pairwise/i.test(OCTAHEDRAL_WEBGPU_WGSL), "WGSL contains no semantic all-pairs path");
assert(OCTAHEDRAL_WEBGPU_WGSL.includes("fn seed_center"), "WGSL exposes deterministic 3D seed-center helper");
assert(OCTAHEDRAL_WEBGPU_WGSL.includes("fn seed_axis"), "WGSL exposes topology-directed mast orientation helper");
assert(OCTAHEDRAL_WEBGPU_WGSL.includes("let x_index = link % side"), "WGSL seed layout spans grid X");
assert(OCTAHEDRAL_WEBGPU_WGSL.includes("let y_index = (link / side) % side"), "WGSL seed layout spans grid Y");
assert(OCTAHEDRAL_WEBGPU_WGSL.includes("let z_index = link / plane"), "WGSL seed layout spans grid Z");
assert(
  !OCTAHEDRAL_WEBGPU_WGSL.includes("var center_x ="),
  "WGSL no longer contains the former one-dimensional center seed",
);

const gpuGrid = getOctahedralSeedGrid3D(template, 333);
same(gpuGrid.side, 7, "CPU contract supplies seven-wide 333-Link grid to GPU globals");
same(gpuGrid.depth, 7, "CPU contract supplies seven-deep 333-Link grid to GPU globals");
assert(
  Math.abs(gpuGrid.spacing - template.diameter * 1.5) <= 1e-12,
  "CPU seed spacing is exactly 1.5x Link diameter and independent of rest length",
);
assert(
  OCTAHEDRAL_WEBGPU_WGSL.includes("let half_length = abs(rest_xyz(globals.counts.w).z);"),
  "WGSL derives half-mast rest length from END apex",
);
assert(
  OCTAHEDRAL_WEBGPU_WGSL.includes("let centerline = center + (target - center) * fraction;"),
  "WGSL distributes incidence fit across the complete half-mast",
);
assert(
  !OCTAHEDRAL_WEBGPU_WGSL.includes("+ axis * rest.z"),
  "WGSL no longer leaves the whole mast rigid then tears only its apex springs",
);

const fake = new FakeDevice();
const controller = await createOctahedralWebGpuCompute3D(fake, fanInNetwork, {
  aspectRatio: ratio,
  stiffness: 1.25,
  simulationSpeed: 1,
});

const initialWriteLabels = fake.queue.writes.map((write) => write.label);
assert(!initialWriteLabels.includes("octahedral-positions"), "GPU initialization does not upload CPU position state");
assert(!initialWriteLabels.includes("octahedral-velocities"), "GPU initialization does not upload CPU velocity state");
assert(!initialWriteLabels.includes("octahedral-forces"), "GPU initialization does not upload CPU force state");
assert(initialWriteLabels.includes("octahedral-topology"), "topology is uploaded once");
assert(initialWriteLabels.includes("octahedral-template-words"), "cached template words are uploaded once");
const globalsWrite = fake.queue.writes.find((write) => write.label === "octahedral-globals");
assert(globalsWrite !== undefined, "GPU initialization uploads one globals block");
same(globalsWrite.bytes, 80, "GPU globals include explicit grid side/depth plus physics controls");

const snapshot = controller.snapshot();
same(snapshot.status, "available", "fresh GPU controller reports available status");
same(snapshot.deviceLostReason, null, "fresh GPU controller has no device-loss reason");
same(snapshot.linkCount, 4, "GPU controller snapshot Link count");
same(snapshot.vertexCount, 11, "GPU controller uses minimum cached template");
same(snapshot.positionBytes, 4 * 11 * 3 * 4, "positions remain tightly packed XYZ Float32");
same(snapshot.gpuDynamicXyzBytes, 3 * snapshot.positionBytes, "three dynamic XYZ fields retain 12-byte vertex packing");

fake.queue.resetWrites();
fake.resetDispatches();
const step = controller.step();
same(fake.queue.writes.length, 0, "ordinary GPU step performs zero queue.writeBuffer calls");
same(step.dynamicStateUploadBytes, 0, "ordinary GPU step reports zero dynamic-state upload bytes");
same(step.springBatchDispatches, template.edgeBatches.length, "one GPU spring dispatch per cached edge batch");
same(step.computePasses, template.edgeBatches.length + 5, "tick contains batch passes plus five fixed passes");

const sequence = fake.dispatches.map((dispatch) => dispatch.entryPoint);
same(sequence[0], "clear_forces_main", "tick starts by clearing GPU force state");
same(sequence.at(-1), "project_hinges_main", "tick ends by projecting hinge positions/velocities");
same(
  sequence.filter((entryPoint) => entryPoint === "spring_batch_main").length,
  template.edgeBatches.length,
  "tick dispatch sequence contains exact cached spring batch count",
);
assert(
  sequence.indexOf("hinge_gather_main") < sequence.indexOf("hinge_zero_main"),
  "hinge gather completes before apex reaction zeroing",
);
assert(
  sequence.indexOf("hinge_zero_main") < sequence.indexOf("integrate_main"),
  "apex reactions are zeroed before interior integration",
);

fake.queue.resetWrites();
controller.setStiffness(2);
same(fake.queue.writes.length, 1, "stiffness update writes only small control state");
same(fake.queue.writes[0]!.label, "octahedral-globals", "stiffness update targets globals buffer");
fake.queue.resetWrites();
controller.setSimulationSpeed(0.5);
same(fake.queue.writes.length, 1, "simulation-speed update writes only small control state");
same(fake.queue.writes[0]!.label, "octahedral-globals", "simulation-speed update targets globals buffer");

controller.destroy();
same(controller.snapshot().status, "destroyed", "destroyed controller reports destroyed status");
assert(fake.buffers.filter((buffer) => buffer.label.startsWith("octahedral-")).every((buffer) => buffer.destroyed), "destroy releases every owned WebGPU buffer");
controller.destroy();

try {
  controller.step();
  throw new Error("destroyed controller step should fail");
} catch (error) {
  assert(error instanceof Error && /destroyed/.test(error.message), "destroyed controller fails closed");
}

class LostFakeDevice extends FakeDevice {
  readonly lost: Promise<{ readonly reason: string; readonly message: string }>;
  private resolveLost!: (info: { readonly reason: string; readonly message: string }) => void;

  constructor() {
    super();
    this.lost = new Promise((resolve) => {
      this.resolveLost = resolve;
    });
  }

  lose(message: string): void {
    this.resolveLost({ reason: "unknown", message });
  }
}

const lostDevice = new LostFakeDevice();
const lostController = await createOctahedralWebGpuCompute3D(lostDevice, selfNetwork, {
  aspectRatio: ratio,
  stiffness: 1,
  simulationSpeed: 1,
});
lostDevice.lose("synthetic device loss");
await Promise.resolve();
same(lostController.snapshot().status, "device-lost", "device loss becomes explicit controller state");
same(lostController.snapshot().deviceLostReason, "synthetic device loss", "device-loss reason remains observable");
try {
  lostController.step();
  throw new Error("lost-device controller step should fail");
} catch (error) {
  assert(error instanceof Error && /device lost/.test(error.message), "lost device fails closed");
}
lostController.destroy();
