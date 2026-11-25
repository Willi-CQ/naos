const int SCAN = 0, STRIKE = 1, DRILL = 2, OUTBOUND = 3, TIGHT = 4, METEOR = 5;
uniform float uNow;
in float vT;
in float vSide;
in vec4 vColor;
flat in float vClass;
out vec4 o;

void main() {
  int k = int(vClass + 0.5);
  float across = abs(vSide);
  float m = 1.0 - smoothstep(0.35, 1.0, across);
  if (k == SCAN) m = exp(-across * across * 3.0) * vT * 0.5;                  // wide, pale cone
  if (k == DRILL) m *= step(0.5, fract(vT * 7.0 - uNow * 6.0));               // dashes flow toward the surface
  if (k == OUTBOUND) m *= step(0.35, fract(vT * 4.0 - uNow * 3.0));           // dashes flow out of the world
  if (k == STRIKE || k == METEOR) m *= mix(0.4, 1.0, vT);                     // hot at the tip
  o = vec4(vColor.rgb * vColor.a * m, 1.0);
}
