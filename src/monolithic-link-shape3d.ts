import type { OctahedralLinkTopology3D } from "./octahedral-link3d.js";
import type {
  MonolithicLinkSpringTemplate3D,
  MonolithicLinkVec3,
} from "./monolithic-link-spring3d.js";

const EPSILON = 1e-9;
const TWO_PI = 2 * Math.PI;
const SELF_HINGE_OPENING = Math.PI;
export const MONOLITHIC_SELF_LOOP_UNIT_ARC_LENGTH = 8.448334738583334;
const ARC_INTEGRATION_STEPS = 96;
const ARC_BISECTION_STEPS = 40;
const ROLL_GAUGE_WEAK_BEND_SINE = 0.015;
const ROLL_GAUGE_STRONG_BEND_SINE = 0.08;

export type MonolithicLinkQuat = readonly [number, number, number, number];

export interface MonolithicLinkShape3D {
  readonly sectionCenters: Float32Array;
  readonly sectionOrientations: Float32Array;
  readonly sectionCount: number;
  readonly centerSection: number;
  readonly firstHalfArcLength: number;
  readonly secondHalfArcLength: number;
}

export interface MonolithicNetworkShape3D {
  readonly sectionCenters: Float32Array;
  readonly sectionOrientations: Float32Array;
  readonly linkCount: number;
  readonly sectionCount: number;
  readonly derivedSectionCount: number;
}

export interface MonolithicLinkRollGauge3D {
  readonly normal: MonolithicLinkVec3;
  readonly bendSine: number;
  readonly geometricWeight: number;
}

function add3(a: MonolithicLinkVec3, b: MonolithicLinkVec3): MonolithicLinkVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract3(
  a: MonolithicLinkVec3,
  b: MonolithicLinkVec3,
): MonolithicLinkVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale3(a: MonolithicLinkVec3, scale: number): MonolithicLinkVec3 {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

function dot3(a: MonolithicLinkVec3, b: MonolithicLinkVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: MonolithicLinkVec3, b: MonolithicLinkVec3): MonolithicLinkVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length3(a: MonolithicLinkVec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize3(
  value: MonolithicLinkVec3,
  fallback: MonolithicLinkVec3 = [0, 0, 1],
): MonolithicLinkVec3 {
  const length = length3(value);
  if (!(length > EPSILON) || !Number.isFinite(length)) return fallback;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function readVec3(values: Float32Array, index: number): MonolithicLinkVec3 {
  const offset = index * 3;
  return [values[offset]!, values[offset + 1]!, values[offset + 2]!];
}

function writeVec3(
  values: Float32Array,
  index: number,
  value: MonolithicLinkVec3,
): void {
  const offset = index * 3;
  values[offset] = value[0];
  values[offset + 1] = value[1];
  values[offset + 2] = value[2];
}

function writeQuat(
  values: Float32Array,
  index: number,
  value: MonolithicLinkQuat,
): void {
  const offset = index * 4;
  values[offset] = value[0];
  values[offset + 1] = value[1];
  values[offset + 2] = value[2];
  values[offset + 3] = value[3];
}

function deterministicAxes(
  linkIndex: number,
): readonly [MonolithicLinkVec3, MonolithicLinkVec3, MonolithicLinkVec3] {
  const angle = (linkIndex * 0.7548776662466927) % TWO_PI;
  const z = normalize3([
    Math.cos(angle),
    0.35 + 0.1 * Math.sin(angle * 1.7),
    Math.sin(angle),
  ]);
  const helper: MonolithicLinkVec3 = Math.abs(z[1]) < 0.9
    ? [0, 1, 0]
    : [1, 0, 0];
  const x = normalize3(cross3(helper, z), [1, 0, 0]);
  const y = normalize3(cross3(z, x), [0, 1, 0]);
  return [x, y, z];
}

function deterministicPerpendicular(
  direction: MonolithicLinkVec3,
  linkIndex: number,
): MonolithicLinkVec3 {
  const axes = deterministicAxes(linkIndex);
  const candidates = [axes[0], axes[1], axes[2]] as const;
  let best = candidates[0];
  let bestAlignment = Math.abs(dot3(best, direction));
  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const alignment = Math.abs(dot3(candidate, direction));
    if (alignment < bestAlignment) {
      best = candidate;
      bestAlignment = alignment;
    }
  }
  return normalize3(
    subtract3(best, scale3(direction, dot3(best, direction))),
    axes[0],
  );
}

function quaternionFromBasis(
  xAxis: MonolithicLinkVec3,
  yAxis: MonolithicLinkVec3,
  zAxis: MonolithicLinkVec3,
): MonolithicLinkQuat {
  const m00 = xAxis[0];
  const m01 = yAxis[0];
  const m02 = zAxis[0];
  const m10 = xAxis[1];
  const m11 = yAxis[1];
  const m12 = zAxis[1];
  const m20 = xAxis[2];
  const m21 = yAxis[2];
  const m22 = zAxis[2];
  const trace = m00 + m11 + m22;

  let x: number;
  let y: number;
  let z: number;
  let w: number;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }

  const norm = Math.hypot(x, y, z, w);
  if (!(norm > EPSILON)) return [0, 0, 0, 1];
  return [x / norm, y / norm, z / norm, w / norm];
}

function rotateAroundAxis(
  value: MonolithicLinkVec3,
  axis: MonolithicLinkVec3,
  angle: number,
): MonolithicLinkVec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return add3(
    add3(
      scale3(value, cosine),
      scale3(cross3(axis, value), sine),
    ),
    scale3(axis, dot3(axis, value) * (1 - cosine)),
  );
}

