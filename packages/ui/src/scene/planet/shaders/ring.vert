// A flat annulus in the planet's equator. position.x runs 0..1 from inner to outer edge, position.y is the angle.
uniform vec3 uCentre;
uniform float uScale;
uniform mat3 uBody;          // world axes to body axes
uniform vec2 uRadii;         // inner, outer, in radii, just outside the visible edges
out vec3 vBody;

void main() {
  float r = mix(uRadii.x, uRadii.y, position.x);
  vec3 b = vec3(cos(position.y) * r, 0.0, sin(position.y) * r);
  vBody = b;
  vec3 world = uCentre + transpose(uBody) * b * uScale;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
