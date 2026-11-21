/**
 * Ordered-dither post-process.
 *
 * The scene is rendered into a small render target (2 texels per dither cell, so each
 * cell gets a cheap 2x2 average). This pass then runs at full canvas resolution, works
 * out which cell each fragment belongs to, and quantises that cell's luminance into the
 * palette using a Bayer threshold. Cells are square in device pixels at any DPR.
 *
 * Marker colours: pixels whose colour is strongly green-dominant are drawn in the
 * `fg` colour, and strongly red-dominant pixels in the `accent` colour, regardless of
 * luminance. Use `ditherMarkerColor` from ./markers to get those colours.
 */

export const ditherVertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const ditherFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D tScene;
  uniform vec2 uCells;        // number of dither cells across / down
  uniform float uCellSize;    // cell size in device pixels
  uniform float uLevels;      // 2 or 3 palette levels for ordinary shading
  uniform float uMatrix;      // 4 or 8 (Bayer matrix size)
  uniform float uContrast;
  uniform float uBrightness;
  uniform vec3 uBg;
  uniform vec3 uMid;
  uniform vec3 uFg;
  uniform vec3 uAccent;

  float bayer2(vec2 a) {
    a = floor(a);
    return fract(dot(a, vec2(0.5, a.y * 0.75)));
  }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
  float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

  void main() {
    vec2 cell = floor(gl_FragCoord.xy / uCellSize);
    vec2 uv = (cell + 0.5) / uCells;
    vec3 c = texture2D(tScene, uv).rgb;

    // Threshold in (0, 1), centred in each Bayer bucket.
    float n = uMatrix > 6.0 ? 64.0 : 16.0;
    float t = (uMatrix > 6.0 ? bayer8(cell) : bayer4(cell)) + 0.5 / n;

    // Marker channels (linear colour).
    float primaryMark = c.g - max(c.r, c.b);
    float accentMark = c.r - max(c.g, c.b);

    vec3 color;
    if (accentMark > 0.12) {
      float v = clamp(accentMark * 1.6, 0.0, 1.0);
      color = v > t ? uAccent : uBg;
    } else if (primaryMark > 0.12) {
      float v = clamp(primaryMark * 1.6, 0.0, 1.0);
      color = v > t ? uFg : uBg;
    } else {
      // Perceptual luminance from linear RGB.
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      l = pow(max(l, 0.0), 1.0 / 2.2);
      l = clamp((l - 0.5) * uContrast + 0.5 + uBrightness, 0.0, 1.0);

      float steps = uLevels - 1.0;
      float v = l * steps;
      float level = min(floor(v) + step(t, fract(v)), steps);

      if (level < 0.5) {
        color = uBg;
      } else if (level < 1.5 && steps > 1.5) {
        color = uMid;
      } else {
        color = uFg;
      }
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;
