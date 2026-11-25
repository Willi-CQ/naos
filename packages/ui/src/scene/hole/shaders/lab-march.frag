// Lab only: the road not taken. Plain RK4 along each ray with no tables, to measure what the tables save. The picture is crude on purpose.
uniform float uSteps;
in vec3 vRay;
out vec4 o;

void main() {
  vec3 dir = normalize(vRay);
  float cosA = -dot(dir, uHoleE1);
  vec3 t = dir + cosA * uHoleE1;
  float sinA = length(t);
  vec3 e2 = t / max(sinA, 1e-7);
  float rc = uHoleBScale * uHoleBScale / (uHoleBScale + sqrt(uHoleBScale * uHoleBScale + 8.0)) * 2.0;
  float u = 1.0 / rc;
  float v = u * sqrt(1.0 - 2.0 * u) * cosA / max(sinA, 1e-7);
  float h = 12.566 / uSteps;
  float phi = 0.0;
  float last = uHoleE1.y;
  vec3 light = vec3(0.0);
  for (float i = 0.0; i < uSteps; i += 1.0) {
    float k1 = 3.0 * u * u - u;
    float u2 = u + 0.5 * h * v;
    float k2 = 3.0 * u2 * u2 - u2;
    float u3 = u + 0.5 * h * (v + 0.5 * h * k1);
    float k3 = 3.0 * u3 * u3 - u3;
    float u4 = u + h * (v + 0.5 * h * k2);
    float k4 = 3.0 * u4 * u4 - u4;
    u += h * v + h * h / 6.0 * (k1 + k2 + k3);
    v += h / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    phi += h;
    if (u <= 0.0 || u >= 0.5) break;
    float y = cos(phi) * uHoleE1.y + sin(phi) * e2.y;
    if (y * last < 0.0 && u < 0.26 && u > 0.024) light += vec3(1.0, 0.5, 0.1) * 40.0 * u;
    last = y;
  }
  o = vec4(light, 1.0);
}
