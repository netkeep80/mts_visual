import * as THREE from "three";
import type { OctahedralLivePhysics3D } from "../octahedral-live3d.js";
import type { OctahedralLinkTemplate3D } from "../octahedral-link3d.js";

type BatchMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

export interface OctahedralThreeBatchSnapshot {
  readonly linkCount: number;
  readonly drawObjectCount: number;
  readonly drawCallProxy: number;
  readonly surfaceInstances: number;
  readonly centerInstances: number;
  readonly arrowInstances: number;
  readonly textureWidth: number;
  readonly textureHeight: number;
  readonly textureCapacityVertices: number;
  readonly uploadedVertices: number;
  readonly surfaceTemplateVertexCount: number;
}

export interface OctahedralThreeBatch {
  readonly group: THREE.Group;
  readonly surface: BatchMesh;
  readonly centers: BatchMesh;
  readonly arrows: BatchMesh;
  readonly positionTexture: THREE.DataTexture;
  readonly instanceTexelAttribute: THREE.InstancedBufferAttribute;
  sync(): OctahedralThreeBatchSnapshot;
  snapshot(): OctahedralThreeBatchSnapshot;
  dispose(): void;
}

interface PositionTextureStorage {
  readonly texture: THREE.DataTexture;
  readonly data: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly capacityVertices: number;
}

const FETCH_VERTEX_GLSL = `
uniform sampler2D positionTexture;
uniform vec2 positionTextureSize;
attribute vec2 instanceTexel;

vec3 fetchLinkVertex(float localVertexIndex) {
  float rawX = instanceTexel.x + localVertexIndex;
  float rowOffset = floor(rawX / positionTextureSize.x);
  float x = rawX - rowOffset * positionTextureSize.x;
  float y = instanceTexel.y + rowOffset;
  vec2 uv = (vec2(x, y) + vec2(0.5)) / positionTextureSize;
  return texture2D(positionTexture, uv).xyz;
}
`;

const SURFACE_VERTEX_SHADER = `
attribute float localVertexIndex;
attribute float gradientT;
varying float vGradientT;
${FETCH_VERTEX_GLSL}

void main() {
  vec3 worldPosition = fetchLinkVertex(localVertexIndex);
  vGradientT = gradientT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 1.0);
}
`;

const SURFACE_FRAGMENT_SHADER = `
uniform vec3 startColor;
uniform vec3 endColor;
varying float vGradientT;

void main() {
  vec3 color = mix(startColor, endColor, clamp(vGradientT, 0.0, 1.0));
  gl_FragColor = vec4(color, 1.0);
}
`;

const CENTER_VERTEX_SHADER = `
uniform vec3 centerVertexIndices;
${FETCH_VERTEX_GLSL}

void main() {
  vec3 center = (
    fetchLinkVertex(centerVertexIndices.x)
    + fetchLinkVertex(centerVertexIndices.y)
    + fetchLinkVertex(centerVertexIndices.z)
  ) / 3.0;
  vec3 worldPosition = center + position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 1.0);
}
`;

const SOLID_FRAGMENT_SHADER = `
uniform vec3 solidColor;

void main() {
  gl_FragColor = vec4(solidColor, 1.0);
}
`;

const ARROW_VERTEX_SHADER = `
uniform float endApexIndex;
uniform vec3 endBaseVertexIndices;
uniform float arrowHeight;
${FETCH_VERTEX_GLSL}

void main() {
  vec3 tip = fetchLinkVertex(endApexIndex);
  vec3 baseCenter = (
    fetchLinkVertex(endBaseVertexIndices.x)
    + fetchLinkVertex(endBaseVertexIndices.y)
    + fetchLinkVertex(endBaseVertexIndices.z)
  ) / 3.0;

  vec3 yAxis = tip - baseCenter;
  float axisLength = length(yAxis);
  if (axisLength <= 1e-6) {
    yAxis = vec3(0.0, 0.0, 1.0);
  } else {
    yAxis /= axisLength;
  }

  vec3 referenceAxis = abs(yAxis.y) < 0.95
    ? vec3(0.0, 1.0, 0.0)
    : vec3(1.0, 0.0, 0.0);
  vec3 xAxis = normalize(cross(referenceAxis, yAxis));
  vec3 zAxis = normalize(cross(yAxis, xAxis));

  vec3 center = tip - yAxis * (arrowHeight * 0.5);
  vec3 worldPosition = center
    + xAxis * position.x
    + yAxis * position.y
    + zAxis * position.z;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPosition, 1.0);
}
`;

function textureStorage(requiredVertices: number): PositionTextureStorage {
  const required = Math.max(1, requiredVertices);
  const width = Math.max(1, Math.ceil(Math.sqrt(required)));
  const height = Math.max(1, Math.ceil(required / width));
  const data = new Float32Array(width * height * 4);
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  return Object.freeze({
    texture,
    data,
    width,
    height,
    capacityVertices: width * height,
  });
}

