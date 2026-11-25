// A fullscreen triangle that knows which way each pixel looks, for this camera or for one face of a cube.
out vec3 vDir;

void main() {
  gl_Position = vec4(position.xy, 1.0, 1.0);
  vec4 view = inverse(projectionMatrix) * gl_Position;
  vDir = transpose(mat3(viewMatrix)) * (view.xyz / view.w);
}
