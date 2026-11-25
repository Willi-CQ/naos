// One light per finished agent, one cluster per session. Night side only.
in vec3 aDir;             // unit vector from the world centre
in float aWorld;          // world index
in float aFail;           // 1 for an ember, 0 for a city light
uniform vec4 uWorld[32];  // xyz: centre, w: radius
uniform vec4 uSpin[32];   // xyz: axis, w: angle. The lights turn with their planet
uniform vec3 uStar;
uniform float uPx;
uniform vec3 uCity;
uniform vec3 uHalpha;
out vec3 vColor;

vec3 turned(vec3 v, vec4 q) {
  float c = cos(q.w);
  float s = sin(q.w);
  return v * c + cross(q.xyz, v) * s + q.xyz * dot(q.xyz, v) * (1.0 - c);
}

void main() {
  vec4 w = uWorld[int(aWorld)];
  vec3 dir = turned(aDir, uSpin[int(aWorld)]);
  vec3 view = mat3(viewMatrix) * dir;
  float night = 1.0 - smoothstep(-0.12, 0.32, dot(dir, normalize(uStar - w.xyz)));
  float limb = smoothstep(0.04, 0.3, view.z);
  bool hide = view.z < 0.04 || night * limb < 0.01;
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(w.xyz + dir * w.w * 1.002, 1.0);
  gl_PointSize = uPx * clamp(0.45 + w.w / 70.0, 0.6, 1.0);   // a small world keeps separate lights
  vColor = mix(uCity, uHalpha, aFail) * night * limb * 3.0;
}
