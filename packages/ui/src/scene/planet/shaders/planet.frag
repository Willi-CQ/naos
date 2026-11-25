// One planet along one ray. TIER 0 is a planet at system scale, 1 fills the frame, 2 is low orbit. Everything is in the body frame, in radii.
in vec3 vRay;
out vec4 o;

uniform samplerCube uAlbedo;
uniform samplerCube uRelief;
uniform samplerCube uClouds;
uniform samplerCube uLights;
uniform sampler2D uBand;
uniform sampler2D uRing;
uniform highp sampler3D uNoise;

uniform vec3 uCam;
uniform vec3 uSun;           // toward the source
uniform vec3 uSunAxis;       // the long axis of the source as this planet sees it
uniform vec3 uLight;         // HDR colour of the source
uniform vec2 uSoft;          // sine of the source's half width: across, along
uniform float uPx;           // radians per pixel

uniform float uH;            // scale height, radii
uniform float uTop;          // where the air ends, radii
uniform vec3 uTauR;          // Rayleigh optical depth straight up
uniform float uTauM;         // aerosol optical depth straight up
uniform vec3 uHazeColor;
uniform float uMulti;        // multiple scattering gain

uniform float uCloudTop;     // cloud shell altitude
uniform vec3 uCloudColor;
uniform vec4 uCloudSpin;     // cos, sin of the deck, cos, sin of the high layer
uniform float uCloudOn;
uniform float uCloudShadow;

uniform vec3 uLava;
uniform vec3 uCity;
uniform vec3 uEmber;
uniform float uLightsOn;
uniform float uLightBlur;    // mips of blur, for lights seen through the deck of a giant

uniform float uGlint;
uniform vec3 uSkyTint;
uniform float uLommel;       // 1 airless regolith, 0 Lambert
uniform float uLimbDark;     // Minnaert exponent minus one, for giants
uniform float uFlowOn;
uniform vec4 uFlow;          // x: how far the winds have carried the deck
uniform float uBias;         // texture sharpness on the way in from a lower bake
#ifdef WRITE_DEPTH
uniform mat4 uViewProj;
uniform vec3 uCentre;
uniform float uScale;
uniform mat3 uBody;
#endif
uniform float uHeightMax;

uniform vec4 uRingBand;      // inner, outer, 1 / (outer - inner), on
uniform float uRingTauMax;
uniform vec4 uOccluder;      // a moon in the body frame: xyz, radius
uniform float uReveal;       // 1 shown. Below 1, the surface is still spreading from uRevealAxis
uniform vec3 uRevealAxis;

const mat3 TURN = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
// How much of a height difference a cube can vouch for. Its 8 bits are steps, and a walk that trusts one of them draws contour lines on a plain.
const float HEIGHT_STEP = 4.0 / 255.0;

#if TIER == 2
uniform float uRough;
uniform float uRidge;        // 0 soft ground, 1 sharp ridges and pits
uniform float uClose;        // 0 exactly what tier 1 draws, 1 all the detail. The switch between tiers is at 0, so it cannot be seen.

// Nested patches of the same surface, coarse to fine. See region.ts.
uniform sampler2D uA0;
uniform sampler2D uA1;
uniform sampler2D uA2;
uniform sampler2D uR0;
uniform sampler2D uR1;
uniform sampler2D uR2;
uniform mat3 uP0;
uniform mat3 uP1;
uniform mat3 uP2;
uniform vec3 uPW;            // half widths
uniform vec3 uPOn;           // how far each is faded in

// A little fractal offset for every lookup. Magnified, a bake is only a blur, but a blurred edge read through a warp and cut against noise is a
// sharp fractal edge again, at any zoom and for no extra texture.
vec3 warpOf(vec3 p, float amount) {
  vec3 a = texture(uNoise, p * 11.0).rgb - 0.5;
  vec3 b = texture(uNoise, TURN * p * 26.0).rgb - 0.5;
  vec3 c = texture(uNoise, TURN * TURN * p * 61.0).rgb - 0.5;
  return (a + b * 0.5 + c * 0.25) * amount;
}

// Picks up where the finest patch stops. Each octave has the same slope, as a fractal surface does, and the mips of the volume fade an octave
// out by themselves once it is smaller than a pixel.
vec4 groundDetail(vec3 p) {
  vec3 slope = vec3(0.0);
  float height = 0.0;
  float f = 1100.0;
  float w = 1.0;
  vec3 q = p;
  for (int i = 0; i < 4; i++) {
    vec4 t = texture(uNoise, q * f * 0.0625);
    float v = t.a * 2.0 - 1.0;
    vec3 g = (t.rgb - 0.5) * 6.4;
    slope += mix(g, -sign(v) * g, uRidge) * w;
    height += mix(v, 0.5 - abs(v), uRidge) * w;
    w *= 0.68;
    f *= 2.17;
    q = TURN * q;
  }
  return vec4(slope, height);
}

// The bake's cloud is smooth this close. Billow noise cuts its edges, and in xyz gives the slope of the tops for the light to catch. Rounded
// tops with creases between them, as cumulus has: the other way round it reads as worm casts under a low sun.
vec4 cloudDetail(vec3 p) {
  float v = 0.0;
  vec3 slope = vec3(0.0);
  float a = 0.5;
  float f = 70.0;
  vec3 q = p;
  for (int i = 0; i < 5; i++) {
    vec4 t = texture(uNoise, q * f * 0.0625);
    float n = t.a * 2.0 - 1.0;
    v += a * abs(n) * 2.0;
    slope += a * sign(n) * (t.rgb - 0.5) * 6.4;
    a *= 0.6;
    f *= 2.23;
    q = TURN * q;
  }
  return vec4(slope, v);
}

