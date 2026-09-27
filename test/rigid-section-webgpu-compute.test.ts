import {
  RIGID_SECTION_WEBGPU_WGSL,
  collectRigidSectionCenterDragBodies3D,
  createRigidSectionWebGpuCompute3D,
  runRigidSectionWebGpuDifferential3D,
  type WebGpuBufferLike,
  type WebGpuDeviceLike,
} from "../src/webgpu/index.js";
import type { VisualLinkNetwork } from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual v0.5/P3: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
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
    new Uint8Array(target.bytes).set(source.subarray(dataOffset, dataOffset + byteLength), bufferOffset);
    this.writes.push({ label: buffer.label ?? "", bytes: byteLength, offset: bufferOffset });
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
  readonly limits: {
    readonly maxComputeWorkgroupsPerDimension: number;
    readonly maxStorageBufferBindingSize: number;
    readonly maxStorageBuffersPerShaderStage: number;
  };
  readonly buffers: FakeBuffer[] = [];

  constructor(maxStorageBuffersPerShaderStage = 8) {
    this.limits = {
      maxComputeWorkgroupsPerDimension: 65_535,
      maxStorageBufferBindingSize: 256 * 1024 * 1024,
      maxStorageBuffersPerShaderStage,
    };
  }
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
    return {
      label: descriptor.label,
      code: descriptor.code,
      async getCompilationInfo() {
        return { messages: [] };
      },
    };
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
    readonly compute: { readonly module: object; readonly entryPoint: string };
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
        source: WebGpuBufferLike,
        sourceOffset: number,
        destination: WebGpuBufferLike,
        destinationOffset: number,
        size: number,
      ) {
        const sourceBytes = new Uint8Array((source as FakeBuffer).bytes, sourceOffset, size);
        new Uint8Array((destination as FakeBuffer).bytes).set(sourceBytes, destinationOffset);
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
  "clear_force_torque_main",
  "relation_batch_main",
  "integrate_main",
  "hinge_star_main",
  "hinge_apply_main",
]) {
  assert(
    RIGID_SECTION_WEBGPU_WGSL.includes(`fn ${entryPoint}`),
    `rigid-section WGSL exposes ${entryPoint}`,
  );
}
same(
  [...RIGID_SECTION_WEBGPU_WGSL.matchAll(/@group\(0\) @binding\(\d+\)/g)].length,
  9,
  "rigid-section WGSL has exactly nine explicit bindings",
);
same(
  [...RIGID_SECTION_WEBGPU_WGSL.matchAll(/var<storage/g)].length,
  7,
  "rigid-section WGSL stays within the WebGPU baseline of eight storage buffers per stage",
);
assert(!/atomic</.test(RIGID_SECTION_WEBGPU_WGSL), "rigid-section WGSL needs no atomics");
assert(!/pairwise/i.test(RIGID_SECTION_WEBGPU_WGSL), "rigid-section WGSL has no semantic all-pairs path");
assert(
  RIGID_SECTION_WEBGPU_WGSL.includes("let local = pair * 2u + parity;"),
  "two parity batches are the conflict-free relation schedule",
);
assert(
  RIGID_SECTION_WEBGPU_WGSL.includes("let next_q = q_normalize"),
  "GPU integration normalizes every rigid-section quaternion",
);
assert(
  RIGID_SECTION_WEBGPU_WGSL.includes("let gyroscopic = cross(omega_local, angular_momentum_local);"),
  "GPU angular integration includes Euler gyroscopic coupling",
);
assert(
  !/\blayout\s*:/.test(RIGID_SECTION_WEBGPU_WGSL),
  "rigid-section WGSL avoids reserved identifier layout",
);
assert(
  !/\blet\s+target\b/.test(RIGID_SECTION_WEBGPU_WGSL),
  "rigid-section WGSL avoids reserved identifier target",
);

const rootBasis: VisualLinkNetwork = {
  links: [
    { key: "R", startKey: "R", endKey: "R" },
    { key: "O", startKey: "O", endKey: "R" },
    { key: "C", startKey: "R", endKey: "C" },
    { key: "L", startKey: "O", endKey: "C" },
    { key: "U", startKey: "C", endKey: "O" },
  ],
};
const fake = new FakeDevice();
const controller = await createRigidSectionWebGpuCompute3D(fake, rootBasis, {
  aspectRatio: 10 * Math.SQRT2,
  stiffness: 2,
  simulationSpeed: 1,
});

