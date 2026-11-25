// Nothing reflects in NAOS: the hull is its own edge light. Filled for an owned craft, only the rim for one NAOS merely reads.
uniform vec3 uColor;
uniform float uFill;
uniform float uGain;
in vec3 vView;
in float vAlong;
out vec4 o;

void main() {
  vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
  float facing = abs(dot(n, normalize(vView)));
  float rim = pow(1.0 - facing, 3.0);
  float body = uFill * (0.1 + 0.3 * facing) * smoothstep(-0.7, 1.0, vAlong);
  o = vec4(uColor * uGain * (rim * 1.4 + body), 1.0);
}
