// A ship part, instanced. Poses are a quaternion and a scale, because a part never shears and six numbers upload cheaper than sixteen.
in vec4 aMeta;           // material, seed, panel size at 16 per metre, bevel radius at 64 per metre
in vec4 aEdge;           // place on a flat face from its centre, then the half size of that face, metres
in vec4 iPose;           // world position, scale
in vec4 iQuat;
in vec4 iTone;           // linear rgb, gain
in vec4 iLook;           // x fill, y fade, z how much of the hull stands in its state's light, and past 1 how much of a mark's, w drive
in vec4 iExtra;          // x dashes. y, z: a crashed section, its slice of the hull along x. w: section
in float iFine;          // how much surface detail this size can show, 0 to 1
in vec4 iShip;           // centre of the whole ship, world, and its bounding radius
in vec4 iTile;           // shadow atlas: corner, size (0 for none), and strength
uniform vec3 uDisk;
uniform vec3 uFieldMin;
uniform vec3 uFieldInverse;

out vec3 vWorld;
out vec3 vNormal;
out vec3 vLocal;
out vec3 vLocalNormal;
out vec3 vField;
out vec2 vUv;
out vec4 vEdge;
flat out float vBevel;
flat out float vMat;
flat out float vSeed;
flat out float vPanel;
flat out vec4 vTone;
flat out vec4 vLook;
flat out vec4 vExtra;
flat out float vFine;
flat out vec3 vL;
flat out vec3 vLocalL;
flat out vec4 vShip;
flat out vec4 vTile;
flat out vec3 vX;
flat out vec3 vY;

vec3 rotate(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }

void main() {
  vec3 w = iPose.xyz + rotate(iQuat, position * iPose.w);
  vWorld = w;
  vNormal = rotate(iQuat, normal);
  vLocal = position;
  vLocalNormal = normal;
  vField = (position - uFieldMin) * uFieldInverse;
  vUv = uv;
  vEdge = aEdge;
  vBevel = aMeta.w / 64.0;
  vMat = aMeta.x;
  vSeed = aMeta.y / 255.0;
  vPanel = aMeta.z / 16.0;
  vTone = iTone;
  vLook = iLook;
  vExtra = iExtra;
  vFine = iFine;
  vec3 L = normalize(uDisk - iShip.xyz);
  vL = L;
  vLocalL = rotate(vec4(-iQuat.xyz, iQuat.w), L);
  vShip = iShip;
  vTile = iTile;
  // The same basis as the shadow pass, so both agree where a point falls on the atlas.
  vX = normalize(cross(L, vec3(0.31, 0.87, 0.39)));
  vY = cross(vX, L);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
