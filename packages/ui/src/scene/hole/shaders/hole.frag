// Gargantua. One thin disk seen along null geodesics. A ray meets the disk plane every half turn of its sweep, and those crossings
// are known in closed form, so each image of the disk costs one table read and no marching. Crossing 0 is the direct image: the near
// band, and the far side bent up over the shadow. 1 is the far side seen around the bottom of the hole. 2 and 3 are the thin higher
// images that pile up on the photon ring.
//
// This file builds twice. The back pass draws what lies behind crossing 0: the sky, the higher images, the ring. Then the worlds draw.
// HOLE_FRONT is the front pass, crossing 0 laid over all of that with real alpha, because a body seen through gas has to stay there.
uniform sampler2D uStreak;     // polar tile: x azimuth, y log radius. r fine filaments, g lanes, b broad bands, a knots
uniform sampler2D uHeat;       // polar: x azimuth, y through the disk. r hot arcs, g flares
uniform float uRIn;            // inner edge, moves out as the quota drains
uniform float uROut;
uniform float uEnergy;         // radiance of the disk
uniform float uTemp;           // temperature of the disk, 1 is full
uniform float uClock;          // rotation angle at r = 6, radians
uniform float uTurbulence;
uniform float uDoppler;        // 0 no beaming, 1 full
uniform float uRing;           // radiance of the photon ring
uniform vec3 uBeadDir;         // where the bead sits on the ring, perpendicular to the view of the hole
uniform float uBeadGain;
uniform float uExposure;       // what the camera lets through, holeExposure in disk.ts
uniform float uView;           // sine of the camera's elevation over the disk
uniform float uImages;         // crossings to draw, 1 to 4
uniform float uRotation;       // +1 or -1
uniform float uGraze;          // steps along a ray that runs inside the disk, 0 turns that off
uniform vec3 uVoid;
uniform mat3 uHoleToWorld;
uniform mat4 uHoleClip;        // hole frame in M to clip space, for the depth of the disk and of the shadow
in vec3 vRay;
out vec4 o;

const float PHASE = 3.0;       // radians of inner rotation one noise phase lives through
const float TAU = 6.2831853;
const float STREAK_Y = 0.42;   // tiles of the streak map per e-fold of radius
const float THICK = 0.0055;    // half thickness of the disk over radius
const vec2 STREAK_SIZE = vec2(1024.0, 512.0);
const vec2 DETAIL = vec2(3.0, 7.0);
const float R_INNER = HOLE_R_IN;   // the inner edge of a full disk
const float CAP = 3.4;         // radiance saturates here: the tone curve reads white by now, and more would only feed the bloom
const float DUST = 6.0;        // dust takes out more light than the gas gives off
const vec4 MEAN = HOLE_STREAK_MEAN;

// Linear. A little blue stays in the orange, or dim gas turns brown, and too much of it turns the disk to clay.
vec3 ramp(float t) {
  const vec3 a = vec3(1.00, 0.085, 0.010);   // ember
  const vec3 b = vec3(1.00, 0.200, 0.038);   // orange
  const vec3 c = vec3(1.00, 0.430, 0.150);   // gold
  const vec3 d = vec3(1.00, 0.650, 0.340);   // white gold
  const vec3 e = vec3(1.00, 0.860, 0.660);   // white, which the tone curve finishes
  if (t < 0.55) return mix(a, b, smoothstep(0.3, 0.55, t));
  if (t < 0.8) return mix(b, c, (t - 0.55) / 0.25);
  if (t < 1.05) return mix(c, d, (t - 0.8) / 0.25);
  return mix(d, e, clamp((t - 1.05) / 0.35, 0.0, 1.0));
}

struct Gas {
  float source;   // radiance of the gas where it is opaque
  float tau;      // optical depth at normal incidence
  float block;    // opacity of the dust against what lies behind, no structure in it
  float temp;
  float peak;     // where its radiance saturates. A flare is what may rise above the white of the disk
};

