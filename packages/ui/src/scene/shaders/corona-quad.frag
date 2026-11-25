// The half resolution corona target, added to the sky. Not one of the 22 in DESIGN 7.6, which names this step and gives it no shader.
uniform sampler2D uCorona;
in vec2 vUv;
out vec4 o;

void main() {
  o = vec4(texture(uCorona, vUv).rgb, 1.0);
}
