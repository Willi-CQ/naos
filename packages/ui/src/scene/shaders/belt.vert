// The Belt: rubble on a ring at the edge. aRock is orbit radius, phase, height and size, world units. Plain for now: each point is one rock
// with a broken outline, lit from the hole. A rock that comes close to the camera fades out, because a sprite cannot hold up from there.
in vec4 aRock;
uniform float uTurn;
uniform float uPx;      // px per world unit at depth 1
out vec3 vLight;
out float vSeed;
out float vFade;

void main() {
  float a = aRock.y + uTurn;
  vec3 p = vec3(cos(a) * aRock.x, aRock.z, sin(a) * aRock.x);
  vec4 c = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * c;
  gl_PointSize = clamp(aRock.w * uPx / max(1.0, -c.z), 1.6, 9.0);
  vLight = normalize(mat3(viewMatrix) * -p);
  vSeed = aRock.y * 37.0;
  vFade = smoothstep(260.0, 620.0, -c.z);
}
