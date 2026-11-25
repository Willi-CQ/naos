// The layer that glows by itself. Lava comes from the field here, cities land on top later. R city, G ember, B lava.
in vec2 vFace;
out vec4 o;

uniform mat3 uFace;
uniform samplerCube uField;

void main() {
  vec3 p = normalize(uFace * vec3(vFace, 1.0));
  o = vec4(0.0, 0.0, textureLod(uField, p, 0.0).b, 1.0);
}