#ifdef HOLE_FRONT
// Slow wander of the lanes, so that they are not circles. Sums of a few whole turns tile around the disk.
vec2 wobble(float a, float lr) {
  float t = a * TAU;
  float w = sin(2.0 * t + 3.1 * lr + 0.7) + 0.6 * sin(3.0 * t - 4.3 * lr + 2.1) + 0.35 * sin(5.0 * t + 6.7 * lr + 4.0);
  return vec2(0.011 * w, 0.006 * (sin(3.0 * t + 5.0 * lr) + sin(t - 7.0 * lr + 1.0)));
}
#endif

// Two uncorrelated layers averaged have half the variance of one. Weighted like this they have the same at every moment of the handover.
vec4 blendLayers(vec4 a, vec4 b, float w) {
  float n = 1.0 / sqrt(w * w + (1.0 - w) * (1.0 - w));
  return max(MEAN + (a - MEAN) * w * n + (b - MEAN) * (1.0 - w) * n, vec4(0.0));
}

// What the gas does with a density at a radius.
Gas gas(float u, float x, float a0, float density, float rim, float b, float normalY) {
  vec2 heat = textureLod(uHeat, vec2(a0, x), 0.0).rg;
  float hot = heat.r * 0.8 + heat.g * 4.0;

  // The exact Doppler shift of a circular orbit. uDoppler only holds it back. Gravity gets a third of its due. Inside r = 3.4 no circular
  // orbit is left to speak of, and the march can step there.
  float orbit = min(u, 0.294);
  float g = mix(1.0, sqrt(max(1.0 - 3.0 * orbit, 0.02)), 0.3) / (1.0 - uRotation * orbit * sqrt(orbit) * b * normalY);

  float ratio = max(uRIn, 3.9) * u;
  float r2 = ratio * ratio;
  float r4 = r2 * r2;
  Gas e;
  e.source = uEnergy * uExposure * 15.0 * pow(ratio, 1.6) * rim * (0.42 + 0.58 * density) * pow(g, 3.0 * uDoppler) * (1.0 + 1.6 * hot);
  // A dense inner flow and a thin outer sheet. The sheet is what the reference is made of: thin gas shines along a grazing line of sight,
  // so it draws the long band and leaves the lensed ring tight, because rays cross it steeply there. Only from above does it get to show.
  float sheet = (0.0032 + 0.9 * uView * uView) * exp(-1.0 / (7.0 * u));
  // When the disk burns out, its dust goes with it, or it would stay on as a dark stain on the sky.
  float there = smoothstep(0.0, 0.05, uEnergy);
  e.tau = (18.0 * r4 * r4 + sheet) * density * rim * (1.0 + hot) * there;
  e.block = 5.0 * rim * there;
  e.temp = uTemp * pow(g, 0.6 * uDoppler) * (1.0 + 0.4 * hot);
  e.peak = CAP * (1.0 + 2.0 * hot);
  return e;
}

float layerWeight() { return 1.0 - abs(2.0 * fract(uClock / PHASE) - 1.0); }

// The outer edge wanders with the broad bands, so the disk has no circular rim.
float rimOf(float u, float band) {
  return 1.0 - smoothstep(12.0, 22.0, (1.0 + (band - 0.38) * 0.4) / u);
}

float structure(vec4 s) { return 2.1 * (0.56 + 0.8 * s.r) * (0.52 + 1.15 * s.g * s.g) * (0.4 + 1.2 * s.b) * (1.0 + 1.6 * s.a * s.a); }