const snapshot = controller.snapshot();
same(snapshot.status, "available", "fresh rigid-section GPU controller is available");
same(snapshot.linkCount, 5, "GPU root-basis Link count");
same(snapshot.sectionCount, 21, "GPU root-basis section count");
same(snapshot.bodyCount, 105, "GPU root-basis body count");
same(snapshot.centerBytes, 105 * 16, "centers are packed vec4 per rigid section");
same(snapshot.orientationBytes, 105 * 16, "quaternions are packed vec4 per rigid section");

const rDragBodies = collectRigidSectionCenterDragBodies3D(
  controller.topology,
  controller.template,
  0,
);
same(
  rDragBodies.length,
  5,
  "R center drag includes R middle, R START/END, O END and C START rigid sections",
);
same(
  new Set(rDragBodies.map(({ bodyIndex }) => bodyIndex)).size,
  rDragBodies.length,
  "rigid center drag de-duplicates body indices",
);
assert(
  rDragBodies.some(
    ({ linkIndex, localSection }) =>
      linkIndex === 0 && localSection === controller.template.centerSection,
  ),
  "rigid center drag includes selected semantic CENTER body",
);

try {
  collectRigidSectionCenterDragBodies3D(
    controller.topology,
    controller.template,
    99,
  );
  throw new Error("invalid rigid center-drag link should reject");
} catch (error) {
  assert(
    error instanceof Error && /invalid rigid center-drag linkIndex/.test(error.message),
    "invalid rigid center-drag selection fails closed",
  );
}

const initialLabels = fake.queue.writes.map((write) => write.label);
for (const label of [
  "rigid-section-centers",
  "rigid-section-orientations",
  "rigid-section-linear-velocities",
  "rigid-section-angular-velocities",
  "rigid-section-topology-data",
  "rigid-section-globals",
]) {
  assert(initialLabels.includes(label), `initialization uploads ${label} exactly as immutable/initial state`);
}

fake.queue.resetWrites();
const centerBody = controller.template.centerSection;
const overrideStats = controller.writeCenterOverrides([
  {
    bodyIndex: centerBody,
    position: [1.25, -2.5, 3.75],
  },
]);
same(overrideStats.bodyCount, 1, "rigid drag overrides one selected body");
same(overrideStats.bufferWrites, 2, "one rigid body override writes center and linear velocity");
same(overrideStats.centerBytes, 16, "rigid center override writes one packed vec4");
same(overrideStats.velocityBytes, 16, "rigid velocity override writes one packed vec4");
same(fake.queue.writes.length, 2, "rigid drag produces exactly two sparse queue writes");
same(fake.queue.writes[0]!.label, "rigid-section-centers", "rigid drag writes centerBuffer first");
same(fake.queue.writes[1]!.label, "rigid-section-linear-velocities", "rigid drag zeroes linear velocity");
same(fake.queue.writes[0]!.offset, centerBody * 16, "rigid center override uses exact packed body offset");
same(fake.queue.writes[1]!.offset, centerBody * 16, "rigid velocity override uses exact packed body offset");

try {
  controller.writeCenterOverrides([
    { bodyIndex: centerBody, position: [0, 0, 0] },
    { bodyIndex: centerBody, position: [1, 1, 1] },
  ]);
  throw new Error("duplicate rigid center override should reject");
} catch (error) {
  assert(
    error instanceof Error && /duplicate rigid center override/.test(error.message),
    "duplicate rigid center override fails closed",
  );
}

fake.queue.resetWrites();
fake.resetDispatches();
const stats = controller.step();
same(fake.queue.writes.length, 0, "ordinary rigid-section GPU step has zero queue.writeBuffer calls");
same(stats.dynamicStateUploadBytes, 0, "ordinary rigid-section GPU step reports zero dynamic upload");
same(stats.relationBatchDispatches, 2, "exactly two parity relation batches per step");
same(stats.hingeDispatches, 2, "exact star-average hinge solve uses gather + apply");
same(stats.computePasses, 6, "tick has clear + two relation + integrate + hinge gather/apply");

