// The diffuse light of the band, baked once a month into a small cube and only looked up here.
uniform samplerCube uGlow;
in vec3 vDir;
out vec4 o;

void main() {
  o = vec4(texture(uGlow, normalize(vDir)).rgb, 1.0);
}
