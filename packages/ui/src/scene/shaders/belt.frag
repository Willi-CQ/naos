uniform vec3 uRock;
uniform float uQuota;
in vec3 vLight;
in float vSeed;
in float vFade;
out vec4 o;

void main() {
  // A rock near the camera dissolves, because a sprite cannot hold up from there. Fading its colour would only leave a black blob.
  if (vFade < fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  q.y = -q.y;
  float a = atan(q.y, q.x);
  float edge = 0.72 + 0.16 * sin(a * 2.0 + vSeed) + 0.12 * sin(a * 3.0 + vSeed * 1.7);
  float r2 = dot(q, q) / (edge * edge);
  if (r2 > 1.0) discard;
  vec3 n = vec3(q / edge, sqrt(1.0 - r2));
  o = vec4(uRock * (0.22 + 1.8 * max(dot(n, vLight), 0.0)) * uQuota, 1.0);
}