#ifdef HOLE_FRONT
// The disk where it is seen large. cover is the share of the pixel on the disk: an opaque disk turns any soft ramp in depth into a hard
// step, so the edge is antialiased here, apart from the depth. As the disk drains, the inner edge frays over a wider and wider band.
Gas diskFull(float u, vec3 P, vec2 dTx, vec2 dTy, float b, float normalY, out float cover) {
  cover = 0.0;
  float lr = -log(u);
  float lIn = log(uRIn);
  float x = (lr - lIn) / (log(uROut) - lIn);
  float fray = 0.05 * (uRIn - R_INNER);
  if (lr - lIn < -2.0 * fray - 0.03 || x >= 1.1) return Gas(0.0, 0.0, 0.0, 0.0, 1.0);

  float spin = uRotation * pow(6.0 * u, 1.5);
  // Two layers of the same lanes live through a short stretch of the shear and hand over, so the disk never winds up.
  float t1 = fract(uClock / PHASE);
  float w1 = layerWeight();
  vec2 gx = vec2(dTx.x / TAU, dTx.y * STREAK_Y);
  vec2 gy = vec2(dTy.x / TAU, dTy.y * STREAK_Y);
  float a0 = atan(P.z, P.x) / TAU;
  float a1 = a0 - spin * (t1 - 0.5) * PHASE / TAU;
  float a2 = a0 - spin * (fract(t1 + 0.5) - 0.5) * PHASE / TAU + 0.37;
  vec2 bend = (wobble(a1, lr) * w1 + wobble(a2, lr) * (1.0 - w1)) * (0.75 + 0.5 * uTurbulence);
  float y = lr * STREAK_Y + bend.x;
  a1 += bend.y;
  a2 += bend.y;
  vec4 s = blendLayers(textureGrad(uStreak, vec2(a1, y), gx, gy), textureGrad(uStreak, vec2(a2, y + 0.011 * uTurbulence), gx, gy), w1);

  float foot = 1.2 * max(abs(dTx.y), abs(dTy.y)) + 0.003 + fray;
  cover = smoothstep(-foot, foot, lr - lIn + (s.r - MEAN.r) * 2.0 * fray);
  float rim = rimOf(u, s.b);
  if (rim <= 0.0 || cover <= 0.0) return Gas(0.0, 0.0, 0.0, 0.0, 1.0);

  // The tile runs out of texels close up. The same tile, far smaller, carries the detail on down. Only the direct image is ever
  // that large, so this read happens on few pixels and only when the camera is near.
  float near = 1.0 - smoothstep(0.25, 1.1, max(length(gx * STREAK_SIZE), length(gy * STREAK_SIZE)));
  if (near > 0.0) {
    vec4 d = blendLayers(textureGrad(uStreak, vec2(a1, y) * DETAIL, gx * DETAIL, gy * DETAIL), textureGrad(uStreak, vec2(a2, y) * DETAIL, gx * DETAIL, gy * DETAIL), w1);
    s.r = mix(s.r, s.r * (0.25 + 1.5 * d.r) + 0.2 * d.g, near);
    s.g = mix(s.g, s.g * (0.45 + 1.1 * d.g), near);
  }
  // Close up the frame holds less range of radius, so the lanes must carry the range.
  return gas(u, x, a0, pow(structure(s), 1.0 + 1.1 * near), rim, b, normalY);
}
#endif

// The disk where it is seen small or smeared: the thin higher images, and along a grazing ray. Mips stand in for all the detail.
Gas diskThin(float u, vec3 P, float b, float normalY, float soft, out float cover) {
  float lr = -log(u);
  float lIn = log(uRIn);
  float x = (lr - lIn) / (log(uROut) - lIn);
  cover = smoothstep(-soft, soft, lr - lIn) * step(x, 1.0);
  if (cover == 0.0) return Gas(0.0, 0.0, 0.0, 0.0, 1.0);
  float spin = uRotation * pow(6.0 * u, 1.5);
  float t1 = fract(uClock / PHASE);
  float a0 = atan(P.z, P.x) / TAU;
  // Seen from close by, even a grazing ray has room for more of the map.
  float lod = mix(0.5, 2.5, smoothstep(10.0, 60.0, uHoleBScale));
  vec4 s = blendLayers(
    textureLod(uStreak, vec2(a0 - spin * (t1 - 0.5) * PHASE / TAU, lr * STREAK_Y), lod),
    textureLod(uStreak, vec2(a0 - spin * (fract(t1 + 0.5) - 0.5) * PHASE / TAU + 0.37, lr * STREAK_Y), lod), layerWeight());
  return gas(u, x, a0, structure(s), rimOf(u, s.b), b, normalY);
}

