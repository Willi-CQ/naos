// Last effect in the pass, after bloom. postprocessing supplies aspect, and encodes sRGB after mainImage.
uniform vec3 uDisc;     // xy: centre uv, z: radius as a fraction of canvas height
uniform vec4 uFocus;    // xy: centre uv, z: inner radius, w: outer radius, fractions of canvas height
uniform float uDim;     // 1 normal, 0.45 locked
uniform float uDesat;   // 0 normal, 0.4 kernel link lost
uniform vec3 uVoid;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 k = vec2(aspect, 1.0);
  float past = smoothstep(uDisc.z * 0.985, uDisc.z, length((uv - uDisc.xy) * k));
  vec3 c = mix(uVoid * 0.3, inputColor.rgb, past);                  // the disc stays black after bloom
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 v = mix(c, vec3(luma), clamp(log2(1.0 + luma) / 6.0, 0.0, 1.0));   // highlights roll toward white, as film does
  v *= mix(1.0, uDim, smoothstep(uFocus.z, uFocus.w, length((uv - uFocus.xy) * k)));
  vec3 t = 1.0 - exp(-v * 1.05);
  outputColor = vec4(mix(t, vec3(dot(t, vec3(0.2126, 0.7152, 0.0722))), uDesat), inputColor.a);
}
