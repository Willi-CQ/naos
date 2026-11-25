// Token motes. Craft zoom only. Ring buffer, written once at birth, then analytic.
in vec4 aPath;       // xy: start, zw: end, on the orbital plane of the selected craft
in vec3 aMeta;       // x: birth s, y: life s, z: lateral bow
uniform mat4 uPlane; // orbital plane to world
uniform float uNow;
uniform float uPx;
out float vA;

void main() {
  float t = clamp((uNow - aMeta.x) / aMeta.y, 0.0, 1.0);
  vec2 a = aPath.xy;
  vec2 b = aPath.zw;
  vec2 c = 0.5 * (a + b) + vec2(a.y - b.y, b.x - a.x) * aMeta.z;
  vec2 p = mix(mix(a, c, t), mix(c, b, t), t);
  gl_Position = projectionMatrix * viewMatrix * uPlane * vec4(p.x, 0.0, p.y, 1.0);
  gl_PointSize = uPx;
  vA = sin(t * 3.14159);
}