// Waves, as a slope. Long swell first, and the mips take the short ones out with distance, which is when they turn into plain roughness.
vec3 waves(vec3 p) {
  vec3 slope = vec3(0.0);
  float a = 1.0;
  float f = 520.0;
  vec3 q = p;
  for (int i = 0; i < 5; i++) {
    // Squashed across the wind, so crests are long.
    vec4 t = texture(uNoise, vec3(q.x, q.y * 2.6, q.z) * f * 0.0625);
    slope += a * (t.rgb - 0.5);
    a *= 0.72;
    f *= 2.31;
    q = TURN * q;
  }
  return slope;
}

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

// One size of lamp: a jittered grid on a face of the cube, so a lamp stays where it is as the camera moves. A cell is lit by the chance the
// density gives, and a lit cell carries what the whole cell would have glowed, so the average over the ground is the density at any zoom.
// The spot keeps a margin inside its cell, which is why one cell is enough to read.
float lampsAt(vec2 uv, float face, float cell, float px, float density, float bias) {
  vec2 g = uv / cell;
  vec2 c = floor(g);
  vec2 key = c + vec2(face * 7919.0, face * 104729.0);
  float chance = 1.0 - exp(-4.0 * density * bias);
  if (hash12(key) >= chance) return 0.0;
  vec2 at = c + 0.25 + 0.5 * hash22(key + 17.0);
  float sigma = max(0.06, 0.75 * px / cell);
  vec2 d = (g - at) / sigma;
  float strength = min((0.35 + 1.3 * hash12(key + 41.0)) * density / max(chance, 1e-3) / (3.14159265 * sigma * sigma), 14.0);
  return exp(-dot(d, d)) * strength;
}

// How far a point is from the nearest edge of a Voronoi cell, in cells. The edges are roads between the places at the cells' centres:
// straight between junctions, as roads are, where lines in a noise would be closed loops.
float roadEdge(vec2 g, vec2 seed) {
  vec2 c = floor(g);
  vec2 f = g - c;
  vec2 near = vec2(0.0);
  vec2 at = vec2(0.0);
  float best = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 r = o + hash22(c + o + seed) - f;
      float d = dot(r, r);
      if (d < best) { best = d; near = r; at = o; }
    }
  }
  best = 8.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 o = at + vec2(float(i), float(j));
      vec2 r = o + hash22(c + o + seed) - f;
      vec2 between = r - near;
      if (dot(between, between) > 1e-5) best = min(best, dot(0.5 * (near + r), normalize(between)));
    }
  }
  return best;
}

// Lights in low orbit: villages, then blocks, then single streets, each only once its cells are several pixels wide. Until then its share
// stays in a faint glow. Lamps crowd along two nets of roads, highways between towns and streets inside them, so a town shows its
// layout and a highway runs out of it as a line of lights. `foot` is the ground a pixel covers, in radii.
float lampField(vec3 n, float density, float foot) {
  vec3 a = abs(n);
  float m = max(a.x, max(a.y, a.z));
  vec3 f = a.x == m ? vec3(n.yz / a.x, n.x > 0.0 ? 0.0 : 1.0) : a.y == m ? vec3(n.xz / a.y, n.y > 0.0 ? 2.0 : 3.0) : vec3(n.xy / a.z, n.z > 0.0 ? 4.0 : 5.0);
  float px = foot / (m * m);
  vec2 seed = vec2(f.z * 31.0, f.z * 17.0);
  const float HIGHWAY = 1.0 / 120.0;
  const float STREET = 1.0 / 900.0;
  float highway = 1.0 - smoothstep(0.0, max(0.025, 1.4 * px / HIGHWAY), roadEdge(f.xy / HIGHWAY, seed));
  float street = (1.0 - smoothstep(0.0, max(0.05, 1.4 * px / STREET), roadEdge(f.xy / STREET, seed + 53.0))) * smoothstep(3.0, 8.0, STREET / px);
  float roads = max(highway, street * 0.8);
  float bias = 0.6 + 2.4 * roads;
  float glow = 0.04;
  float light = 0.0;
  float cell = 1.0 / 350.0;
  float share[3] = float[3](0.24, 0.34, 0.38);
  for (int i = 0; i < 3; i++) {
    float on = smoothstep(4.0, 8.0, cell / px);
    glow += share[i] * (1.0 - on);
    if (on > 0.0) light += share[i] * on * lampsAt(f.xy, f.z + float(i) * 6.0, cell, px, density, bias);
    cell /= 2.6;
  }
  return light + glow * density * (0.75 + 0.5 * highway);
}

float patchWeight(vec2 u, float z, float on) {
  return z > 0.0 ? on * (1.0 - smoothstep(0.8, 0.97, max(abs(u.x), abs(u.y)))) : 0.0;
}

