// The unresolved light of the month: what the stars of the band would add up to, with dark lanes through it. Its brightness along the band
// is what landed on each day. Baked into a cube when the month changes, so its cost is one small draw per redraw of the sky.
uniform mat3 uToSky;     // world to sky axes
uniform float uDay[31];  // 0..1, what landed on each day
uniform float uRaNow;
uniform float uRaStep;
uniform vec3 uWarm;
uniform vec3 uCool;
in vec3 vDir;
out vec4 o;

float hash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 s = uToSky * d;
  float dec = asin(clamp(s.z, -1.0, 1.0));
  float ra = atan(s.y, s.x);
  float age = mod((ra - uRaNow) / uRaStep, 30.0);
  int i = int(floor(age));
  float day = mix(uDay[i], uDay[i + 1 > 30 ? 0 : i + 1], fract(age));
  vec3 warp = d + 0.32 * vec3(fbm(d * 2.1), fbm(d * 2.1 + 7.3), fbm(d * 2.1 + 3.7));
  float big = fbm(warp * 2.4);
  float rift = smoothstep(0.42, 0.62, fbm(warp * 4.6 + 11.0));
  float wander = dec + 0.16 * (big - 0.5);
  float core = exp(-wander * wander / (2.0 * 0.15 * 0.15));
  float disk = exp(-wander * wander / (2.0 * 0.42 * 0.42));
  float light = (0.4 + 0.6 * day) * (core * (1.0 - 0.8 * rift) * (0.45 + 0.9 * big) + 0.16 * disk * big);
  vec3 tint = mix(uCool, uWarm, smoothstep(0.34, 0.66, fbm(warp * 1.7 + 5.0)) * (0.35 + 0.65 * core));
  // This cloud field also exists when there is no history to draw.
  vec3 q = d * 3.1 + vec3(4.3, 1.8, 8.1);
  vec3 drift = vec3(fbm(q), fbm(q + 6.2), fbm(q + 13.8));
  vec3 p = q + (drift - 0.5) * 1.6;
  float grain = fbm(p * 2.2);
  float folds = fbm(p * 5.0 + 12.4);
  float latitude = dot(d, normalize(vec3(0.34, 0.86, -0.38))) + 0.12 + (grain - 0.5) * 0.28;
  float ribbon = exp(-latitude * latitude / 0.09);
  float clouds = smoothstep(0.37, 0.74, grain) * ribbon;
  float dust = smoothstep(0.48, 0.67, folds) * 0.8;
  float hue = smoothstep(0.36, 0.66, fbm(p * 0.8 + 4.0));
  vec3 nebula = mix(vec3(0.027, 0.055, 0.145), vec3(0.115, 0.045, 0.092), hue);
  nebula = mix(nebula, vec3(0.018, 0.115, 0.135), smoothstep(0.52, 0.72, drift.z) * 0.7);
  nebula *= 0.32 * clouds * (1.0 - dust) * (0.25 + 1.2 * grain);
  o = vec4(tint * light * light * (0.6 + 1.4 * light) + nebula, 1.0);
}
