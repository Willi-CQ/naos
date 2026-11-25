// The sky of the Stage through the lens. The environment cube answers in any direction, and its mips keep the images squeezed against the
// shadow smooth, but a star in it is a few px wide at the zoom of Home. The sky target holds the same stars crisp, for rays that land
// inside the frame. So each pixel takes the target wherever it can and the cube everywhere else.
uniform samplerCube uHoleSkyCube;
uniform sampler2D uHoleSkyTarget;
uniform mat4 uHoleSkyClip;     // projection times view, used on directions only

vec3 holeSky(vec3 dir, vec3 dx, vec3 dy) {
  vec3 far = textureGrad(uHoleSkyCube, dir, dx, dy).rgb;
  vec4 c = uHoleSkyClip * vec4(dir, 0.0);
  if (c.w <= 1e-4) return far;
  vec2 uv = c.xy / c.w;
  vec4 cx = uHoleSkyClip * vec4(dir + dx, 0.0);
  vec4 cy = uHoleSkyClip * vec4(dir + dy, 0.0);
  // How many pixels of the target one pixel here runs across. The target has no mips, so past a few it would sparkle.
  vec2 half_ = 0.5 * vec2(textureSize(uHoleSkyTarget, 0));
  float span = max(length((cx.xy / cx.w - uv) * half_), length((cy.xy / cy.w - uv) * half_));
  vec2 inFrame = 1.0 - smoothstep(vec2(0.94), vec2(0.995), abs(uv));
  float keep = inFrame.x * inFrame.y * (1.0 - smoothstep(1.4, 2.8, span));
  if (keep <= 0.0) return far;
  return mix(far, textureLod(uHoleSkyTarget, uv * 0.5 + 0.5, 0.0).rgb, keep);
}
