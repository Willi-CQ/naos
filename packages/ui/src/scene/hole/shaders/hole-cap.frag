// The shadow again, after the worlds. A body behind the hole has drawn over it by now, and this takes the shadow back, with the same edge
// as the back pass, and with no alpha left, so the finish keeps bloom out of it.
uniform vec3 uHoleE1;
uniform float uHoleBScale;
in vec3 vRay;
out vec4 o;

const float HOLE_BC = 5.196152422706632;

void main() {
  vec3 dir = normalize(vRay);
  float cosA = -dot(dir, uHoleE1);
  float b = uHoleBScale * length(dir + cosA * uHoleE1);
  float edgeW = max(fwidth(b), 1e-4);
  float captured = cosA > 0.0 ? 1.0 - smoothstep(-0.7, 0.7, (b - HOLE_BC) / edgeW) : 0.0;
  if (captured <= 0.0) discard;
  o = vec4(0.0, 0.0, 0.0, captured);
}
