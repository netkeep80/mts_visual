import {
  VisualPresentationError,
  normalizeVisualPresentationState,
  validateVisualPresentationState,
  type VisualLinkNetwork,
  type VisualPresentationErrorCode,
  type VisualPresentationState,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V2g-A: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function expectCode(
  effect: () => unknown,
  code: VisualPresentationErrorCode,
  message: string,
): void {
  try {
    effect();
  } catch (error) {
    assert(error instanceof VisualPresentationError, `${message}: wrong error type`);
    same(error.code, code, `${message}: wrong error code`);
    return;
  }
  throw new Error(`@mts/visual V2g-A: ${message}: expected rejection`);
}

const network: VisualLinkNetwork = {
  links: [
    { key: "R", startKey: "R", endKey: "R", label: "∞", tags: ["root"] },
    { key: "O", startKey: "O", endKey: "R" },
    { key: "C", startKey: "R", endKey: "C" },
    { key: "L", startKey: "O", endKey: "C" },
    { key: "U", startKey: "C", endKey: "O" },
    { key: "X", startKey: "L", endKey: "U", label: "link-of-links" },
  ],
};

const topologyBefore = JSON.stringify(network);
const inputHalo = { color: 0x336699, scale: 1.4, opacity: 0.6 };
const state: VisualPresentationState = {
  links: [
    { key: "X", visible: false },
    { key: "R", emphasis: 1.35, selected: true, labelVisible: true, halo: inputHalo },
  ],
};
const stateBefore = JSON.stringify(state);

validateVisualPresentationState(network, { links: [] });
validateVisualPresentationState(network, state);

const normalized = normalizeVisualPresentationState(network, state);
same(normalized.links.length, 2, "all overrides preserved");
same(normalized.links.map((entry) => entry.key).join(","), "R,X", "stable key order");
same(JSON.stringify(network), topologyBefore, "network remains unchanged");
same(JSON.stringify(state), stateBefore, "input state remains unchanged");
assert(Object.isFrozen(normalized), "normalized state is frozen");
assert(Object.isFrozen(normalized.links), "normalized links array is frozen");

const root = normalized.links[0];
assert(root !== undefined && root.key === "R", "root override retained as ordinary key");
same(root.emphasis, 1.35, "root emphasis retained");
same(root.selected, true, "root selected retained");
same(root.labelVisible, true, "root label visibility retained");
assert(root.halo !== undefined, "root halo retained");
same(root.halo.color, 0x336699, "halo color retained");
same(root.halo.scale, 1.4, "halo scale retained");
same(root.halo.opacity, 0.6, "halo opacity retained");
assert(root.halo !== inputHalo, "halo is cloned rather than aliased");
assert(Object.isFrozen(root), "normalized override is frozen");
assert(Object.isFrozen(root.halo), "normalized halo is frozen");

const reordered = normalizeVisualPresentationState(network, {
  links: [...state.links].reverse(),
});
same(JSON.stringify(reordered), JSON.stringify(normalized), "input order does not alter normalized state");

expectCode(
  () => validateVisualPresentationState(network, { links: [{ key: "   " }] }),
  "empty-key",
  "blank presentation key",
);
expectCode(
  () => validateVisualPresentationState(network, { links: [{ key: "missing" }] }),
  "unknown-key",
  "unknown presentation key",
);
expectCode(
  () => validateVisualPresentationState(network, { links: [{ key: "R" }, { key: "R" }] }),
  "duplicate-key",
  "duplicate presentation key",
);

for (const emphasis of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  expectCode(
    () => validateVisualPresentationState(network, { links: [{ key: "R", emphasis }] }),
    "invalid-emphasis",
    `invalid emphasis ${String(emphasis)}`,
  );
}

for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  expectCode(
    () => validateVisualPresentationState(network, { links: [{ key: "R", halo: { color: 0, scale } }] }),
    "invalid-halo-scale",
    `invalid halo scale ${String(scale)}`,
  );
}

for (const opacity of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
  expectCode(
    () => validateVisualPresentationState(network, { links: [{ key: "R", halo: { color: 0, opacity } }] }),
    "invalid-halo-opacity",
    `invalid halo opacity ${String(opacity)}`,
  );
}

for (const color of [-1, 0x1000000, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  expectCode(
    () => validateVisualPresentationState(network, { links: [{ key: "R", halo: { color } }] }),
    "invalid-halo-color",
    `invalid halo color ${String(color)}`,
  );
}
