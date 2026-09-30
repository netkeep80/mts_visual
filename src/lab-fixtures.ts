import type { VisualKey, VisualLink, VisualLinkNetwork } from "./index.js";

export interface VisualLabFixtureHints {
  readonly rootKey?: VisualKey;
}

export interface VisualLabFixtureDefinition {
  readonly id: string;
  readonly label: string;
  readonly tags: readonly string[];
  readonly hints?: VisualLabFixtureHints;
}

export interface VisualLabFixture extends VisualLabFixtureDefinition {
  readonly network: VisualLinkNetwork;
}

interface InternalFixtureDefinition extends VisualLabFixtureDefinition {
  readonly createNetwork: () => VisualLinkNetwork;
}

const ROOT_BASIS = Object.freeze([
  Object.freeze({ key: "R", startKey: "R", endKey: "R", label: "ROOT" }),
  Object.freeze({ key: "O", startKey: "O", endKey: "R", label: "START" }),
  Object.freeze({ key: "C", startKey: "R", endKey: "C", label: "END" }),
  Object.freeze({ key: "L", startKey: "O", endKey: "C", label: "PAIR" }),
  Object.freeze({ key: "U", startKey: "C", endKey: "O", label: "U" }),
] as const);

const definitions: readonly InternalFixtureDefinition[] = Object.freeze([
  fixtureDefinition("single-link", "Одна самозамкнутая связь", ["small", "self-incidence"], () => ({
    links: [{ key: "R", startKey: "R", endKey: "R", label: "R" }],
  }), { rootKey: "R" }),
  ...[1, 2, 3, 4, 5].map((count) =>
    fixtureDefinition(
      ["root-r", "root-ro", "root-roc", "root-rocl", "root-roclu"][count - 1]!,
      [
        "только R",
        "R + O",
        "R + O + C",
        "R + O + C + L",
        "R + O + C + L + U",
      ][count - 1]!,
      ["root", "recursive", "basis"],
      () => createRootBasisNetwork(count),
      { rootKey: "R" },
    )
  ),
  fixtureDefinition(
    "self-incidence",
    "Самоинцидентность START / END / double-self",
    ["self-incidence", "recursive", "debug"],
    () => ({
      links: [
        { key: "R", startKey: "R", endKey: "R", label: "double-self" },
        { key: "O", startKey: "O", endKey: "R", label: "START-self" },
        { key: "C", startKey: "R", endKey: "C", label: "END-self" },
      ],
    }),
    { rootKey: "R" },
  ),
  fixtureDefinition(
    "links-branching",
    "Связи связей · ветвление",
    ["links-of-links", "branching", "medium"],
    () => ({
      links: [
        ...ROOT_BASIS,
        { key: "A", startKey: "L", endKey: "U", label: "A" },
        { key: "B", startKey: "L", endKey: "A", label: "B" },
        { key: "D", startKey: "B", endKey: "U", label: "D" },
        { key: "E", startKey: "A", endKey: "D", label: "E" },
      ],
    }),
    { rootKey: "R" },
  ),
  fixtureDefinition(
    "medium-compact",
    "Средняя асеть · 18 связей",
    ["medium", "stress"],
    () => createHubHeavyNetwork(18),
  ),
  fixtureDefinition(
    "article-root",
    "Статья · R/O/C/L/U + link-of-links",
    ["article", "document", "publication"],
    () => ({
      links: [
        ...ROOT_BASIS,
        { key: "X", startKey: "L", endKey: "U", label: "link of links" },
      ],
    }),
    { rootKey: "R" },
  ),
  fixtureDefinition(
    "classic-separation",
    "Classic · разведение похожих связей",
    ["classic-3d", "repulsion", "separation"],
    createClassicSeparationNetwork,
    { rootKey: "R" },
  ),
  fixtureDefinition("hub-64", "нагрузка · 64 связи", ["stress", "hub"], () => createHubHeavyNetwork(64)),
  fixtureDefinition("hub-333", "нагрузка · 333 связи", ["stress", "hub"], () => createHubHeavyNetwork(333)),
  fixtureDefinition("hub-1000", "нагрузка · 1 000 связей", ["stress", "hub"], () => createHubHeavyNetwork(1000)),
]);

export const VISUAL_LAB_FIXTURE_DEFINITIONS: readonly VisualLabFixtureDefinition[] =
  Object.freeze(definitions.map(({ createNetwork: _createNetwork, ...definition }) =>
    Object.freeze({
      ...definition,
      tags: Object.freeze([...definition.tags]),
      ...(definition.hints === undefined
        ? {}
        : { hints: Object.freeze({ ...definition.hints }) }),
    })
  ));

