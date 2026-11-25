// One city stamped into one cube face. Dividing by the face's major axis is the gnomonic projection that the cube map itself uses, so a stamp
// is the right shape wherever it lands, and a face that cannot see the city clips it away.
in vec4 iPoint;              // xyz: unit direction, w: angular radius
in vec2 iKind;               // x: 1 for an ember, y: brightness
uniform mat3 uFace;
uniform samplerCube uAlbedo; // alpha is open water
uniform float uOceans;
out vec2 vQ;
out vec3 vDir;
flat out vec2 vKind;

vec3 ashore(vec3 c) {
  if (uOceans < 0.5) return c;
  vec3 t = normalize(cross(c, abs(c.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(c, t);
  // A spiral out from where the city was asked for, and the first dry ground wins. No land near by and the city waits under water, unlit.
  for (int i = 0; i < 14; i++) {
    float a = float(i) * 2.399963;
    float r = 0.03 * sqrt(float(i)) * step(0.5, float(i)) * 1.8;
    vec3 d = normalize(c + (t * cos(a) + b * sin(a)) * r);
    if (textureLod(uAlbedo, d, 2.0).a < 0.3) return d;
  }
  return c;
}

void main() {
  vec3 c = ashore(iPoint.xyz);
  vec3 t = normalize(cross(c, abs(c.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(c, t);
  vec3 d = normalize(c + (t * position.x + b * position.y) * iPoint.w);
  vec3 f = transpose(uFace) * d;
  vQ = position.xy;
  vDir = d;
  vKind = iKind;
  gl_Position = vec4(f.x, f.y, 0.0, f.z);
}
