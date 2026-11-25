precision highp float;
in vec2 vP;
flat in vec4 vColor;
flat in float vKind;
flat in vec4 vLine;
flat in vec2 vSize;
out vec4 o;

void main() {
  float a;
  vec3 c = vColor.rgb;
  if (vKind <= 0.0) {
    float r = length(vP);
    a = max(0.0, 1.0 - r);
    a = a * a * (0.25 + 3.0 * exp(-r * r * 26.0));
  } else {
    // A plume is a thin hot core inside a wider, fainter sheath, tightest at the nozzle, and it thins out long before it stops.
    vec2 p = gl_FragCoord.xy - vLine.xy;
    float t = clamp(dot(p, vLine.zw) / max(vSize.x, 1.0), 0.0, 1.0);
    float d = length(p - vLine.zw * t * vSize.x);
    float w = vSize.y * (1.0 + 0.75 * t);
    float sheath = exp(-d * d / (w * w));
    float core = exp(-d * d / (w * w * 0.09)) * (1.0 - t) * (1.0 - t);
    float fall = (1.0 - t) * (1.0 - t) * (0.72 + 0.28 * cos(t * 21.0) * (1.0 - t));
    // The sheath grows out of the core a little way off: the mouth of the bell stays dark, and the fire is inside it.
    a = sheath * fall * 0.55 * mix(0.12, 1.0, smoothstep(0.02, 0.3, t));
    c = c + vec3(0.7, 0.85, 0.8) * core * 2.4;
    a += core * 0.8;
  }
  o = vec4(c * vColor.a * a, 1.0);
}
