// Height and paint for a solid world. Heights are in planet radii, so slopes are honest and a crater's depth follows its width.
// R height, 0 at sea level. G dark plains and fresh flows. B lava heat. A surface paint: crater rays and ejecta above 0.5, stains below.
in vec2 vFace;
out vec4 o;

uniform mat3 uFace;
uniform vec3 uSeed;
uniform float uFreq;        // continents per lattice cell
uniform float uWarp;
uniform float uSea;
uniform float uOceans;      // 0 dry
uniform float uRelief;      // mountain height, radii
uniform float uRough;
uniform float uCraters;
uniform float uBasins;
uniform float uFractures;
uniform float uWorn;        // 1 air and weather have filled the small craters in, 0 airless, where every impact stays
uniform float uTexel;       // angular size of one texel
uniform int uDetail;        // octaves that fit this resolution
uniform vec4 uRay[10];
uniform int uRayCount;
uniform vec4 uArcA[64];     // pole, offset along it
uniform vec4 uArcB[64];     // middle of the arc, cosine of its half length
uniform vec4 uArcC[64];     // width, strength, kind, a number of its own
uniform int uArcCount;
uniform vec4 uVent[28];     // axis, radius
uniform vec4 uVentLook[28]; // heat, reach of its flows, a number of its own, lake
uniform int uVentCount;

// x with every octave, for the coast. y with the first few, for the shape of the land.
vec2 continents(vec3 p) {
  vec3 s = p * uFreq + uSeed;
  vec3 w = vec3(nz(s * 0.7 + 3.1).x, nz(s * 0.7 + 7.7).x, nz(s * 0.7 + 13.3).x);
  vec3 q = s + w * uWarp;
  float broad = fbmSmooth(q, 4, 0.56);
  float fine = (fbmSmooth(TURN * TURN * TURN * TURN * q * 16.98, 4, 0.6) + 0.0625 * 0.6 * 0.6 * fbmGain(TURN * TURN * q * 300.0, uDetail - 8, 0.6)) * 0.092;
  return vec2(broad + fine, broad);
}

// One size of crater. Fresh ones have a sharp rim and a bright blanket, old ones have nearly melted back.
void craterLayer(vec3 p, float freq, float keep, float age, inout float h, inout float paint) {
  vec3 q = p * freq;
  vec3 id = floor(q);
  vec3 lo = step(0.5, q - id) - 1.0;
  for (int iz = 0; iz < 2; iz++) for (int iy = 0; iy < 2; iy++) for (int ix = 0; ix < 2; ix++) {
    vec3 c = id + lo + vec3(ix, iy, iz);
    vec3 r = hash3(c + uSeed * 16.0);
    if (r.z > keep) continue;
    vec3 r2 = hash3(c + 91.0);
    vec3 at = normalize((c + 0.2 + 0.6 * r2) / freq);
    float rad = (0.14 + 0.3 * r.x * r.x) / freq;
    float d = distance(p, at) / rad;
    if (d > 3.0) continue;
    float fresh = pow(r.y, 2.0) * age + (1.0 - age) * 0.15;
    float depth = rad * mix(0.12, 0.4, fresh);
    float bowl = d < 1.0 ? (d * d - 1.0) * 0.8 : 0.0;
    float rim = exp(-pow(max(d - 1.0, 0.0) * 3.2, 2.0)) * smoothstep(0.55, 1.0, d) * 0.28;
    float peak = rad > 0.02 ? 0.3 * exp(-d * d * 28.0) : 0.0;
    // Later craters overwrite what they land on, so a big bowl flattens what was there. A small one only dents it: it cannot move a mountain.
    float inside = (1.0 - smoothstep(0.8, 1.15, d)) * smoothstep(0.006, 0.03, rad);
    h = mix(h, h * 0.4, inside * 0.7) + depth * (bowl + rim + peak);
    // The blanket is thrown out, so it lies outside the rim, and it lands unevenly.
    float thrown = 1.0 - smoothstep(1.0, 2.4 + 0.8 * r2.x, d + nz(p * freq * 2.7 + r2 * 9.0).x * 0.7);
    paint += thrown * smoothstep(0.55, 1.0, d) * fresh * 0.22;
  }
}

