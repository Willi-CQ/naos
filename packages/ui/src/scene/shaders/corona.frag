// Streamers. Half resolution target, updated at the tier's corona rate. A polar chart of token load.
uniform sampler2D uNoise;
uniform vec2 uStream[16];    // x: screen azimuth of a world, y: token load 0..1, plus salvo flare, at most 1.3
uniform int uStreamCount;
uniform float uTokenClock;   // advances with fleet output tokens, never with wall time
uniform vec2 uStarPx;        // star centre in target px
uniform float uStarR;        // disc radius in target px
uniform vec3 uPearl;
uniform vec3 uOiii;
out vec4 o;

// Radius moves the lookup along its own ray, so a streamer stays straight at every azimuth. A shift in one fixed direction
// shears the rays at 3 and 9 o'clock and cuts them at 12 and 6. The stills had a third noise axis for this.
float tap(float a, float r, float f, float k) {
  return texture(uNoise, vec2(cos(a), sin(a)) * (f + r * k) + vec2(0.0, -uTokenClock)).r;
}

void main() {
  vec2 q = (gl_FragCoord.xy - uStarPx) / uStarR;
  float r = length(q);
  if (r < 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float a = atan(q.y, q.x);
  float s = 0.0;
  for (int i = 0; i < uStreamCount; i++) {
    float d = atan(sin(a - uStream[i].x), cos(a - uStream[i].x));
    float sig = 0.1 + 0.05 * uStream[i].y;
    s += uStream[i].y * exp(-(d * d) / (sig * sig));
  }
  s = min(s, 1.25);
  float c = min(s, 1.0);
  float n = pow(clamp((tap(a, r, 0.41, 0.03) - 0.24) / 0.5, 0.0, 1.0), 2.2);
  float h = pow(clamp((tap(a, r, 2.6, 0.05) - 0.2) / 0.6, 0.0, 1.0), 1.6);
  float fade = 1.0 - smoothstep(3.6 + 2.6 * c, 5.2 + 3.6 * c, r);
  float I = pow(r, -(3.9 - 1.9 * c)) * (0.1 + 1.45 * n * (0.45 + 1.1 * h)) * (0.62 + 1.5 * s) * fade * 1.05;
  o = vec4(mix(uPearl, uOiii, clamp(0.62 * s, 0.0, 1.0)) * I, 1.0);
}