// What comes out of the gas along a line of sight, in the radiance of the red channel. Hue follows this and not the temperature of the
// gas alone, as it does in the reference: only what is bright is white. Dim gas is deep orange and never turns to khaki.
vec3 emit(Gas e, float depth, float cover) {
  float I = e.source * (1.0 - exp(-depth));
  I = e.peak * (1.0 - exp(-I / e.peak));
  return ramp(e.temp * (0.34 + 1.05 * (1.0 - exp(-I * cover / 2.4)))) * I;
}

void over(Gas e, float cover, float mu, inout vec3 light, inout float through) {
  // A long path through thin gas brightens faster than its length alone: the near band is what the eye reads as the disk.
  float depth = e.tau / (mu * mu * mu * sqrt(mu));
  vec3 add = emit(e, depth, cover);
  // An edge against the black shadow would stair step in linear light, so the coverage is taken on the tone curve, where half means half.
  // Taken on one channel and applied to all: per channel, the white of the edge would fall apart into khaki.
  if (cover < 1.0) add *= -log(max(1.0 - (1.0 - exp(-1.05 * add.r)) * cover, 1e-4)) / (1.05 * max(add.r, 1e-5));
  light += add * through;
  through *= 1.0 - cover * (1.0 - exp(-(DUST * depth + e.block / mu)));
}

// Sine of the angle between a ray and the disk plane, where it crosses at u.
float cosIncidence(float u, float b, float lat) { return max(lat * u / sqrt(1.0 / (b * b) + 2.0 * u * u * u), 0.02); }

#ifdef HOLE_FRONT
// The share of the thickness of the disk below height y, in half thicknesses, and its slope: a gaussian's shape with an exact integral.
const float SLAB = 3.6;
float slab(float y) { return smoothstep(-SLAB, SLAB, y); }
float slabSlope(float y) { float t = clamp(0.5 + 0.5 * y / SLAB, 0.0, 1.0); return 3.0 * t * (1.0 - t) / SLAB; }

// A ray that lies almost in the disk plane stays inside the disk for a long way, and a sheet has no answer for it. The table makes
// a march cheap here: one read a step, and only the few pixels on the disk's own line pay for it. Steps are even in log radius, and
// each one integrates the thickness of the disk over its own length exactly, so the same few steps stay smooth without any dither.
void graze(HoleRay ray, float phiP, float lat, float normalY, inout vec3 light, inout float through) {
  float w0 = max(asin(clamp(ray.b / uROut, 0.0, 1.0)) - 0.1, max(ray.alpha, 1e-3));
  float w1 = min(ray.sweep, HOLE_PI + 1.0 - w0) + ray.alpha;
  if (w1 <= w0) return;
  float ratio = log(w1 / w0);
  float wa = w0;
  float ya = lat * cos(wa - ray.alpha - phiP) / THICK;
  for (float i = 1.0; i <= uGraze; i += 1.0) {
    float wb = w0 * exp(ratio * i / uGraze);
    float yb = lat * cos(wb - ray.alpha - phiP) / THICK;
    float dy = yb - ya;
    float mean = abs(dy) > 1e-3 ? (slab(yb) - slab(ya)) / dy : slabSlope(ya);
    float phi = 0.5 * (wa + wb) - ray.alpha;
    float dPhi = wb - wa;
    wa = wb;
    ya = yb;
    if (mean < 1e-4) continue;
    float u = holeU(ray, phi);
    if (u < 0.5 / uROut) continue;
    vec3 P = cos(phi) * uHoleE1 + sin(phi) * ray.e2;
    float cover;
    // A step spans a fifth of the radius here. An inner edge much sharper than that shows as bars, one for each step that crosses it.
    Gas e = diskThin(u, P, ray.b, normalY, 0.25, cover);
    // The column of the slab along this step. Summed over one clean crossing it comes to tau / mu, the same as the sheet, and the sheet's
    // extra 1 / mu applies here too, so the two agree where they meet.
    float mu = cosIncidence(u, ray.b, lat);
    float slabbed = mean * dPhi * sqrt(1.0 / (ray.b * ray.b) + 2.0 * u * u * u) / (u * THICK);
    float depth = e.tau * slabbed / (mu * mu * sqrt(mu));
    light += emit(e, depth, cover) * cover * through;
    // The dust must not hide the inner disk here. Exactly in the plane a ray meets the cool rim first, and the line of the disk would go dark.
    through *= 1.0 - cover * (1.0 - exp(-0.12 * (DUST * depth + e.block * slabbed)));
  }
}
#endif

