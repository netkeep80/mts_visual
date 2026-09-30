import {
  MONOLITHIC_LINK_WEBGPU_WGSL,
  createMonolithicLinkWebGpuCompute3D,
  createMonolithicLinkWebGpuComputeFromTopology3D,
  runMonolithicLinkWebGpuDifferential3D,
  type WebGpuBufferLike,
  type WebGpuDeviceLike,
} from "../src/webgpu/index.js";
import type { VisualLinkNetwork } from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`@mts/visual v0.5/#92 monolithic WebGPU: ${message}`);
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
    const target = buffer as FakeBuffer;
    const source = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const byteLength = size ?? source.byteLength - dataOffset;
    new Uint8Array(target.bytes).set(
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

  resetWrites(): void {
    this.writes.length = 0;
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
  readonly copiedBytes: number[] = [];
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
    const result = new FakeBuffer(descriptor.size, descriptor.label ?? "");
    this.buffers.push(result);
    return result;
  }

  createShaderModule(descriptor: {
    readonly label?: string;
    readonly code: string;
  }): object {
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
          setPipeline(pipeline: {
            readonly entryPoint?: string;
            readonly label?: string;
          }) {
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
        source: WebGpuBufferLike,
        sourceOffset: number,
        destination: WebGpuBufferLike,
        destinationOffset: number,
        size: number,
      ) {
        const sourceBytes = new Uint8Array(
          (source as FakeBuffer).bytes,
          sourceOffset,
          size,
        );
        new Uint8Array((destination as FakeBuffer).bytes).set(
          sourceBytes,
          destinationOffset,
        );
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

for (const entryPoint of [
  "link_force_main",
  "gather_integrate_main",
]) {
  assert(
    MONOLITHIC_LINK_WEBGPU_WGSL.includes(`fn ${entryPoint}`),
    `WGSL exposes ${entryPoint}`,
  );
}

same(
  [...MONOLITHIC_LINK_WEBGPU_WGSL.matchAll(/@group\(0\) @binding\(\d+\)/g)].length,
  5,
  "monolithic WGSL has four storage buffers plus one uniform",
);
same(
  [...MONOLITHIC_LINK_WEBGPU_WGSL.matchAll(/var<storage/g)].length,
  4,
  "monolithic physical kernel uses only four storage buffers",
);
assert(
  !/atomic</.test(MONOLITHIC_LINK_WEBGPU_WGSL),
  "semantic CENTER gather needs no float atomics",
);
assert(
  !/quaternion|orientation|omega|angular/i.test(MONOLITHIC_LINK_WEBGPU_WGSL),
  "monolithic physical kernel has no section rotational state",
);
assert(
  MONOLITHIC_LINK_WEBGPU_WGSL.includes(
    "start_index != link && end_index != link",
  ),
  "WGSL applies whole-Link straightening only when both arms are non-self",
);
assert(
  MONOLITHIC_LINK_WEBGPU_WGSL.includes(
    "let q = s - 2.0 * c + e;",
  ),
  "WGSL retains the ordinary whole-Link straightening term",
);
assert(
  MONOLITHIC_LINK_WEBGPU_WGSL.includes(
    "return gid.x + gid.y * 65535u * 64u;",
  ),
  "global invocation indexing uses the accepted 2D linearization",
);

const basis: VisualLinkNetwork = {
  links: [
    { key: "R", startKey: "R", endKey: "R" },
    { key: "O", startKey: "O", endKey: "R" },
    { key: "C", startKey: "R", endKey: "C" },
    { key: "L", startKey: "O", endKey: "C" },
    { key: "U", startKey: "C", endKey: "O" },
  ],
};

const options = {
  aspectRatio: 8 * Math.SQRT2,
  stretchStiffness: 5,
  straighteningStiffness: 2,
  nonlinearity: 0.75,
  centerMass: 3,
  dampingRate: 0.6,
  simulationSpeed: 1.5,
} as const;

const fake = new FakeDevice();
const controller = await createMonolithicLinkWebGpuCompute3D(
  fake,
  basis,
  options,
);
const snapshot = controller.snapshot();

same(snapshot.status, "available", "fresh monolithic GPU controller is available");
same(snapshot.linkCount, 5, "GPU stores one dynamic state per semantic Link");
same(snapshot.centerBytes, 5 * 16, "CENTER state is one vec4 per semantic Link");
same(snapshot.velocityBytes, 5 * 16, "velocity state is one vec4 per semantic Link");
same(snapshot.linkForceBytes, 5 * 3 * 16, "Stage A stores exactly S/C/E force contributions");
same(snapshot.stretchStiffness, 5, "stretch stiffness reaches GPU controller");
same(snapshot.straighteningStiffness, 2, "straightening stiffness reaches GPU controller");
same(snapshot.nonlinearity, 0.75, "nonlinearity reaches GPU controller");
same(snapshot.centerMass, 3, "semantic CENTER mass reaches GPU controller");
same(snapshot.dampingRate, 0.6, "CENTER damping reaches GPU controller");
same(snapshot.simulationSpeed, 1.5, "simulation speed reaches GPU controller");

fake.resetDispatches();
const step = controller.step();
same(step.linkForceDispatches, 1, "one whole-Link force dispatch");
same(step.gatherIntegrateDispatches, 1, "one semantic CENTER gather/integrate dispatch");
same(step.computePasses, 2, "ordinary physical tick is exactly two compute passes");
same(step.dynamicStateUploadBytes, 0, "ordinary physical tick uploads no dynamic state");
same(fake.dispatches.length, 2, "fake device sees exactly two compute dispatches");
same(fake.dispatches[0]!.entryPoint, "link_force_main", "force pass is first");
same(fake.dispatches[1]!.entryPoint, "gather_integrate_main", "CENTER gather is second");

for (const [label, apply, read, expected] of [
  [
    "stretch",
    () => controller.setStretchStiffness(9),
    () => controller.snapshot().stretchStiffness,
    9,
  ],
  [
    "straightening",
    () => controller.setStraighteningStiffness(4),
    () => controller.snapshot().straighteningStiffness,
    4,
  ],
  [
    "nonlinearity",
    () => controller.setNonlinearity(3),
    () => controller.snapshot().nonlinearity,
    3,
  ],
  [
    "center mass",
    () => controller.setCenterMass(2.5),
    () => controller.snapshot().centerMass,
    2.5,
  ],
  [
    "damping",
    () => controller.setDampingRate(0.25),
    () => controller.snapshot().dampingRate,
    0.25,
  ],
  [
    "speed",
    () => controller.setSimulationSpeed(0.5),
    () => controller.snapshot().simulationSpeed,
    0.5,
  ],
] as const) {
  fake.queue.resetWrites();
  apply();
  same(fake.queue.writes.length, 1, `${label} setter writes only globals`);
  same(
    fake.queue.writes[0]!.label,
    "monolithic-link-globals",
    `${label} setter targets globals`,
  );
  same(read(), expected, `${label} snapshot follows control`);
}

fake.queue.resetWrites();
const override = controller.writeCenterOverrides([
  {
    linkIndex: 2,
    position: [1, 2, 3],
    velocity: [0.5, 0, -0.25],
  },
]);
same(override.linkCount, 1, "one semantic CENTER override");
same(override.bufferWrites, 2, "CENTER override writes position and velocity only");
same(override.centerBytes, 16, "CENTER override uploads one vec4");
same(override.velocityBytes, 16, "velocity override uploads one vec4");
same(fake.queue.writes[0]!.label, "monolithic-link-centers", "override writes semantic center buffer");
same(fake.queue.writes[1]!.label, "monolithic-link-velocities", "override writes semantic velocity buffer");

const presentationEquivalentFake = new FakeDevice();
const presentationEquivalentController =
  await createMonolithicLinkWebGpuCompute3D(
    presentationEquivalentFake,
    basis,
    options,
  );
const compactFake = new FakeDevice();
const compactController = await createMonolithicLinkWebGpuComputeFromTopology3D(
  compactFake,
  {
    linkCount: 5,
    startIndices: new Uint32Array([3, 2, 2, 3, 0]),
    endIndices: new Uint32Array([0, 0, 3, 3, 2]),
  },
  options,
);
same(
  compactController.snapshot().linkCount,
  controller.snapshot().linkCount,
  "compact topology path preserves semantic Link count",
);
same(
  compactController.snapshot().restLength,
  controller.snapshot().restLength,
  "compact topology path uses the same monolithic template",
);

function bufferBytes(device: FakeDevice, label: string): Uint8Array {
  const buffer = device.buffers.find((candidate) => candidate.label === label);
  assert(buffer !== undefined, `missing fake buffer ${label}`);
  return new Uint8Array(buffer.bytes);
}

function sameBytes(
  actual: Uint8Array,
  expected: Uint8Array,
  message: string,
): void {
  same(actual.length, expected.length, `${message} length`);
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(
        `@mts/visual v0.6/#159 compact compute: ${message}[${index}] ${actual[index]} !== ${expected[index]}`,
      );
    }
  }
}

sameBytes(
  bufferBytes(compactFake, "monolithic-link-centers"),
  bufferBytes(presentationEquivalentFake, "monolithic-link-centers"),
  "compact and presentation adapters seed identical CENTER bytes",
);
sameBytes(
  bufferBytes(compactFake, "monolithic-link-velocities"),
  bufferBytes(presentationEquivalentFake, "monolithic-link-velocities"),
  "compact and presentation adapters seed identical velocity bytes",
);
sameBytes(
  bufferBytes(compactFake, "monolithic-link-topology"),
  bufferBytes(presentationEquivalentFake, "monolithic-link-topology"),
  "compact and presentation adapters pack identical forward/reverse topology",
);
compactFake.resetDispatches();
const compactStep = compactController.step();
same(compactStep.computePasses, 2, "compact path executes the same two physical passes");
same(compactFake.dispatches[0]!.entryPoint, "link_force_main", "compact path uses production force WGSL");
same(compactFake.dispatches[1]!.entryPoint, "gather_integrate_main", "compact path uses production gather WGSL");

const customSeedFake = new FakeDevice();
const customSeed = new Float32Array([
  1, 2, 3,
  4, 5, 6,
]);
const customVelocity = new Float32Array([
  0.1, 0.2, 0.3,
  -0.1, -0.2, -0.3,
]);
const customSeedController =
  await createMonolithicLinkWebGpuComputeFromTopology3D(
    customSeedFake,
    {
      linkCount: 2,
      startIndices: new Uint32Array([0, 0]),
      endIndices: new Uint32Array([1, 1]),
    },
    options,
    {
      centers: customSeed,
      velocities: customVelocity,
    },
  );
const centerWords = new Float32Array(
  bufferBytes(customSeedFake, "monolithic-link-centers").buffer,
);
same(centerWords[0], 1, "custom compact seed CENTER x");
same(centerWords[1], 2, "custom compact seed CENTER y");
same(centerWords[2], 3, "custom compact seed CENTER z");
same(centerWords[4], 4, "custom compact seed second CENTER x");
const velocityWords = new Float32Array(
  bufferBytes(customSeedFake, "monolithic-link-velocities").buffer,
);
assert(
  Math.abs(velocityWords[0]! - Math.fround(0.1)) < 1e-7,
  "custom compact seed velocity x",
);
customSeedController.destroy();

for (const invalidTopology of [
  {
    linkCount: 2,
    startIndices: new Uint32Array([0]),
    endIndices: new Uint32Array([0, 1]),
  },
  {
    linkCount: 2,
    startIndices: new Uint32Array([0, 2]),
    endIndices: new Uint32Array([0, 1]),
  },
]) {
  try {
    await createMonolithicLinkWebGpuComputeFromTopology3D(
      new FakeDevice(),
      invalidTopology,
      options,
    );
    throw new Error("invalid compact topology accepted");
  } catch (error) {
    assert(
      String(error).includes("invalid monolithic WebGPU topology"),
      "invalid compact topology fails closed",
    );
  }
}

compactController.destroy();
presentationEquivalentController.destroy();

const shortController = await createMonolithicLinkWebGpuCompute3D(
  new FakeDevice(),
  basis,
  { ...options, aspectRatio: 8 * Math.SQRT2 },
);
const longController = await createMonolithicLinkWebGpuCompute3D(
  new FakeDevice(),
  basis,
  { ...options, aspectRatio: 128 * Math.SQRT2 },
);
const shortSnapshot = shortController.snapshot();
const longSnapshot = longController.snapshot();
same(
  shortSnapshot.centerBytes,
  longSnapshot.centerBytes,
  "16-octa and 256-octa Links allocate identical authoritative GPU CENTER state",
);
same(
  shortSnapshot.velocityBytes,
  longSnapshot.velocityBytes,
  "Link length adds no GPU inertial stages",
);
same(
  shortSnapshot.linkForceBytes,
  longSnapshot.linkForceBytes,
  "Link length adds no force-propagation stages",
);
assert(
  longSnapshot.restLength > shortSnapshot.restLength,
  "physical rest length still increases with octahedron count",
);
shortController.destroy();
longController.destroy();

const zeroStepDifferential = await runMonolithicLinkWebGpuDifferential3D(
  new FakeDevice(),
  basis,
  options,
  0,
  1e-7,
);
assert(
  zeroStepDifferential.passed,
  "CPU/GPU initialization is byte-equivalent at step zero",
);
same(zeroStepDifferential.maxCenterDelta, 0, "initial semantic centers match exactly");
same(zeroStepDifferential.maxVelocityDelta, 0, "initial semantic velocities match exactly");

controller.destroy();
same(controller.snapshot().status, "destroyed", "destroy updates controller status");

console.log(
  `[v0.5 #92 monolithic WebGPU] PASS links=${snapshot.linkCount} `
  + `passes=${step.computePasses} state=${snapshot.centerBytes + snapshot.velocityBytes}B `
  + `forceContrib=${snapshot.linkForceBytes}B`,
);
