// Worlds and moons as analytic impostors. position.xy is -1..1, scaled to 1.16 radii. The quad faces the camera's own eye, not its axis:
// a sphere's outline is a circle in the plane through its centre square to the line of sight, exactly, at any distance and any angle off axis.
in vec3 iCentre;
in float iRadius;      // world units
in float iGlow;        // 1 at rest, more while a world wakes
uniform vec3 uStar;
out vec2 vQ;
flat out float vGlow;
flat out vec3 vLight;  // toward the star, in the frame of the quad

void main() {
  vQ = position.xy * 1.16;
  vGlow = iGlow;
  vec3 c = (viewMatrix * vec4(iCentre, 1.0)).xyz;
  float d = max(length(c), iRadius * 1.02);
  vec3 back = -c / d;
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), back));
  vec3 lift = cross(back, side);
  float limb = iRadius * d / sqrt(d * d - iRadius * iRadius);
  vec3 l = normalize(mat3(viewMatrix) * (uStar - iCentre));
  vLight = vec3(dot(l, side), dot(l, lift), dot(l, back));
  gl_Position = projectionMatrix * vec4(c + (side * vQ.x + lift * vQ.y) * limb, 1.0);
}
