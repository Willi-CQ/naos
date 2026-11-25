// The kernel disc, the sliver of sun past it, the thin limb. The sliver is the five hour gauge.
uniform float uSunLeft;      // five hour window left, 0..1
uniform vec3 uSliver;        // lerps from sliver-full to sliver-low as the window burns
uniform vec3 uPearl;
in vec2 vP;                  // position in star radii
out vec4 o;

void main() {
  float r = length(vP);
  vec2 sp = vP - vec2(0.469, 0.883) * (0.012 + 0.11 * uSunLeft);   // the sun, displaced toward one o'clock
  float aa = fwidth(r) * 1.2;
  float past = smoothstep(1.0 - aa, 1.0 + aa, r);
  float sun = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, length(sp));
  if (r > 1.0 + aa && sun <= 0.0 && r > 1.06) discard;   // only the disc itself writes depth, so a world behind it hides and one beside it does not
  float e = (r - 1.0) / 0.008;
  vec3 col = uSliver * sun * past * 16.0 + uPearl * exp(-e * e) * 0.5;
  o = vec4(col * past, 1.0 - past);                                // premultiplied: the disc occludes, the rim adds
}
