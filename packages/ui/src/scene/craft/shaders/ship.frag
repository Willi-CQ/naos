// The hull under one warm light in a black sky. Almost everything on screen in a film of this kind is a key light, a shadow and a hard edge, so
// the shader spends its money there: a wide soft key, a real self shadow, seams and rolled edges that catch that key, and something for polish
// to reflect. State is light too, because section 6 outranks the look: a small ship stands in its colour, and a close one carries it on the hull.
precision highp float;
precision highp sampler3D;
precision highp sampler2DShadow;

uniform sampler3D uField;
uniform sampler2DShadow uShadow;
uniform float uFieldCell;       // voxel size in metres
uniform vec3 uFieldInverse;
uniform vec3 uKey;              // the disk's colour and power, already dimmed by quota
uniform vec4 uBody;             // the near world: position, radius. Radius 0 for none
uniform vec3 uBodyColor;
uniform sampler3D uGrain;        // tiling noise, four channels
uniform sampler2D uCrumple;      // foil facets: tilt in rg, tone in b
uniform float uShadowTexel;     // one over the atlas size
uniform vec4 uBelt[3];          // status sections: station, half width, reach from the axis (0 for all of it), spill. Half width 0 for none
uniform float uSpan;            // length of this part along x

in vec3 vWorld;
in vec3 vNormal;
in vec3 vLocal;
in vec3 vLocalNormal;
in vec3 vField;
in vec2 vUv;
in vec4 vEdge;
flat in float vBevel;
flat in float vMat;
flat in float vSeed;
flat in float vPanel;
flat in vec4 vTone;
flat in vec4 vLook;
flat in vec4 vExtra;
flat in float vFine;
flat in vec3 vL;
flat in vec3 vLocalL;
flat in vec4 vShip;
flat in vec4 vTile;
flat in vec3 vX;
flat in vec3 vY;
out vec4 o;

const int WHITE = 0, DARK = 1, GOLD = 2, METAL = 3, SOLAR = 4, WINDOW = 5, THROAT = 6, SILVER = 7, STRIP = 8, RADIATOR = 9, PAINT = 10, GRAPHITE = 11;
const float PI = 3.14159265;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float h1(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float h2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 h22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float h3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }

#ifdef TORN
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
#endif

struct Plate { float edge; float id; vec2 toEdge; vec2 cell; };

/**
 * Plating, as it is laid on a real pressure hull: stringers run unbroken down the length, and cross seams land only where a sheet ends. The
 * rows never stagger, because staggered rows read as brickwork at once. Each row chooses its own sheet lengths.
 */
Plate plates(vec2 p, float size, float seed) {
  float H = size;
  float W = size * 2.3;
  float row = floor(p.y / H);
  float fy = p.y / H - row;
  float shift = h1(row + seed * 91.0) * 3.0;
  float u = p.x / W + shift;
  float c = floor(u);
  float fx = u - c;
  float left = step(0.58, h2(vec2(c, row + seed * 31.0)));
  float right = step(0.58, h2(vec2(c + 1.0, row + seed * 31.0)));
  float dLeft = left > 0.5 ? fx * W : 1e3;
  float dRight = right > 0.5 ? (1.0 - fx) * W : 1e3;
  float dLow = fy * H;
  float dHigh = (1.0 - fy) * H;
  float start = c;
  if (left < 0.5) { start -= 1.0; if (h2(vec2(start, row + seed * 31.0)) < 0.58) start -= 1.0; }
  float dx = min(dLeft, dRight);
  float dy = min(dLow, dHigh);
  Plate o;
  o.edge = min(dx, dy);
  o.cell = vec2(start, row);
  o.id = h2(o.cell + 3.7 + seed);
  o.toEdge = dx < dy ? vec2(dLeft < dRight ? -1.0 : 1.0, 0.0) : vec2(0.0, dLow < dHigh ? -1.0 : 1.0);
  return o;
}

