precision highp float;
uniform vec3 uSun;
uniform vec3 uColor;
uniform float uTime;
uniform float uActivity;
uniform float uSeed;
uniform float uReveal;
in vec3 vBody;
in vec2 vCurtain;
out vec4 fragColor;
void main() {
  float h = vCurtain.y;
  float a = vCurtain.x;
  float rays = pow(.5 + .5 * sin(a * 89.0 + sin(a * 13.0 + uTime * .24) * 2.0), 3.0);
  float folds = .35 + .65 * pow(.5 + .5 * sin(a * 7.0 + sin(a * 3.0 - uTime * .13) + uSeed), 2.0);
  float night = 1.0 - smoothstep(-.28, .38, dot(normalize(vBody), uSun));
  float envelope = smoothstep(0.0, .12, h) * pow(1.0 - h, 1.8);
  float gain = envelope * folds * (.22 + rays * .78) * night * (.22 + uActivity * 1.8) * uReveal;
  vec3 color = mix(uColor, vec3(.44,.24,.92), h * .65);
  fragColor = vec4(color * gain * 2.2, 1.0);
}
