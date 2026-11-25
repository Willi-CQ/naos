// Straight marks in world space: open tool calls and meteors. position.x runs 0..1, position.y is the side.
in vec3 iFrom;
in vec3 iTo;
in vec4 iBeam;       // x: class, y: birth s, z: life s, 0 while the call is open, w: width CSS px
in vec4 iColor;      // linear rgb, HDR gain
uniform vec2 uRes;
uniform float uPxPerCss;
uniform float uNow;
out float vT;
out float vSide;
out vec4 vColor;
flat out float vClass;

void main() {
  float t = position.x;
  float g = 1.0;
  if (iBeam.z > 0.0) {                                  // a meteor: a window that runs once and dies
    float s = clamp((uNow - iBeam.y) / iBeam.z, 0.0, 1.0);
    t = mix(max(0.0, s - 0.3), s, t);
    g = 1.0 - s * s;
  }
  mat4 vp = projectionMatrix * viewMatrix;
  vec4 a = vp * vec4(iFrom, 1.0);
  vec4 b = vp * vec4(iTo, 1.0);
  vec4 c = mix(a, b, t);
  float wa = abs(a.w) < 1e-4 ? 1e-4 : a.w;
  float wb = abs(b.w) < 1e-4 ? 1e-4 : b.w;
  vec2 dir = normalize((b.xy / wb - a.xy / wa) * uRes + vec2(1e-5, 0.0));
  float w = iBeam.w * uPxPerCss * (int(iBeam.x + 0.5) == 0 ? mix(0.25, 1.0, position.x) : 1.0);
  c.xy += vec2(-dir.y, dir.x) * position.y * w / uRes * 2.0 * c.w;
  gl_Position = c;
  vT = position.x;
  vSide = position.y;
  vColor = vec4(iColor.rgb, iColor.a * g);
  vClass = iBeam.x;
}
