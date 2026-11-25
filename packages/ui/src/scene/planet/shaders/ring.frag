// Rings as what they are: an optically thin slab of ice. Drawn after the planet. Where the planet stands in front, nothing is drawn. The
// slab is lit from one face and may be seen from the other, and single scattering gives both, which is why the dense ring goes dark and the
// gaps go bright when a ring is backlit.
in vec3 vBody;
out vec4 o;

uniform sampler2D uRing;
uniform vec3 uCam;
uniform vec3 uSun;
uniform vec3 uLight;
uniform vec2 uSoft;
uniform vec4 uRingBand;      // inner, outer, 1 / (outer - inner)
uniform float uRingTauMax;
uniform float uReveal;

void main() {
  vec3 x = vBody;
  float r = length(x.xz);
  float at = (r - uRingBand.x) * uRingBand.z;
  float edge = fwidth(at);
  float inside = smoothstep(0.0, edge, at) * (1.0 - smoothstep(1.0 - edge, 1.0, at));
  if (inside <= 0.0) discard;

  vec3 toCam = uCam - x;
  float dist = length(toCam);
  vec3 v = toCam / dist;

  // The planet in front of this piece of ring.
  float b = dot(x, v);
  float pass = dot(x, x) - b * b;
  if (b < 0.0 && pass < 1.0) {
    // The edge is antialiased by the planet draw underneath it. A hard test here leaves no halo.
    discard;
  }

  vec4 s = texture(uRing, vec2(at, 0.5));
  // The texture minifies toward fine ringlets, and a fade keeps them from crawling far away.
  float tau = s.a * uRingTauMax;
  float mu = max(abs(v.y), 0.015);
  float mu0 = max(abs(uSun.y), 0.015);

  // Inside the planet's shadow, soft by the width of the source. Past the terminator the shadow narrows, as it should.
  float along = dot(x, uSun);
  float miss = length(x - uSun * along);
  float penumbra = uSoft.x * 2.0 * max(-along, 0.0) + 0.01;
  float shadow = along < 0.0 ? smoothstep(1.0 - penumbra, 1.0 + penumbra, miss) : 1.0;

  float lit = sign(v.y) == sign(uSun.y) ? 1.0 : 0.0;
  float reflected = mu0 / (mu + mu0) * (1.0 - exp(-tau * (1.0 / mu + 1.0 / mu0)));
  float through = abs(mu - mu0) < 1e-3
    ? tau / mu * exp(-tau / mu)
    : mu0 / (mu - mu0) * (exp(-tau / mu) - exp(-tau / mu0));
  float scatter = lit > 0.5 ? reflected * 1.35 : through;

  // Ice grains throw light mostly forward, so a backlit ring brightens with a narrow glow around the source.
  float cosPhase = dot(-v, uSun);
  float g = 0.35;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosPhase, 1.5);

  vec3 color = s.rgb * uLight * scatter * hg * shadow * 1.5;
  float alpha = (1.0 - exp(-tau / mu)) * inside;
  o = vec4(color * inside, alpha) * uReveal;
}