function hermitePoint(
  start: MonolithicLinkVec3,
  end: MonolithicLinkVec3,
  startTangent: MonolithicLinkVec3,
  endTangent: MonolithicLinkVec3,
  t: number,
): MonolithicLinkVec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return [
    h00 * start[0] + h10 * startTangent[0] + h01 * end[0] + h11 * endTangent[0],
    h00 * start[1] + h10 * startTangent[1] + h01 * end[1] + h11 * endTangent[1],
    h00 * start[2] + h10 * startTangent[2] + h01 * end[2] + h11 * endTangent[2],
  ];
}

function hermiteDerivative(
  start: MonolithicLinkVec3,
  end: MonolithicLinkVec3,
  startTangent: MonolithicLinkVec3,
  endTangent: MonolithicLinkVec3,
  t: number,
): MonolithicLinkVec3 {
  const t2 = t * t;
  const h00 = 6 * t2 - 6 * t;
  const h10 = 3 * t2 - 4 * t + 1;
  const h01 = -6 * t2 + 6 * t;
  const h11 = 3 * t2 - 2 * t;
  return [
    h00 * start[0] + h10 * startTangent[0] + h01 * end[0] + h11 * endTangent[0],
    h00 * start[1] + h10 * startTangent[1] + h01 * end[1] + h11 * endTangent[1],
    h00 * start[2] + h10 * startTangent[2] + h01 * end[2] + h11 * endTangent[2],
  ];
}

function bucklingBasis(t: number): number {
  // Normalized sixth-order buckling mode:
  // g(0)=g(1)=0, g'(0)=g'(1)=0, g''(0)=g''(1)=0, g(1/2)=1.
  // Zero endpoint curvature avoids injecting a fake bending moment at S/C/E.
  const oneMinus = 1 - t;
  return 64 * t * t * t * oneMinus * oneMinus * oneMinus;
}

function bucklingBasisDerivative(t: number): number {
  const oneMinus = 1 - t;
  return 192 * t * t * oneMinus * oneMinus * (1 - 2 * t);
}

interface HalfCurve {
  readonly point: (t: number) => MonolithicLinkVec3;
  readonly derivative: (t: number) => MonolithicLinkVec3;
  readonly arcLength: number;
}

