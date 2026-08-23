import "./blueprint-geometry.test.js";
import "./blueprint-svg.test.js";
import "./blueprint-interaction.test.js";
import "./geometry3d.test.js";
import "./physics3d.test.js";
import "./live-physics3d.test.js";
import "./three-scene.test.js";
import "./three-renderer.test.js";
import "./three-controls.test.js";
import "./presentation.test.js";
import "./three-presentation.test.js";
import "./three-labels.test.js";

import {
  VisualNetworkError,
  normalizeVisualLinkNetwork,
  validateVisualLinkNetwork,
  type VisualLink,
  type VisualLinkNetwork,
  type VisualNetworkErrorCode,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual V0: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function expectCode(effect: () => unknown, code: VisualNetworkErrorCode, message: string): void {
  try {
    effect();
  } catch (error) {
    assert(error instanceof VisualNetworkError, `${message}: wrong error type`);
    same(error.code, code, `${message}: wrong error code`);
    return;
  }
  throw new Error(`@mts/visual V0: ${message}: expected rejection`);
}

function basisLinks(): VisualLink[] {
  return [
    { key: "R", startKey: "R", endKey: "R", label: "∞", tags: ["root"] },
    { key: "O", startKey: "O", endKey: "R" },
    { key: "C", startKey: "R", endKey: "C" },
    { key: "L", startKey: "O", endKey: "C" },
    { key: "U", startKey: "C", endKey: "O" },
    { key: "X", startKey: "L", endKey: "U", tags: ["link-of-links"] },
  ];
}

const basis: VisualLinkNetwork = { links: basisLinks() };
validateVisualLinkNetwork(basis);

const normalized = normalizeVisualLinkNetwork(basis);
same(normalized.links.length, 6, "all links preserved");
same(normalized.links.map((link) => link.key).join(","), "C,L,O,R,U,X", "stable key order");

const root = normalized.links.find((link) => link.key === "R");
assert(root !== undefined, "root presentation retained");
same(root.startKey, "R", "self-link start retained");
same(root.endKey, "R", "self-link end retained");
same(root.label, "∞", "presentation label retained");
same(root.tags?.join(","), "root", "presentation tags retained");

const linkOfLinks = normalized.links.find((link) => link.key === "X");
assert(linkOfLinks !== undefined, "link-of-links retained");
same(linkOfLinks.startKey, "L", "link-of-links start retained");
same(linkOfLinks.endKey, "U", "link-of-links end retained");

const reordered: VisualLinkNetwork = { links: [...basisLinks()].reverse() };
const normalizedReordered = normalizeVisualLinkNetwork(reordered);
const topology = (network: VisualLinkNetwork): string =>
  JSON.stringify(network.links.map(({ key, startKey, endKey }) => ({ key, startKey, endKey })));
same(topology(normalizedReordered), topology(normalized), "input order does not alter normalized topology");

const relabeled: VisualLinkNetwork = {
  links: basisLinks().map((link) =>
    link.key === "X" ? { ...link, label: "display only", tags: ["selected", "debug"] } : link,
  ),
};
same(topology(normalizeVisualLinkNetwork(relabeled)), topology(normalized), "metadata does not alter topology");

expectCode(
  () => validateVisualLinkNetwork({ links: [...basisLinks(), { key: "R", startKey: "R", endKey: "R" }] }),
  "duplicate-key",
  "duplicate visual key",
);
expectCode(
  () => validateVisualLinkNetwork({ links: [{ key: "   ", startKey: "   ", endKey: "   " }] }),
  "empty-key",
  "blank visual key",
);
expectCode(
  () => validateVisualLinkNetwork({ links: [...basisLinks(), { key: "Y", startKey: "missing", endKey: "R" }] }),
  "missing-start",
  "missing start reference",
);
expectCode(
  () => validateVisualLinkNetwork({ links: [...basisLinks(), { key: "Y", startKey: "R", endKey: "missing" }] }),
  "missing-end",
  "missing end reference",
);
expectCode(
  () =>
    validateVisualLinkNetwork({
      links: [...basisLinks(), { key: "Y", startKey: "missing", endKey: "R", label: "missing", tags: ["missing"] }],
    }),
  "missing-start",
  "metadata cannot repair invalid topology",
);
expectCode(
  () => validateVisualLinkNetwork({ links: [...basisLinks(), { key: "Y", startKey: " ", endKey: "R" }] }),
  "empty-start",
  "blank start reference",
);
expectCode(
  () => validateVisualLinkNetwork({ links: [...basisLinks(), { key: "Y", startKey: "R", endKey: "\t" }] }),
  "empty-end",
  "blank end reference",
);

assert(Object.isFrozen(normalized), "normalized network is immutable presentation snapshot");
assert(Object.isFrozen(normalized.links), "normalized link list is immutable presentation snapshot");