function fillTexture(storage: PositionTextureStorage, positions: Float32Array): void {
  const vertices = positions.length / 3;
  if (!Number.isInteger(vertices) || vertices > storage.capacityVertices) {
    throw new Error("@mts/visual/three: invalid octahedral position texture capacity");
  }

  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const source = vertex * 3;
    const target = vertex * 4;
    const x = positions[source]!;
    const y = positions[source + 1]!;
    const z = positions[source + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`@mts/visual/three: non-finite octahedral position at vertex ${vertex}`);
    }
    storage.data[target] = x;
    storage.data[target + 1] = y;
    storage.data[target + 2] = z;
    storage.data[target + 3] = 1;
  }

  storage.texture.needsUpdate = true;
}

function staticSurfaceGeometry(template: OctahedralLinkTemplate3D): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(template.restPositions, 3));

  const localVertexIndex = new Float32Array(template.vertexCount);
  for (let vertex = 0; vertex < template.vertexCount; vertex += 1) {
    localVertexIndex[vertex] = vertex;
  }
  geometry.setAttribute("localVertexIndex", new THREE.BufferAttribute(localVertexIndex, 1));
  geometry.setAttribute("gradientT", new THREE.BufferAttribute(template.gradientT, 1));
  geometry.setIndex(new THREE.BufferAttribute(template.surfaceTriangles, 1));
  return geometry;
}

function instancedGeometry(base: THREE.BufferGeometry): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  if (base.index !== null) geometry.setIndex(base.index);
  for (const name of Object.keys(base.attributes)) {
    geometry.setAttribute(name, base.getAttribute(name));
  }
  return geometry;
}

function positionUniforms(storage: PositionTextureStorage): Readonly<Record<string, THREE.IUniform>> {
  return {
    positionTexture: { value: storage.texture },
    positionTextureSize: { value: new THREE.Vector2(storage.width, storage.height) },
  };
}

function surfaceMaterial(storage: PositionTextureStorage): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...positionUniforms(storage),
      startColor: { value: new THREE.Color(0xff0000) },
      endColor: { value: new THREE.Color(0x0000ff) },
    },
    vertexShader: SURFACE_VERTEX_SHADER,
    fragmentShader: SURFACE_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });
}

function centerMaterial(
  storage: PositionTextureStorage,
  template: OctahedralLinkTemplate3D,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...positionUniforms(storage),
      centerVertexIndices: {
        value: new THREE.Vector3(
          template.centerTriangle[0],
          template.centerTriangle[1],
          template.centerTriangle[2],
        ),
      },
      solidColor: { value: new THREE.Color(0.5, 0, 0.5) },
    },
    vertexShader: CENTER_VERTEX_SHADER,
    fragmentShader: SOLID_FRAGMENT_SHADER,
  });
}

function arrowMaterial(
  storage: PositionTextureStorage,
  template: OctahedralLinkTemplate3D,
  arrowHeight: number,
): THREE.ShaderMaterial {
  const lastRing = template.startApex - 3;
  return new THREE.ShaderMaterial({
    uniforms: {
      ...positionUniforms(storage),
      endApexIndex: { value: template.endApex },
      endBaseVertexIndices: {
        value: new THREE.Vector3(lastRing, lastRing + 1, lastRing + 2),
      },
      arrowHeight: { value: arrowHeight },
      solidColor: { value: new THREE.Color(0x0000ff) },
    },
    vertexShader: ARROW_VERTEX_SHADER,
    fragmentShader: SOLID_FRAGMENT_SHADER,
  });
}

function applyPositionTexture(
  material: THREE.ShaderMaterial,
  storage: PositionTextureStorage,
): void {
  material.uniforms.positionTexture!.value = storage.texture;
  const size = material.uniforms.positionTextureSize!.value as THREE.Vector2;
  size.set(storage.width, storage.height);
}

function makeInstanceTexelAttribute(
  linkCount: number,
  template: OctahedralLinkTemplate3D,
  textureWidth: number,
): THREE.InstancedBufferAttribute {
  const values = new Float32Array(linkCount * 2);
  for (let link = 0; link < linkCount; link += 1) {
    const baseVertex = link * template.vertexCount;
    values[link * 2] = baseVertex % textureWidth;
    values[link * 2 + 1] = Math.floor(baseVertex / textureWidth);
  }
  return new THREE.InstancedBufferAttribute(values, 2);
}

function setInstanceAddress(
  geometry: THREE.InstancedBufferGeometry,
  attribute: THREE.InstancedBufferAttribute,
  instanceCount: number,
): void {
  geometry.setAttribute("instanceTexel", attribute);
  geometry.instanceCount = instanceCount;
}

class OctahedralThreeBatchController implements OctahedralThreeBatch {
  readonly group = new THREE.Group();
  readonly surface: BatchMesh;
  readonly centers: BatchMesh;
  readonly arrows: BatchMesh;

  private readonly controller: OctahedralLivePhysics3D;
  private storage: PositionTextureStorage;
  private instanceAddress: THREE.InstancedBufferAttribute;
  private currentLinkCount: number;
  private disposed = false;

