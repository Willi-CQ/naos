// Surface normal and height from the baked field. In a cube RGB holds the normal's tilt and A the height, both in 8 bits. A patch is half
// float, so its height keeps up with its texels and shadows can be walked over it: RG tilt, B lava heat, A height, all as they are.
in vec2 vFace;
out vec4 o;

uniform mat3 uFace;
uniform float uTexel;
uniform float uHeightMax;
uniform float uOceans;
#ifdef PATCH
uniform sampler2D uField;
uniform mat3 uFaceInv;
float rawHeight(vec3 d) {
  vec3 q = uFaceInv * d;
  return textureLod(uField, q.xy / q.z * 0.5 + 0.5, 0.0).r;
}
#else
uniform samplerCube uField;
float rawHeight(vec3 d) { return textureLod(uField, d, 0.0).r; }
#endif

float heightAt(vec3 d) {
  float h = rawHeight(d);
  return uOceans > 0.0 ? max(h, 0.0) : h;
}

void main() {
  vec3 p = normalize(uFace * vec3(vFace, 1.0));
  vec3 t = normalize(cross(p, abs(p.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(p, t);
  float e = uTexel;
  float dt = heightAt(normalize(p + t * e)) - heightAt(normalize(p - t * e));
  float db = heightAt(normalize(p + b * e)) - heightAt(normalize(p - b * e));
  vec3 tilt = -(t * dt + b * db) / (2.0 * e);
#ifdef PATCH
  // Tilt in the patch's own axes, which leaves a channel for the lava heat of that texel.
  o = vec4(dot(tilt, normalize(uFace[0])), dot(tilt, normalize(uFace[1])), textureLod(uField, vFace * 0.5 + 0.5, 0.0).b, heightAt(p));
#else
  // Normals tilt by about a quarter at most. Dividing here spends all 8 bits on that range.
  o = vec4(clamp(tilt * 2.0 + 0.5, 0.0, 1.0), clamp(heightAt(p) / uHeightMax * 0.5 + 0.5, 0.0, 1.0));
#endif
}
