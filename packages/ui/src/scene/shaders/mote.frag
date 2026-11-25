uniform vec3 uOiii;
in float vA;
out vec4 o;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  o = vec4(uOiii * 2.0 * vA * exp(-dot(d, d) * 14.0), 1.0);
}