void main() {
  vec3 dir = normalize(vRay);
  HoleRay ray = holeRay(dir);

  float lat = length(vec2(uHoleE1.y, ray.e2.y));
  float phiP = atan(ray.e2.y, uHoleE1.y);
  float phi0 = mod(phiP + 0.5 * HOLE_PI, HOLE_PI);
  float normalY = uHoleE1.z * ray.e2.x - uHoleE1.x * ray.e2.z;   // y of e1 x e2
  bool reach = ray.b < min(HOLE_B_MAX, uROut + 3.0);
  vec3 P = cos(phi0) * uHoleE1 + sin(phi0) * ray.e2;

  vec3 light = vec3(0.0);
  float through = 1.0;

#ifdef HOLE_FRONT
  float u0 = reach && phi0 < ray.sweep ? holeU(ray, phi0) : 1e-5;
  // Derivatives must run on every pixel, so they stay out of the branches. x: azimuth, y: log radius.
  float invP = 1.0 / max(P.x * P.x + P.z * P.z, 1e-6);
  float l0 = log(u0);
  vec2 d0x = vec2((P.x * dFdx(P.z) - P.z * dFdx(P.x)) * invP, dFdx(l0));
  vec2 d0y = vec2((P.x * dFdy(P.z) - P.z * dFdy(P.x)) * invP, dFdy(l0));

  if (u0 > 2e-5) {
    float cover;
    Gas e = diskFull(u0, P, d0x, d0y, ray.b, normalY, cover);
    over(e, cover, cosIncidence(u0, ray.b, lat), light, through);
  }
  // Only a flat ray at the height of the disk: slope against the plane, and height above it when passing the hole.
  float low = reach && uGraze > 0.5 ? (1.0 - smoothstep(0.015, 0.045, abs(dir.y))) * (1.0 - smoothstep(0.65, 1.0, abs(ray.b * ray.e2.y) / (3.0 * THICK * uROut))) : 0.0;
  if (low > 0.0) {
    vec3 l = vec3(0.0);
    float t = 1.0;
    graze(ray, phiP, lat, normalY, l, t);
    light = mix(light, l, low);
    through = mix(through, t, low);
  }
  if (through > 0.998 && max(light.r, max(light.g, light.b)) < 1e-3) discard;

  vec4 clip = uHoleClip * vec4(u0 > 2e-5 ? P / u0 : vec3(0.0), 1.0);
  float depth = clip.w > 0.0 ? clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0) : 0.0;
  // A ray that falls in can meet the far side of the disk on the way. It must still pass the depth the shadow wrote at the hole's centre.
  vec4 centre = uHoleClip * vec4(0.0, 0.0, 0.0, 1.0);
  if (ray.b < HOLE_BC + 0.1 && centre.w > 0.0) depth = min(depth, clamp(centre.z / centre.w * 0.5 + 0.5, 0.0, 1.0));
  gl_FragDepth = depth;
  o = vec4(light, 1.0 - through);
