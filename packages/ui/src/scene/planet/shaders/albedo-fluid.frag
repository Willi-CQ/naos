// The cloud deck of a giant, or of a world that hides its ground. Bands come from a table and every point is carried through a divergence
// free flow first, stretched along the winds, which is what turns stripes into filaments. RGB colour, A the latitude that point was carried from,
// so the planet shader can tell which band a texel belongs to, whatever shape the flow has given its edge.
in vec2 vFace;
out vec4 o;

uniform mat3 uFace;
uniform sampler2D uBand;
uniform vec3 uSeed;
uniform vec3 uAccent;
uniform vec3 uHigh;
uniform float uTurbulence;
uniform float uFine;         // octaves of flow that fit this resolution
uniform float uChevron;      // 1 bends the deck into the V of a super-rotating atmosphere
uniform vec4 uStorm[24];
uniform vec4 uStormLook[24];
uniform int uStormCount;

vec3 turn(vec3 v, vec3 axis, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

void main() {
  vec3 p = normalize(uFace * vec3(vFace, 1.0));
  vec3 q = p;

  float paint = 0.0;
  vec3 paintColor = vec3(0.0);
  for (int i = 0; i < uStormCount; i++) {
    vec4 c = uStorm[i];
    vec4 l = uStormLook[i];
    // Ovals, wider along the wind. Distance is measured in a squeezed frame.
    vec3 d = p - c.xyz;
    d.y *= 1.55;
    float u = length(d) / c.w;
    if (u > 3.4) continue;
    q = turn(q, c.xyz, l.x * 3.4 * exp(-u * u * 0.8));
    float body = 1.0 - smoothstep(0.62, 1.05, u + 0.09 * nz(p * 34.0 + float(i)).x);
    vec3 tone = mix(uHigh * 1.08, uAccent * (0.9 + 0.2 * smoothstep(0.1, 0.9, u)), l.z);
    float keep = mix(0.5, 0.92, l.z) * body;
    paintColor = mix(paintColor, tone, body);
    paint = max(paint, keep * l.y * 1.2);
  }

  // Latitude carried by the flow. Motion is nearly all along the jets, and it curls only where neighbouring jets shear, on the band edges.
  // Near the poles the stretch fades and the chaos goes round.
  float polar = smoothstep(0.66, 0.94, abs(p.y));
  float stretch = mix(5.0, 1.3, polar);
  // Squared, so a calm giant stays calm: Saturn has fine straight bands, and only a Jupiter breaks them up.
  float amp = 0.0085 * (0.08 + 1.75 * uTurbulence * uTurbulence);
  float f = 2.4;
  int steps = int(uFine);
  for (int i = 0; i < steps; i++) {
    // Winds step from band to band, and a blurred read shows how near a step is, which is where the flow curls.
    float above = textureLod(uBand, vec2(clamp(q.y + 0.03, -1.0, 1.0) * 0.5 + 0.5, 0.5), 4.5).a;
    float below = textureLod(uBand, vec2(clamp(q.y - 0.03, -1.0, 1.0) * 0.5 + 0.5, 0.5), 4.5).a;
    float shear = 0.22 + min(abs(above - below) * 4.5, 1.1) + polar;
    vec3 s = vec3(q.x, q.y * stretch, q.z) * f + uSeed + float(i) * 5.3;
    vec4 n = nz(s);
    vec3 g = n.yzw * vec3(1.0, stretch, 1.0);
    q = normalize(q + cross(q, g) * amp * shear);
    f *= 1.9;
    amp *= 0.74;
  }

  float y = q.y;
  if (uChevron > 0.0) y += uChevron * 0.34 * pow(abs(sin(atan(q.z, q.x) * 1.0)), 2.0) * (0.25 - p.y * p.y) * 2.0;
  vec4 band = textureLod(uBand, vec2(y * 0.5 + 0.5, 0.5), 0.0);
  vec3 color = band.rgb;

  // Fine rows and a slow mottling. Both follow the flow, so they sit on the filaments, not on the sphere.
  vec3 w = vec3(q.x, q.y * 9.0, q.z) * 9.0 + uSeed;
  float rows = fbmGain(w, 6, 0.58);
  float blotch = fbm(vec3(q.x, q.y * 2.4, q.z) * 4.2 + uSeed.yzx, 4);
  color *= 1.0 + rows * 0.5 * (0.25 + uTurbulence) + blotch * 0.18 * smoothstep(0.15, 0.7, uTurbulence);
  // Colour lives in the depth of the deck: warm where the cloud has thinned, pale where it has welled up.
  float deep = smoothstep(0.08, -0.22, rows + blotch * 0.5);
  color = mix(color, color * uAccent / max(dot(uAccent, vec3(0.3, 0.5, 0.2)), 0.02) * 0.55, deep * 0.28 * uTurbulence);

  color = mix(color, paintColor, min(paint, 1.0));
  // A gentle curve on the bake, since a real deck has deeper blacks in its belts than a table of colours gives.
  float luma = dot(color, vec3(0.25, 0.6, 0.15));
  color *= mix(0.86, 1.08, smoothstep(0.1, 0.7, luma));
  o = vec4(color, y * 0.5 + 0.5);
}
