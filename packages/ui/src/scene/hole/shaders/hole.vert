// Fullscreen triangle. The ray through a vertex is linear in clip space, so it interpolates exactly.
uniform mat3 uHoleRay;   // columns: ray per ndc x, per ndc y, at the centre, in the hole frame
out vec3 vRay;

void main() {
  vRay = uHoleRay * vec3(position.xy, 1.0);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