const sequence = fake.dispatches.map((dispatch) => dispatch.entryPoint);
same(sequence[0], "clear_force_torque_main", "tick starts by clearing force/torque");
same(sequence[1], "relation_batch_main", "first parity relation batch");
same(sequence[2], "relation_batch_main", "second parity relation batch");
same(sequence[3], "integrate_main", "integration follows complete relation accumulation");
same(sequence[4], "hinge_star_main", "hinge gather computes one conservative average per target star");
same(sequence[5], "hinge_apply_main", "hinge apply writes exact shared center/velocity states");
same(
  sequence.filter((entry) => entry === "hinge_star_main").length,
  1,
  "one hinge-star gather pass per tick",
);
same(
  sequence.filter((entry) => entry === "hinge_apply_main").length,
  1,
  "one hinge-star apply pass per tick",
);

fake.queue.resetWrites();
controller.setStiffness(3);
same(fake.queue.writes.length, 1, "stiffness update writes only globals");
same(fake.queue.writes[0]!.label, "rigid-section-globals", "stiffness update targets globals");
fake.queue.resetWrites();
controller.setSimulationSpeed(0.5);
same(fake.queue.writes.length, 1, "speed update writes only globals");
same(fake.queue.writes[0]!.label, "rigid-section-globals", "speed update targets globals");

const zeroStepDifferential = await runRigidSectionWebGpuDifferential3D(
  new FakeDevice(),
  rootBasis,
  { aspectRatio: 10 * Math.SQRT2, stiffness: 2, simulationSpeed: 1 },
  0,
  1e-7,
);
assert(zeroStepDifferential.passed, "CPU/GPU initialization state is byte-equivalent at step zero");
same(zeroStepDifferential.maxCenterDelta, 0, "initial centers match exactly");
same(zeroStepDifferential.maxOrientationDelta, 0, "initial orientations match exactly");

controller.destroy();
same(controller.snapshot().status, "destroyed", "destroyed rigid-section controller reports destroyed");
assert(
  fake.buffers.filter((buffer) => buffer.label.startsWith("rigid-section-")).every((buffer) => buffer.destroyed),
  "destroy releases every rigid-section-owned GPU buffer",
);

try {
  controller.step();
  throw new Error("destroyed rigid-section controller step should fail");
} catch (error) {
  assert(error instanceof Error && /destroyed/.test(error.message), "destroyed rigid-section controller fails closed");
}

class InvalidShaderDevice extends FakeDevice {
  createShaderModule(descriptor: { readonly label?: string; readonly code: string }): object {
    return {
      label: descriptor.label,
      code: descriptor.code,
      async getCompilationInfo() {
        return {
          messages: [{
            type: "error",
            message: "synthetic rigid-section WGSL failure",
            lineNum: 19,
            linePos: 7,
          }],
        };
      },
    };
  }
}

try {
  await createRigidSectionWebGpuCompute3D(new FakeDevice(6), rootBasis, {
    aspectRatio: 2 * Math.SQRT2,
    stiffness: 1,
    simulationSpeed: 1,
  });
  throw new Error("insufficient storage-buffer limit should fail");
} catch (error) {
  assert(error instanceof Error, "storage-buffer limit failure has Error shape");
  assert(
    error.message.includes("requires 7 storage buffers per shader stage"),
    "storage-buffer limit failure states the packed requirement",
  );
  assert(error.message.includes("adapter exposes 6"), "storage-buffer limit failure states adapter limit");
}

try {
  await createRigidSectionWebGpuCompute3D(new InvalidShaderDevice(), rootBasis, {
    aspectRatio: 2 * Math.SQRT2,
    stiffness: 1,
    simulationSpeed: 1,
  });
  throw new Error("invalid rigid-section shader should fail");
} catch (error) {
  assert(error instanceof Error, "shader validation failure has Error shape");
  assert(error.message.includes("WGSL compilation failed"), "shader failure is explicit");
  assert(error.message.includes("line 19:7"), "shader failure keeps browser line/column");
  assert(error.message.includes("synthetic rigid-section WGSL failure"), "shader failure keeps browser message");
}

console.log(
  `[v0.5 P3 WebGPU] PASS bodies=${snapshot.bodyCount} passes=${stats.computePasses} `
  + `bindings=9 storage=7 zeroUpload=${stats.dynamicStateUploadBytes}`,
);