float rays(vec3 p) {
  float v = 0.0;
  for (int i = 0; i < uRayCount; i++) {
    vec4 c = uRay[i];
    float d = acos(clamp(dot(p, c.xyz), -1.0, 1.0)) / c.w;
    if (d > 26.0) continue;
    vec3 side = normalize(cross(c.xyz, abs(c.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 up = cross(c.xyz, side);
    vec3 t = normalize(p - c.xyz * dot(p, c.xyz));
    float a = atan(dot(t, up), dot(t, side));
    // Rays are thin, unequal, and only the longest reach far.
    vec3 s = vec3(cos(a), sin(a), float(i) * 3.7) * 5.0;
    float ray = pow(max(nz(s).x * 0.5 + nz(s * 2.3 + 5.0).x * 0.5 + 0.35, 0.0), 2.4) * 2.2;
    float reach = 4.0 + 22.0 * max(nz(s * 0.5 + 9.0).x + 0.3, 0.0);
    float blanket = exp(-pow(max(d - 1.0, 0.0) * 0.8, 2.0));
    v += ray * (1.0 - smoothstep(reach * 0.3, reach, d)) * (0.5 + 0.5 * nz(p * 90.0).x) + blanket * 0.7;
  }
  return min(v, 1.2);
}

// Arcs of the three kinds, the oldest first, so a later one cuts across what lies under it. They all wander through the same slow field,
// because nothing in nature follows a perfect circle, and the field is three noises so the wander has no one size.
void arcs(vec3 p, vec3 s, inout float h, inout float mare, inout float lava, inout float paint) {
  vec3 slow = vec3(nz(s * 1.1 + 51.0).x, nz(s * 1.1 + 57.0).x, nz(s * 1.1 + 63.0).x);
  vec3 mid = vec3(nz(s * 6.3 + 21.0).x, nz(s * 6.3 + 27.0).x, nz(s * 6.3 + 33.0).x);
  vec3 fine = vec3(nz(s * 31.0 + 1.0).x, nz(s * 31.0 + 9.0).x, nz(s * 31.0 + 17.0).x);
  vec3 w = p + slow * 0.065 + mid * 0.008 + fine * 0.001;
  float wall = fbm(s * 14.0 + 71.0, min(uDetail - 3, 8));
  for (int i = 0; i < uArcCount; i++) {
    vec4 a = uArcA[i];
    vec4 b = uArcB[i];
    vec4 c = uArcC[i];
    float t = dot(p, b.xyz);
    if (t <= b.w) continue;
    float d = abs(dot(w, a.xyz) - a.w);
    if (d > c.x * 7.0) continue;
    float ends = sqrt(clamp((t - b.w) / (1.0 - b.w) * 4.0, 0.0, 1.0));
    float vary = 0.8 + 0.55 * nz(p * (2.0 / sqrt(c.x)) + c.w).x;
    if (c.z < 0.5) {
      // Crack: a dark stain, and on it a double ridge with a groove down the middle, as on Europa.
      float wide = c.x * ends * max(vary, 0.3);
      float drawn = max(wide, uTexel);
      float fade = c.y * min(1.0, wide / uTexel);
      float u = d / drawn;
      float stain = exp(-u * u * 0.14);
      float ridge = exp(-pow(u - 0.6, 2.0) * 9.0);
      float groove = exp(-u * u * 12.0);
      h += fade * drawn * (ridge * 0.26 - groove * 0.2);
      paint -= stain * 0.3 * fade;
      paint += ridge * 0.2 * fade;
    } else if (c.z < 1.5) {
      // Canyon: walls eaten back into alcoves, a flat dark floor, and one bench half way down.
      // Widest at the middle, as a trough that has been growing from there.
      float wide = c.x * ends * max(vary, 0.42) * (0.55 + 0.75 * sqrt((t - b.w) / (1.0 - b.w)));
      float u = (d + wall * wide * 0.8) / wide;
      if (u < 1.5) {
        float cut = 1.0 - smoothstep(0.62, 1.0, u);
        float deep = 1.0 - smoothstep(0.2, 0.55, u);
        h -= (cut * 0.6 + deep * 0.4) * c.x * 0.34 * c.y;
        mare = max(mare, cut * mix(0.45, 0.8, deep) * c.y);
        paint += (1.0 - deep) * cut * 0.1;
      }
    } else {
      // Fissure: dark flood along its length, lit only where it is open.
      float wide = c.x * ends;
      float u = d / wide;
      float open = smoothstep(-0.05, 0.3, nz(p * 34.0 + c.w).x) * smoothstep(-0.2, 0.2, nz(p * 140.0 + c.w).x);
      lava = max(lava, exp(-u * u * 1.4) * open * c.y);
      mare = max(mare, exp(-u * u * 0.03) * 0.75);
      h -= exp(-u * u * 2.0) * wide * 0.3;
    }
  }
}

// Distance to the nearest edge of a cell pattern. A crust of cooling lava breaks along these.
float cellEdge(vec3 q) {
  vec3 id = floor(q);
  vec3 f = q - id;
  float first = 8.0;
  float second = 8.0;
  for (int iz = -1; iz <= 1; iz++) for (int iy = -1; iy <= 1; iy++) for (int ix = -1; ix <= 1; ix++) {
    vec3 g = vec3(ix, iy, iz);
    vec3 r = g + hash3(id + g + 7.0) * 0.86 + 0.07 - f;
    float d = dot(r, r);
    if (d < first) { second = first; first = d; }
    else if (d < second) second = d;
  }
  return sqrt(second) - sqrt(first);
}

// Volcanoes: a low shield, a caldera in it, dark tongues of flow that run out unevenly, and a pale ring of ash. What glows is small: the broken
// rim of the caldera, the seams of a lake's crust, and thin channels near the vent. Most of a lava field is black by the time you see it.
void vents(vec3 p, vec3 s, inout float h, inout float mare, inout float lava, inout float paint) {
  float edge = fbm(s * 11.0 + 81.0, 6);
  float tiny = fbm(s * 47.0 + 83.0, max(uDetail - 6, 2));
  for (int i = 0; i < uVentCount; i++) {
    vec4 c = uVent[i];
    vec4 l = uVentLook[i];
    float R = c.w;
    float d0 = distance(p, c.xyz);
    if (d0 > R * 11.0) continue;
    vec3 side = normalize(cross(c.xyz, abs(c.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 up = cross(c.xyz, side);
    vec3 t = p - c.xyz * dot(p, c.xyz);
    float a = atan(dot(t, up), dot(t, side));
    vec3 round = vec3(cos(a), sin(a), l.z);
    float arm = 0.5 + 0.5 * (nz(round * 1.6).x * 0.8 + nz(round * 3.7 + 5.0).x * 0.5 + nz(round * 8.1 + 2.0).x * 0.3);
    float reach = R * (1.4 + 8.0 * pow(clamp(arm, 0.0, 1.0), 2.4) * l.y);
    float d = d0 + R * (edge * 1.2 + tiny * 0.35);
    float flow = 1.0 - smoothstep(reach * 0.72, reach, d);
    float u = d0 / R;
    float rimAt = u + edge * 0.3 + tiny * 0.1 - 0.52;
    float pit = 1.0 - smoothstep(-0.1, 0.0, rimAt);

    h += R * 0.15 * exp(-u * u * 0.9) - pit * R * 0.09;
    mare = max(mare, max(flow * 0.85, pit));
    // The field of a living vent is not cold: a dull red under the crust, broken up, and gone before it reaches the end of the flow.
    float embers = flow * (1.0 - smoothstep(0.1, 0.8, d / reach)) * smoothstep(-0.05, 0.3, tiny + edge * 0.5);
    paint += exp(-pow((d / (R * (3.5 + 3.5 * l.y)) - 1.0) * 3.0, 2.0)) * 0.1;

    float rim = exp(-rimAt * rimAt * 200.0) * smoothstep(-0.15, 0.2, nz(round * 5.0 + 9.0).x);
    float nearby = 1.0 - smoothstep(0.0, reach, d);
    float channel = 1.0 - smoothstep(0.0, 0.05 + 0.2 * (1.0 - nearby), abs(nz(round * 9.0 + vec3(0.0, 0.0, d0 / R * 0.2)).x + edge * 0.4));
    float heat = max(max(rim, channel * nearby * nearby * smoothstep(-0.25, 0.25, edge + tiny) * 0.8), embers * 0.3);
    if (l.w > 0.5 && pit > 0.0) {
      float seam = cellEdge(p / (R * 0.075) + l.z);
      heat = max(heat, pit * (0.06 + 0.86 * (1.0 - smoothstep(0.02, 0.16, seam))));
    }
    lava = max(lava, heat * l.x);
  }
}

void main() {
  vec3 p = normalize(uFace * vec3(vFace, 1.0));
  vec2 c = continents(p);
  float land = c.x - uSea;

  vec3 s = p * 2.2 + uSeed.zxy;
  float paint = 0.5;
  float h;

  // Long ranges follow the zero lines of a slow field, which looks like plates meeting.
  float belt = 1.0 - smoothstep(0.0, 0.22, abs(nz(s * 0.8 + 11.0).x + 0.3 * nz(s * 1.9).x));
  float hills = eroded(s * 3.0, uDetail, 0.5 + 0.08 * uRough);
  float peaks = ridged(s * 4.0 + 5.0, min(uDetail, 12));
  float mask = smoothstep(0.02, 0.2, c.y - uSea + 0.2 * (1.0 - uOceans));
  h = uRelief * mask * (0.26 * hills + peaks * (0.12 + 0.75 * belt * smoothstep(0.1, 0.5, hills + 0.4)));
  if (uOceans > 0.0) {
    // The coast is fractal but barely above the water. Inland rises with the smooth shape only, so plains stay plains.
    h += land > 0.0 ? land * 0.01 + max(c.y - uSea, 0.0) * 0.045 * smoothstep(0.0, 0.1, land) : land * 0.12;
  } else {
    h += land * uRelief * 0.8;
  }

  // Dark smooth plains: the lowest ground on a dry world, filled once and then left alone.
  float mare = 0.0;
  if (uBasins > 0.0) {
    float b = fbm(s * 0.55 + 41.0, 5) + 0.16 * fbm(s * 2.6 + 3.0, 5);
    mare = smoothstep(0.12 - 0.42 * uBasins, 0.4 - 0.42 * uBasins, b + 0.06 * fbm(s * 9.0, 4));
    h = mix(h, min(h, 0.0) - 0.002 + h * 0.08, mare);
  }

  if (uCraters > 0.0) {
    // Sizes run from basins to the smallest the texture can hold. Stop before a crater is one texel wide.
    float keep = uCraters;
    float freq = 3.0;
    float age = 1.0;
    float m = 1.0 - mare * 0.75;
    for (int i = 0; i < 12; i++) {
      if (0.3 / freq < uTexel * 1.5) break;
      float small = smoothstep(4.0, 7.0, float(i));
      craterLayer(p, freq, min(1.0, keep * (0.6 + 0.09 * float(i))) * m * (1.0 - small * mix(0.35, 0.92, uWorn)), age, h, paint);
      freq *= 1.95;
      age = min(1.0, age + 0.06);
    }
  }
  if (uRayCount > 0) paint += rays(p) * 0.5;

  float lava = 0.0;
  if (uFractures > 0.0) {
    // Between the great arcs the shell is ridged all over, in sets that follow the same stresses.
    vec3 ax = uArcA[uArcCount - 1].xyz;
    vec3 ay = normalize(cross(ax, vec3(0.31, 0.83, 0.47)));
    vec3 az = cross(ax, ay);
    int fine = clamp(uDetail - 8, 1, 7);
    vec3 bent = p + 0.07 * vec3(nz(s * 1.3 + 11.0).x, nz(s * 1.3 + 15.0).x, nz(s * 1.3 + 19.0).x);
    float one = ridged(vec3(dot(bent, ax) * 60.0, dot(bent, ay) * 9.0, dot(bent, az) * 9.0) + uSeed, fine);
    float two = ridged(vec3(dot(bent, ay) * 70.0, dot(bent, ax) * 11.0, dot(bent, az) * 11.0) + uSeed.zxy, fine);
    float which = smoothstep(-0.06, 0.06, fbm(s * 1.7 + 91.0, 4));
    float plains = mix(one, two, which) * smoothstep(0.0, 0.35, fbm(s * 1.1 + 95.0, 3) + uFractures * 0.5 - 0.42);
    h += plains * 0.0008 * uFractures;
    paint += (plains - 0.25) * 0.03 * uFractures;
  }
  if (uArcCount > 0) arcs(p, s, h, mare, lava, paint);
  if (uVentCount > 0) vents(p, s, h, mare, lava, paint);

  o = vec4(h, mare, lava, paint);
}
