// A small box around the shadow, at the depth of the hole. Anything nearer stays in front of it by the plain depth test.
uniform mat3 uHoleRay;
uniform vec4 uCapBox;   // centre and half size, ndc
uniform float uCapZ;
out vec3 vRay;

void main() {
  vec2 p = uCapBox.xy + position.xy * uCapBox.zw;
  vRay = uHoleRay * vec3(p, 1.0);
  gl_Position = vec4(p, uCapZ, 1.0);
}