  constructor(controller: OctahedralLivePhysics3D) {
    this.controller = controller;
    this.currentLinkCount = controller.topology.linkCount;
    this.storage = textureStorage(controller.positions.length / 3);
    this.instanceAddress = makeInstanceTexelAttribute(
      this.currentLinkCount,
      controller.template,
      this.storage.width,
    );

    const surfaceGeometry = staticSurfaceGeometry(controller.template);
    setInstanceAddress(surfaceGeometry, this.instanceAddress, this.currentLinkCount);
    const surfaceShader = surfaceMaterial(this.storage);
    this.surface = new THREE.Mesh(surfaceGeometry, surfaceShader);
    this.surface.frustumCulled = false;
    this.surface.userData = { kind: "octahedral-link-surfaces" };

    const centerRadius = controller.template.diameter * 0.10;
    const centerBase = new THREE.IcosahedronGeometry(centerRadius, 1);
    const centerGeometry = instancedGeometry(centerBase);
    setInstanceAddress(centerGeometry, this.instanceAddress, this.currentLinkCount);
    const centerShader = centerMaterial(this.storage, controller.template);
    this.centers = new THREE.Mesh(centerGeometry, centerShader);
    this.centers.frustumCulled = false;
    this.centers.userData = { kind: "octahedral-link-centers" };

    const arrowHeight = controller.template.diameter * 0.45;
    const arrowRadius = controller.template.diameter * 0.12;
    const arrowBase = new THREE.ConeGeometry(arrowRadius, arrowHeight, 6);
    const arrowGeometry = instancedGeometry(arrowBase);
    setInstanceAddress(arrowGeometry, this.instanceAddress, this.currentLinkCount);
    const arrowShader = arrowMaterial(this.storage, controller.template, arrowHeight);
    this.arrows = new THREE.Mesh(arrowGeometry, arrowShader);
    this.arrows.frustumCulled = false;
    this.arrows.userData = { kind: "octahedral-link-end-arrows" };

    this.group.userData = { kind: "octahedral-link-batch" };
    this.group.add(this.surface, this.centers, this.arrows);
    this.sync();
  }

  get positionTexture(): THREE.DataTexture {
    return this.storage.texture;
  }

  get instanceTexelAttribute(): THREE.InstancedBufferAttribute {
    return this.instanceAddress;
  }

  private replaceStorage(requiredVertices: number): void {
    if (requiredVertices <= this.storage.capacityVertices) return;
    const old = this.storage;
    this.storage = textureStorage(requiredVertices);
    applyPositionTexture(this.surface.material, this.storage);
    applyPositionTexture(this.centers.material, this.storage);
    applyPositionTexture(this.arrows.material, this.storage);
    old.texture.dispose();
  }

  private syncTopologyAddressing(): void {
    const nextLinkCount = this.controller.topology.linkCount;
    const nextAddress = makeInstanceTexelAttribute(
      nextLinkCount,
      this.controller.template,
      this.storage.width,
    );
    this.instanceAddress = nextAddress;
    this.currentLinkCount = nextLinkCount;
    setInstanceAddress(this.surface.geometry, nextAddress, nextLinkCount);
    setInstanceAddress(this.centers.geometry, nextAddress, nextLinkCount);
    setInstanceAddress(this.arrows.geometry, nextAddress, nextLinkCount);
  }

  sync(): OctahedralThreeBatchSnapshot {
    if (this.disposed) throw new Error("@mts/visual/three: octahedral batch is disposed");

    const requiredVertices = this.controller.positions.length / 3;
    const oldWidth = this.storage.width;
    this.replaceStorage(requiredVertices);

    if (
      this.controller.topology.linkCount !== this.currentLinkCount
      || this.storage.width !== oldWidth
    ) {
      this.syncTopologyAddressing();
    }

    fillTexture(this.storage, this.controller.positions);
    return this.snapshot();
  }

  snapshot(): OctahedralThreeBatchSnapshot {
    const linkCount = this.controller.topology.linkCount;
    return Object.freeze({
      linkCount,
      drawObjectCount: this.group.children.length,
      drawCallProxy: linkCount > 0 ? 3 : 0,
      surfaceInstances: this.surface.geometry.instanceCount,
      centerInstances: this.centers.geometry.instanceCount,
      arrowInstances: this.arrows.geometry.instanceCount,
      textureWidth: this.storage.width,
      textureHeight: this.storage.height,
      textureCapacityVertices: this.storage.capacityVertices,
      uploadedVertices: this.controller.positions.length / 3,
      surfaceTemplateVertexCount: this.controller.template.vertexCount,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.remove(this.surface, this.centers, this.arrows);
    this.storage.texture.dispose();
    this.surface.geometry.dispose();
    this.surface.material.dispose();
    this.centers.geometry.dispose();
    this.centers.material.dispose();
    this.arrows.geometry.dispose();
    this.arrows.material.dispose();
  }
}

export function createOctahedralThreeBatch(
  controller: OctahedralLivePhysics3D,
): OctahedralThreeBatch {
  return new OctahedralThreeBatchController(controller);
}