float ggx(float NoH, float a) { float q = a * a; float d = NoH * NoH * (q - 1.0) + 1.0; return q / (PI * d * d); }
float vis(float NoL, float NoV, float a) { float k = a * 0.5; return 0.25 / max(0.02, (NoL * (1.0 - k) + k) * (NoV * (1.0 - k) + k)); }

/** The sky as polish sees it: the disk across its own plane, its glow around it, and a void that is cold one way and warm the other, so metal has a form. */
vec3 env(vec3 R, vec3 L, float rough) {
  float flat_ = R.y;
  float w = 0.05 + rough * 0.5;
  float band = exp(-flat_ * flat_ / (w * w));
  float toward = smoothstep(-0.5, 1.0, dot(R, L));
  vec3 disk = uKey * band * toward * toward * (0.5 / (1.0 + rough * 5.0));
  vec3 halo = uKey * pow(max(dot(R, L), 0.0), mix(40.0, 3.0, rough)) * mix(0.3, 0.09, rough);
  vec3 sky = mix(vec3(0.022, 0.018, 0.016), vec3(0.03, 0.04, 0.058), 0.5 + 0.5 * R.y);
  return disk + halo + sky;
}

float shadowMap(vec3 P, vec3 N, float noiseA) {
  if (vTile.z <= 0.0) return 1.0;
  float texels = 1.0 / (vTile.z * uShadowTexel);
  vec3 rel = (P + N * vShip.w * 0.006 - vShip.xyz) / vShip.w;
  vec2 uv = vTile.xy + (vec2(dot(rel, vX), dot(rel, vY)) * 0.5 + 0.5) * vTile.z;
  float z = dot(rel, -vL) * 0.5 + 0.5 - 2.0 / texels;
  float radius = 1.6 * uShadowTexel;
  float sum = 0.0;
  // Rotated by screen noise, and each tap is already four compares, so four of them blur without banding.
  float c = cos(noiseA), s = sin(noiseA);
  mat2 m = mat2(c, s, -s, c);
  sum += texture(uShadow, vec3(uv + m * vec2(0.7, 0.2) * radius, z));
  sum += texture(uShadow, vec3(uv + m * vec2(-0.3, 0.8) * radius, z));
  sum += texture(uShadow, vec3(uv + m * vec2(-0.9, -0.2) * radius, z));
  sum += texture(uShadow, vec3(uv + m * vec2(0.2, -0.7) * radius, z));
  return sum * 0.25;
}

