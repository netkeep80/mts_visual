import {
  createMonolithicLinkBenchmarkTopology3D,
} from "../src/webgpu/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`@mts/visual benchmark-topology: ${message}`);
  }
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(
    Object.is(actual, expected),
    `${message}: ${String(actual)} !== ${String(expected)}`,
  );
}

function sameUint32(
  actual: Uint32Array,
  expected: Uint32Array,
  message: string,
): void {
  assert(actual.length === expected.length, `${message}: length mismatch`);
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(
        `@mts/visual benchmark-topology: ${message}[${index}]: ${actual[index]} !== ${expected[index]}`,
      );
    }
  }
}

const profiles = [
  "chain",
  "hub-heavy",
  "mixed",
  "self-incidence",
  "branching",
] as const;

for (const profile of profiles) {
  const first = createMonolithicLinkBenchmarkTopology3D({
    linkCount: 257,
    profile,
    seed: 0x1234_5678,
  });
  const second = createMonolithicLinkBenchmarkTopology3D({
    linkCount: 257,
    profile,
    seed: 0x1234_5678,
  });

  same(first.linkCount, 257, `${profile}: linkCount`);
  same(first.startIndices.length, 257, `${profile}: START length`);
  same(first.endIndices.length, 257, `${profile}: END length`);
  same(first.inputTopologyBytes, 257 * 8, `${profile}: input bytes`);
  sameUint32(
    first.startIndices,
    second.startIndices,
    `${profile}: deterministic START`,
  );
  sameUint32(
    first.endIndices,
    second.endIndices,
    `${profile}: deterministic END`,
  );

  for (let link = 0; link < first.linkCount; link += 1) {
    assert(
      first.startIndices[link]! < first.linkCount,
      `${profile}: START[${link}] in range`,
    );
    assert(
      first.endIndices[link]! < first.linkCount,
      `${profile}: END[${link}] in range`,
    );
  }
}

const mixedA = createMonolithicLinkBenchmarkTopology3D({
  linkCount: 1024,
  profile: "mixed",
  seed: 1,
});
const mixedB = createMonolithicLinkBenchmarkTopology3D({
  linkCount: 1024,
  profile: "mixed",
  seed: 2,
});
assert(
  mixedA.startIndices.some(
    (value, index) =>
      value !== mixedB.startIndices[index]
      || mixedA.endIndices[index] !== mixedB.endIndices[index],
  ),
  "mixed profile seed changes topology",
);

const self = createMonolithicLinkBenchmarkTopology3D({
  linkCount: 4096,
  profile: "self-incidence",
  seed: 0xfeed_beef,
});
assert(self.startSelfCount > 0, "self-incidence profile has START-self Links");
assert(self.endSelfCount > 0, "self-incidence profile has END-self Links");
assert(
  self.startSelfCount < self.linkCount,
  "self-incidence profile is not START-self everywhere",
);
assert(
  self.endSelfCount < self.linkCount,
  "self-incidence profile is not END-self everywhere",
);

const chain = createMonolithicLinkBenchmarkTopology3D({
  linkCount: 5,
  profile: "chain",
  seed: 99,
});
sameUint32(
  chain.startIndices,
  new Uint32Array([0, 0, 1, 2, 3]),
  "chain START topology",
);
sameUint32(
  chain.endIndices,
  new Uint32Array([1, 2, 3, 4, 4]),
  "chain END topology",
);

const branching = createMonolithicLinkBenchmarkTopology3D({
  linkCount: 7,
  profile: "branching",
});
sameUint32(
  branching.startIndices,
  new Uint32Array([0, 0, 0, 1, 1, 2, 2]),
  "branching START topology",
);
sameUint32(
  branching.endIndices,
  new Uint32Array([1, 3, 5, 3, 4, 5, 6]),
  "branching END topology",
);

// The one-million witness allocates only two Uint32 topology arrays.
// Do not convert these arrays to JS object/string fixtures.
const million = createMonolithicLinkBenchmarkTopology3D({
  linkCount: 1_000_000,
  profile: "chain",
  seed: 0x4d545356,
});
same(million.inputTopologyBytes, 8_000_000, "1M compact input topology is exactly 8 MB");
same(million.startIndices.byteLength, 4_000_000, "1M START bytes");
same(million.endIndices.byteLength, 4_000_000, "1M END bytes");
assert(
  !("keys" in million),
  "compact 1M topology carries no presentation key array",
);
same(million.startIndices[999_999], 999_998, "1M final START");
same(million.endIndices[999_999], 999_999, "1M final END");

for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER]) {
  try {
    createMonolithicLinkBenchmarkTopology3D({
      linkCount: invalid,
      profile: "chain",
    });
    throw new Error(`invalid linkCount accepted: ${invalid}`);
  } catch (error) {
    assert(
      String(error).includes("monolithic benchmark"),
      `invalid linkCount fails closed: ${invalid}`,
    );
  }
}

console.log(
  "[v0.6 #159 compact benchmark topology] PASS · "
  + `1M input=${(million.inputTopologyBytes / 1_000_000).toFixed(1)} MB`,
);
