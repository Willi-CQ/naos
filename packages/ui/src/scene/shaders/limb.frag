uniform float uQuota;     // 0.28 + 0.72 * sun left: the whole system dims with the window
uniform vec3 uPearl;
in vec2 vQ;               // 1.0 is the limb
flat in vec3 vLight;
flat in float vGlow;
out vec4 o;

void main() {
  float r = length(vQ);
  if (r > 1.16) discard;
  float aa = fwidth(r) * 1.1;
  float body = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  vec3 col = vec3(0.0);
  if (r < 1.0) {
    vec3 n = vec3(vQ, sqrt(1.0 - r * r));
    float ndl = dot(n, vLight);
    float rim = pow(1.0 - n.z, 9.0) * smoothstep(-0.34, 0.5, ndl);
    col = uPearl * (rim * 9.0 + pow(max(ndl, 0.0), 3.0) * 0.018) * uQuota;
  } else {
    float nl = dot(normalize(vQ), vLight.xy);
    col = uPearl * exp((1.0 - r) / 0.022) * smoothstep(-0.1, 0.72, nl) * 1.5 * uQuota;
  }
  o = vec4(col * vGlow, body);    // premultiplied: the body occludes, the atmosphere adds
  gl_FragDepth = r < 1.0 ? gl_FragCoord.z : 1.0;   // only the body: a hull just past the limb must stay in front of the glow
}