function simpsonArcLength(
  derivative: (t: number) => MonolithicLinkVec3,
): number {
  const steps = ARC_INTEGRATION_STEPS;
  const h = 1 / steps;
  let sum = length3(derivative(0)) + length3(derivative(1));
  for (let index = 1; index < steps; index += 1) {
    sum += (index % 2 === 0 ? 2 : 4) * length3(derivative(index * h));
  }
  return sum * h / 3;
}

function buildHermiteHalfCurve(
  start: MonolithicLinkVec3,
  end: MonolithicLinkVec3,
  startDirection: MonolithicLinkVec3,
  endDirection: MonolithicLinkVec3,
  bendDirection: MonolithicLinkVec3,
  restArcLength: number,
): HalfCurve {
  const chordLength = length3(subtract3(end, start));
  const tangentScale = Math.max(chordLength, restArcLength * 0.25);
  const startTangent = scale3(normalize3(startDirection), tangentScale);
  const endTangent = scale3(normalize3(endDirection), tangentScale);

  const baseDerivative = (t: number): MonolithicLinkVec3 =>
    hermiteDerivative(start, end, startTangent, endTangent, t);
  const baseLength = simpsonArcLength(baseDerivative);

  let amplitude = 0;
  if (baseLength + 1e-7 < restArcLength) {
    const lengthAt = (candidate: number): number => simpsonArcLength((t) =>
      add3(
        baseDerivative(t),
        scale3(bendDirection, candidate * bucklingBasisDerivative(t)),
      ));

    let low = 0;
    let high = Math.max(restArcLength, chordLength, 1);
    while (lengthAt(high) < restArcLength) high *= 2;
    for (let iteration = 0; iteration < ARC_BISECTION_STEPS; iteration += 1) {
      const middle = (low + high) / 2;
      if (lengthAt(middle) < restArcLength) {
        low = middle;
      } else {
        high = middle;
      }
    }
    amplitude = (low + high) / 2;
  }

  const point = (t: number): MonolithicLinkVec3 =>
    add3(
      hermitePoint(start, end, startTangent, endTangent, t),
      scale3(bendDirection, amplitude * bucklingBasis(t)),
    );
  const derivative = (t: number): MonolithicLinkVec3 =>
    add3(
      baseDerivative(t),
      scale3(bendDirection, amplitude * bucklingBasisDerivative(t)),
    );
  return Object.freeze({
    point,
    derivative,
    arcLength: simpsonArcLength(derivative),
  });
}

function selfLoopBasePoint(u: number): MonolithicLinkVec3 {
  const theta = TWO_PI * u;
  const sinTheta = Math.sin(theta);
  const oneMinusCos = 1 - Math.cos(theta);
  // Positional self-incidence is a hinge, not a welded tangent. This term
  // vanishes at u=0/1 while contributing opposite terminal derivatives.
  const hingeOpening = SELF_HINGE_OPENING * u * (1 - u);
  return [
    0.60 * oneMinusCos * oneMinusCos + hingeOpening,
    0.35 * sinTheta * oneMinusCos,
    sinTheta,
  ];
}

function selfLoopBaseDerivative(u: number): MonolithicLinkVec3 {
  const theta = TWO_PI * u;
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const oneMinusCos = 1 - cosTheta;
  const dTheta = TWO_PI;
  return [
    1.20 * oneMinusCos * sinTheta * dTheta
      + SELF_HINGE_OPENING * (1 - 2 * u),
    0.35 * (cosTheta * oneMinusCos + sinTheta * sinTheta) * dTheta,
    cosTheta * dTheta,
  ];
}

