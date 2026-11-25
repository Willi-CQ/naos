const int KITE = 0, DART = 1, BEAD = 2, BROKEN = 3, HOLLOW = 4, COUNTDOWN = 5, SLASH = 6, SHARD = 7, POD = 8;
const float TAU = 6.2831853;
in vec2 vP;
in vec4 vColor;
flat in vec4 vShape;
out vec4 o;

float seg(vec2 p, vec2 a, vec2 b) {
  vec2 e = b - a;
  vec2 w = p - a;
  return length(w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0));
}

float quad4(vec2 p, vec2 v0, vec2 v1, vec2 v2, vec2 v3) {            // signed distance to a closed polygon
  vec2 v[4] = vec2[4](v0, v1, v2, v3);
  float d = 1e3;
  float s = 1.0;
  for (int i = 0, j = 3; i < 4; j = i, i++) {
    d = min(d, seg(p, v[i], v[j]));
    vec2 e = v[j] - v[i];
    vec2 w = p - v[i];
    bool c1 = p.y >= v[i].y;
    bool c2 = p.y < v[j].y;
    bool c3 = e.x * w.y > e.y * w.x;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * d;
}

void main() {
  int kind = int(vShape.x + 0.5);
  float stroke = 0.09;
  float d = 1.0;
  float gate = 1.0;
  if (kind == KITE) {
    d = quad4(vP, vec2(1.0, 0.0), vec2(-0.62, 0.46), vec2(-0.24, 0.0), vec2(-0.62, -0.46));
    if (vShape.w > 0.5) gate = step(fract(atan(vP.y, vP.x + 0.1) / TAU * vShape.w), 0.55);
  }
  else if (kind == DART) d = quad4(vP, vec2(1.0, 0.0), vec2(-0.5, 0.26), vec2(-0.2, 0.0), vec2(-0.5, -0.26));
  else if (kind == BEAD) d = length(vP) - 0.72;
  else if (kind == POD) d = quad4(vP, vec2(0.7, 0.0), vec2(0.0, 0.42), vec2(-0.7, 0.0), vec2(0.0, -0.42));
  else if (kind == SHARD) d = quad4(vP, vec2(0.8, 0.1), vec2(-0.4, 0.5), vec2(-0.2, 0.0), vec2(-0.5, -0.4));
  else if (kind == SLASH) d = seg(vP, vec2(-0.8, -0.8), vec2(0.8, 0.8)) - 0.07;
  else {
    d = length(vP) - 0.9;
    float a = atan(vP.y, vP.x);
    if (kind == BROKEN) gate = step(fract(a / TAU * max(vShape.w, 1.0)), 0.62);
    if (kind == COUNTDOWN) gate = step(fract(a / TAU + 0.25), vShape.z) * (vShape.w > 0.5 ? step(fract(a / TAU * vShape.w), 0.6) : 1.0);
    stroke = 0.03;
  }
  float aa = fwidth(d);
  float fill = 1.0 - smoothstep(-aa, aa, d);
  float line = 1.0 - smoothstep(stroke - aa, stroke + aa, abs(d));
  o = vec4(vColor.rgb * vColor.a * mix(line, fill, vShape.y) * gate, 1.0);
}