// The tilt comes in the patch's own axes. Those are the rows of the matrix, times the width, and the rest is the small turn across a patch.
vec3 patchTilt(mat3 P, vec2 rg, float width, vec3 n) {
  vec3 t = (transpose(P) * vec3(rg, 0.0)) * width;
  return t - n * dot(t, n);
}

// Height near a point, in radii, and how much of a difference in it to trust.
vec2 heightNear(vec3 d, float lod) {
  vec3 q;
  vec2 u;
  q = uP2 * d; u = q.xy / q.z;
  if (uPOn.z * uClose > 0.5 && q.z > 0.0 && max(abs(u.x), abs(u.y)) < 0.97) return vec2(textureLod(uR2, u * 0.5 + 0.5, lod).a, 2e-5);
  q = uP1 * d; u = q.xy / q.z;
  if (uPOn.y * uClose > 0.5 && q.z > 0.0 && max(abs(u.x), abs(u.y)) < 0.97) return vec2(textureLod(uR1, u * 0.5 + 0.5, lod + log2(uPW.z / uPW.y)).a, 4e-5);
  q = uP0 * d; u = q.xy / q.z;
  if (uPOn.x * uClose > 0.5 && q.z > 0.0 && max(abs(u.x), abs(u.y)) < 0.97) return vec2(textureLod(uR0, u * 0.5 + 0.5, max(lod + log2(uPW.z / uPW.x), 0.0)).a, 8e-5);
  return vec2((textureLod(uRelief, d, 0.0).a * 2.0 - 1.0) * uHeightMax, HEIGHT_STEP * uHeightMax);
}
#else
vec2 heightNear(vec3 d, float lod) {
  return vec2((textureLod(uRelief, d, 0.0).a * 2.0 - 1.0) * uHeightMax, HEIGHT_STEP * uHeightMax);
}
#endif

const float PI = 3.14159265;

// Column of air along a ray, in units of the vertical column at the ground. X is planet radius over scale height, h altitude in scale
// heights. Schueler's fit of the Chapman function, GPU Pro 3. Accurate at any angle and takes no loop.
float chapman(float X, float h, float mu) {
  float c = sqrt(X + h);
  if (mu >= 0.0) return c / (c * mu + 1.0) * exp(-h);
  float x0 = sqrt(1.0 - mu * mu) * (X + h);
  float c0 = sqrt(x0);
  return 2.0 * c0 * exp(min(X - x0, 40.0)) - c / (1.0 - c * mu) * exp(-h);
}

vec3 sunThrough(float h, float mu) {
  float column = chapman(1.0 / uH, h, mu);
  return exp(-min(column, 200.0) * (uTauR + uTauM * 1.1));
}

// What reaches the ground: the direct beam plus most of what it lost, which comes back as skylight. Without this, noon is yellow.
vec3 groundLight(vec3 beam, float mu) {
  return beam + (1.0 - beam) * 0.75 * smoothstep(0.0, 0.35, mu);
}

// Lambert under a source of half width s. Inside the band the curve leaves zero flat, because the display's gamma lifts the first faint light
// into a visible edge if it does not, and it meets mu with the right value and slope at the top.
float softLit(float mu, float s) {
  if (mu >= s) return mu;
  if (mu <= -s) return 0.0;
  float t = (mu + s) / (2.0 * s);
  return s * t * t * t * (2.0 - t);
}

float phaseMie(float c) {
  const float g = 0.76;
  float k = 1.0 + g * g - 2.0 * g * c;
  return (1.0 - g * g) / (4.0 * PI * k * sqrt(k));
}

// Scattering along [t0, t1], samples packed where the air is thick.
void air(vec3 ro, vec3 rd, float t0, float t1, bool ground, out vec3 glow, out vec3 trans) {
#if TIER == 0
  const int N = 3;
#else
  const int N = 6;
#endif
  float len = t1 - t0;
  float sumColumn = 0.0;
  vec3 sum = vec3(0.0);
  float mid = 0.5 * (t0 + t1);
  float half_ = 0.5 * len;
  vec3 tauAll = uTauR + uTauM * 1.1;
  for (int i = 0; i < N; i++) {
    float u = (float(i) + 0.5) / float(N);
    float s;
    float ds;
    if (ground) {
      float k = 1.0 - u;
      s = t1 - len * k * k;
      ds = 2.0 * len * k / float(N);
    } else {
      float w = 2.0 * u - 1.0;
      s = mid + half_ * w * abs(w);
      ds = 4.0 * half_ * abs(w) / float(N);
    }
    vec3 x = ro + rd * s;
    float r = length(x);
    float h = max(r - 1.0, 0.0) / uH;
    float rho = exp(-h) * ds / uH;
    float column = sumColumn + rho * 0.5;
    // Half the extinction on the way out: what the air scatters away mostly stays in the air. Full extinction leaves a real limb olive.
    vec3 t = exp(-min(chapman(1.0 / uH, h, dot(x, uSun) / r), 200.0) * tauAll - column * tauAll * 0.5);
    sum += t * rho;
    sumColumn += rho;
  }
  float c = dot(rd, uSun);
  // Real air scatters each photon many times, so its source strength is several times the single scatter phase. The measured reflectance of
  // Earth's sky at 470 nm is about five times what one bounce gives. The gain is less than that, and less again over a deck of cloud.
  float pr = 0.0597 * (1.0 + c * c) * uMulti;
  glow = uLight * sum * (uTauR * pr + uTauM * uHazeColor * (phaseMie(c) + 0.1));
  trans = exp(-sumColumn * tauAll);
}