#else
  float u1 = 1e-5, u2 = 1e-5, u3 = 1e-5;
  if (reach) {
    if (phi0 + HOLE_PI < ray.sweep && uImages > 1.5) u1 = holeU(ray, phi0 + HOLE_PI);
    if (phi0 + 2.0 * HOLE_PI < ray.sweep && uImages > 2.5) u2 = holeU(ray, phi0 + 2.0 * HOLE_PI);
    if (phi0 + 3.0 * HOLE_PI < ray.sweep && uImages > 3.5) u3 = holeU(ray, phi0 + 3.0 * HOLE_PI);
  }

  vec3 end = holeOut(ray);
  vec3 endX = dFdx(end);
  vec3 endY = dFdy(end);
  float edgeW = max(fwidth(ray.b), 1e-4);

  if (u1 > 2e-5) {
    float cover;
    Gas e = diskThin(u1, -P, ray.b, normalY, 0.03, cover);
    over(e, cover, cosIncidence(u1, ray.b, lat), light, through);
  }
  if (u2 > 2e-5) {
    float cover;
    Gas e = diskThin(u2, P, ray.b, normalY, 0.03, cover);
    over(e, cover, cosIncidence(u2, ray.b, lat), light, through);
  }
  if (u3 > 2e-5) {
    float cover;
    Gas e = diskThin(u3, -P, ray.b, normalY, 0.03, cover);
    over(e, cover, cosIncidence(u3, ray.b, lat), light, through);
  }

  // The shadow edge lands on a pixel, and the photon ring sits on top of it.
  float captured = ray.b < HOLE_BC - edgeW ? 1.0 : 1.0 - smoothstep(-0.7, 0.7, (ray.b - HOLE_BC) / edgeW);
  float open = through * (1.0 - captured);
  if (open > 1e-3) light += open * (uVoid + holeSky(uHoleToWorld * end, uHoleToWorld * endX, uHoleToWorld * endY));

  // The ring is a pixel or so wide at any distance, and it follows the exposure, or close up it outshines the disk it comes from.
  float width = max(edgeW * 0.75, 0.018);
  float x = (ray.b - HOLE_BC - 0.3 * edgeW) / width;
  float ring = exp(-x * x);
  if (ring > 1e-3) light += through * ring * uRing * uExposure * (1.0 + 0.22 * uRotation * normalY) * vec3(1.0, 0.94, 0.86);

  // The reset's bead: one point of the ring burns past white. It sits on the ring and its glow reaches into the shadow, which the
  // finish would cut, so it also lifts the mask there.
  float bead = 0.0;
  if (uBeadGain > 0.0) {
    float along = acos(clamp(dot(ray.e2, uBeadDir), -1.0, 1.0)) * HOLE_BC;
    float d = length(vec2(along, ray.b - HOLE_BC));
    bead = uBeadGain * (exp(-d * d / 0.03) * 34.0 + exp(-d / 0.55) * 1.4);
    light += bead * vec3(1.0, 0.93, 0.82);
  }

  // Depth of the shadow: it hides what lies behind the hole.
  vec4 clip = uHoleClip * vec4(0.0, 0.0, 0.0, 1.0);
  gl_FragDepth = captured > 0.5 ? clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0) : 1.0;
  // Alpha is how much bloom may land here, and it is read by the finish. None in the shadow, little in the gap beside it, which would
  // fill with the glow of the bright gas on both of its sides, and not much on the open sky around the hole, or the disk stands in smog.
  // It depends on where the pixel lies and on nothing that is drawn there, so it can have no edge at the rim of the gas.
  float gap = 0.85 * (1.0 - smoothstep(HOLE_BC * 1.02, HOLE_BC * 1.75, ray.b));
  float smog = 0.6 * (1.0 - smoothstep(HOLE_BC * 3.0, HOLE_BC * 8.0, ray.b));
  o = vec4(light, max(1.0 - max(captured, max(gap, smog)), min(1.0, bead * 2.0)));
#endif
}
