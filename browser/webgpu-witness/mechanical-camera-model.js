export function normalize3(vector) {
  const length =
    Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [
    vector[0] / length,
    vector[1] / length,
    vector[2] / length,
  ];
}

export function cross3(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

export function dot3(left, right) {
  return (
    left[0] * right[0]
    + left[1] * right[1]
    + left[2] * right[2]
  );
}

export function lookAt4(eye, center, up) {
  const z = normalize3([
    eye[0] - center[0],
    eye[1] - center[1],
    eye[2] - center[2],
  ]);
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}

export function perspective4(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

export function multiply4(left, right) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let k = 0; k < 4; k += 1) {
        value +=
          left[k * 4 + row]
          * right[column * 4 + k];
      }
      out[column * 4 + row] = value;
    }
  }
  return out;
}

export function transformPoint4(matrix, point) {
  const [x, y, z] = point;
  return [
    matrix[0] * x
      + matrix[4] * y
      + matrix[8] * z
      + matrix[12],
    matrix[1] * x
      + matrix[5] * y
      + matrix[9] * z
      + matrix[13],
    matrix[2] * x
      + matrix[6] * y
      + matrix[10] * z
      + matrix[14],
    matrix[3] * x
      + matrix[7] * y
      + matrix[11] * z
      + matrix[15],
  ];
}

export function clamp(
  value,
  minimum,
  maximum,
) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function cameraEye(camera) {
  const cp = Math.cos(camera.pitch);
  return [
    camera.target[0]
      + Math.cos(camera.yaw) * cp * camera.distance,
    camera.target[1]
      + Math.sin(camera.pitch) * camera.distance,
    camera.target[2]
      + Math.sin(camera.yaw) * cp * camera.distance,
  ];
}

export function resetCamera(camera, distance) {
  camera.yaw = -0.8;
  camera.pitch = 0.38;
  camera.distance = distance;
  camera.defaultDistance = distance;
  camera.minDistance = Math.max(2, distance * 0.08);
  camera.maxDistance = distance * 20;
  camera.target[0] = 0;
  camera.target[1] = 0;
  camera.target[2] = 0;
}

export function cameraBasis(camera) {
  const eye = cameraEye(camera);
  const forward = normalize3([
    camera.target[0] - eye[0],
    camera.target[1] - eye[1],
    camera.target[2] - eye[2],
  ]);
  const right = normalize3(
    cross3(forward, [0, 1, 0]),
  );
  const up = normalize3(
    cross3(right, forward),
  );
  return { eye, forward, right, up };
}

export function panCamera(camera, dx, dy) {
  const { right, up } = cameraBasis(camera);
  const scale = camera.distance * 0.0015;
  for (let axis = 0; axis < 3; axis += 1) {
    camera.target[axis] +=
      right[axis] * (-dx * scale)
      + up[axis] * (dy * scale);
  }
}

export function createViewProjection(
  camera,
  framebufferWidth,
  framebufferHeight,
) {
  const eye = cameraEye(camera);
  const view = lookAt4(
    eye,
    camera.target,
    [0, 1, 0],
  );
  const projection = perspective4(
    Math.PI / 4,
    Math.max(
      1e-9,
      framebufferWidth / framebufferHeight,
    ),
    0.1,
    camera.maxDistance * 4,
  );
  return multiply4(projection, view);
}

export function projectWorldToClient({
  camera,
  world,
  framebufferWidth,
  framebufferHeight,
  rect,
}) {
  const clip = transformPoint4(
    createViewProjection(
      camera,
      framebufferWidth,
      framebufferHeight,
    ),
    world,
  );
  if (!(clip[3] > 1e-6)) return null;

  const ndcX = clip[0] / clip[3];
  const ndcY = clip[1] / clip[3];
  if (
    !Number.isFinite(ndcX)
    || !Number.isFinite(ndcY)
  ) {
    return null;
  }

  return [
    rect.left + (ndcX * 0.5 + 0.5) * rect.width,
    rect.top + (0.5 - ndcY * 0.5) * rect.height,
  ];
}

export function pointerWorldRay({
  camera,
  clientX,
  clientY,
  rect,
}) {
  const { eye, forward, right, up } =
    cameraBasis(camera);
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const ndcX =
    ((clientX - rect.left) / width) * 2 - 1;
  const ndcY =
    1 - ((clientY - rect.top) / height) * 2;
  const tanHalfFov = Math.tan(Math.PI / 8);
  const aspect = width / height;
  const direction = normalize3([
    forward[0]
      + right[0] * ndcX * aspect * tanHalfFov
      + up[0] * ndcY * tanHalfFov,
    forward[1]
      + right[1] * ndcX * aspect * tanHalfFov
      + up[1] * ndcY * tanHalfFov,
    forward[2]
      + right[2] * ndcX * aspect * tanHalfFov
      + up[2] * ndcY * tanHalfFov,
  ]);
  return { origin: eye, direction };
}
