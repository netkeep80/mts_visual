import * as THREE from "three";
import {
  createOctahedralLivePhysics3D,
  transitionOctahedralLivePhysics3DNetwork,
  type VisualLinkNetwork,
} from "../src/index.js";
import {
  createOctahedralThreeBatch,
  type OctahedralThreeBatch,
} from "../src/three/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`@mts/visual M5/P3: ${message}`);
}

function same<T>(actual: T, expected: T, message: string): void {
  assert(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function approx(actual: number, expected: number, message: string, epsilon = 1e-6): void {
  assert(Math.abs(actual - expected) <= epsilon, `${message}: ${actual} != ${expected}`);
}

function selfNetwork(count: number, prefix = "L"): VisualLinkNetwork {
  return {
    links: Array.from({ length: count }, (_, index) => {
      const key = `${prefix}${index}`;
      return { key, startKey: key, endKey: key };
    }),
  };
}

function textureData(batch: OctahedralThreeBatch): Float32Array {
  return (batch.positionTexture.image as { data: Float32Array }).data;
}

const ratio = 2 * Math.SQRT2;
const controller = createOctahedralLivePhysics3D(selfNetwork(2), {
  aspectRatio: ratio,
  stiffness: 1,
  simulationSpeed: 1,
});
const batch = createOctahedralThreeBatch(controller);

same(batch.group.children.length, 3, "batch owns exactly three Three draw objects");
assert(batch.surface.geometry instanceof THREE.InstancedBufferGeometry, "surface uses instanced geometry");
assert(batch.centers.geometry instanceof THREE.InstancedBufferGeometry, "centers use instanced geometry");
assert(batch.arrows.geometry instanceof THREE.InstancedBufferGeometry, "arrows use instanced geometry");
same(batch.surface.geometry.instanceCount, 2, "surface instance count equals Link count");
same(batch.centers.geometry.instanceCount, 2, "center instance count equals Link count");
same(batch.arrows.geometry.instanceCount, 2, "arrow instance count equals Link count");

const snapshot = batch.snapshot();
same(snapshot.linkCount, 2, "snapshot Link count");
same(snapshot.drawObjectCount, 3, "two Links still use three draw objects");
same(snapshot.drawCallProxy, 3, "non-empty batch draw-call proxy is three");
same(snapshot.surfaceInstances, 2, "surface instances");
same(snapshot.centerInstances, 2, "center instances");
same(snapshot.arrowInstances, 2, "arrow instances");

const surfacePosition = batch.surface.geometry.getAttribute("position");
same(surfacePosition.count, controller.template.vertexCount, "surface stores one template copy only");
const gradient = batch.surface.geometry.getAttribute("gradientT");
same(gradient.count, controller.template.vertexCount, "one cached gradient value per template vertex");
for (let index = 0; index < controller.template.vertexCount; index += 1) {
  approx(
    gradient.getX(index),
    controller.template.gradientT[index]!,
    `surface gradient t[${index}]`,
  );
}
same(gradient.getX(controller.template.startApex), 0, "surface START is exact red endpoint t=0");
same(gradient.getX(controller.template.endApex), 1, "surface END is exact blue endpoint t=1");

const surfaceInstanceAddress = batch.surface.geometry.getAttribute("instanceTexel");
const centerInstanceAddress = batch.centers.geometry.getAttribute("instanceTexel");
const arrowInstanceAddress = batch.arrows.geometry.getAttribute("instanceTexel");
assert(surfaceInstanceAddress instanceof THREE.InstancedBufferAttribute, "surface address is instanced");
assert(surfaceInstanceAddress === centerInstanceAddress, "surface/center share exact instance address buffer");
assert(surfaceInstanceAddress === arrowInstanceAddress, "surface/arrow share exact instance address buffer");
same(surfaceInstanceAddress.count, 2, "one texel origin per Link instance");

let data = textureData(batch);
for (let vertex = 0; vertex < controller.positions.length / 3; vertex += 1) {
  const source = vertex * 3;
  const texel = vertex * 4;
  approx(data[texel]!, controller.positions[source]!, `texture x vertex ${vertex}`);
  approx(data[texel + 1]!, controller.positions[source + 1]!, `texture y vertex ${vertex}`);
  approx(data[texel + 2]!, controller.positions[source + 2]!, `texture z vertex ${vertex}`);
  same(data[texel + 3]!, 1, `texture alpha vertex ${vertex}`);
}

const surfaceMesh = batch.surface;
const surfaceGeometry = batch.surface.geometry;
const surfaceMaterial = batch.surface.material;
const centerMesh = batch.centers;
const centerGeometry = batch.centers.geometry;
const centerMaterial = batch.centers.material;
const arrowMesh = batch.arrows;
const arrowGeometry = batch.arrows.geometry;
const arrowMaterial = batch.arrows.material;
const positionTexture = batch.positionTexture;
const instanceAddress = batch.instanceTexelAttribute;
const versionBefore = positionTexture.version;

controller.step();
batch.sync();

assert(batch.surface === surfaceMesh, "ordinary sync preserves surface Mesh");
assert(batch.surface.geometry === surfaceGeometry, "ordinary sync preserves surface geometry");
assert(batch.surface.material === surfaceMaterial, "ordinary sync preserves surface material");
assert(batch.centers === centerMesh, "ordinary sync preserves center Mesh");
assert(batch.centers.geometry === centerGeometry, "ordinary sync preserves center geometry");
assert(batch.centers.material === centerMaterial, "ordinary sync preserves center material");
assert(batch.arrows === arrowMesh, "ordinary sync preserves arrow Mesh");
assert(batch.arrows.geometry === arrowGeometry, "ordinary sync preserves arrow geometry");
assert(batch.arrows.material === arrowMaterial, "ordinary sync preserves arrow material");
assert(batch.positionTexture === positionTexture, "ordinary sync preserves position DataTexture");
assert(batch.instanceTexelAttribute === instanceAddress, "ordinary sync preserves instance address attribute");
assert(batch.positionTexture.version > versionBefore, "ordinary sync schedules a fresh texture upload");

data = textureData(batch);
approx(data[0]!, controller.positions[0]!, "post-step texture x follows packed physics");
approx(data[1]!, controller.positions[1]!, "post-step texture y follows packed physics");
approx(data[2]!, controller.positions[2]!, "post-step texture z follows packed physics");

const sameCountSurface = batch.surface;
const sameCountTexture = batch.positionTexture;
const sameCountAddress = batch.instanceTexelAttribute;
transitionOctahedralLivePhysics3DNetwork(controller, selfNetwork(2, "N"));
batch.sync();
assert(batch.surface === sameCountSurface, "same-count topology transition preserves surface object");
assert(batch.positionTexture === sameCountTexture, "same-count topology transition reuses texture capacity");
assert(batch.instanceTexelAttribute === sameCountAddress, "same-count topology transition reuses instance addressing");

const growthSurface = batch.surface;
const growthSurfaceGeometry = batch.surface.geometry;
const growthSurfaceMaterial = batch.surface.material;
const growthCenter = batch.centers;
const growthArrow = batch.arrows;
const oldTexture = batch.positionTexture;
transitionOctahedralLivePhysics3DNetwork(controller, selfNetwork(4, "G"));
batch.sync();

assert(batch.surface === growthSurface, "topology growth preserves surface Mesh");
assert(batch.surface.geometry === growthSurfaceGeometry, "topology growth preserves template surface geometry");
assert(batch.surface.material === growthSurfaceMaterial, "topology growth preserves surface shader material");
assert(batch.centers === growthCenter, "topology growth preserves center draw object");
assert(batch.arrows === growthArrow, "topology growth preserves arrow draw object");
same(batch.surface.geometry.instanceCount, 4, "growth updates surface instance count");
same(batch.centers.geometry.instanceCount, 4, "growth updates center instance count");
same(batch.arrows.geometry.instanceCount, 4, "growth updates arrow instance count");
same(batch.instanceTexelAttribute.count, 4, "growth updates instance texel addresses");
assert(batch.positionTexture !== oldTexture, "growth beyond capacity replaces only position texture storage");
same(batch.snapshot().drawCallProxy, 3, "growth keeps constant draw-call proxy");

const thousandController = createOctahedralLivePhysics3D(selfNetwork(1_000, "K"), {
  aspectRatio: ratio,
  stiffness: 0,
  simulationSpeed: 0,
});
const thousandBatch = createOctahedralThreeBatch(thousandController);
same(thousandBatch.group.children.length, 3, "1000 Links still create exactly three Three draw objects");
same(thousandBatch.surface.geometry.instanceCount, 1_000, "1000 surface instances");
same(thousandBatch.centers.geometry.instanceCount, 1_000, "1000 center instances");
same(thousandBatch.arrows.geometry.instanceCount, 1_000, "1000 arrow instances");
same(thousandBatch.snapshot().drawCallProxy, 3, "1000 Links retain three-draw proxy");
same(
  thousandBatch.surface.geometry.getAttribute("position").count,
  thousandController.template.vertexCount,
  "1000 Links do not duplicate template surface vertices on CPU geometry",
);

let disposeEvents = 0;
const disposable = [
  batch.positionTexture,
  batch.surface.geometry,
  batch.surface.material,
  batch.centers.geometry,
  batch.centers.material,
  batch.arrows.geometry,
  batch.arrows.material,
];
for (const resource of disposable) {
  resource.addEventListener("dispose", () => { disposeEvents += 1; });
}
batch.dispose();
same(batch.group.children.length, 0, "dispose removes all batch draw objects from group");
same(disposeEvents, disposable.length, "dispose releases every owned GPU resource exactly once");
batch.dispose();
same(disposeEvents, disposable.length, "dispose is idempotent");

thousandBatch.dispose();