const definitionById = new Map(definitions.map((definition) => [definition.id, definition] as const));
const fixtureCache = new Map<string, VisualLabFixture>();

export function visualLabFixture(id: string): VisualLabFixture {
  const cached = fixtureCache.get(id);
  if (cached !== undefined) return cached;

  const definition = definitionById.get(id);
  if (definition === undefined) throw new Error(`unknown visual lab fixture: ${id}`);

  const fixture = Object.freeze({
    id: definition.id,
    label: definition.label,
    tags: Object.freeze([...definition.tags]),
    ...(definition.hints === undefined
      ? {}
      : { hints: Object.freeze({ ...definition.hints }) }),
    network: freezeNetwork(definition.createNetwork()),
  });
  fixtureCache.set(id, fixture);
  return fixture;
}

export function createRootBasisNetwork(count: number): VisualLinkNetwork {
  if (!Number.isSafeInteger(count) || count < 1 || count > ROOT_BASIS.length) {
    throw new RangeError(`root basis count must be within 1..${ROOT_BASIS.length}`);
  }
  return freezeNetwork({
    links: ROOT_BASIS.slice(0, count).map(({ key, startKey, endKey, label }) => ({
      key,
      startKey,
      endKey,
      label,
    })),
  });
}

export function createClassicSeparationNetwork(): VisualLinkNetwork {
  return freezeNetwork({
    links: [
      { key: "R", startKey: "R", endKey: "R" },
      { key: "O", startKey: "O", endKey: "R" },
      { key: "C", startKey: "R", endKey: "C" },
      { key: "L", startKey: "O", endKey: "C" },
      { key: "U", startKey: "C", endKey: "O" },
      { key: "A", startKey: "L", endKey: "U" },
      { key: "B", startKey: "L", endKey: "A" },
      { key: "D", startKey: "B", endKey: "U" },
      { key: "E", startKey: "A", endKey: "D" },
      { key: "F", startKey: "B", endKey: "E" },
    ],
  });
}

export function createHubHeavyNetwork(count: number): VisualLinkNetwork {
  if (!Number.isSafeInteger(count) || count < 8) {
    throw new RangeError("hub-heavy fixture requires at least 8 Links");
  }

  const links: VisualLink[] = [
    { key: "L1", startKey: "L1", endKey: "L1" },
    { key: "L2", startKey: "L2", endKey: "L1" },
    { key: "L3", startKey: "L1", endKey: "L3" },
  ];
  const key = (oneBased: number): string => `L${oneBased}`;

  for (let oneBased = 4; oneBased <= count; oneBased += 1) {
    const previous = key(oneBased - 1);
    const previous2 = key(Math.max(1, oneBased - 2));
    const self = key(oneBased);
    const role = oneBased % 16;

    let startKey: string;
    let endKey: string;
    switch (role) {
      case 0: startKey = previous; endKey = "L2"; break;
      case 1: startKey = previous; endKey = "L3"; break;
      case 2: startKey = self; endKey = previous; break;
      case 3: startKey = "L1"; endKey = previous; break;
      case 4: startKey = previous2; endKey = "L2"; break;
      case 5: startKey = previous2; endKey = "L3"; break;
      case 6: startKey = previous2; endKey = previous; break;
      case 7: startKey = previous; endKey = previous2; break;
      default:
        startKey = previous;
        endKey = oneBased % 3 === 0 ? "L3" : "L2";
        break;
    }
    links.push({ key: self, startKey, endKey });
  }
  return freezeNetwork({ links });
}

function fixtureDefinition(
  id: string,
  label: string,
  tags: readonly string[],
  createNetwork: () => VisualLinkNetwork,
  hints?: VisualLabFixtureHints,
): InternalFixtureDefinition {
  return Object.freeze({
    id,
    label,
    tags: Object.freeze([...tags]),
    ...(hints === undefined ? {} : { hints: Object.freeze({ ...hints }) }),
    createNetwork,
  });
}

function freezeNetwork(network: VisualLinkNetwork): VisualLinkNetwork {
  return Object.freeze({
    links: Object.freeze(network.links.map((link) => Object.freeze({
      key: link.key,
      startKey: link.startKey,
      endKey: link.endKey,
      ...(link.label === undefined ? {} : { label: link.label }),
      ...(link.tags === undefined ? {} : { tags: Object.freeze([...link.tags]) }),
    }))),
  });
}
