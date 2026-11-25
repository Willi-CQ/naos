// The lens. Finds where a ray sits on its orbit and how far it can sweep, so that any shader can ask where a ray ends up with no
// marching. Pair it with the tables of hole.ts. All vectors are in the hole frame, where y is the disk normal. Lengths are in M.
uniform highp sampler2D uHoleOrbit;
uniform highp sampler2D uHoleRows;
uniform highp sampler2D uHoleCam;
uniform vec3 uHoleE1;         // from the hole toward the camera, unit
uniform float uHoleBScale;    // rc / sqrt(1 - 2 / rc), b per sin(alpha)

const float HOLE_PI = 3.14159265358979;
const float HOLE_BC = 5.196152422706632;

struct HoleRay {
  vec3 e2;         // in the plane of the ray, perpendicular to e1, along the sweep
  float alpha;     // angle off the hole at the camera
  float b;         // impact parameter
  float row;       // row of the orbit table
  float len;       // length of that row in radians
  float start;     // psi of the camera on the orbit
  float sweep;     // angle the ray can sweep before it escapes or falls in
  bool escapes;
  bool turns;      // has a turning point, so the orbit folds there
};

float holeRow(float b) {
  float s = max(log(max(abs(b - HOLE_BC) / HOLE_BC, 1e-6)), HOLE_S_MIN);
  if (b < HOLE_BC) return (HOLE_HALF - 1.0) * (s / HOLE_S_MIN);
  return HOLE_HALF + (HOLE_HALF - 1.0) * min(1.0, (s - HOLE_S_MIN) / (HOLE_S_ESC - HOLE_S_MIN));
}

HoleRay holeRay(vec3 dir) {
  HoleRay ray;
  float cosA = -dot(dir, uHoleE1);
  vec3 t = dir + cosA * uHoleE1;
  float sinA = length(t);
  ray.e2 = t / max(sinA, 1e-7);
  float b = uHoleBScale * sinA;
  ray.b = b;
  ray.alpha = atan(sinA, cosA);
  float psi0 = textureLod(uHoleCam, vec2((ray.alpha / HOLE_PI * (HOLE_CAM_TEXELS - 1.0) + 0.5) / HOLE_CAM_TEXELS, 0.5), 0.0).r;
  ray.row = holeRow(b);
  if (b >= HOLE_B_MAX) {
    float i = 1.0 / b;
    ray.len = 0.5 * HOLE_PI + i * (2.0 + i * (5.8904862 + i * (21.333333 + i * 170.09724)));
  } else {
    ray.len = textureLod(uHoleRows, vec2((ray.row + 0.5) / HOLE_ROWS, 0.5), 0.0).r;
  }
  bool inward = cosA > 0.0;
  ray.turns = b >= HOLE_BC;
  if (ray.turns) {
    float end = 2.0 * ray.len;
    ray.start = inward ? psi0 : end - psi0;
    ray.sweep = end - ray.start;
    ray.escapes = true;
  } else if (inward) {
    ray.start = psi0;
    ray.sweep = ray.len - psi0;
    ray.escapes = false;
  } else {
    ray.start = -psi0;
    ray.sweep = psi0;
    ray.escapes = true;
  }
  return ray;
}

/** u = 1 / r after sweeping phi. */
float holeU(HoleRay ray, float phi) {
  float psi = ray.start + phi;
  float folded = ray.turns ? ray.len - abs(psi - ray.len) : abs(psi);
  float c = clamp(folded / ray.len, 0.0, 1.0);
  return textureLod(uHoleOrbit, vec2((c * (HOLE_COLS - 1.0) + 0.5) / HOLE_COLS, (ray.row + 0.5) / HOLE_ROWS), 0.0).r;
}

/** Where a ray arrives at infinity. Valid when ray.escapes. */
vec3 holeOut(HoleRay ray) {
  return cos(ray.sweep) * uHoleE1 + sin(ray.sweep) * ray.e2;
}
