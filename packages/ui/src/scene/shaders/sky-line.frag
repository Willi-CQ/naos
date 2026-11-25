in float vSide;
in vec3 vColor;
out vec4 o;

void main() {
  o = vec4(vColor * (1.0 - smoothstep(0.35, 1.0, abs(vSide))), 1.0);
}
