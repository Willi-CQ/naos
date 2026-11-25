uniform vec3 uCentre;
uniform float uScale;
uniform mat3 uBody;
uniform float uTime;
uniform float uSeed;
out vec3 vBody;
out vec2 vCurtain;
void main() {
  float a = position.x;
  float h = position.y;
  float wave = sin(a * 4.0 + uTime * .17 + uSeed) * .035 + sin(a * 9.0 - uTime * .12) * .013;
  float latitude = .44 + wave + h * .025;
  float height = 1.018 + h * (.095 + .035 * sin(a * 6.0 + uTime * .22));
  vBody = vec3(sin(latitude) * cos(a), cos(latitude) * position.z, sin(latitude) * sin(a));
  vCurtain = vec2(a, h);
  vec3 world = uCentre + transpose(uBody) * vBody * height * uScale;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
