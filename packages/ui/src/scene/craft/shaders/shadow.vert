// One atlas tile per close ship, from the light's point of view. Every caster lands in its own tile by arithmetic, so the whole atlas is one
// target and needs no viewport changes.
in vec4 iPose;
in vec4 iQuat;
in vec4 iShip;
in vec4 iTile;
uniform vec3 uDisk;

vec3 rotate(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }

void main() {
  if (iTile.z <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 w = iPose.xyz + rotate(iQuat, position * iPose.w);
  vec3 L = normalize(uDisk - iShip.xyz);
  vec3 X = normalize(cross(L, vec3(0.31, 0.87, 0.39)));
  vec3 Y = cross(X, L);
  vec3 rel = (w - iShip.xyz) / iShip.w;
  vec2 uv = iTile.xy + (vec2(dot(rel, X), dot(rel, Y)) * 0.5 + 0.5) * iTile.z;
  gl_Position = vec4(uv * 2.0 - 1.0, dot(rel, -L), 1.0);
}
