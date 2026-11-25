// One tile of one cube face. position.xy is -1..3, and vFace runs -1..1 over the face.
out vec2 vFace;

void main() {
  vFace = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
