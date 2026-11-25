// Stars and dust on the celestial sphere: directions, so they stand at infinity and only a turn of the camera moves them. Drawn into the
// sky target when the camera moved or the sky changed, and into the environment cube when the month changed.
in vec3 aDir;          // unit vector, world space
in vec3 aColor;        // linear colour times flux
in float aSize;        // point diameter in CSS px
uniform float uPxScale; // target px per CSS px, so a star keeps its size and flux at any tier
out vec3 vColor;

void main() {
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * aDir, 1.0);
  gl_Position.z = gl_Position.w * 0.999;   // at infinity, whatever the near plane is doing
  float p = aSize * uPxScale;
  gl_PointSize = max(p, 1.0);
  vColor = aColor * min(1.0, p * p);
}
