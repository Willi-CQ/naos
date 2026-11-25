// Every curve is an arc of an ellipse: orbits, wakes, plumes, hoops, exposures, transfer arcs, streaks.
// position.x runs 0..1 along the arc, position.y is the side, -1..1.
in vec3 iCenter;
in vec3 iA;            // ellipse basis, scaled by radius
in vec3 iB;
in vec2 iSpan;         // start angle, sweep, radians
in vec4 iColor;        // linear rgb, HDR gain
in vec4 iStyle;        // x: width CSS px, y: taper 0..1, z: dash cycles along the arc, w: dash flow per second
in vec2 iLife;         // x: birth s, y: life s. Life 0 is a static arc. Otherwise a bright window runs along it once
in float iUnroll;      // 0 hoop, 1 flat row. Only the armillary sets it
in vec3 iRow;          // left end of the flat row, world space
uniform vec2 uRes;
uniform float uPxPerCss;
uniform float uNow;
out float vT;
out float vSide;
out vec4 vColor;
out vec3 vFx;          // x: dash cycles, y: dash flow, z: taper

vec3 orbit(float th) { return iCenter + iA * cos(th) + iB * sin(th); }

// A curve can pass behind the camera. The GPU clips the strip there, and this only keeps the direction finite.
float safe(float w) { return abs(w) < 1e-4 ? 1e-4 : w; }

// Constant arc length: curvature falls to zero, the strip never stretches.
vec3 uncurl(float th, float t) {
  vec3 hoop = orbit(th);
  if (t <= 0.0) return hoop;
  float R = length(iA);
  float s = (th - iSpan.x) * R;                       // arc length from the pin
  float k = (1.0 - t) / R;
  vec2 q = k < 1e-5 ? vec2(s, 0.0) : vec2(sin(k * s) / k, (1.0 - cos(k * s)) / k);
  vec3 bent = iRow + vec3(q.x, 0.0, q.y);
  return mix(hoop, bent, smoothstep(0.0, 0.2, t));
}

void main() {
  float t = position.x;
  float g = 1.0;
  if (iLife.y > 0.0) {
    float s = clamp((uNow - iLife.x) / iLife.y, 0.0, 1.0);
    t = mix(max(0.0, s - 0.35), s, t);
    g = 1.0 - s * s;
  }
  float th = iSpan.x + iSpan.y * t;
  mat4 vp = projectionMatrix * viewMatrix;
  vec4 c0 = vp * vec4(uncurl(th, iUnroll), 1.0);
  vec4 c1 = vp * vec4(uncurl(th + 0.01, iUnroll), 1.0);
  vec2 dir = normalize((c1.xy / safe(c1.w) - c0.xy / safe(c0.w)) * uRes + vec2(1e-5, 0.0));
  float w = iStyle.x * uPxPerCss * mix(1.0, position.x, iStyle.y);
  c0.xy += vec2(-dir.y, dir.x) * position.y * w / uRes * 2.0 * c0.w;
  gl_Position = c0;
  vT = position.x;
  vSide = position.y;
  vColor = vec4(iColor.rgb, iColor.a * g);
  vFx = vec3(iStyle.z, iStyle.w, iStyle.y);
}
