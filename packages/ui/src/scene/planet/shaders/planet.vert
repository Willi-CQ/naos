// A camera facing quad just big enough for the air around one sphere, or the whole screen once the camera is inside that sphere. All shading
// happens along rays in the planet's own frame, in radii, so a low orbit keeps its precision and the body is never a mesh.
uniform vec3 uCentre;        // world
uniform float uScale;        // world units per radius
uniform float uBound;        // radii the quad must cover
uniform mat3 uBody;          // world axes to body axes
uniform mat4 uUnproject;     // clip to world, for the inside case
out vec3 vRay;

void main() {
  vec3 toCentre = uCentre - cameraPosition;
  float d = length(toCentre);
  float reach = uScale * uBound;
  if (d < reach * 1.05) {
    gl_Position = vec4(position.xy, 0.0, 1.0);
    vec4 far = uUnproject * vec4(position.xy, 1.0, 1.0);
    vRay = uBody * (far.xyz / far.w - cameraPosition);
    return;
  }
  vec3 f = toCentre / d;
  vec3 up = abs(f.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(f, up));
  vec3 v = cross(u, f);
  float s = reach * d / sqrt(d * d - reach * reach) * 1.02;
  vec3 world = uCentre + (u * position.x + v * position.y) * s;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  vRay = uBody * (world - cameraPosition);
}