function buildSelfHalfCurve(
  anchor: MonolithicLinkVec3,
  axes: readonly [
    MonolithicLinkVec3,
    MonolithicLinkVec3,
    MonolithicLinkVec3,
  ],
  restArcLength: number,
  lobeSign: number,
): HalfCurve {
  const scale =
    restArcLength / MONOLITHIC_SELF_LOOP_UNIT_ARC_LENGTH;
  const [xAxis, yAxis, zAxis] = axes;

  const map = (base: MonolithicLinkVec3): MonolithicLinkVec3 =>
    add3(
      anchor,
      add3(
        scale3(zAxis, scale * base[2]),
        add3(
          scale3(xAxis, lobeSign * scale * base[0]),
          scale3(yAxis, lobeSign * scale * base[1]),
        ),
      ),
    );

  const mapDerivative = (base: MonolithicLinkVec3): MonolithicLinkVec3 =>
    add3(
      scale3(zAxis, scale * base[2]),
      add3(
        scale3(xAxis, lobeSign * scale * base[0]),
        scale3(yAxis, lobeSign * scale * base[1]),
      ),
    );

  return Object.freeze({
    point: (t: number) => map(selfLoopBasePoint(t)),
    derivative: (t: number) => mapDerivative(selfLoopBaseDerivative(t)),
    arcLength: restArcLength,
  });
}

function resampleCurveByArcLength(
  curve: HalfCurve,
  segmentCount: number,
): readonly MonolithicLinkVec3[] {
  if (!Number.isSafeInteger(segmentCount) || segmentCount <= 0) {
    throw new Error(`invalid monolithic shape segmentCount: ${String(segmentCount)}`);
  }

  const sampleCount = Math.max(256, segmentCount * 24);
  const parameters = new Float64Array(sampleCount + 1);
  const cumulative = new Float64Array(sampleCount + 1);
  let previous = curve.point(0);
  for (let sample = 1; sample <= sampleCount; sample += 1) {
    const parameter = sample / sampleCount;
    parameters[sample] = parameter;
    const current = curve.point(parameter);
    cumulative[sample] =
      cumulative[sample - 1]! + length3(subtract3(current, previous));
    previous = current;
  }

  const total = cumulative[sampleCount]!;
  const result: MonolithicLinkVec3[] = [curve.point(0)];
  let cursor = 1;
  for (let segment = 1; segment < segmentCount; segment += 1) {
    const target = total * segment / segmentCount;
    while (cursor < sampleCount && cumulative[cursor]! < target) cursor += 1;
    const leftLength = cumulative[cursor - 1]!;
    const rightLength = cumulative[cursor]!;
    const span = rightLength - leftLength;
    const fraction = span <= EPSILON
      ? 0
      : (target - leftLength) / span;
    const parameter =
      (cursor - 1 + fraction) / sampleCount;
    result.push(curve.point(parameter));
  }
  result.push(curve.point(1));
  return Object.freeze(result);
}

function smoothStep01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function resolveMonolithicLinkRollGauge3D(
  start: MonolithicLinkVec3,
  center: MonolithicLinkVec3,
  end: MonolithicLinkVec3,
  linkIndex: number,
  previousNormal?: MonolithicLinkVec3,
): MonolithicLinkRollGauge3D {
  const first = subtract3(center, start);
  const second = subtract3(end, center);
  const firstLength = length3(first);
  const secondLength = length3(second);
  const overall = subtract3(end, start);

  const axis = normalize3(
    overall,
    normalize3(
      first,
      normalize3(second, deterministicAxes(linkIndex)[2]),
    ),
  );

  const deterministic = deterministicPerpendicular(axis, linkIndex);
  const previous = previousNormal === undefined
    ? deterministic
    : normalize3(
      subtract3(
        previousNormal,
        scale3(axis, dot3(previousNormal, axis)),
      ),
      deterministic,
    );

  const crossed = cross3(first, second);
  const crossedLength = length3(crossed);
  const denominator = firstLength * secondLength;
  const bendSine = denominator > EPSILON
    ? Math.max(0, Math.min(1, crossedLength / denominator))
    : 0;

  if (!(crossedLength > EPSILON)) {
    return Object.freeze({
      normal: previous,
      bendSine,
      geometricWeight: 0,
    });
  }

  let geometric = scale3(crossed, 1 / crossedLength);
  if (dot3(geometric, previous) < 0) {
    geometric = scale3(geometric, -1);
  }

  const rawWeight =
    (bendSine - ROLL_GAUGE_WEAK_BEND_SINE)
    / (ROLL_GAUGE_STRONG_BEND_SINE - ROLL_GAUGE_WEAK_BEND_SINE);
  const geometricWeight = smoothStep01(rawWeight);
  const normal = normalize3(
    add3(
      scale3(previous, 1 - geometricWeight),
      scale3(geometric, geometricWeight),
    ),
    previous,
  );

  return Object.freeze({
    normal,
    bendSine,
    geometricWeight,
  });
}

