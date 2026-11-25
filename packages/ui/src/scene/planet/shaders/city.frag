// A city seen from orbit is a bright knot and a thinning web of roads, not a dot.
in vec2 vQ;
in vec3 vDir;
flat in vec2 vKind;
out vec4 o;

uniform float uFine;

void main() {
  float r = length(vQ);
  if (r > 1.0) discard;
  float core = exp(-r * r * 9.0);
  float edge = 1.0 - smoothstep(0.4, 1.0, r);
  float web = nz(vDir * 310.0).x + 0.7 * nz(vDir * 120.0 + 3.0).x;
  float roads = smoothstep(0.05 + r * 0.6, 0.6 + r * 0.6, web + core * 1.1);
  float light = mix(core, roads * (0.25 + 0.75 * core), uFine) * edge * vKind.y;
  o = vec4(light * (1.0 - vKind.x), light * vKind.x, 0.0, 1.0);
}
