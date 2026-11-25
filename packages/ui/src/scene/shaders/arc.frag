uniform float uNow;
in float vT;
in float vSide;
in vec4 vColor;
in vec3 vFx;
out vec4 o;

void main() {
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(vSide));              // analytic AA, no MSAA needed
  float dash = vFx.x > 0.0 ? step(0.5, fract(vT * vFx.x - uNow * vFx.y)) : 1.0;
  float fade = mix(1.0, vT * vT, vFx.z);
  o = vec4(vColor.rgb * vColor.a * edge * dash * fade, 1.0);
}
