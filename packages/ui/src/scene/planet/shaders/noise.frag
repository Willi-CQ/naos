// Included by the bake and by close-up detail. One octave is one read of the volume: value in x, gradient in yzw.
uniform highp sampler3D uNoise;

vec4 nz(vec3 p) {
  vec4 t = textureLod(uNoise, p * 0.0625, 0.0);
  return vec4(t.a * 2.0 - 1.0, (t.rgb * 2.0 - 1.0) * 3.2);
}

// The volume is read linearly, so a large octave is flat facets, and normals taken from it are ruled lines along the texel planes, which on a smooth
// plain read as ripples round an axis of the planet. Four reads along the diagonal spread each kink over a whole texel. For terrain only, where
// a normal is taken: the texture is 64 texels to 16 cells, so this is a quarter of a cell.
vec4 nzSmooth(vec3 p) {
  const float e = 0.0625;
  return (nz(p) + nz(p + e) + nz(p + 2.0 * e) + nz(p + 3.0 * e)) * 0.25;
}

// Turns each octave, so the lattice never lines up with itself.
const mat3 TURN = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

float fbmGain(vec3 p, int octaves, float gain) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < octaves; i++) {
    v += a * nz(p).x;
    a *= gain;
    p = TURN * p * 2.03;
  }
  return v;
}

float fbm(vec3 p, int octaves) { return fbmGain(p, octaves, 0.5); }

float fbmSmooth(vec3 p, int octaves, float gain) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < octaves; i++) {
    v += a * nzSmooth(p).x;
    a *= gain;
    p = TURN * p * 2.03;
  }
  return v;
}

// Heights on a planet are exaggerated about sevenfold, so that they read from far away. Past this octave amplitude falls faster than the size,
// and slopes stay what real ground has. Without it, every metre of a close-up is a cliff that shades its neighbour.
const int SLOPE_KNEE = 9;

// Noise whose fine octaves fade on steep ground, the way water and gravity leave valleys smooth and ridges sharp.
float eroded(vec3 p, int octaves, float gain) {
  float v = 0.0;
  float a = 0.5;
  vec3 d = vec3(0.0);
  for (int i = 0; i < octaves; i++) {
    vec4 n = i < octaves - 3 ? nzSmooth(p) : nz(p);
    d += n.yzw * a * 2.0;
    v += a * n.x / (1.0 + dot(d, d) * 0.6);
    a *= i < SLOPE_KNEE ? gain : gain * 0.72;
    p = TURN * p * 2.03;
  }
  return v;
}

float ridged(vec3 p, int octaves) {
  float v = 0.0;
  float a = 0.5;
  float w = 1.0;
  for (int i = 0; i < octaves; i++) {
    float n = 1.0 - abs((i < octaves - 3 ? nzSmooth(p) : nz(p)).x);
    n *= n;
    v += a * n * w;
    w = clamp(n * 1.8, 0.0, 1.0);
    a *= i < SLOPE_KNEE ? 0.5 : 0.36;
    p = TURN * p * 2.07;
  }
  return v;
}

uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

vec3 hash3(vec3 c) {
  return vec3(pcg3(uvec3(ivec3(c) + 32768))) * (1.0 / 4294967295.0);
}
