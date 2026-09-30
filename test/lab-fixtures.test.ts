import {
  VISUAL_LAB_FIXTURE_DEFINITIONS,
  createClassicSeparationNetwork,
  createHubHeavyNetwork,
  createRootBasisNetwork,
  validateVisualLinkNetwork,
  visualLabFixture,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`lab-fixtures: ${message}`);
}

const expectedIds = [
  "single-link",
  "root-r",
  "root-ro",
  "root-roc",
  "root-rocl",
  "root-roclu",
  "self-incidence",
  "links-branching",
  "medium-compact",
  "article-root",
  "classic-separation",
  "hub-64",
  "hub-333",
  "hub-1000",
];

assert(
  VISUAL_LAB_FIXTURE_DEFINITIONS.map((fixture) => fixture.id).join(",")
    === expectedIds.join(","),
  "fixture registry order is stable",
);
assert(new Set(expectedIds).size === expectedIds.length, "fixture ids unique");

for (const definition of VISUAL_LAB_FIXTURE_DEFINITIONS) {
  assert(Object.isFrozen(definition), `${definition.id}: definition frozen`);
  assert(Object.isFrozen(definition.tags), `${definition.id}: tags frozen`);
  const first = visualLabFixture(definition.id);
  const second = visualLabFixture(definition.id);
  assert(first === second, `${definition.id}: fixture identity cached`);
  assert(Object.isFrozen(first), `${definition.id}: fixture frozen`);
  assert(Object.isFrozen(first.network), `${definition.id}: network frozen`);
  assert(Object.isFrozen(first.network.links), `${definition.id}: links frozen`);
  assert(first.network.links.every(Object.isFrozen), `${definition.id}: Link records frozen`);
  validateVisualLinkNetwork(first.network);
  if (first.hints?.rootKey !== undefined) {
    assert(
      first.network.links.some((link) => link.key === first.hints!.rootKey),
      `${definition.id}: root hint resolves in fixture network`,
    );
  }
}

assert(visualLabFixture("single-link").network.links.length === 1, "single-link size");
assert(visualLabFixture("root-roclu").network.links.length === 5, "root basis size");
assert(visualLabFixture("medium-compact").network.links.length === 18, "medium fixture size");
assert(visualLabFixture("hub-64").network.links.length === 64, "hub-64 size");
assert(visualLabFixture("hub-333").network.links.length === 333, "hub-333 size");
assert(visualLabFixture("hub-1000").network.links.length === 1000, "hub-1000 size");

const article = visualLabFixture("article-root");
assert(
  article.network.links.map((link) => link.key).join(",") === "R,O,C,L,U,X",
  "article fixture topology matches canonical publication fixture",
);
assert(article.hints?.rootKey === "R", "article fixture explicit root hint");

const classic = createClassicSeparationNetwork();
validateVisualLinkNetwork(classic);
assert(classic.links.length === 10, "Classic separation fixture size");

for (let count = 1; count <= 5; count += 1) {
  const root = createRootBasisNetwork(count);
  validateVisualLinkNetwork(root);
  assert(root.links.length === count, `root basis count ${count}`);
}

for (const count of [8, 18, 64]) {
  const hub = createHubHeavyNetwork(count);
  validateVisualLinkNetwork(hub);
  assert(hub.links.length === count, `hub-heavy count ${count}`);
}

let unknownRejected = false;
try {
  visualLabFixture("missing");
} catch {
  unknownRejected = true;
}
assert(unknownRejected, "unknown fixture fails closed");

let invalidRootRejected = false;
try {
  createRootBasisNetwork(0);
} catch {
  invalidRootRejected = true;
}
assert(invalidRootRejected, "invalid root basis count fails closed");

let invalidHubRejected = false;
try {
  createHubHeavyNetwork(7);
} catch {
  invalidHubRejected = true;
}
assert(invalidHubRejected, "invalid hub-heavy count fails closed");
