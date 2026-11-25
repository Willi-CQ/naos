// The other side of the tone curve A/B, DESIGN ruling 10. Same disc occluder, dim and desaturation as finish.frag, with
// three's AgX in place of the stills' curve. It lives here because it ships only if the A/B says so.
import { FinishEffect } from '../scene/Finish.ts';

const AGX = /* glsl */ `
uniform vec3 uDisc;
uniform vec4 uFocus;
uniform float uDim;
uniform float uDesat;
uniform vec3 uVoid;

// three's AgXToneMapping, step for step, so the A/B is fair to it. The exposure is 1.
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 agx(vec3 color) {
  const mat3 toRec2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956);
  const mat3 fromRec2020 = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
  const mat3 inset = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995,
                          0.0951212405381588, 0.761241990602591, 0.0767994186031903,
                          0.0482516061458583, 0.101439036467562, 0.811302368396859);
  const mat3 outset = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
                           -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
                           -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
  const float lo = -12.47393;
  const float hi = 4.026069;
  color = inset * (toRec2020 * color);
  color = clamp((log2(max(color, 1e-10)) - lo) / (hi - lo), 0.0, 1.0);
  color = agxContrast(color);
  color = outset * color;
  return clamp(fromRec2020 * pow(max(color, vec3(0.0)), vec3(2.2)), 0.0, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 k = vec2(aspect, 1.0);
  float past = smoothstep(uDisc.z * 0.985, uDisc.z, length((uv - uDisc.xy) * k));
  vec3 c = mix(uVoid * 0.3, inputColor.rgb, past);
  c *= mix(1.0, uDim, smoothstep(uFocus.z, uFocus.w, length((uv - uFocus.xy) * k)));
  vec3 t = agx(c);
  outputColor = vec4(mix(t, vec3(dot(t, vec3(0.2126, 0.7152, 0.0722))), uDesat), inputColor.a);
}
`;

export class AgXEffect extends FinishEffect {
  constructor() { super({ fragment: AGX }); }
}
