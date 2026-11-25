// The Bend. The scene background: it draws the sky through the point lens equation, so hulls stay sharp in the ring.
uniform sampler2D uSky;     // sky target, half float
uniform sampler2D uNoise;   // 256 x 256 tiling noise, built at boot
uniform vec4 uWell[8];      // xy: centre px, z: signed thetaE px, w: ring colour, 0 sodium, 1 H-alpha
uniform int uWellCount;
uniform vec4 uWave[4];      // xy: centre px, z: crest radius px, w: amplitude px
uniform int uWaveCount;
uniform vec2 uWaveShape;    // x: crest width px, y: peak amplitude px
uniform vec2 uRes;          // canvas px
uniform vec3 uVoid;
uniform vec3 uNad;
uniform vec3 uHalpha;
in vec2 vUv;
out vec4 o;

void main() {
  vec2 p = vUv * uRes;
  vec2 s = p;
  float shadow = 1.0;
  float gain = 1.0;
  vec3 ring = vec3(0.0);
  for (int i = 0; i < uWellCount; i++) {
    vec2 d = p - uWell[i].xy;
    float te = uWell[i].z;
    float r2 = dot(d, d) + 1.0;
    float r = sqrt(r2);
    s -= d * te * abs(te) / r2;                            // point lens, wells add. Negative te is the rebound
    if (te < 1.0) continue;
    shadow *= smoothstep(0.34 * te, 0.62 * te, r);         // dark inner disc
    float k = (r - te) / (0.3 * te);
    gain *= 1.0 + 2.6 * exp(-k * k);                       // caustic brightening
    float a = atan(d.y, d.x);
    float m = texture(uNoise, vec2(cos(a), sin(a)) * 0.17 + float(i) * 0.31).r;
    float arc = pow(clamp((m - 0.3) / 0.42, 0.0, 1.0), 1.5);
    float e = (r - te) / ((0.85 + 3.4 * arc) * sqrt(te / 104.0));
    ring += mix(uNad, uHalpha, uWell[i].w) * 2.5 * (0.14 + 1.3 * arc) * exp(-e * e);
  }
  for (int j = 0; j < uWaveCount; j++) {
    vec2 d = p - uWave[j].xy;
    float r = length(d) + 1e-3;
    float k = (r - uWave[j].z) / uWaveShape.x;
    float g = exp(-k * k);
    s -= d / r * uWave[j].w * (1.0 - 2.0 * k * k) * g;     // Ricker profile: push, then pull
    gain *= 1.0 + 1.4 * g * uWave[j].w / uWaveShape.y;     // the crest catches light
  }
  vec3 sky = texture(uSky, s / uRes).rgb;
  o = vec4(uVoid + sky * shadow * gain + ring, 1.0);
}
