// Weather. R the main deck, G high thin cloud. Every sample is first carried round the cyclones, so systems spiral as they do from orbit, and
// the amount follows a coarse circulation: the ITCZ on the equator, clear subtropics, storm tracks at 50 degrees.
in vec2 vFace;
out vec4 o;

uniform mat3 uFace;
uniform vec3 uSeed;
uniform float uCut;         // cloud amount where the deck starts, set from coverage
uniform float uScale;
uniform float uThin;         // a little cloud is thin cloud, never a few white balls
uniform float uWisps;
uniform float uBanded;       // 1 for giants: cloud lies in thin streaks only
uniform int uDetail;
uniform vec4 uStorm[24];
uniform vec4 uStormLook[24];
uniform int uStormCount;

vec3 turn(vec3 v, vec3 axis, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

void main() {
  vec3 p = normalize(uFace * vec3(vFace, 1.0));
  vec3 q = p;
  float eye = 1.0;
  float storm = 0.0;
  for (int i = 0; i < uStormCount; i++) {
    vec4 c = uStorm[i];
    vec4 l = uStormLook[i];
    float u = distance(p, c.xyz) / c.w;
    if (u > 3.0) continue;
    // Tight at the centre, loosening outward, and zero at the edge, or the sky tears along a circle.
    float fade = 1.0 - smoothstep(1.2, 3.0, u);
    q = turn(q, c.xyz, l.x * 3.2 * l.y * exp(-u * 1.5) * fade);
    storm = max(storm, exp(-u * u * 0.5) * l.y * fade);
    if (l.z > 0.5) eye *= smoothstep(0.03, 0.12, u);
  }

  // The winds: a few steps along a divergence free field. Small steps, or noise turns to brush strokes.
  float base = mix(4.0, 1.6, uScale);
  float amp = 0.012;
  float f = base * 0.6;
  for (int i = 0; i < 4; i++) {
    vec3 s = vec3(q.x, q.y * 1.5, q.z) * f + uSeed + float(i) * 3.1;
    q = normalize(q + cross(q, nz(s).yzw) * amp);
    f *= 2.0;
    amp *= 0.66;
  }

  float lat = abs(p.y);
  float circulation = 0.1 * exp(-lat * lat * 90.0) + 0.11 * exp(-pow((lat - 0.74) * 5.0, 2.0)) - 0.15 * exp(-pow((lat - 0.42) * 7.0, 2.0));

  // One fractal over every size. Real cloud fields have no size of their own, so the same field is the fronts and their torn edges.
  vec3 e = q * base + uSeed;
  float v = 0.0;
  float rough = 0.0;
  float a = 0.5;
  for (int i = 0; i < uDetail + 3; i++) {
    vec4 n = nz(e);
    v += a * n.x;
    if (i > 3) rough += a * (0.5 - abs(n.x) * 1.4);
    a *= 0.6;
    e = TURN * e * 2.05;
  }
  v = v * 1.15 + circulation + storm * 0.22;
  // Optical depth, not a mask: thin at the edges, and it takes a lot of cloud to hide the ground.
  float tau = max(v - uCut, 0.0) * (5.5 + rough * 9.0);
  float deck = (1.0 - exp(-tau)) * eye * uThin * (1.0 - uBanded);

  // Cirrus, pulled out along the winds and combed by the storms.
  vec3 w = vec3(q.x, q.y * mix(5.0, 16.0, uBanded), q.z) * mix(2.4, 3.2, uBanded) + uSeed.yzx;
  float streak = fbm(w, 6);
  float cirrusCut = uBanded > 0.5 ? 0.24 : 0.12;
  float cirrus = pow(smoothstep(cirrusCut, cirrusCut + 0.46, streak + uWisps * 0.2 - 0.1), 1.6) * (0.1 + 0.42 * uWisps) * eye;
  if (uBanded > 0.5) {
    // On a giant, high cloud gathers in a few latitudes and stays thin.
    float lane = nz(vec3(p.y * 6.0, uSeed.x, uSeed.z)).x;
    cirrus = pow(cirrus, 1.5) * smoothstep(0.05, 0.3, lane);
  }

  o = vec4(deck, cirrus, storm, 1.0);
}
