/**
 * ASCII 3D Studio -- render shaders.
 *
 * Two GLSL passes:
 *  1. `trailFragmentShader` -- a feedback pass that keeps a decaying "heat"
 *     buffer of recent pointer positions, used to accent glyphs near the
 *     cursor.
 *  2. `asciiFragmentShader` -- the main composite pass. It samples a
 *     normally rendered 3D scene, quantizes the screen into a grid of
 *     cells, converts each cell's luminance into a character index, and
 *     looks that character up in a single-row font-glyph strip texture
 *     built at runtime from Canvas2D text (see `glyph-atlas.ts`).
 *
 * Both passes share `fullscreenVertexShader`, a full-screen plane vertex
 * shader that ignores camera/projection matrices entirely.
 */

export const fullscreenVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const trailFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uPrevTrail;
  uniform vec2 uPointer;
  uniform float uPointerActive;
  uniform float uDecay;
  uniform float uRadius;
  // Seconds since the last rendered frame. Without this, uDecay is applied
  // once per *frame* rather than once per unit *time*, so the trail fades
  // proportionally faster on higher-refresh-rate displays (same root cause
  // as the auto-rotate speed issue -- see AsciiEffect's frame loop).
  uniform float uDeltaTime;

  varying vec2 vUv;

  void main() {
    float decay = pow(uDecay, uDeltaTime * 60.0);
    float previous = texture2D(uPrevTrail, vUv).r * decay;
    float distanceToPointer = distance(vUv, uPointer);
    float stamp = uPointerActive * smoothstep(uRadius, 0.0, distanceToPointer);
    float value = clamp(previous + stamp, 0.0, 1.0);

    gl_FragColor = vec4(value, value, value, 1.0);
  }
`;

export const asciiFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uScene;
  uniform sampler2D uCharacters;
  uniform sampler2D uTrail;
  uniform vec2 uResolution;
  uniform float uGranularity;
  uniform float uCharCount;
  uniform bool uInvert;
  uniform float uGreyscaleIntensity;
  uniform bool uFillCells;
  uniform bool uTrailEnabled;
  uniform bool uIncludeBackground;
  uniform vec3 uColor;
  uniform vec3 uAccentColor;
  uniform vec3 uBackground;
  uniform float uBrightness;

  varying vec2 vUv;

  float toLuma(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec2 cell = uGranularity / uResolution;
    vec2 cellUv = floor(vUv / cell) * cell + cell * 0.5;

    vec4 scene = texture2D(uScene, cellUv);
    float trail = uTrailEnabled ? texture2D(uTrail, cellUv).r : 0.0;

    float lum = toLuma(scene.rgb);
    if (uInvert) {
      lum = 1.0 - lum;
    }

    // scene.a is 1 where the 3D object was actually rendered and 0 over the
    // untouched (transparent-cleared) background -- see AsciiEffect's clear
    // alpha. Gating brightness by it means "Brightness" only lifts the
    // object's own glyphs; it can no longer summon glyphs out of empty space.
    float objectMask = scene.a;
    lum = clamp(lum + trail * 0.65 + uBrightness * objectMask, 0.0, 1.0);

    float count = max(uCharCount - 1.0, 1.0);
    float index = floor(lum * count);

    vec2 withinCell = fract(vUv / cell);
    vec2 glyphUv = vec2((index + withinCell.x) / uCharCount, withinCell.y);
    float glyphAlpha = texture2D(uCharacters, glyphUv).a;

    vec3 tint = mix(uColor, uAccentColor, trail);
    // 0 = flat tint (ignores scene brightness), 1 = fully luminance-tinted
    // (the old "on" behavior) -- continuous instead of a binary switch.
    vec3 shaded = mix(tint, vec3(lum) * tint, uGreyscaleIntensity);
    float coverage = uFillCells
      ? max(glyphAlpha, step(0.02, lum) * 0.55 + glyphAlpha * 0.45)
      : glyphAlpha;

    // WebGL canvases are premultiplied-alpha by default, so an output color
    // must already be multiplied by its own alpha. The two branches below
    // are NOT interchangeable with a single mix()+alpha pair: when the
    // background is included, alpha is always 1 so mix() is already correct
    // (premultiplied-by-1 is a no-op). When it's excluded, alpha is
    // 'coverage', so the color channels must be 'shaded * coverage', not a
    // mix against uBackground -- otherwise a 'uBackground * (1 - coverage)'
    // term leaks into the output as an additive veil of the background
    // color across the whole canvas (strongest exactly where the glyph is
    // most transparent), and anti-aliased glyph edges composite against
    // uBackground instead of whatever is actually behind the canvas.
    if (uIncludeBackground) {
      gl_FragColor = vec4(mix(uBackground, shaded, coverage), 1.0);
    } else {
      gl_FragColor = vec4(shaded * coverage, coverage);
    }
  }
`;
