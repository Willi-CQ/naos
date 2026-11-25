// A sky for the lab: stars of infinite resolution, because a lens magnifies them without limit, and a test pattern.
uniform float uSkyMode;     // 0 stars, 1 latitude and longitude grid, 2 one bright star, 3 nothing
uniform vec3 uStarDir;
uniform sampler2D uSkyNoise;

vec3 hash3(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yzz) * q.zyx);
}

vec2 octEncode(vec3 d) {
  d /= abs(d.x) + abs(d.y) + abs(d.z);
  vec2 p = d.xz;
  if (d.y < 0.0) p = (1.0 - abs(p.yx)) * vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
  return p * 0.5 + 0.5;
}

vec3 octDecode(vec2 e) {
  vec2 f = e * 2.0 - 1.0;
  vec3 n = vec3(f.x, 1.0 - abs(f.x) - abs(f.y), f.y);
  float t = max(-n.y, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.z += n.z >= 0.0 ? -t : t;
  return normalize(n);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

vec3 starLayer(vec3 dir, float cells, float seed, float density, float sigma0, float foot) {
  vec3 id = floor(dir * cells);
  vec3 h = hash33(id + seed);
  if (h.z > density) return vec3(0.0);
  vec3 s = normalize((id + 0.3 + 0.4 * h) / cells);
  float d = length(dir - s);
  float sigma = max(sigma0, foot);
  float flux = pow(h.x, 5.0) * 26.0 + 0.5;
  float k = d / sigma;
  vec3 tint = mix(vec3(1.0, 0.80, 0.60), vec3(0.72, 0.82, 1.0), fract(h.y * 7.0));
  return tint * flux * (sigma0 * sigma0) / (sigma * sigma) * exp(-0.5 * k * k);
}

vec3 holeSky(vec3 dir, vec3 dx, vec3 dy) {
  float foot = 0.6 * sqrt(length(dx) * length(dy));
  if (uSkyMode > 2.5) return vec3(0.0);
  if (uSkyMode > 1.5) {
    float d = acos(clamp(dot(dir, uStarDir), -1.0, 1.0));
    float sigma = max(0.0035, foot);
    float k = d / sigma;
    return vec3(1.0, 0.93, 0.85) * 22.0 * (0.0035 * 0.0035) / (sigma * sigma) * exp(-0.5 * k * k) + starLayer(dir, 90.0, 3.0, 0.5, 0.0009, foot) * 0.6;
  }
  if (uSkyMode > 0.5) {
    float lat = asin(clamp(dir.y, -1.0, 1.0));
    float lon = atan(dir.z, dir.x);
    vec2 g = abs(fract(vec2(lon, lat) * 18.0 / 3.14159265) - 0.5);
    float w = 18.0 / 3.14159265 * foot;
    float line = 1.0 - smoothstep(0.03 + w, 0.08 + w, min(g.x, g.y));
    return mix(vec3(0.018, 0.02, 0.03), vec3(0.34, 0.42, 0.52), line * (1.0 / (1.0 + 2.0 * w)));
  }
  vec3 n = normalize(vec3(0.3, 0.86, -0.4));
  float b = dot(dir, n);
  float haze = exp(-b * b / 0.05);
  float cloud = textureLod(uSkyNoise, dir.xz * 0.61 + dir.y * 0.27, 0.0).r * textureLod(uSkyNoise, dir.zy * 1.73 + dir.x * 0.41, 0.0).r;
  vec3 band = vec3(0.020, 0.014, 0.011) * haze * smoothstep(0.1, 0.5, cloud) * 0.12;
  return band
    + starLayer(dir, 34.0, 1.0, 0.2, 0.00034, foot) * 0.7
    + starLayer(dir, 90.0, 7.0, 0.12, 0.00028, foot) * 0.35
    + starLayer(dir, 230.0, 13.0, 0.07, 0.00024, foot) * 0.2;
}
