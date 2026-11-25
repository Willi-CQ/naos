in vec3 vColor;
out vec4 o;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r = dot(p, p);
  float core = exp(-r * 1100.0);
  float halo = 0.06 * exp(-r * 42.0);
  float rays = 0.026 * exp(-min(abs(p.x), abs(p.y)) * 170.0) * exp(-r * 38.0);
  o = vec4(vColor * (core + halo + rays), 1.0);
}
