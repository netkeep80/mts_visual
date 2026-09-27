import {
  createMonolithicLinkSpringPhysics3D,
  getMonolithicLinkSpringTemplate3D,
  type MonolithicLinkVec3,
} from "../src/monolithic-link-spring3d.js";
import {
  deriveMonolithicLinkShape3D,
  deriveMonolithicNetworkShape3D,
} from "../src/monolithic-link-shape3d.js";
import type { VisualLinkNetwork } from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`@mts/visual v0.5/#92 monolithic shape: ${message}`);
  }
}

function approx(
  actual: number,
  expected: number,
  message: string,
  epsilon = 1e-5,
): void {
  assert(
    Math.abs(actual - expected) <= epsilon,
    `${message}: ${actual} != ${expected} (eps=${epsilon})`,
  );
}

function read3(values: Float32Array, index: number): MonolithicLinkVec3 {
  const offset = index * 3;
  return [values[offset]!, values[offset + 1]!, values[offset + 2]!];
}

function subtract3(a: MonolithicLinkVec3, b: MonolithicLinkVec3): MonolithicLinkVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length3(value: MonolithicLinkVec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function dot3(a: MonolithicLinkVec3, b: MonolithicLinkVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalized(value: MonolithicLinkVec3): MonolithicLinkVec3 {
  const length = length3(value);
  assert(length > 1e-9, "cannot normalize zero vector");
  return [value[0] / length, value[1] / length, value[2] / length];
}

function polylineLength(
  values: Float32Array,
  begin: number,
  end: number,
): number {
  let result = 0;
  for (let index = begin; index < end; index += 1) {
    result += length3(subtract3(read3(values, index + 1), read3(values, index)));
  }
  return result;
}

function pointDelta(
  left: Float32Array,
  right: Float32Array,
  index: number,
): number {
  return length3(subtract3(read3(left, index), read3(right, index)));
}

const template = getMonolithicLinkSpringTemplate3D(16 * Math.SQRT2);
assert(template.octahedronCount === 32, "shape witness resolves 32 octahedra");
const halfSegments = template.octahedronCount / 2;
const h = template.halfRestLength;

const straight = deriveMonolithicLinkShape3D(
  template,
  [0, 0, 0],
  [h, 0, 0],
  [2 * h, 0, 0],
  0,
);
assert(
  straight.sectionCount === template.octahedronCount + 1,
  "one derived connecting-triangle center per octahedron boundary",
);
assert(
  straight.centerSection === halfSegments,
  "semantic CENTER is the middle connecting triangle",
);
for (let index = 0; index < straight.sectionCount; index += 1) {
  const point = read3(straight.sectionCenters, index);
  approx(point[0], index * template.moduleHeight, `straight Q${index} x`, 2e-5);
  approx(point[1], 0, `straight Q${index} y`, 2e-5);
  approx(point[2], 0, `straight Q${index} z`, 2e-5);
}
approx(
  polylineLength(straight.sectionCenters, 0, halfSegments),
  h,
  "straight first half reproduces rest arc length",
  2e-4,
);
approx(
  polylineLength(straight.sectionCenters, halfSegments, template.octahedronCount),
  h,
  "straight second half reproduces rest arc length",
  2e-4,
);

const compressedStart: MonolithicLinkVec3 = [0, 0, 0];
const compressedCenter: MonolithicLinkVec3 = [h * 0.64, 0, 0];
const compressedEnd: MonolithicLinkVec3 = [h * 1.28, 0, 0];
const compressed = deriveMonolithicLinkShape3D(
  template,
  compressedStart,
  compressedCenter,
  compressedEnd,
  3,
);
approx(
  compressed.firstHalfArcLength,
  h,
  "compressed first half globally buckles to its rest arc length",
  2e-4,
);
approx(
  compressed.secondHalfArcLength,
  h,
  "compressed second half globally buckles to its rest arc length",
  2e-4,
);
assert(
  polylineLength(compressed.sectionCenters, 0, halfSegments) > h * 0.98,
  "resampled compressed first half preserves the rest-scale arc within the expected finite-section chord approximation",
);
assert(
  polylineLength(
    compressed.sectionCenters,
    halfSegments,
    template.octahedronCount,
  ) > h * 0.98,
  "resampled compressed second half preserves the rest-scale arc within the expected finite-section chord approximation",
);
assert(
  Math.max(
    ...Array.from({ length: compressed.sectionCount }, (_, index) =>
      Math.hypot(
        read3(compressed.sectionCenters, index)[1],
        read3(compressed.sectionCenters, index)[2],
      )),
  ) > template.diameter * 0.2,
  "compression is represented by global bowing rather than shortening every local module",
);

const bentStart: MonolithicLinkVec3 = [-h, 0, 0];
const bentCenter: MonolithicLinkVec3 = [0, 2.0, 0.5];
const bentEnd: MonolithicLinkVec3 = [h, 0.2, 1.0];
const bent = deriveMonolithicLinkShape3D(
  template,
  bentStart,
  bentCenter,
  bentEnd,
  7,
);
const centerPoint = read3(bent.sectionCenters, bent.centerSection);
approx(length3(subtract3(centerPoint, bentCenter)), 0, "derived centerline passes exactly through semantic CENTER", 1e-6);
approx(length3(subtract3(read3(bent.sectionCenters, 0), bentStart)), 0, "derived centerline begins exactly at START", 1e-6);
approx(
  length3(
    subtract3(
      read3(bent.sectionCenters, bent.sectionCount - 1),
      bentEnd,
    ),
  ),
  0,
  "derived centerline ends exactly at END",
  1e-6,
);

const intoCenter = normalized(
  subtract3(
    read3(bent.sectionCenters, bent.centerSection),
    read3(bent.sectionCenters, bent.centerSection - 1),
  ),
);
const outOfCenter = normalized(
  subtract3(
    read3(bent.sectionCenters, bent.centerSection + 1),
    read3(bent.sectionCenters, bent.centerSection),
  ),
);
assert(
  dot3(intoCenter, outOfCenter) > 0.97,
  "two globally reconstructed halves meet with a continuous center tangent",
);

for (let section = 0; section < bent.sectionCount; section += 1) {
  const offset = section * 4;
  const qNorm = Math.hypot(
    bent.sectionOrientations[offset]!,
    bent.sectionOrientations[offset + 1]!,
    bent.sectionOrientations[offset + 2]!,
    bent.sectionOrientations[offset + 3]!,
  );
  approx(qNorm, 1, `derived section quaternion ${section} is normalized`, 2e-6);
}

// Full self-incidence uses a finite, explicitly non-circular closed carrier.
const selfAnchor: MonolithicLinkVec3 = [1.25, -0.75, 2.0];
const self = deriveMonolithicLinkShape3D(
  template,
  selfAnchor,
  selfAnchor,
  selfAnchor,
  11,
);
approx(
  length3(subtract3(read3(self.sectionCenters, 0), selfAnchor)),
  0,
  "double-self START aliases CENTER exactly",
  1e-6,
);
approx(
  length3(
    subtract3(
      read3(self.sectionCenters, self.centerSection),
      selfAnchor,
    ),
  ),
  0,
  "double-self middle aliases CENTER exactly",
  1e-6,
);
approx(
  length3(
    subtract3(
      read3(self.sectionCenters, self.sectionCount - 1),
      selfAnchor,
    ),
  ),
  0,
  "double-self END aliases CENTER exactly",
  1e-6,
);
const selfTurns: number[] = [];
for (let section = 1; section < self.centerSection; section += 1) {
  const before = normalized(
    subtract3(
      read3(self.sectionCenters, section),
      read3(self.sectionCenters, section - 1),
    ),
  );
  const after = normalized(
    subtract3(
      read3(self.sectionCenters, section + 1),
      read3(self.sectionCenters, section),
    ),
  );
  selfTurns.push(
    Math.acos(Math.max(-1, Math.min(1, dot3(before, after)))),
  );
}
const selfTurnMean =
  selfTurns.reduce((sum, value) => sum + value, 0) / selfTurns.length;
const selfTurnStd = Math.sqrt(
  selfTurns.reduce(
    (sum, value) => sum + (value - selfTurnMean) ** 2,
    0,
  ) / selfTurns.length,
);
assert(
  selfTurnStd > 0.01,
  "self carrier is deliberately non-circular rather than a constant-curvature ring",
);
assert(
  polylineLength(self.sectionCenters, 0, self.centerSection) > h * 0.98,
  "self first half retains finite rest-scale material extent",
);

// Same physics tick / same shape rebuild: changing CENTER changes derived
// geometry on both halves immediately; there is no section-wise relaxation.
const beforeMove = deriveMonolithicLinkShape3D(
  template,
  bentStart,
  bentCenter,
  bentEnd,
  7,
);
const movedCenter: MonolithicLinkVec3 = [
  bentCenter[0] + 0.8,
  bentCenter[1] - 0.5,
  bentCenter[2] + 0.35,
];
const afterMove = deriveMonolithicLinkShape3D(
  template,
  bentStart,
  movedCenter,
  bentEnd,
  7,
);
assert(
  pointDelta(
    beforeMove.sectionCenters,
    afterMove.sectionCenters,
    Math.floor(halfSegments / 2),
  ) > 1e-3,
  "CENTER change immediately rebuilds an interior point on the START half",
);
assert(
  pointDelta(
    beforeMove.sectionCenters,
    afterMove.sectionCenters,
    halfSegments + Math.floor(halfSegments / 2),
  ) > 1e-3,
  "CENTER change immediately rebuilds an interior point on the END half",
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
const physics = createMonolithicLinkSpringPhysics3D(basis, {
  aspectRatio: 16 * Math.SQRT2,
  stretchStiffness: 4,
  straighteningStiffness: 2,
  nonlinearity: 0,
  centerMass: 1,
  dampingRate: 1,
  simulationSpeed: 1,
});
const networkShape = deriveMonolithicNetworkShape3D(
  physics.template,
  physics.topology,
  physics.centers,
);
assert(
  networkShape.derivedSectionCount
    === basis.links.length * (template.octahedronCount + 1),
  "network derives one presentation section stack per semantic Link",
);
assert(
  networkShape.sectionCenters.length
    === networkShape.derivedSectionCount * 3,
  "derived center buffer has exact packed vec3 size",
);
assert(
  networkShape.sectionOrientations.length
    === networkShape.derivedSectionCount * 4,
  "derived orientation buffer has exact packed quaternion size",
);
assert(
  physics.centers.length === basis.links.length * 3,
  "authoritative physical state remains semantic-center sized while derived geometry is larger",
);

console.log(
  `[v0.5 #92 monolithic shape] PASS sections=${template.octahedronCount + 1} `
  + `compressedArc=[${compressed.firstHalfArcLength.toFixed(6)},${compressed.secondHalfArcLength.toFixed(6)}] `
  + `selfTurnStd=${selfTurnStd.toExponential(4)} derived=${networkShape.derivedSectionCount}`,
);