function parallelTransportOrientations(
  centers: readonly MonolithicLinkVec3[],
  linkIndex: number,
  initialNormal?: MonolithicLinkVec3,
): Float32Array {
  const count = centers.length;
  const result = new Float32Array(count * 4);
  const tangents: MonolithicLinkVec3[] = new Array(count);

  for (let index = 0; index < count; index += 1) {
    const previous = centers[Math.max(0, index - 1)]!;
    const next = centers[Math.min(count - 1, index + 1)]!;
    let tangent = subtract3(next, previous);
    if (!(length3(tangent) > EPSILON) && index > 0) {
      tangent = subtract3(centers[index]!, centers[index - 1]!);
    }
    tangents[index] = normalize3(
      tangent,
      deterministicAxes(linkIndex)[2],
    );
  }

  let z = tangents[0]!;
  const deterministic = deterministicPerpendicular(z, linkIndex);
  const roll = initialNormal === undefined
    ? deterministic
    : normalize3(
      subtract3(initialNormal, scale3(z, dot3(initialNormal, z))),
      deterministic,
    );
  let x = normalize3(cross3(roll, z), deterministic);
  let y = normalize3(cross3(z, x), roll);
  x = normalize3(cross3(y, z), x);

  for (let index = 0; index < count; index += 1) {
    const nextZ = tangents[index]!;
    if (index > 0) {
      const axisRaw = cross3(z, nextZ);
      const sine = length3(axisRaw);
      const cosine = Math.max(-1, Math.min(1, dot3(z, nextZ)));
      if (sine > 1e-8) {
        const axis = scale3(axisRaw, 1 / sine);
        x = rotateAroundAxis(x, axis, Math.atan2(sine, cosine));
      } else if (cosine < 0) {
        const axis = deterministicPerpendicular(z, linkIndex + index);
        x = rotateAroundAxis(x, axis, Math.PI);
      }
      x = normalize3(
        subtract3(x, scale3(nextZ, dot3(x, nextZ))),
        deterministicPerpendicular(nextZ, linkIndex + index),
      );
      y = normalize3(cross3(nextZ, x), y);
      x = normalize3(cross3(y, nextZ), x);
      z = nextZ;
    }

    // Canonical labeled octahedral sections alternate 0/60 degrees.
    // Cumulative 60-degree phase permutes corner identities every 120 degrees
    // and therefore disagrees with the static template edge topology.
    const twist = (index & 1) * Math.PI / 3;
    const cosineTwist = Math.cos(twist);
    const sineTwist = Math.sin(twist);
    const twistedX = add3(
      scale3(x, cosineTwist),
      scale3(y, sineTwist),
    );
    const twistedY = add3(
      scale3(y, cosineTwist),
      scale3(x, -sineTwist),
    );
    writeQuat(
      result,
      index,
      quaternionFromBasis(twistedX, twistedY, z),
    );
  }

  return result;
}

