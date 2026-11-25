// The hull mesh of the chased craft, world space. Normals come from derivatives, so the facets stay flat.
out vec3 vView;
out float vAlong;

void main() {
  vec4 v = modelViewMatrix * vec4(position, 1.0);
  vView = v.xyz;
  vAlong = position.x;
  gl_Position = projectionMatrix * v;
}
