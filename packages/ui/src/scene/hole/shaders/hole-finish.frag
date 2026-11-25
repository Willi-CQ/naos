// The finish of the Stage for a scene with the hole in it. The old occluder was a circle. This one comes from the alpha the hole wrote,
// which says how much bloom may land on each pixel: none in the shadow, and little in the gap and on the sky around it. Only the bloom is
// held back. What the scene itself drew stays, so the near side of the disk can cross the shadow and a glow in front of it needs no alpha.
uniform vec4 uFocus;    // xy: centre uv, z: inner radius, w: outer radius, fractions of canvas height
uniform float uDim;     // 1 normal, 0.45 locked
uniform float uDesat;   // 0 normal, 0.4 kernel link lost

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 k = vec2(aspect, 1.0);
  vec4 scene = texture2D(inputBuffer, uv);
  vec3 c = scene.rgb + max(inputColor.rgb - scene.rgb, vec3(0.0)) * clamp(scene.a, 0.0, 1.0);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 v = mix(c, vec3(luma), clamp(log2(1.0 + luma) / 6.0, 0.0, 1.0));   // highlights roll toward white, as film does
  v *= mix(1.0, uDim, smoothstep(uFocus.z, uFocus.w, length((uv - uFocus.xy) * k)));
  vec3 t = 1.0 - exp(-v * 1.05);
  outputColor = vec4(mix(t, vec3(dot(t, vec3(0.2126, 0.7152, 0.0722))), uDesat), 1.0);
}
