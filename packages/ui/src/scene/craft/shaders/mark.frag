// One drawing, three ways: solid for an owned craft, a line around it for one NAOS merely reads, and in five pieces for a crash. Section 6 again.
precision highp float;
uniform sampler2D uAtlas;
uniform vec2 uGrid;
uniform float uRange;
uniform float uReach;
uniform float uOutlineHalf;
uniform float uOutlineGap;
in vec2 vU;
flat in vec2 vTile;
flat in vec4 vColor;
flat in vec4 vStyle;
out vec4 o;

float field(vec2 u) {
  vec2 p = clamp(u / (2.0 * uReach) + 0.5, 0.004, 0.996);
  return (0.5 - texture(uAtlas, (vTile + p) / uGrid).r) * 2.0 * uRange;
}

// Section 6.4: the hull breaks along its length into five, and each piece keeps a heading of its own.
const vec2 DRIFT[5] = vec2[5](vec2(-0.16, 0.3), vec2(-0.08, -0.36), vec2(0.0, 0.26), vec2(0.1, -0.32), vec2(0.2, 0.24));
const float TURN[5] = float[5](0.7, -0.9, 0.55, -0.6, 0.85);

float shards(vec2 u, float b) {
  float d = 9.0;
  for (int k = 0; k < 5; k++) {
    float x = -0.8 + 0.4 * float(k);
    float a = TURN[k] * b;
    float c = cos(a), s = sin(a);
    vec2 r = u - DRIFT[k] * b - vec2(x, 0.0);
    r = vec2(c * r.x + s * r.y, -s * r.x + c * r.y) + vec2(x, 0.0);
    d = min(d, max(field(r), abs(r.x - x) - 0.17));
  }
  return d;
}

void main() {
  float px = max(length(dFdx(vU)), length(dFdy(vU)));
  float d = vStyle.w > 0.0 ? shards(vU, vStyle.w) : field(vU);
  float fill = 1.0 - smoothstep(-0.7 * px, 0.7 * px, d);
  float half_ = uOutlineHalf * px;
  float line = 1.0 - smoothstep(half_ - 0.55 * px, half_ + 0.55 * px, abs(d - uOutlineGap * px - half_));
  float gate = 1.0;
  if (vStyle.y > 0.5) {
    // Across the drawing, not around it, so a dash is as long on a straight flank as on a nose.
    float stripe = fract((vU.x + vU.y * 0.62) / (5.6 * px));
    gate = smoothstep(0.0, 0.14, stripe) * (1.0 - smoothstep(0.5, 0.64, stripe));
  }
  float body = mix(line, fill, vStyle.x);
  o = vec4(vColor.rgb * vColor.a * body * gate * vStyle.z, 1.0);
}
