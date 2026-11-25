// What a solid world looks like with the light off. RGB albedo, A 1 where the surface is open water.
in vec2 vFace;
out vec4 o;

uniform mat3 uFace;
#ifdef PATCH
uniform sampler2D uField;
uniform sampler2D uRelief;
#else
uniform samplerCube uField;
uniform samplerCube uRelief;
#endif
uniform vec3 uSeed;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec3 uAccent;
uniform vec3 uPole;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uShelf;
uniform float uOceans;
uniform float uMoisture;
uniform float uVegetation;   // 1 where low means something growing
uniform float uCaps;
uniform float uHeightMax;
uniform float uFractures;
uniform float uVolcano;
uniform int uDetail;

void main() {
  vec3 p = normalize(uFace * vec3(vFace, 1.0));
#ifdef PATCH
  vec2 at = vFace * 0.5 + 0.5;
  vec4 f = textureLod(uField, at, 0.0);
  // Close up the ground is steeper at every step, so a patch is told apart from a cube by how much it trusts one texel.
  float slope = min(length(textureLod(uRelief, at, 0.0).xy) * 0.7, 0.34);
#else
  vec4 f = textureLod(uField, p, 0.0);
  float slope = length(textureLod(uRelief, p, 0.0).xyz - 0.5) * 0.5;
#endif
  float h = f.r;
  float mare = f.g;
  float paint = f.a - 0.5;

  vec3 s = p * 2.2 + uSeed.zxy;
  float lat = abs(p.y);
  float broad = fbm(s * 0.8 + 31.0, 5);
  float fine = fbm(s * 5.0 + 37.0, 6);
  float grit = fbm(s * 40.0 + 43.0, 5);
  float mottled = broad * 0.7 + fine * 0.3 + grit * 0.1;
  // Only a patch has texels for this, and it keeps the ground from going flat at the size of a town.
  float micro = uDetail > 11 ? fbm(s * 420.0 + 47.0, uDetail - 9) : 0.0;

  vec3 ground;
  if (uVegetation > 0.5) {
    // Climate, coarse and on purpose: wet at the equator, dry near 25 degrees, wet again near 50, cold above.
    float belt = 0.5 + 0.5 * cos(lat * 9.4);
    float alt = max(h, 0.0) / uHeightMax;
    float wet = belt * 0.72 + uMoisture * 1.05 - 0.5 + broad * 1.5 + fine * 0.5 + grit * 0.12 - alt * 0.5 - slope * 0.25;
    float cold = lat * 1.15 + alt * 0.34 + broad * 0.16 + fine * 0.14;
    float green = smoothstep(0.0, 0.3, wet) * (1.0 - smoothstep(0.62, 0.86, cold));
    float tundra = smoothstep(0.55, 0.8, cold);
    vec3 dry = mix(uMid, uAccent, smoothstep(0.08, -0.3, wet) * 0.9);
    ground = mix(dry, uLow * (1.0 + fine * 1.2 + grit * 0.4), green);
    ground = mix(ground, mix(uLow, uMid, 0.5) * 0.9, tundra * 0.75);
    ground = mix(ground, uHigh * (1.0 + grit * 0.5), smoothstep(0.62, 0.92, alt + slope * 0.5 + fine * 0.3) * 0.85);
  } else {
    ground = mix(uLow, uMid, smoothstep(-0.5, 0.0, mottled * 1.7 + 0.05));
    ground = mix(ground, uHigh, smoothstep(0.0, 0.5, mottled * 1.7 - 0.05));
    float steep = smoothstep(0.04, 0.2, slope);
    ground = mix(ground, mix(uMid, uHigh, 0.6), steep * 0.45);
  }
  ground = mix(ground, uLow * (0.8 + mottled), mare * 0.92);
  ground *= 1.0 + fine * 0.4 + grit * 0.1 + micro * 0.2;

  // Rays and ejecta are bright, cracks take the stain.
  float bright = max(paint, 0.0);
  float dark = max(-paint, 0.0);
  // On a hot world what lies bright around a vent is its fallout, stained by the sulfur in it.
  ground = mix(ground, uVolcano > 0.0 ? mix(uHigh, uAccent * 0.7, 0.32) : uHigh * 1.15, min(1.0, bright * 1.3));
  // Ice cracks stain. On a hot world the crack is just dark crust by day.
  ground = mix(ground, uVolcano > 0.0 ? uLow : uAccent, min(1.0, dark * 3.0) * step(0.001, uFractures) * 0.9);

  float water = 0.0;
  if (uOceans > 0.0 && h <= 0.0) water = 1.0;
  float depth = -h;
  // Open water is not one colour: currents and blooms show from orbit, stretched along the gyres.
  float gyre = fbm(vec3(s.x, s.y * 3.2, s.z) * 2.1 + broad * 2.4 + 53.0, 6);
  vec3 sea = uDeep * (1.0 + broad * 0.5 + gyre * 0.42);
  sea = mix(sea, uShallow, exp(-depth * (1100.0 - 900.0 * uShelf) * (1.0 + 2.4 * smoothstep(-0.2, 0.3, broad + fine))) * 0.62);
  // Silt at the mouths of things and blooms on the shelves, faint, but a flat sea reads as paint.
  sea = mix(sea, sea * vec3(1.08, 1.2, 1.1), smoothstep(0.0, 0.3, fine + 0.08) * exp(-depth * 300.0));

  vec3 color = mix(ground, sea, water);

  float capEdge = 1.0 - uCaps * 0.62 + mottled * 0.1 + fine * 0.03;
  float cap = smoothstep(capEdge, capEdge + 0.05, lat + max(h, 0.0) / uHeightMax * 0.1);
  if (uCaps <= 0.0) cap = 0.0;
  color = mix(color, uPole * (1.0 + fine * 0.14), cap);
  water *= 1.0 - cap;

  o = vec4(color, water);
}