export function deriveMonolithicLinkShape3D(
  template: MonolithicLinkSpringTemplate3D,
  start: MonolithicLinkVec3,
  center: MonolithicLinkVec3,
  end: MonolithicLinkVec3,
  linkIndex = 0,
): MonolithicLinkShape3D {
  const halfSegments = template.octahedronCount / 2;
  if (!Number.isSafeInteger(halfSegments) || halfSegments <= 0) {
    throw new Error(
      `invalid monolithic shape octahedronCount: ${String(template.octahedronCount)}`,
    );
  }

  const firstChord = subtract3(center, start);
  const secondChord = subtract3(end, center);
  const firstLength = length3(firstChord);
  const secondLength = length3(secondChord);
  const firstDirection = normalize3(
    firstChord,
    deterministicAxes(linkIndex)[2],
  );
  const secondDirection = normalize3(
    secondChord,
    firstDirection,
  );
  let sharedDirection: MonolithicLinkVec3;
  if (firstLength <= EPSILON && secondLength > EPSILON) {
    // START-self has no incoming arm direction. The surviving ordinary half
    // must leave CENTER along its own chord instead of averaging with an
    // arbitrary deterministic self direction.
    sharedDirection = secondDirection;
  } else if (secondLength <= EPSILON && firstLength > EPSILON) {
    sharedDirection = firstDirection;
  } else {
    sharedDirection = normalize3(
      add3(firstDirection, secondDirection),
      normalize3(subtract3(end, start), firstDirection),
    );
    if (!(length3(sharedDirection) > EPSILON)) {
      sharedDirection = firstDirection;
    }
  }

  const macroNormal = resolveMonolithicLinkRollGauge3D(
    start,
    center,
    end,
    linkIndex,
  ).normal;
  const axes = deterministicAxes(linkIndex);

  const firstCurve = firstLength <= EPSILON
    ? buildSelfHalfCurve(start, axes, template.halfRestLength, -1)
    : buildHermiteHalfCurve(
      start,
      center,
      firstDirection,
      sharedDirection,
      macroNormal,
      template.halfRestLength,
    );

  const secondCurve = secondLength <= EPSILON
    ? buildSelfHalfCurve(center, axes, template.halfRestLength, 1)
    : buildHermiteHalfCurve(
      center,
      end,
      sharedDirection,
      secondDirection,
      macroNormal,
      template.halfRestLength,
    );

  const firstPoints = resampleCurveByArcLength(firstCurve, halfSegments);
  const secondPoints = resampleCurveByArcLength(secondCurve, halfSegments);
  const centers: MonolithicLinkVec3[] = [
    ...firstPoints.slice(0, -1),
    ...secondPoints,
  ];

  // Enforce exact semantic anchors after numeric resampling.
  centers[0] = start;
  centers[halfSegments] = center;
  centers[centers.length - 1] = end;

  const packedCenters = new Float32Array(centers.length * 3);
  for (let index = 0; index < centers.length; index += 1) {
    writeVec3(packedCenters, index, centers[index]!);
  }

  return Object.freeze({
    sectionCenters: packedCenters,
    sectionOrientations: parallelTransportOrientations(
      centers,
      linkIndex,
      macroNormal,
    ),
    sectionCount: centers.length,
    centerSection: halfSegments,
    firstHalfArcLength: firstCurve.arcLength,
    secondHalfArcLength: secondCurve.arcLength,
  });
}

export function deriveMonolithicNetworkShape3D(
  template: MonolithicLinkSpringTemplate3D,
  topology: OctahedralLinkTopology3D,
  semanticCenters: Float32Array,
): MonolithicNetworkShape3D {
  if (semanticCenters.length !== topology.linkCount * 3) {
    throw new Error(
      `monolithic shape center length mismatch: ${semanticCenters.length} != ${topology.linkCount * 3}`,
    );
  }

  const sectionCount = template.octahedronCount + 1;
  const sectionCenters = new Float32Array(
    topology.linkCount * sectionCount * 3,
  );
  const sectionOrientations = new Float32Array(
    topology.linkCount * sectionCount * 4,
  );

  for (let link = 0; link < topology.linkCount; link += 1) {
    const shape = deriveMonolithicLinkShape3D(
      template,
      readVec3(semanticCenters, topology.startIndices[link]!),
      readVec3(semanticCenters, link),
      readVec3(semanticCenters, topology.endIndices[link]!),
      link,
    );
    sectionCenters.set(shape.sectionCenters, link * sectionCount * 3);
    sectionOrientations.set(
      shape.sectionOrientations,
      link * sectionCount * 4,
    );
  }

  return Object.freeze({
    sectionCenters,
    sectionOrientations,
    linkCount: topology.linkCount,
    sectionCount,
    derivedSectionCount: topology.linkCount * sectionCount,
  });
}