void main() {
#ifdef TORN
  // A crashed section: torn edges, not a clean cut. Only here, because one `discard` in the shader turns early depth off for every pixel of
  // it, and a truss behind a hull would then be shaded in full and thrown away.
  if (vExtra.y != vExtra.z) {
    float tear = (noise(vec3(vLocal.yz * 0.4, vExtra.w)) - 0.5) * (vExtra.z - vExtra.y) * 0.5;
    if (vLocal.x < vExtra.y + tear || vLocal.x > vExtra.z + (noise(vec3(vLocal.yz * 0.4, vExtra.w + 1.0)) - 0.5) * (vExtra.z - vExtra.y) * 0.5) discard;
  }
#endif
  int mat = int(vMat + 0.5);
  vec3 N = normalize(vNormal);
  vec3 P = vWorld;
  vec3 V = normalize(cameraPosition - P);
  vec3 L = vL;
  vec2 uv = vUv;
  float footprint = length(fwidth(uv));                                  // metres per pixel
  vec3 local = vLocal;

  vec3 albedo = vec3(0.5);
  vec3 F0 = vec3(0.04);
  float rough = 0.5;
  vec3 glow = vec3(0.0);
  vec2 bump = vec2(0.0);
  float own = vLook.x;
  float drive = vLook.w;
  // How much of the key reaches this surface. Only the inside of a nozzle says less than all of it.
  float cavity = 1.0;
  // A hull a few dozen pixels long has none of this to show, and each of those pixels would still pay for all of it. The average of each
  // material stands in, and `vFine` blends across, so the surface arrives without a step.
  float fine = vFine;
  vec3 T = vec3(0.0), B = vec3(0.0);

  if (mat == WINDOW) {
    albedo = vec3(0.006);
    F0 = vec3(0.07);
    rough = 0.07;
    // Rooms, not lamps: most are dark and a few are lived in, set back behind a frame.
    vec3 warm = vec3(1.0, 0.6, 0.28);
    float lit = smoothstep(0.42, 0.95, vSeed);
    vec2 inset = (vEdge.zw - abs(vEdge.xy)) / max(vEdge.zw, vec2(1e-3));
    float frame = vBevel > 0.0 ? smoothstep(0.1, 0.45, min(inset.x, inset.y)) : 1.0;
    glow = warm * (0.006 + 0.3 * lit * lit) * mix(0.45, 1.0, own) * frame;
  } else if (mat == THROAT) {
    // Depth runs from the floor of the chamber, in bell radii. Light from outside cannot get far in, so a cold nozzle is dark all the way down,
    // and a hot one burns hardest at the floor, where you are looking into the throat.
    float depth = uv.y / max(vPanel, 0.1);
    albedo = vec3(0.07, 0.068, 0.066);
    rough = 0.56;
    F0 = vec3(0.06);
    cavity = smoothstep(0.55, 2.6, depth);
    // The cooling channels of the wall, line after line down its length.
    if (fine > 0.0) albedo *= 1.0 - 0.5 * fine * clamp(0.05 / max(footprint, 1e-4), 0.0, 1.0) * smoothstep(0.3, 0.5, abs(fract(uv.x / (vPanel * 0.11)) - 0.5));
    vec3 oiii = vec3(0.016, 0.76, 0.52);
    glow = drive * (oiii * 2.2 * exp(-depth * 2.3) + vec3(0.8, 1.0, 0.95) * 9.0 * exp(-depth * depth * 11.0));
  } else if (mat == STRIP) {
    albedo = vec3(0.03);
    glow = vTone.rgb * min(vTone.a, 1.4) * (0.03 + 0.42 * own);
  } else {
    if (mat == WHITE) { albedo = vec3(0.3, 0.297, 0.288); F0 = vec3(0.05); rough = 0.5; }
    else if (mat == DARK) { albedo = vec3(0.022); F0 = vec3(0.05); rough = 0.52; }
    else if (mat == METAL) { albedo = vec3(0.014); F0 = vec3(0.3); rough = 0.44; }
    else if (mat == RADIATOR) { albedo = vec3(0.016); F0 = vec3(0.09); rough = 0.36; }
    else if (mat == GOLD) { F0 = vec3(0.82, 0.58, 0.24); albedo = F0 * 0.08; rough = 0.42; }
    else if (mat == SILVER) { albedo = vec3(0.26, 0.262, 0.262); F0 = vec3(0.05); rough = 0.62; }
    else if (mat == SOLAR) { albedo = vec3(0.004, 0.006, 0.015); F0 = vec3(0.07); rough = 0.14; }
    else if (mat == PAINT) { albedo = vec3(0.05); rough = 0.6; }
    else { albedo = vec3(0.026); F0 = vec3(0.06); rough = 0.46; }
    if (fine > 0.0) {
      vec3 albedo0 = albedo, F00 = F0;
      float rough0 = rough;
      // Cotangent frame from derivatives: uv is in metres, and no tangent has to be stored.
      vec3 dpx = dFdx(P), dpy = dFdy(P);
      vec2 dux = dFdx(uv), duy = dFdy(uv);
      vec3 px = cross(dpy, N), py = cross(N, dpx);
      T = px * dux.x + py * duy.x;
      B = px * dux.y + py * duy.y;
      float scale = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
      T *= scale;
      B *= scale;
      vec4 big = texture(uGrain, local * 0.031 + vSeed);
      float wear = big.r;
      float detail = clamp(1.0 - footprint * 3.0, 0.0, 1.0);             // no use computing what a pixel averages away

      // The edge of a plate. No hard edge is sharp in life: the normal rolls over, and a thin line of the key runs along it.
      float worn = 0.0;
      if (vBevel > 0.0) {
        vec2 ex = dFdx(vEdge.xy), ey = dFdy(vEdge.xy);
        vec3 E = px * ex.x + py * ey.x;
        vec3 F = px * ex.y + py * ey.y;
        E *= inversesqrt(max(dot(E, E), 1e-16));
        F *= inversesqrt(max(dot(F, F), 1e-16));
        vec2 rim = clamp(1.0 - (vEdge.zw - abs(vEdge.xy)) / vBevel, 0.0, 1.0);
        vec2 roll = rim * rim * sign(vEdge.xy) * clamp(vBevel / max(footprint * 0.7, 1e-4), 0.0, 1.0);
        N = normalize(N + (E * roll.x + F * roll.y) * 0.9 * fine);
        worn = max(rim.x, rim.y);
        worn = worn * worn * clamp(vBevel * 1.5 / max(footprint, 1e-4), 0.0, 1.0);
      }

  if (mat == WHITE || mat == DARK || mat == METAL || mat == RADIATOR) {
    float size = max(vPanel, 0.25);
    bool plain = vPanel < 0.05;
    Plate pl = plates(uv + vSeed * 13.0, size, vSeed);
    float seam = 0.012 + 0.0045 * size;
    float reach = clamp(seam * 2.6 / max(footprint, 1e-4), 0.0, 1.0);    // a seam thinner than a pixel fades to its average
    float edge = plain ? 0.0 : smoothstep(seam + footprint, seam * 0.4, pl.edge) * reach;
    float tone = plain ? 0.5 : pl.id;
    float block = plain ? 0.5 : h2(floor(uv / (size * 4.0)) + vSeed * 9.0);
    if (mat == WHITE) {
      albedo = vec3(0.32, 0.316, 0.305) * (0.74 + 0.36 * tone + 0.1 * block);
      // Sheets get replaced, and the new one never quite matches. A few were never white: service panels come in the grey of the primer.
      if (!plain) albedo *= (1.0 - 0.18 * step(0.82, pl.id) + 0.07 * step(pl.id, 0.1)) * mix(1.0, 0.44, step(0.93, pl.id));
      // Grime lies along the seams, where nothing wipes it off.
      if (!plain) albedo *= 1.0 - 0.14 * smoothstep(size * 0.16, 0.0, pl.edge);
      // Years of outgassing run aft along a hull. Long, faint and straight, and they are what stops it looking freshly rendered.
      float streak = texture(uGrain, vec3(local.x * 0.0042, local.y * 0.47 + vSeed, local.z * 0.47)).g;
      float weather = texture(uGrain, vec3(local.x * 0.012, local.y * 1.3 - vSeed, local.z * 1.3)).b;
      albedo *= mix(0.84, 1.03, smoothstep(0.34, 0.6, streak)) * mix(0.93, 1.02, smoothstep(0.38, 0.62, weather));
      rough = 0.4 + 0.22 * tone;
      F0 = vec3(0.055);
      if (!plain) {
        // Access hatches: not every plate, and never in a pattern. Let into the skin, so the far side of the cut catches the key.
        vec2 q = uv / (size * 1.27) + 2.3;
        vec2 cell = floor(q);
        vec2 fq = q - cell;
        vec2 hs = h22(cell + 5.0);
        if (hs.x > 0.8) {
          vec2 half_ = 0.14 + 0.2 * vec2(h2(cell + 1.0), h2(cell + 2.0));
          vec2 dq = abs(fq - 0.5 - (hs - 0.5) * 0.3) - half_;
          float box = max(dq.x, dq.y) * size * 1.27;
          float line = smoothstep(0.016 + footprint, 0.004, abs(box)) * clamp(0.02 / max(footprint, 1e-4), 0.0, 1.0);
          albedo *= 1.0 - 0.42 * line;
          if (box < 0.0) albedo *= 0.93 + 0.1 * hs.y;
          bump += (dq.x > dq.y ? vec2(sign(fq.x - 0.5), 0.0) : vec2(0.0, sign(fq.y - 0.5))) * line * 0.3;
        }
      }
      bump += (big.ba - 0.5) * 0.05;
      // Fastener rows just in from a seam, and only once you could count them.
      float rivet = detail * smoothstep(0.03, 0.002, footprint) * smoothstep(0.075, 0.055, abs(pl.edge - 0.1));
      vec2 fr = fract(uv / 0.26) - 0.5;
      albedo *= 1.0 - 0.3 * rivet * smoothstep(0.26, 0.12, length(fr));
      // Paint goes first at an edge, and what shows there is bright primer.
      float chip = smoothstep(0.42, 0.62, texture(uGrain, local * 0.41 + vSeed).b);
      albedo = mix(albedo, vec3(0.5, 0.48, 0.44), worn * (0.25 + 0.5 * chip));
    } else if (mat == DARK) {
      // Thermal tile: each one fired on its own, and mounted a hair off its neighbour, so a sweep of light breaks up tile by tile.
      Plate tile = plates(uv + 1.1, max(size * 0.36, 0.34), vSeed + 0.2);
      float t = tile.id;
      albedo = vec3(0.021, 0.0205, 0.0195) * (0.55 + 1.5 * t * t);
      rough = 0.4 + 0.24 * t;
      F0 = vec3(0.055);
      float line = clamp(0.03 / max(footprint, 1e-4), 0.0, 1.0) * smoothstep(0.018 + footprint, 0.006, tile.edge);
      albedo *= 1.0 - 0.7 * line;
      F0 *= 1.0 - 0.7 * line;
      bump += (h22(tile.cell + 2.0) - 0.5) * 0.11;
      F0 += worn * 0.1;
    } else if (mat == METAL) {
      // Machined and anodised: a grain that runs one way, so a highlight on it is a streak, not a blob.
      float brush = texture(uGrain, vec3(uv.x * 0.08, uv.y * 1.9, vSeed)).a;
      albedo = vec3(0.014);
      F0 = vec3(0.3, 0.295, 0.29) * (0.78 + 0.42 * tone) * (0.86 + 0.28 * brush);
      rough = 0.32 + 0.16 * tone + 0.14 * brush;
      F0 += worn * 0.3;
      edge *= 0.4;
    } else {
      // A radiator is coolant tube bonded to thin sheet, so it runs in long lines and has no cross hatch to speak of.
      float at = uv.x / 0.74;
      float rib = abs(fract(at) - 0.5);
      albedo = vec3(0.016, 0.0158, 0.0155) * (0.8 + 0.5 * block);
      F0 = vec3(0.095);
      rough = 0.26 + 0.2 * smoothstep(0.08, 0.34, rib);
      bump.x += detail * 0.22 * sign(fract(at) - 0.5) * smoothstep(0.3, 0.5, rib);
      bump += (h22(vec2(floor(at), block * 9.0)) - 0.5) * 0.03;
      edge *= 0.2;
    }
    albedo *= 1.0 - 0.56 * edge;
    F0 *= 1.0 - 0.5 * edge;
    // A sheet is never quite in the plane of its neighbour, and that small wander is what breaks up a highlight.
    if (!plain) bump += (h22(pl.cell + 7.0) - 0.5) * 0.05;
    // And no sheet is flat: it is held at its edges and bows between them, so a low light shows every plate of the hull.
    if (!plain) bump += pl.toEdge * exp(-pl.edge / (size * 0.2)) * 0.1;
    bump += plain ? vec2(0.0) : pl.toEdge * smoothstep(seam * 2.6, seam, pl.edge) * reach * 0.34;
  } else if (mat == GOLD) {
    // Multilayer film over wadding, the way it comes off the roll: mirror in small crumpled facets, so most of it reflects black and a few
    // facets at a time catch the disk. A tank of it is dark with bright creases, not a tank of brass.
    vec4 w = texture(uGrain, vec3(uv * 0.07, vSeed));
    vec4 v = texture(uGrain, vec3(uv.yx * 0.23, vSeed + 0.4));
    vec3 a = texture(uCrumple, uv * 0.19 + vSeed).rgb;
    float keep = clamp(1.0 - footprint * 3.0, 0.0, 1.0);
    bump = ((w.xy - 0.5) * 0.8 + (v.zw - 0.5) * 0.36 + (a.xy - 0.5) * 0.16) * keep;
    F0 = vec3(0.74, 0.52, 0.22) * (0.86 + 0.28 * a.z);
    albedo = F0 * 0.04;
    rough = mix(0.42, 0.3, keep);
  } else if (mat == SILVER) {
    // Blanket: beta cloth quilted over insulation. Soft, pale, and stitched into a grid that pulls down at each tie.
    float size = max(vPanel * 0.2, 0.34);
    vec2 g = uv / size;
    vec2 c = fract(g) - 0.5;
    float keep = clamp(1.0 - footprint * 4.0, 0.0, 1.0);
    float pillow = 1.0 - dot(c, c) * 2.0;
    albedo = vec3(0.28, 0.282, 0.278) * (0.95 + 0.1 * h2(floor(g) + vSeed * 7.0));
    albedo *= mix(1.0, 0.8 + 0.2 * pillow, keep);
    albedo *= mix(0.8, 1.0, smoothstep(0.25, 0.6, wear));
    bump = c * -0.2 * keep;
    rough = 0.64;
    F0 = vec3(0.05);
  } else if (mat == SOLAR) {
    // Cells under cover glass. They are a deep blue that only shows at an angle; the grid is a hair, and the real lines are the bus bars.
    vec2 g = uv / 0.31;
    vec2 cell = floor(g);
    vec2 c = fract(g);
    float line = min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y));
    float bar = step(fract((cell.x + 0.5) / 6.0), 1.0 / 6.0);
    float hair = smoothstep(0.012, 0.03 + footprint * 3.2, line);
    albedo = vec3(0.003, 0.0055, 0.016) * (0.8 + 0.5 * h2(cell + 1.0));
    F0 = mix(vec3(0.11), vec3(0.05, 0.06, 0.085), hair);
    F0 = mix(F0, vec3(0.2), bar * 0.6 * clamp(0.1 / max(footprint, 1e-4), 0.0, 1.0));
    bump += (h22(cell + 4.0) - 0.5) * 0.02;
    rough = 0.1;
  } else if (mat == PAINT) {
    albedo = vec3(0.045, 0.04, 0.036);
    rough = 0.6;
    albedo *= mix(0.8, 1.6, wear);
  } else {
    // Graphite: woven, with a satin coat, and a sheen that moves with the angle.
    float weave = texture(uGrain, vec3(uv * 0.9, vSeed)).a;
    albedo = vec3(0.022, 0.0215, 0.0215) * (0.8 + 0.5 * weave);
    F0 = vec3(0.065);
    rough = 0.36 + 0.18 * weave;
    albedo *= 1.0 + smoothstep(0.4, 0.75, wear) * 0.7;
    F0 += worn * 0.12;
  }

      albedo = mix(albedo0, albedo, fine);
      F0 = mix(F00, F0, fine);
      rough = mix(rough0, rough, fine);
      N = normalize(N + (T * bump.x + B * bump.y) * fine);
    }
  }

  float NoV = max(dot(N, V), 0.02);
  float NoLraw = dot(N, L);
  float area = 0.09;                                                     // the disk is wide, and no terminator it casts is razor sharp
  float NoL = clamp((NoLraw + area) / (1.0 + area), 0.0, 1.0);
  NoL *= NoL * (3.0 - 2.0 * NoL) * 0.35 + 0.65;

  // Occlusion and a soft self shadow out of the voxel field, so it works at any distance and needs no shadow map.
  vec3 cell = vec3(uFieldCell) * uFieldInverse;
  vec3 ln = normalize(vLocalNormal);
  vec2 near = texture(uField, vField + ln * cell * 1.6).rg;
  vec3 lane = vField + ln * cell * 3.0;
  float occlusion = 1.0 - clamp((near.r - 0.1) * 1.5, 0.0, 0.85);
  float soft = 1.0;
  // Once the shadow map has taken over, these steps add nothing but cost.
  if (vTile.w < 0.999) {
    float block = texture(uField, lane + vLocalL * cell * 15.0).g * 1.9;
    if (fine > 0.0) block = mix(block, block * 0.47 + texture(uField, lane + vLocalL * cell * 7.0).g + texture(uField, lane + vLocalL * cell * 26.0).g * 0.8, fine);
    soft = exp(-block * 5.0);
  }
  if (fine > 0.0) occlusion *= 1.0 - fine * clamp((texture(uField, vField + ln * cell * 5.0).g - 0.1) * 1.7, 0.0, 0.8);

  float angle = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float hard = vTile.z > 0.0 ? shadowMap(P, normalize(vNormal), angle) : 1.0;
  float shadow = soft * mix(1.0, hard, vTile.w);

  // A world between the ship and the disk puts it out, and the night side of a planet should look like one.
  float eclipse = 1.0;
  vec3 bounce = vec3(0.0);
  if (uBody.w > 0.0) {
    vec3 oc = uBody.xyz - P;
    float along = dot(oc, L);
    float miss = length(oc - L * along);
    if (along > 0.0) eclipse = smoothstep(uBody.w * 0.965, uBody.w * 1.03, miss);
    vec3 toBody = normalize(oc);
    float lit = clamp(0.5 - 0.5 * dot(toBody, L), 0.0, 1.0);
    float size = clamp(uBody.w * uBody.w / max(dot(oc, oc), 1e-3), 0.0, 1.0);
    float facing = max(dot(N, toBody) * 0.5 + 0.5, 0.0);
    bounce = uBodyColor * lit * size * facing * facing * 1.2;
  }
  shadow *= eclipse;

  vec3 H = normalize(L + V);
  float NoH = max(dot(N, H), 0.0);
  float VoH = max(dot(V, H), 0.0);
  float a = max(rough * rough, 0.02) + 0.03;
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);
  // Capped, or a mirror facet at the wrong angle throws a bloom the size of the ship.
  vec3 spec = min(F * ggx(NoH, a) * vis(max(NoLraw, 0.0), NoV, a) * max(NoLraw, 0.0), vec3(mat == GOLD ? 1.1 : 2.4));

  // The key darkens a little where parts meet, as well as the fill. It is the difference between things that sit on a hull and things pasted on it.
  vec3 key = uKey * shadow * mix(0.55, 1.0, occlusion);
  vec3 col = (albedo * NoL + spec) * key;

  // Everything that is not the key: a hair of sky, the disk's far glow, and the world below.
  float wrap = pow(0.5 + 0.5 * NoLraw, 2.0);
  vec3 fill = (vec3(0.008, 0.0105, 0.016) + uKey * 0.005 * wrap + vec3(0.014, 0.017, 0.024) * pow(max(-NoLraw, 0.0), 2.0)) * occlusion + bounce * occlusion;
  col += albedo * fill;

  vec3 R = reflect(-V, N);
  vec3 FR = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NoV, 5.0);
  col += env(R, L, rough) * FR * occlusion * mix(0.35, 1.0, shadow);

  // The disk is wide, so a ship against it is drawn by a thin line of its light, on whatever stands edge on to it. Not an ambient: the blacks stay.
  float against = clamp(0.5 - 0.5 * dot(L, V), 0.0, 1.0);
  float edgeOn = pow(1.0 - NoV, 3.5) * smoothstep(-0.5, 0.2, NoLraw);
  col += uKey * (albedo + F0 + 0.04) * against * against * edgeOn * 0.5 * occlusion * eclipse;

  col *= cavity;
  col += glow;

  // State, section 6. First the status section: two lit rings around the hull, and the plating between them, which the ship floods when it is its
  // own to drive. Filled and outlined mean what they mean on a mark. The ring keeps a pixel of width however far off the ship is.
  vec3 lamp = vTone.rgb * min(vTone.a, 1.6);
  if (mat != WINDOW && mat != GOLD && mat != SOLAR && mat != RADIATOR && mat != THROAT) {
    float fp = max(footprint, 1e-4);
    float rings = 0.0, section = 0.0, spill = 0.0, inset = 0.0;
    for (int i = 0; i < 3; i++) {
      vec4 b = uBelt[i];
      if (b.y <= 0.0 || (b.z > 0.0 && dot(local.yz, local.yz) > b.z * b.z)) continue;
      float dx = abs(local.x - b.x);
      float w = max(b.y * 0.07, fp * 0.5);
      rings = max(rings, 1.0 - smoothstep(w - fp * 0.4, w + fp * 0.4, abs(dx - b.y)));
      float inside = 1.0 - smoothstep(b.y - fp * 0.4, b.y + fp * 0.4, dx);
      if (inside > section) { section = inside; inset = dx / b.y; }
      spill = max(spill, exp(-max(dx - b.y, 0.0) / b.w));
    }
    float around = atan(local.y, local.z);
    if (vExtra.x > 0.5) rings *= step(fract(around / 6.2831853 * 18.0), 0.5);
    if (mat == DARK) rings = 0.0;                                         // nothing is run across a heat shield
    // The rings light the plating between them from its two edges, in the pools a row of small lamps throws, and that is why it looks lit and not painted.
    float pools = 0.62 + 0.38 * cos(around * 18.0);
    float graze = section * (0.3 + 0.9 * inset * inset) * mix(1.0, pools, fine);
    float flood = graze * 1.35 + spill * 0.3;
    col = mix(col, col * 0.5, min(flood, 1.0) * own);
    col += (vec3(dot(albedo, LUMA)) + F0 * 0.3) * lamp * own * flood * occlusion;
    col += min(lamp, vec3(0.7)) * rings * mix(0.66, 1.0, own);
  }

  // Then the second light, which a small ship needs and a close one does not. It falls on the side the disk does not reach, as a film lights a
  // ship with two sources, so white plate takes the colour, dark tile stays dark, and the hull is still made of something. An observed craft gets
  // none of that and goes dark, and catches the colour only where its surface turns away from you: an outline, made of light.
  float body = min(vLook.z, 1.0);
  float handing = max(vLook.z - 1.0, 0.0);
  if (body > 0.0) {
    float reached = clamp(dot(col, LUMA) * 1.4, 0.0, 1.0);
    float turned = pow(1.0 - max(dot(normalize(vNormal), V), 0.0), 2.4);
    // Grey, so foil and paint both take the state's colour and no third colour comes of it.
    vec3 surface = vec3(dot(albedo + F0 * 0.4, LUMA));
    // While the mark is handing over, the hull has to carry the light the mark was carrying, or the craft dims on the way in.
    vec3 hot = vTone.rgb * vTone.a * handing;
    vec3 filled = col * 0.72 + surface * lamp * (0.42 + 1.1 * (1.0 - reached)) * occlusion + hot * (0.2 + 0.5 * reached);
    vec3 hollow = col * 0.5 + lamp * (0.015 + 0.5 * turned) + hot * (0.04 + 0.6 * turned);
    col = mix(col, mix(hollow, filled, own), body);
    // Section 6's dashes, on a hull that cannot show its rings yet.
    if (vExtra.x > 0.5) col *= mix(1.0, 0.5 + 0.5 * step(fract(local.x / uSpan * 7.0 + 0.1), 0.55), body);
  }

  o = vec4(col * vLook.y, vLook.y);
}
