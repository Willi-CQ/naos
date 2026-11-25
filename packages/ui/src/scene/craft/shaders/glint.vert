// What a ship radiates: running lights as points, the drive as a plume. One draw for the whole fleet. position.xy is -1..1.
in vec4 iA;              // world position, size in CSS px
in vec4 iB;              // spot: unused. Plume: far end, world, and in w the radius of the nozzle in world units (0 means a spot)
in vec4 iColor;          // linear rgb, HDR gain
uniform vec2 uRes;
uniform float uPxPerCss;
out vec2 vP;
flat out vec4 vColor;
flat out float vKind;
flat out vec4 vLine;     // plume: start in device px, direction
flat out vec2 vSize;     // plume: length and half width in device px

void main() {
  mat4 vp = projectionMatrix * viewMatrix;
  vec2 unit = uPxPerCss / uRes * 2.0;
  vP = position.xy;
  vColor = iColor;
  vKind = iB.w;
  vLine = vec4(0.0);
  vSize = vec2(0.0);
  if (iB.w <= 0.0) {
    vec4 a = vp * vec4(iA.xyz, 1.0);
    a.xy += position.xy * iA.w * unit * a.w;
    gl_Position = a;
  } else {
    // Stood off toward the eye by the nozzle's own radius, so the bell's lip does not cut it, and the hull still hides one on its far side.
    vec3 eyeA = normalize(cameraPosition - iA.xyz);
    vec3 eyeB = normalize(cameraPosition - iB.xyz);
    vec4 a = vp * vec4(iA.xyz + eyeA * iB.w * 1.2, 1.0);
    vec4 b = vp * vec4(iB.xyz + eyeB * iB.w * 1.2, 1.0);
    vec2 sa = (a.xy / a.w * 0.5 + 0.5) * uRes;
    vec2 sb = (b.xy / max(b.w, 1e-3) * 0.5 + 0.5) * uRes;
    vec2 d = sb - sa;
    float l = length(d);
    vec2 dir = l > 1e-3 ? d / l : vec2(1.0, 0.0);
    float w = iA.w * uPxPerCss;
    // A capsule on the screen, so a plume seen down its own axis is a round glow and never a smear.
    float along = mix(-w * 1.6, l + w * 2.6, position.x * 0.5 + 0.5);
    float across = position.y * w * 3.4;
    vec2 p = sa + dir * along + vec2(-dir.y, dir.x) * across;
    float t = clamp(along / max(l, 1.0), 0.0, 1.0);
    vec4 c = mix(a, b, t);
    gl_Position = vec4((p / uRes * 2.0 - 1.0) * c.w, c.z, c.w);
    vLine = vec4(sa, dir);
    vSize = vec2(l, w);
  }
  // A hair toward the camera, so a light on the skin is not fought for by the skin.
  gl_Position.z -= 0.00002 * gl_Position.w;
}
