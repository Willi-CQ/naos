// One instanced quad for every screen facing mark: hulls, beads, broken rings, countdown arcs, slashes, debris, pods.
// position.xy is -1..1.
in vec3 iPos;            // world position
in float iHeading;       // screen radians, 0 points right
in float iSize;          // half extent of the quad, CSS px
in vec4 iColor;          // linear rgb, HDR gain
in vec4 iShape;          // x: kind, y: fill 0..1, z: progress 0..1, w: dash count
uniform vec2 uRes;
uniform float uPxPerCss;
out vec2 vP;
out vec4 vColor;
flat out vec4 vShape;

void main() {
  vec4 c = projectionMatrix * viewMatrix * vec4(iPos, 1.0);
  float ca = cos(iHeading);
  float sa = sin(iHeading);
  vec2 q = vec2(position.x * ca - position.y * sa, position.x * sa + position.y * ca);
  c.xy += q * iSize * uPxPerCss / uRes * 2.0 * c.w;
  gl_Position = c;
  vP = position.xy;
  vColor = iColor;
  vShape = iShape;
}