vec3 turnY(vec3 v, float c, float s) { return vec3(c * v.x + s * v.z, v.y, c * v.z - s * v.x); }

float cloudAt(vec3 p) {
  vec3 d = turnY(p, uCloudSpin.x, uCloudSpin.y);
  vec3 c = turnY(p, uCloudSpin.z, uCloudSpin.w);
  return 1.0 - (1.0 - texture(uClouds, d, uBias).r) * (1.0 - 0.6 * texture(uClouds, c, uBias).g);
}

// Read exactly, not filtered: a wind half way between two bands is the wind of neither, and one row of pixels would take the wrong texels.
float windOf(float y) {
  int size = textureSize(uBand, 0).x;
  return (texelFetch(uBand, ivec2(clamp(int((y * 0.5 + 0.5) * float(size)), 0, size - 1), 0), 0).a - 0.5) * 2.0;
}

// One band of a giant, carried round by its wind.
vec4 layer(vec3 n, float wind, vec3 dx, vec3 dy) {
  float a = wind * uFlow.x;
  float c = cos(a);
  float s = sin(a);
  vec3 r = turnY(n, c, s);
#if TIER == 2
  // Close up, the deck is torn further along the wind than across it, at sizes the bake has no texels for.
  vec3 stretched = vec3(r.x, r.y * 6.0, r.z);
  vec3 t = texture(uNoise, stretched * 1.3).rgb - 0.5;
  vec3 v = texture(uNoise, TURN * stretched * 4.1).rgb - 0.5;
  vec4 u = texture(uNoise, TURN * TURN * stretched * 13.0);
  float lanes = u.a * 0.5 + texture(uNoise, TURN * stretched * 37.0).a * 0.3 + texture(uNoise, stretched * 103.0).a * 0.2;
  r = normalize(r + (t * 0.02 + v * 0.008 + (u.rgb - 0.5) * 0.003) * vec3(1.0, 0.22, 1.0) * uClose);
#endif
  float scale = exp2(uBias);
  vec4 deck = textureGrad(uAlbedo, r, turnY(dx, c, s) * scale, turnY(dy, c, s) * scale);
#if TIER == 2
  deck.rgb *= 1.0 + (lanes - 0.5) * 0.9 * uClose;
#endif
  return deck;
}

// How much a texel of this neighbour's layer really belongs to it, by the latitude the bake stored. A blurred read of the wind runs from one band's
// value to the other's across their edge, so two layers cross-fade there and never cut.
float belongs(float stored, float wind, float other) {
  float at = (textureLod(uBand, vec2(stored, 0.5), 2.5).a - 0.5) * 2.0;
  return smoothstep(0.1, 0.9, clamp((at - other) / (wind - other), 0.0, 1.0));
}

// 1 at the edge with that neighbour and 0 far from it, so nothing can show where the search for a neighbour stops.
float nearEdge(float y, float wind, float other) {
  float at = (textureLod(uBand, vec2(y * 0.5 + 0.5, 0.5), 4.0).a - 0.5) * 2.0;
  return smoothstep(0.02, 0.22, (at - wind) / (other - wind));
}

// A giant's bands slide past each other for ever. A wind that varied inside a band would shear its filaments to mush within minutes, and resetting
// the shear on a clock makes the planet pulse. So each band has one wind and turns as a rigid ring, with its own wavy edge: the bake says which band
// each texel belongs to, in alpha, and where two bands meet they are laid over each other by that. Fine detail stays sharp for ever.
vec3 deck(vec3 n) {
  vec3 dx = dFdx(n);
  vec3 dy = dFdy(n);
  float here = windOf(n.y);
  float above = windOf(n.y + 0.07);
  float below = windOf(n.y - 0.07);
  vec4 own = layer(n, here, dx, dy);
  vec3 color = own.rgb;
  // Across one edge the upper layer lies on the lower one, seen from either side, so the pixels on both sides of the line agree.
  if (abs(above - here) > 0.004) {
    vec4 a = layer(n, above, dx, dy);
    color = mix(color, mix(own.rgb, a.rgb, belongs(a.a, above, here)), nearEdge(n.y, here, above));
  }
  if (abs(below - here) > 0.004) {
    vec4 b = layer(n, below, dx, dy);
    color = mix(color, mix(b.rgb, own.rgb, belongs(own.a, here, below)), nearEdge(n.y, here, below));
  }
  return color;
}

// The shadow of the rings on the surface, or on cloud tops.
float ringShadow(vec3 x) {
  if (uRingBand.w < 0.5) return 1.0;
  float t = -x.y / uSun.y;
  if (t <= 0.0) return 1.0;
  vec3 hit = x + uSun * t;
  float r = length(hit.xz);
  float at = (r - uRingBand.x) * uRingBand.z;
  if (at <= 0.0 || at >= 1.0) return 1.0;
  float tau = texture(uRing, vec2(at, 0.5)).a * uRingTauMax;
  return exp(-tau / max(abs(uSun.y), 0.03));
}

