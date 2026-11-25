// A craft at System zoom: one instanced quad per mark. position.xy is -1..1.
in vec3 iPos;
in vec4 iBasis;          // CSS px per unit of the drawing: its long axis, then its short axis
in float iIndex;
in vec4 iColor;          // linear rgb, HDR gain
in vec4 iStyle;          // x: fill. y: dashes. z: fade. w: how far apart a crash has come
uniform vec2 uRes;
uniform float uPxPerCss;
uniform vec2 uGrid;
uniform float uReach;
out vec2 vU;
flat out vec2 vTile;
flat out vec4 vColor;
flat out vec4 vStyle;

void main() {
  vec4 c = projectionMatrix * viewMatrix * vec4(iPos, 1.0);
  // The pieces of a crash travel past the edge of the drawing's tile.
  vec2 u = position.xy * uReach * (iStyle.w > 0.0 ? 1.34 : 1.0);
  vec2 q = iBasis.xy * u.x + iBasis.zw * u.y;
  c.xy += q * uPxPerCss / uRes * 2.0 * c.w;
  gl_Position = c;
  float row = floor(iIndex / uGrid.x);
  vTile = vec2(iIndex - row * uGrid.x, row);
  vU = u;
  vColor = iColor;
  vStyle = iStyle;
}
