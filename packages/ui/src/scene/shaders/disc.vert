// A quad of 1.3 star radii, full resolution. position.xy is -1..1.
uniform vec3 uStar;      // world position
uniform float uRadius;   // world units
out vec2 vP;

void main() {
  vP = position.xy * 1.3;
  vec4 c = viewMatrix * vec4(uStar, 1.0);
  c.xy += vP * uRadius;
  gl_Position = projectionMatrix * c;
}