// A moon crossing the source, soft by the width of the source. Moons are worktrees, so this is sometimes there.
float moonShadow(vec3 x) {
  if (uOccluder.w <= 0.0) return 1.0;
  vec3 to = uOccluder.xyz - x;
  float along = dot(to, uSun);
  if (along <= 0.0) return 1.0;
  float miss = length(to - uSun * along);
  float penumbra = max(uSoft.x * along, 0.02);
  return 0.1 + 0.9 * smoothstep(uOccluder.w - penumbra, uOccluder.w + penumbra, miss);
}

void main() {
  vec3 rd = normalize(vRay);
  float b = dot(uCam, rd);
  float closest2 = dot(uCam, uCam) - b * b;
  float closest = sqrt(max(closest2, 0.0));
  bool front = b < 0.0;

  // Rays that miss still hand a point to the texture reads: the nearest one on the sphere. That keeps derivatives sane at the limb.
  float disc = 1.0 - closest2;
  float tHit = -b - sqrt(max(disc, 0.0));
  float pixel = max(-b, 0.01) * uPx;
  float cover = front ? 1.0 - smoothstep(-pixel, pixel, closest - 1.0) : 0.0;
  bool hit = disc > 0.0 && tHit > 0.0;
  bool inside = dot(uCam, uCam) < 1.0;
  if (inside) { cover = 1.0; hit = true; tHit = max(-b + sqrt(max(disc, 0.0)), 0.0); }

  vec3 x = uCam + rd * (hit ? tHit : -b);
  vec3 n = normalize(x);
  vec3 color = vec3(0.0);
  float muView = max(dot(n, -rd), 0.0);

  if (cover > 0.0) {
#if TIER == 2
    vec3 nLook = normalize(n + warpOf(n, 0.0026) * (1.0 - uFlowOn) * uClose);
#else
    vec3 nLook = n;
#endif
    vec4 albedo = texture(uAlbedo, nLook, uBias);
    vec4 rel = texture(uRelief, nLook, uBias);
    vec3 tilt = (rel.xyz - 0.5) * 0.5;
    vec3 surface = uFlowOn > 0.5 ? deck(n) : albedo.rgb;
    float water = albedo.a * (1.0 - uFlowOn);
    float height = (rel.a * 2.0 - 1.0) * uHeightMax;
    float patchHeat = 0.0;
    float onPatch = 0.0;

#if TIER == 2
    if (uFlowOn < 0.5) {
      // Implicit derivatives are not to be had in a branch, so they are all taken here.
      vec3 q0 = uP0 * n; vec3 q1 = uP1 * n; vec3 q2 = uP2 * n;
      vec2 u0 = q0.xy / q0.z; vec2 u1 = q1.xy / q1.z; vec2 u2 = q2.xy / q2.z;
      float w0 = patchWeight(u0, q0.z, uPOn.x) * uClose;
      float w1 = patchWeight(u1, q1.z, uPOn.y) * uClose;
      float w2 = patchWeight(u2, q2.z, uPOn.z) * uClose;
      vec2 g0 = u0 * 0.5 + 0.5; vec2 g1 = u1 * 0.5 + 0.5; vec2 g2 = u2 * 0.5 + 0.5;
      vec2 x0 = dFdx(g0); vec2 y0 = dFdy(g0); vec2 x1 = dFdx(g1); vec2 y1 = dFdy(g1); vec2 x2 = dFdx(g2); vec2 y2 = dFdy(g2);
      vec4 groundColor = vec4(surface, water);
      if (w0 > 0.0 && w1 < 1.0 && w2 < 1.0) {
        vec4 r = textureGrad(uR0, g0, x0, y0);
        groundColor = mix(groundColor, textureGrad(uA0, g0, x0, y0), w0);
        tilt = mix(tilt, patchTilt(uP0, r.rg, uPW.x, n), w0); height = mix(height, r.a, w0); patchHeat = r.b * w0;
      }
      if (w1 > 0.0 && w2 < 1.0) {
        vec4 r = textureGrad(uR1, g1, x1, y1);
        groundColor = mix(groundColor, textureGrad(uA1, g1, x1, y1), w1);
        tilt = mix(tilt, patchTilt(uP1, r.rg, uPW.y, n), w1); height = mix(height, r.a, w1); patchHeat = mix(patchHeat, r.b, w1);
      }
      if (w2 > 0.0) {
        vec4 r = textureGrad(uR2, g2, x2, y2);
        groundColor = mix(groundColor, textureGrad(uA2, g2, x2, y2), w2);
        tilt = mix(tilt, patchTilt(uP2, r.rg, uPW.z, n), w2); height = mix(height, r.a, w2); patchHeat = mix(patchHeat, r.b, w2);
      }
      onPatch = max(w0, max(w1, w2));
      surface = groundColor.rgb;
      water = groundColor.a;

      vec4 d = groundDetail(n);
      // Where only the bilinear cube is left, the coast is a soft ramp. Cut it, with the terrain's own noise deciding where.
      float cut = smoothstep(0.42, 0.58, water + d.w * 0.14 * (1.0 - onPatch * 0.8));
      water = mix(water, cut, uClose);
      tilt += (d.xyz - n * dot(d.xyz, n)) * 0.09 * uRough * (1.0 - water) * uClose;
      surface *= 1.0 + d.w * 0.12 * (1.0 - water) * uClose;
    }
#endif

    // Past the limb a normal means nothing, and a bump would only break the edge.
    vec3 nS = normalize(n + tilt * smoothstep(0.0, 0.2, muView));

    float mu = dot(nS, uSun);
    float muGeo = dot(n, uSun);
    float soft = mix(uSoft.x, uSoft.y, abs(dot(n, uSunAxis)));
    float lit = softLit(mu, soft);

    // Airless dust stays bright to the limb, a deck of cloud darkens toward it. Plain Lambert is wrong for both.
    float lommel = 2.0 * lit / (lit + muView + 0.05);
    float brdf = mix(lit, min(lommel, 1.18), uLommel);
    if (uLimbDark != 0.0) brdf *= pow(max(muView, 0.02), uLimbDark) * pow(max(lit, 1e-3), uLimbDark * 0.6);

    vec3 beam = uTop > 1.0 ? sunThrough(0.0, max(muGeo, -0.2)) : vec3(1.0);
    vec3 sunT = uTop > 1.0 ? groundLight(beam, muGeo) : vec3(1.0);
    float shade = ringShadow(n) * moonShadow(n);

    float cloud = 0.0;
    float cloudHere = 0.0;
    if (uCloudOn > 0.5) {
      // The shadow falls further than the tops are high, as the deck is thick and the source is wide.
      vec3 up = normalize(n + uSun * 0.0055 / max(muGeo + 0.25, 0.1));
      cloud = cloudAt(up);
      cloudHere = cloudAt(normalize(x + rd * (uCloudTop / max(muView, 0.08)) * -1.0));
    }

    float inShade = 0.0;
#if TIER >= 1
    // Near the terminator, relief throws real shadows. Walk the height toward the sun, over the curve of the planet. At full phase the terminator
    // is the limb itself, where a walk has nothing to see and no pixels to show it, so it fades out there.
#if TIER == 2
    float terminator = 1.0 - smoothstep(0.05 + 0.1 * uClose, 0.4 + 0.3 * uClose, muGeo);
#else
    float terminator = 1.0 - smoothstep(0.05, 0.4, muGeo);
#endif
    terminator *= smoothstep(0.03, 0.22, muView);
    if (terminator > 0.0 && lit > 0.0 && uHeightMax > 0.0) {
      vec3 toward = normalize(uSun - n * muGeo);
      float rise = max(muGeo, 0.01) / sqrt(max(1.0 - muGeo * muGeo, 1e-4));
      float blocked = 0.0;
#if TIER == 2
      if (onPatch > 0.0) {
        // From the texels of the finest patch out to where the walk below begins.
        float step0 = 2.0 * uPW.z / 1024.0 * 2.5;
        float d = step0;
        for (int i = 0; i < 7; i++) {
          if (d >= 0.0035) break;
          vec2 s = heightNear(normalize(n + toward * d), max(log2(d / step0), 0.0));
          float above = s.x - height - s.y - d * rise + d * d * 0.5;
          blocked = max(blocked, above / (d * soft + 0.00012) * onPatch);
          d *= 1.6;
        }
      }
#endif
      float d = 0.0035;
      for (int i = 0; i < 5; i++) {
#if TIER == 2
        vec2 s = heightNear(normalize(n + toward * d), log2(d / (2.0 * uPW.z / 1024.0)));
#else
        vec2 s = heightNear(normalize(n + toward * d), 0.0);
#endif
        float above = s.x - height - s.y - d * rise + d * d * 0.5;
        blocked = max(blocked, above / (d * soft + 0.001));
        d *= 1.75;
      }
      inShade = terminator * smoothstep(0.0, 1.0, blocked);
      lit *= 1.0 - inShade;
      brdf *= 1.0 - inShade;
    }
#endif

    vec3 sky = uSkyTint * (0.5 + 0.5 * muGeo);
    vec3 sun = uLight * sunT * shade * (1.0 - cloud * uCloudShadow);
    vec3 lightOn = sun * brdf + uLight * sky * smoothstep(-0.25, 0.2, muGeo);
    // What keeps a shadow from being a hole: light thrown back by the sunlit ground around it, which shows the form of a crater floor even on
    // a world with no sky. A slope turned from the sun gets it too.
    lightOn += sun * (inShade * max(muGeo, 0.0) * 0.1 + 0.045 * smoothstep(-0.02, 0.2, muGeo) * (1.0 - min(brdf / max(muGeo, 0.05), 1.0)));
    color = surface * lightOn;

    if (water > 0.01) {
      vec3 h = normalize(uSun - rd);
      vec3 nW = n;
      // Waves make a wide lobe, and the source is wide too.
      float alpha = 0.085 + soft * 0.28;
#if TIER >= 1
      // Wind roughens the sea in long lanes, which is the texture sunglint shows from orbit: brighter where it is calm, torn where it blows.
      float gust = texture(uNoise, vec3(n.x, n.y * 2.4, n.z) * 1.1).a * 0.6 + texture(uNoise, TURN * n * 3.3).a * 0.4;
      alpha *= (0.8 + 0.5 * cloudHere) * (0.8 + 0.5 * smoothstep(0.3, 0.7, gust));
#endif
#if TIER == 2
      vec3 slope = waves(n);
      nW = normalize(n + (slope - n * dot(slope, n)) * 0.09 * uClose);
      alpha *= mix(1.0, 0.62, uClose);
#endif
      float a2 = alpha * alpha;
      float nh = max(dot(nW, h), 0.0);
      float vh = max(dot(-rd, h), 0.0);
      float k = nh * nh * (a2 - 1.0) + 1.0;
      float ggx = a2 / (PI * k * k);
      float fresnel = 0.02 + 0.98 * pow(1.0 - vh, 5.0);
      float spec = ggx * fresnel / max(4.0 * muView * max(muGeo, 0.0) + 0.05, 0.05);
      // A mirror of the source, so it takes the colour of the direct beam, and rolls off as one colour: a hard clip leaves a fringe at its edge.
      spec *= uGlint * 1.3 * smoothstep(-0.02, 0.06, muGeo);
      color += water * uLight * beam * shade * (1.0 - cloud * uCloudShadow) * spec / (1.0 + spec * 0.34);
      // Sky mirrored at grazing angles, the blue edge of a real ocean.
      color += water * uLight * uSkyTint * pow(1.0 - max(dot(nW, -rd), 0.0), 4.0) * 0.5 * smoothstep(-0.1, 0.25, muGeo);
    }

    if (uLightsOn > 0.5) {
      vec4 l = texture(uLights, nLook, uLightBlur);
#if TIER == 2
      // Magnified, the bake's own pattern is only a blur. It says how dense a town is here and nothing about its shape, which the lamps draw.
      // Four reads around the point, because one read of a coarse mip draws its texels as crosses.
      vec3 s1 = normalize(cross(n, vec3(0.31, 1.0, 0.17)));
      vec3 s2 = cross(n, s1);
      vec2 spread = (texture(uLights, nLook + s1 * 0.004, uLightBlur + 2.0).rg + texture(uLights, nLook - s1 * 0.004, uLightBlur + 2.0).rg
        + texture(uLights, nLook + s2 * 0.004, uLightBlur + 2.0).rg + texture(uLights, nLook - s2 * 0.004, uLightBlur + 2.0).rg) * 0.25;
      l.rg = mix(l.rg, spread, uClose);
#endif
      float night = 1.0 - smoothstep(-0.06, 0.16, muGeo);
      float through = 1.0 - min(cloudHere * 0.82, 1.0);
      float town = l.r;
      float ember = l.g;
#if TIER >= 1
      if (night > 0.0 && town + ember > 0.003 && uLightBlur < 0.5) {
        // Lights are not a stain: they run along streets, which part as they thin out from the centre. These are lines in a noise, and its mips
        // take a size away once it is finer than a pixel, so the web holds together from a distant globe down to low orbit.
        float big = abs(texture(uNoise, n * 3.3).a * 2.0 - 1.0);
        float mid = abs(texture(uNoise, TURN * n * 9.7).a * 2.0 - 1.0);
        float small = abs(texture(uNoise, TURN * TURN * n * 31.0).a * 2.0 - 1.0);
        float web = max(1.0 - smoothstep(0.0, 0.05, big), max(1.0 - smoothstep(0.0, 0.08, mid), (1.0 - smoothstep(0.0, 0.14, small)) * 0.8));
        float density = town + ember;
        float keep = 0.16 + 1.5 * web * smoothstep(0.0, 0.5, density);
        keep = mix(keep, 1.0 + 0.5 * web, smoothstep(0.6, 0.98, density));
#if TIER == 2
        // Close enough, the glow comes apart into lamps strung along the roads of the web, and they stop at the shore.
        float foot = tHit * uPx / sqrt(max(muView, 0.05));
        float lamps = lampField(n, density, foot) * (1.0 - water);
        keep = mix(keep, lamps / max(density, 1e-4), uClose);
#endif
        town *= keep;
        ember *= keep;
      }
#endif
      color += (uCity * town + uEmber * ember) * night * through;
      float heat = max(l.b, patchHeat);
      if (heat > 0.004) {
        // Lava is not one colour: dark red where it has cooled, the planet's accent, and white at the vent.
        float hot = pow(heat, 1.4);
        vec3 glow = mix(uLava * vec3(0.7, 0.3, 0.2), uLava, smoothstep(0.08, 0.5, heat));
        glow = mix(glow, vec3(2.6, 2.0, 1.3), smoothstep(0.72, 1.0, heat));
        color += glow * hot * (0.02 + 0.98 * night) * (1.0 - cloudHere * 0.5);
      }
    }
  }

  float cloudCover = 0.0;
  float tCloud = -1.0;
  vec3 cloudLight = vec3(0.0);
  if (uCloudOn > 0.5 && front) {
    // Deck tops, with parallax, and they can stand past the limb of the ground.
    float shell = 1.0 + uCloudTop;
    float d2 = shell * shell - closest2;
    if (d2 > 0.0) {
      float t = -b - sqrt(d2);
      if (dot(uCam, uCam) < shell * shell) t = hit ? tHit : -b + sqrt(d2);
      tCloud = t;
      vec3 pc = uCam + rd * t;
      vec3 nc = normalize(pc);
      float mu = dot(nc, uSun);
      float soft = mix(uSoft.x, uSoft.y, abs(dot(nc, uSunAxis)));
      vec3 sideways = normalize(uSun - nc * mu + nc * 0.02);
#if TIER == 2
      vec3 inCloud = turnY(nc, uCloudSpin.x, uCloudSpin.y);
      float plain = cloudAt(nc);
      float warped = cloudAt(normalize(nc + warpOf(inCloud, 0.0045)));
      vec4 fine = cloudDetail(inCloud);
      float thick = warped + (fine.w - 0.72) * 0.42 * (1.0 - warped);
      float density = mix(plain, smoothstep(0.1, 0.62, thick) * smoothstep(0.0, 0.2, warped), uClose);
#else
      float density = cloudAt(nc);
#endif
      float towardSun = cloudAt(normalize(nc + sideways * 0.006));
      // Lit from the side, tops facing the sun are bright and their far sides fall into their own shade.
      float relief = clamp(1.0 + (density - towardSun) * mix(0.5, 1.4, 1.0 - clamp(mu, 0.0, 1.0)), 0.45, 1.2);
#if TIER == 2
      // Billows turning toward the sun and away from it. Ground that rises toward the sun faces away from it.
      vec3 slopeHere = turnY(sideways, uCloudSpin.x, uCloudSpin.y);
      relief *= mix(1.0, clamp(1.0 - dot(fine.xyz, slopeHere) * mix(0.05, 0.2, 1.0 - clamp(mu, 0.0, 1.0)), 0.7, 1.2), uClose);
      // The creases between billows see less sky, at any height of the sun, which is what keeps a deck from being flat white.
      relief *= mix(1.0, 0.8 + 0.3 * smoothstep(0.25, 1.15, fine.w), uClose);
#endif
      float lit = softLit(mu + 0.012, soft + 0.03);
      vec3 toCloud = uTop > 1.0 ? groundLight(sunThrough(uCloudTop / uH, max(mu, -0.2)), mu) : vec3(1.0);
      cloudLight = uCloudColor * uLight * toCloud * ringShadow(nc) * moonShadow(nc) * (lit * relief + uSkyTint * 0.6 * smoothstep(-0.2, 0.15, mu));
      cloudCover = density;
      float rim = 1.0 - smoothstep(-pixel, pixel, closest - shell);
      cloudCover *= rim;
    }
  }

  float body = max(cover, cloudCover);

  vec3 glow = vec3(0.0);
  vec3 trans = vec3(1.0);
  vec3 glowTop = vec3(0.0);
  vec3 transTop = vec3(1.0);
  if (uTop > 1.0) {
    float d2 = uTop * uTop - closest2;
    if (d2 > 0.0) {
      float root = sqrt(d2);
      float t0 = max(-b - root, 0.0);
      float t1 = -b + root;
      bool reachesGround = hit && !inside;
      if (reachesGround) t1 = tHit;
      if (inside) t1 = min(t1, tHit > 0.0 ? tHit : t1);
      if (t1 > t0) air(uCam, rd, t0, t1, reachesGround, glow, trans);
      glowTop = glow;
      transTop = trans;
#if TIER >= 1
      // A cloud near the horizon stands in front of the long thick path to the ground, or to the far limb, and that air must not be laid over it.
      if (cloudCover > 0.004 && tCloud > t0 && tCloud < t1) {
        float graze = reachesGround ? 1.0 - smoothstep(0.12, 0.3, muView) : 1.0;
        if (graze > 0.0) {
          vec3 gt;
          vec3 tt;
          air(uCam, rd, t0, tCloud, true, gt, tt);
          glowTop = mix(glow, gt, graze);
          transTop = mix(trans, tt, graze);
        }
      }
#endif
    }
  }

  // Cloud tops stand above most of the air, so they keep their white while the ground under them goes blue. Even at the horizon: most of the
  // blue lost on a long path comes straight back as glow, so taking it out here as well turns distant cloud gold.
  vec3 ground = color * trans + glow;
  vec3 tops = cloudLight * sqrt(sqrt(sqrt(transTop))) + glowTop * 0.45;
  vec3 out3 = mix(ground, tops, cloudCover);
  float alpha = max(body, 1.0 - min(trans.r, min(trans.g, trans.b)));
  if (uReveal < 1.0) {
    // A front that crosses the globe once, wandering as a coast does, with a hairline of the source's own light on it. Measured in pixels, so it
    // stays a line at every size, and it starts off to one side, so that it sweeps over the sphere and does not open on the screen like an iris.
    float at = acos(clamp(dot(n, uRevealAxis), -1.0, 1.0)) / PI;
    at += (texture(uNoise, n * 0.5).a - 0.5) * 0.14 + (texture(uNoise, TURN * n * 2.2).a - 0.5) * 0.05;
    float at0 = uReveal * 1.25 - 0.1;
    float line = max(uPx * max(-b, 0.01) / max(muView, 0.25) / PI, 0.0006);
    float keep = 1.0 - smoothstep(at0 - line, at0 + line, at);
    float crest = exp(-pow((at - at0) / (line * 1.6), 2.0)) + 0.22 * exp((at - at0) / 0.012) * keep;
    o = vec4(out3 * keep + uLight * min(crest, 1.4) * body * 0.8, alpha * keep);
  } else {
    o = vec4(out3, alpha);
  }

#ifdef WRITE_DEPTH
  // The real depth of the sphere, not of the quad: a hull in low orbit passes in front of the ground and behind the limb. Air writes nothing.
  vec4 clip = uViewProj * vec4(uCentre + transpose(uBody) * x * uScale, 1.0);
  gl_FragDepth = body > 0.5 ? clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0) : 1.0;
#endif
}
