in vec3 vColor;
out vec4 o;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  o = vec4(vColor * exp(-dot(d, d) * 12.0), 1.0);         // additive, gaussian disc
}
