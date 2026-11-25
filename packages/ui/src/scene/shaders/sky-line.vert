// Meridians, the now line and burned spokes. All are segments of a great circle in the sky, so all are one draw.
// position.x runs 0..1 along the segment, position.y is the side, -1 or 1.
in float iRa;          // right ascension, radians
in vec2 iDec;          // declination range, radians
in vec4 iColor;        // linear rgb, gain
in float iFade;        // 1 fades toward the poles, 0 does not
uniform mat3 uFrame;   // columns: sky axes e1, e2, e3 in world space
uniform vec2 uRes;
uniform float uWidthPx;
uniform float uLineGain; // below 1 when the width is clamped to one target px, so a low tier keeps the same flux
out float vSide;
out vec3 vColor;

vec3 skyDir(float ra, float dec) {
  return uFrame * vec3(cos(dec) * cos(ra), cos(dec) * sin(ra), sin(dec));
}

vec4 clipOf(vec3 d) {
  vec4 c = projectionMatrix * vec4(mat3(viewMatrix) * d, 1.0);
  c.z = c.w * 0.999;   // at infinity, whatever the near plane is doing
  return c;
}

float safe(float w) {
  return abs(w) < 1e-4 ? 1e-4 : w;
}

void main() {
  float dec = mix(iDec.x, iDec.y, position.x);
  vec4 c0 = clipOf(skyDir(iRa, dec));
  vec4 c1 = clipOf(skyDir(iRa, dec + 0.01));
  vec2 t = normalize((c1.xy / safe(c1.w) - c0.xy / safe(c0.w)) * uRes + vec2(1e-5, 0.0));
  c0.xy += vec2(-t.y, t.x) * position.y * uWidthPx / uRes * 2.0 * c0.w;
  gl_Position = c0;
  vSide = position.y;
  float e = abs(dec) / 1.5;
  vColor = iColor.rgb * iColor.a * uLineGain * (1.0 - iFade * e * e * e);
}
