import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { buildGlyphAtlas } from "./glyph-atlas";
import { createPresetGeometry, type PresetShapeId } from "./presets";
import { asciiFragmentShader, fullscreenVertexShader, trailFragmentShader } from "./shaders";

/**
 * AsciiEffect -- a framework-agnostic Three.js effect that renders a 3D
 * scene (a built-in preset shape or an uploaded GLTF/GLB/OBJ/FBX/STL/SVG model), then
 * converts the render into live ASCII art using a font-glyph texture atlas
 * and a GPU luminance-to-character lookup, with an interactive pointer
 * "heat trail" that accents nearby glyphs. The camera is user-orbitable
 * (drag to rotate) via `OrbitControls`, with auto-rotate as an idle default.
 *
 * This file has no framework dependency beyond `three` -- it is the same
 * module used by the live preview and by the "Export Code" download, so
 * the two never drift apart.
 *
 * Usage:
 *
 *   const effect = new AsciiEffect(canvasElement, { granularity: 10 });
 *   effect.setSize(canvasElement.clientWidth, canvasElement.clientHeight, window.devicePixelRatio);
 *   effect.start();
 *   // later
 *   effect.setParams({ characters: " .:-=+*#%@" });
 *   effect.setModel({ kind: "url", url: "/models/thing.glb", format: "gltf" });
 *   // cleanup
 *   effect.dispose();
 */

export type AsciiModelSource =
  // stl carries no material/color data by design (it's a geometry-only
  // format) -- loaded STL meshes get the same default material as the
  // built-in preset shapes (see buildDefaultMaterial), not per-file colors.
  // svg is 2D by design -- each filled path is extruded into a flat slab
  // (see buildSvgGroup) and colored from that path's own fill, so a
  // multi-color logo/icon keeps its per-shape colors after extrusion.
  | { format: "fbx" | "gltf" | "obj" | "stl" | "svg"; kind: "url"; url: string }
  | { kind: "preset"; preset: PresetShapeId };

export type AsciiEffectParams = {
  accentColor: string;
  autoRotate: boolean;
  background: string;
  brightness: number;
  characters: string;
  color: string;
  distance: number;
  fillCells: boolean;
  fontFamily: string;
  glyphSize: number;
  granularity: number;
  // 0 = flat tint regardless of scene lighting, 1 = fully luminance-tinted
  // (was a boolean "Greyscale luminance" switch; now a continuous mix).
  greyscaleIntensity: number;
  includeBackground: boolean;
  invert: boolean;
  model: AsciiModelSource;
  mouseTrail: boolean;
  mouseTrailIntensity: number;
  rotateSpeed: number;
  // Only affects an uploaded SVG model (ignored otherwise) -- how thick the
  // extruded slab is, as a ratio of the SVG's own bounding width/height
  // (see buildSvgGroup). Changing this re-runs the extrusion, since it's
  // baked into the geometry at load time, not a per-frame shader value.
  svgExtrudeDepth: number;
  tiltX: number;
  tiltY: number;
  tiltZ: number;
};

export const DEFAULT_ASCII_PARAMS: AsciiEffectParams = {
  accentColor: "#5ee6a8",
  autoRotate: true,
  background: "#0b0b0c",
  brightness: 0.1,
  // Matches ASCII_CHARACTER_PRESETS.detailed in ascii-presets.ts.
  characters: " .'\"^:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  color: "#eaeaea",
  distance: 6.8,
  fillCells: false,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  glyphSize: 55,
  granularity: 27,
  greyscaleIntensity: 0.55,
  includeBackground: true,
  invert: false,
  model: { kind: "preset", preset: "torus" },
  mouseTrail: false,
  mouseTrailIntensity: 0,
  rotateSpeed: 0.45,
  svgExtrudeDepth: 0.08,
  tiltX: -34,
  tiltY: 0,
  tiltZ: 0,
};

const TRAIL_SIZE = 256;
const MIN_DISTANCE = 1.6;
const MAX_DISTANCE = 8;
// Clamp for the per-frame delta passed to controls.update()/the trail decay
// uniform. Without a cap, the first frame after a backgrounded tab regains
// focus would report a multi-second delta and jump auto-rotate/trail decay
// by that whole elapsed span instead of a normal frame step.
const MAX_FRAME_DELTA_SECONDS = 0.1;
// The frame-rate this engine was originally authored/tuned against, before
// controls.update()/trail decay took a real delta. Used as the default so a
// single ad-hoc renderOnce() call (PNG export, no rAF loop driving it)
// behaves exactly as it did before this fix, and so the very first rAF
// frame (which has no prior timestamp yet) doesn't get an artificial jump.
const ASSUMED_FRAME_SECONDS = 1 / 60;
// Render loop cap. This is slow, smooth, ambient motion (a few degrees per
// second of auto-rotate) -- rendering it above 60fps is not visibly
// smoother, but every extra rendered frame is 3 real draw-call passes
// (scene, trail, composite). On a 120/144/360Hz-rAF browser, capping to
// 60fps cuts actual GPU work by 2x-6x for identical-looking motion. The
// per-frame `deltaSeconds` fed into controls.update()/trail decay is still
// measured from real elapsed time between RENDERED frames (not skipped rAF
// ticks), so motion speed stays correct regardless of the cap.
const MIN_FRAME_INTERVAL_MS = 1000 / 60;
// The composite shader (asciiFragmentShader) samples `uScene` exactly once
// per output character cell, at that cell's center (`cellUv`) -- it never
// reads any other texel. Rendering the 3D scene at full canvas resolution
// to feed that single point-sample per cell was mostly wasted work (a
// 160x90-cell grid on a 1600x900 canvas was rendering ~89x more pixels than
// it ever actually reads). `sceneTarget` is instead sized to the cell grid
// itself, oversampled by this factor so each cell's sample point still
// blends a small neighborhood of texels (via the target's linear texture
// filtering) instead of a single infinitely-thin point -- closer to a true
// per-cell area average, which in practice reads as very slightly
// different glyph choices at cell boundaries, not a visible quality loss
// (silhouette, extents, and cell positions are all unaffected, since none
// of that math changes -- only how many texels `sceneTarget` is backed by).
const SCENE_TARGET_OVERSAMPLE = 4;
// Floor so a very coarse granularity (few, large cells) never asks for a
// degenerate near-zero-size render target.
const SCENE_TARGET_MIN_SIZE = 8;
// Floor for `params.svgExtrudeDepth` -- prevents a user-facing slider from
// ever driving the ratio to exactly 0 (or negative), which would hand
// ExtrudeGeometry a degenerate zero-thickness shape.
const MIN_SVG_EXTRUDE_DEPTH_RATIO = 0.005;

function hexToVector3(hex: string, target: THREE.Vector3): THREE.Vector3 {
  const color = new THREE.Color(hex);
  return target.set(color.r, color.g, color.b);
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material.dispose();
      }
    }
  });
}

export class AsciiEffect {
  private readonly asciiMaterial: THREE.ShaderMaterial;
  private readonly asciiScene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  private readonly canvas: HTMLCanvasElement;
  private readonly controls: OrbitControls;
  private captureSnapshot: {
    cameraPosition: THREE.Vector3;
    pointerActive: number;
    wasRunning: boolean;
  } | null = null;
  private cssHeight = 1;
  private cssWidth = 1;
  private currentMesh: THREE.Object3D | null = null;
  private disposed = false;
  private readonly dummyCamera = new THREE.Camera();
  private fbxLoader: FBXLoader | null = null;
  private glyphTexture: THREE.CanvasTexture | null = null;
  private gltfLoader: GLTFLoader | null = null;
  private lastFrameTime = 0;
  private loadToken = 0;
  private readonly modelGroup = new THREE.Group();
  private objLoader: OBJLoader | null = null;
  private params: AsciiEffectParams;
  private pixelRatio = 1;
  private pointerActive = 0;
  private readonly pointerUv = new THREE.Vector2(0.5, 0.5);
  private previousAzimuth = 0;
  private cumulativeRotationDegrees = 0;
  private readonly rotationSubscribers = new Set<(cumulativeDegrees: number) => void>();
  private rafHandle: number | null = null;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private sceneTarget: THREE.WebGLRenderTarget;
  private stlLoader: STLLoader | null = null;
  private svgLoader: SVGLoader | null = null;
  private trailReadIndex = 0;
  private readonly trailMaterial: THREE.ShaderMaterial;
  private readonly trailScene = new THREE.Scene();
  private readonly trailTargets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];

  constructor(canvas: HTMLCanvasElement, params: Partial<AsciiEffectParams> = {}) {
    this.canvas = canvas;
    this.params = { ...DEFAULT_ASCII_PARAMS, ...params };

    // alpha: true -- the includeBackground: false path relies on the canvas
    // actually having an alpha channel (see asciiFragmentShader's
    // premultiplied-alpha branch). This happened to render correctly with
    // alpha: false on the three version pinned here (the context reports
    // alpha: true regardless), but that's the renderer contradicting its
    // own stated request, not a guarantee -- a future three release that
    // starts honoring this flag would turn every transparent export opaque
    // black with no other symptom.
    //
    // antialias: false -- MSAA only smooths edges of geometry drawn to the
    // canvas itself (the default framebuffer), and the only thing ever
    // drawn there is `asciiScene`'s single borderless fullscreen quad (see
    // renderFrame's final pass) -- there's no internal edge for MSAA to
    // help with. The actual 3D scene renders to `sceneTarget` (an offscreen
    // WebGLRenderTarget), which this option never touches regardless. Output
    // is byte-identical at a frozen pose; this only removes wasted
    // multisample-buffer allocation/resolve overhead.
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, canvas });
    // Alpha 0 (not 1): the scene render target's alpha channel is read back
    // in the composite shader as an "is there actually an object here" mask
    // (opaque materials still write alpha 1 wherever they draw), so
    // Brightness can be gated to the object instead of leaking into empty
    // background cells. The other two passes (trail, composite) fully
    // overwrite their targets every frame regardless of clear value.
    this.renderer.setClearColor(0x000000, 0);

    this.camera.position.set(0, 0, this.params.distance);
    this.scene.add(this.modelGroup);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    // Key + rim lights are attached to the camera (in camera-local space)
    // instead of the scene (world space). OrbitControls only ever moves the
    // camera -- the object itself stays put except for its static base tilt
    // -- so world-space lights effectively stay "welded" to one side of the
    // object: orbit far enough and the currently-visible face can end up
    // getting none of the key/rim light, just flat ambient. Parenting the
    // lights to the camera makes their direction relative to the current
    // view constant no matter how far you've orbited (drag or auto-rotate),
    // so the visible face is always lit while still keeping a shaded side
    // for contrast. The camera has to be added to the scene graph for its
    // child lights to be picked up during rendering; this has no effect on
    // OrbitControls (it manipulates camera.position/quaternion directly,
    // which stays equivalent to world space since the scene has no
    // transform of its own) or on `renderer.render(scene, camera)`.
    this.scene.add(this.camera);
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2.5, 3, 4);
    this.camera.add(key);
    const rim = new THREE.DirectionalLight(0x88bbff, 0.6);
    rim.position.set(-3, -1, -2);
    this.camera.add(rim);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    // Wheel-zoom is deliberately unbound (see README): OrbitControls calls
    // preventDefault() on wheel events, which would hijack normal page
    // scrolling for any visitor whose cursor happens to be over the canvas
    // when it's embedded in a page. Zoom stays available via the Camera
    // distance control instead. Also disables two-finger pinch-zoom.
    this.controls.enableZoom = false;
    this.controls.minDistance = MIN_DISTANCE;
    this.controls.maxDistance = MAX_DISTANCE;
    this.controls.autoRotate = this.params.autoRotate;
    this.controls.autoRotateSpeed = this.params.rotateSpeed * 6;
    this.previousAzimuth = this.controls.getAzimuthalAngle();

    this.sceneTarget = new THREE.WebGLRenderTarget(2, 2);
    this.trailTargets = [
      new THREE.WebGLRenderTarget(TRAIL_SIZE, TRAIL_SIZE),
      new THREE.WebGLRenderTarget(TRAIL_SIZE, TRAIL_SIZE),
    ];

    const fullscreenPlane = new THREE.PlaneGeometry(2, 2);

    this.trailMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      fragmentShader: trailFragmentShader,
      uniforms: {
        uDecay: { value: 0.9 },
        uDeltaTime: { value: 1 / 60 },
        uPointer: { value: this.pointerUv },
        uPointerActive: { value: 0 },
        uPrevTrail: { value: null },
        uRadius: { value: 0.18 },
      },
      vertexShader: fullscreenVertexShader,
    });
    this.trailScene.add(new THREE.Mesh(fullscreenPlane, this.trailMaterial));

    this.asciiMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      fragmentShader: asciiFragmentShader,
      transparent: true,
      uniforms: {
        uAccentColor: { value: new THREE.Vector3() },
        uBackground: { value: new THREE.Vector3() },
        uBrightness: { value: this.params.brightness },
        uCharacters: { value: null },
        uCharCount: { value: this.params.characters.length },
        uColor: { value: new THREE.Vector3() },
        uFillCells: { value: this.params.fillCells },
        uGranularity: { value: this.params.granularity },
        uGreyscaleIntensity: { value: this.params.greyscaleIntensity },
        uIncludeBackground: { value: this.params.includeBackground },
        uInvert: { value: this.params.invert },
        uResolution: { value: new THREE.Vector2(2, 2) },
        uScene: { value: this.sceneTarget.texture },
        uTrail: { value: this.trailTargets[0].texture },
        uTrailEnabled: { value: this.params.mouseTrail },
      },
      vertexShader: fullscreenVertexShader,
    });
    this.asciiScene.add(new THREE.Mesh(fullscreenPlane, this.asciiMaterial));

    this.rebuildGlyphAtlas();
    this.applyColorUniforms();
    this.applyTilt();
    void this.setModel(this.params.model);
  }

  /**
   * `options.forceContextLoss` (default `false`): also explicitly releases
   * the underlying WebGL context, not just three's own tracked resources.
   * `renderer.dispose()` alone frees programs/buffers/render lists but does
   * NOT release the context itself -- browsers cap the number of live WebGL
   * contexts a page can hold (roughly 8-16 depending on GPU/platform), so a
   * page that creates and tears down several `AsciiEffect` instances (e.g.
   * multiple assets on one landing page) without this can exhaust that cap
   * even though every instance was individually "disposed."
   *
   * Left OFF by default because a lost context cannot be reused: if a new
   * `AsciiEffect` is constructed on the SAME `<canvas>` element afterward --
   * React re-mounting the same DOM node on cleanup+effect (this happens on
   * every mount in development under `StrictMode`, which intentionally
   * double-invokes effects), hot module reload, or any other mount-dispose-
   * remount pattern reusing the element -- the new `WebGLRenderer` inherits
   * that already-lost context and fails to initialize (three's internal
   * capability probing reads from the lost context, surfacing as something
   * like "Cannot read properties of null (reading 'precision')" with no
   * clearer signal of the real cause). Only pass `{ forceContextLoss: true }`
   * when the canvas element itself is also being discarded for good (e.g. a
   * page permanently removing an embedded widget on teardown/unmount) --
   * never for a canvas that might get a fresh effect mounted on it again.
   */
  dispose(options: { forceContextLoss?: boolean } = {}): void {
    this.disposed = true;
    this.stop();
    this.controls.dispose();
    if (this.currentMesh) {
      disposeObject(this.currentMesh);
    }
    this.sceneTarget.dispose();
    this.trailTargets[0].dispose();
    this.trailTargets[1].dispose();
    this.glyphTexture?.dispose();
    this.renderer.dispose();
    if (options.forceContextLoss) {
      this.renderer.forceContextLoss();
    }
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getParams(): AsciiEffectParams {
    // Shallow copy, not the live object -- `setParams` is the only path
    // that's supposed to mutate engine state and re-upload the result to
    // the GPU uniforms/controls; handing out the internal reference would
    // let a caller mutate it directly and silently desync `this.params`
    // from what's actually been uploaded.
    return { ...this.params };
  }

  renderOnce(): void {
    this.renderFrame();
  }

  /**
   * Auto-rotate angular speed in radians/second, matching what OrbitControls
   * does live (autoRotateSpeed = rotateSpeed * 6, and OrbitControls turns
   * 2*PI/60 * autoRotateSpeed radians per second). 0 when auto-rotate is off.
   */
  getAutoRotateRadiansPerSecond(): number {
    if (!this.params.autoRotate) {
      return 0;
    }
    return ((Math.PI * 2) / 60) * this.params.rotateSpeed * 6;
  }

  /**
   * Starts deterministic offline capture (video export): stops the live
   * rAF loop, silences the pointer trail, and remembers the camera pose so
   * endCapture() can restore it. Returns the camera's current azimuth, the
   * natural starting angle for the capture.
   */
  beginCapture(): number {
    this.controls.update();
    this.captureSnapshot = {
      cameraPosition: this.camera.position.clone(),
      pointerActive: this.pointerActive,
      wasRunning: this.rafHandle !== null,
    };
    this.stop();
    this.pointerActive = 0;
    return this.controls.getAzimuthalAngle();
  }

  /**
   * Renders exactly one capture frame with the camera posed at an explicit
   * azimuth (radians, same convention as OrbitControls.getAzimuthalAngle),
   * bypassing OrbitControls' own auto-rotate/damping entirely -- so frame N
   * of a capture is fully determined by N, independent of how long encoding
   * takes in real time. Rotation subscribers (the tag overlay) are notified
   * synchronously, same as a live frame.
   */
  renderCaptureFrame(azimuthRadians: number, deltaSeconds: number): void {
    if (this.disposed) {
      return;
    }
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta = azimuthRadians;
    offset.setFromSpherical(spherical);
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld(true);
    this.trackRotation(azimuthRadians);
    this.renderPasses(deltaSeconds);
  }

  /** Ends capture: restores the camera pose and pointer state, resumes the loop. */
  endCapture(): void {
    const snapshot = this.captureSnapshot;
    this.captureSnapshot = null;
    if (!snapshot || this.disposed) {
      return;
    }
    this.camera.position.copy(snapshot.cameraPosition);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.previousAzimuth = this.controls.getAzimuthalAngle();
    this.pointerActive = snapshot.pointerActive;
    if (snapshot.wasRunning) {
      this.start();
    }
  }

  setParams(next: Partial<AsciiEffectParams>): void {
    // Capture the previous model/depth BEFORE merging `next` into
    // `this.params` -- otherwise the change checks below would compare the
    // new value against itself (since `this.params.model`/`svgExtrudeDepth`
    // are already the new values by then) and never detect a change,
    // silently freezing the displayed model.
    const previousModel = this.params.model;
    const previousSvgExtrudeDepth = this.params.svgExtrudeDepth;
    this.params = { ...this.params, ...next };

    if (
      next.characters !== undefined ||
      next.glyphSize !== undefined ||
      next.fontFamily !== undefined
    ) {
      this.rebuildGlyphAtlas();
    }
    if (
      next.color !== undefined ||
      next.accentColor !== undefined ||
      next.background !== undefined
    ) {
      this.applyColorUniforms();
    }
    if (next.tiltX !== undefined || next.tiltY !== undefined || next.tiltZ !== undefined) {
      this.applyTilt();
    }

    if (next.granularity !== undefined) {
      // sceneTarget's size depends on granularity (see SCENE_TARGET_OVERSAMPLE's
      // comment) -- re-derive it from the last known output size, since
      // granularity can change independently of setSize() being called.
      const width = Math.round(this.cssWidth * this.pixelRatio);
      const height = Math.round(this.cssHeight * this.pixelRatio);
      this.syncSceneTargetSize(width, height);
    }

    const uniforms = this.asciiMaterial.uniforms;
    uniforms.uGranularity.value = this.params.granularity;
    uniforms.uInvert.value = this.params.invert;
    uniforms.uGreyscaleIntensity.value = this.params.greyscaleIntensity;
    uniforms.uFillCells.value = this.params.fillCells;
    uniforms.uTrailEnabled.value = this.params.mouseTrail;
    uniforms.uIncludeBackground.value = this.params.includeBackground;
    uniforms.uBrightness.value = this.params.brightness;
    this.trailMaterial.uniforms.uRadius.value = 0.05 + this.params.mouseTrailIntensity * 0.25;

    this.controls.autoRotate = this.params.autoRotate;
    this.controls.autoRotateSpeed = this.params.rotateSpeed * 6;

    if (next.distance !== undefined) {
      this.setDistance(next.distance);
    }

    if (next.model !== undefined && this.isModelSourceDifferent(previousModel, next.model)) {
      void this.setModel(next.model);
    } else if (
      // svgExtrudeDepth is baked into the extruded geometry at load time
      // (see buildSvgGroup) rather than read per-frame, so changing it has
      // to re-run setModel to take effect -- but only when an SVG is
      // actually the current model, otherwise every param sync (which
      // always includes svgExtrudeDepth, even when unchanged) would
      // needlessly reload whatever GLTF/OBJ/FBX/STL/preset is showing.
      next.svgExtrudeDepth !== undefined &&
      next.svgExtrudeDepth !== previousSvgExtrudeDepth &&
      this.params.model.kind === "url" &&
      this.params.model.format === "svg"
    ) {
      void this.setModel(this.params.model);
    }
  }

  /**
   * Projects a point given in the object's local space (i.e. a point "on"
   * or near the object, before its base tilt/scale) into normalized screen
   * percentages, using the actual live camera -- so a caller (the tracking
   * tag overlay) can render an HTML element that visually sticks to a real
   * point on the object and moves with it as the camera orbits (auto-rotate
   * or drag). `facing` is the dot product of the point's outward direction
   * from the object's center against the direction toward the camera:
   * roughly 1 when that point of the object is turned toward the viewer,
   * roughly -1 when it's turned away -- callers can use it to fade the tag
   * out on the object's far side for a real depth cue instead of a fixed
   * decorative float. Pure Three.js math; no shader/GLSL involvement.
   */
  projectPoint(local: { x: number; y: number; z: number }): {
    facing: number;
    leftPercent: number;
    topPercent: number;
  } {
    this.modelGroup.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);

    const worldPoint = new THREE.Vector3(local.x, local.y, local.z).applyMatrix4(
      this.modelGroup.matrixWorld,
    );
    const outwardDirection = worldPoint.clone().sub(this.modelGroup.position).normalize();
    const towardCamera = this.camera.position.clone().sub(worldPoint).normalize();
    const facing = outwardDirection.dot(towardCamera);

    const ndc = worldPoint.clone().project(this.camera);

    return {
      facing,
      leftPercent: (ndc.x * 0.5 + 0.5) * 100,
      topPercent: (1 - (ndc.y * 0.5 + 0.5)) * 100,
    };
  }

  /**
   * Subscribes to the object's cumulative rotation in degrees (camera-orbit
   * angle, since auto-rotate and drag-to-rotate both move the camera around
   * the object -- see the OrbitControls setup above). Unwrapped/unbounded
   * rather than -180..180, so a caller can detect "the object has turned N
   * degrees since I last checked" regardless of direction or how many full
   * turns have happened. Calls back immediately with the current value, then
   * on every rendered frame after that. Returns an unsubscribe function.
   * Pure JS/Three.js bookkeeping -- no shader or GLSL involvement.
   */
  subscribeRotation(listener: (cumulativeDegrees: number) => void): () => void {
    this.rotationSubscribers.add(listener);
    listener(this.cumulativeRotationDegrees);
    return () => {
      this.rotationSubscribers.delete(listener);
    };
  }

  setPointer(uv: { x: number; y: number } | null): void {
    if (!uv) {
      this.pointerActive = 0;
      return;
    }
    this.pointerUv.set(uv.x, uv.y);
    this.pointerActive = 1;
  }

  async setModel(source: AsciiModelSource): Promise<void> {
    const token = (this.loadToken += 1);

    if (source.kind === "preset") {
      this.replaceMesh(this.buildPresetMesh(source.preset));
      return;
    }

    try {
      let loaded: THREE.Object3D;

      if (source.format === "obj") {
        this.objLoader ??= new OBJLoader();
        loaded = await this.objLoader.loadAsync(source.url);
      } else if (source.format === "fbx") {
        this.fbxLoader ??= new FBXLoader();
        loaded = await this.fbxLoader.loadAsync(source.url);
      } else if (source.format === "stl") {
        // STLLoader resolves a bare THREE.BufferGeometry, not an Object3D --
        // STL is a geometry-only format (no materials/colors in the file at
        // all), so wrap it in a Mesh with the same default material the
        // built-in preset shapes use (see buildDefaultMaterial).
        this.stlLoader ??= new STLLoader();
        const geometry = await this.stlLoader.loadAsync(source.url);
        loaded = new THREE.Mesh(geometry, this.buildDefaultMaterial());
      } else if (source.format === "svg") {
        // SVG is 2D-only -- there is no "SVGLoader.loadAsync() -> Object3D"
        // path in three.js the way there is for the other formats, so this
        // one goes through its own loader + extrude step (buildSvgGroup)
        // instead of the generic `loaded = await xLoader.loadAsync(url)`
        // pattern the other branches use.
        loaded = await this.buildSvgGroup(source.url);
      } else {
        this.gltfLoader ??= new GLTFLoader();
        const gltf = await this.gltfLoader.loadAsync(source.url);
        loaded = gltf.scene;
      }

      if (token !== this.loadToken || this.disposed) {
        return;
      }
      this.replaceMesh(this.frameObject(loaded));
    } catch (error) {
      if (token !== this.loadToken || this.disposed) {
        return;
      }
      // Deliberately does NOT fall back to a preset here: silently swapping
      // back to a preset shape on a failed upload looks indistinguishable
      // from "my upload did nothing", which is exactly the confusing
      // behavior this is avoiding. Whatever was already showing (a preset,
      // or a previously successful upload) stays on screen, and the real
      // reason is in the console.
      console.error(
        `AsciiEffect: failed to load uploaded ${source.format.toUpperCase()} model. ` +
          "Keeping the previous model on screen instead of silently reverting to a preset.",
        error,
      );
    }
  }

  setSize(cssWidth: number, cssHeight: number, pixelRatio = 1): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.pixelRatio = Math.max(0.5, pixelRatio);

    const width = Math.round(this.cssWidth * this.pixelRatio);
    const height = Math.round(this.cssHeight * this.pixelRatio);

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";

    this.syncSceneTargetSize(width, height);
    this.camera.aspect = this.cssWidth / this.cssHeight;
    this.camera.updateProjectionMatrix();

    (this.asciiMaterial.uniforms.uResolution.value as THREE.Vector2).set(width, height);
  }

  start(): void {
    if (this.rafHandle !== null) {
      return;
    }
    this.lastFrameTime = performance.now();
    const tick = (time: number): void => {
      this.rafHandle = requestAnimationFrame(tick);

      // Skip rendering entirely (but keep scheduling rAF ticks) until at
      // least one 60fps-equivalent interval has passed since the last
      // rendered frame -- see MIN_FRAME_INTERVAL_MS. This is a render cap,
      // not a frame-rate change: `lastFrameTime` only advances on frames
      // that actually render, so deltaSeconds below is still measured
      // against real elapsed wall-clock time, keeping motion speed correct.
      if (time - this.lastFrameTime < MIN_FRAME_INTERVAL_MS) {
        return;
      }

      // Real elapsed time since the last rendered frame, not an assumed
      // 60fps step -- otherwise auto-rotate speed and trail decay both
      // depend on the viewer's monitor refresh rate (~2.4x faster on
      // 144Hz, ~3x on 175Hz, for the exact same rotateSpeed/uDecay
      // values). Clamped so a tab that was backgrounded and regains focus
      // doesn't jump rotation/decay by the whole elapsed gap.
      const deltaSeconds = Math.min(
        Math.max((time - this.lastFrameTime) / 1000, 0),
        MAX_FRAME_DELTA_SECONDS,
      );
      this.renderFrame(deltaSeconds);
      this.lastFrameTime = time;
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  private applyTilt(): void {
    // modelGroup carries only this static base orientation -- auto-rotate
    // and drag-to-rotate are both camera moves (OrbitControls orbiting
    // around the origin), not object rotation, so this never fights either
    // of them. Lets the object sit at a fixed angle (e.g. a key tumbling
    // around a tilted axis instead of always spinning bolt-upright).
    this.modelGroup.rotation.set(
      THREE.MathUtils.degToRad(this.params.tiltX),
      THREE.MathUtils.degToRad(this.params.tiltY),
      THREE.MathUtils.degToRad(this.params.tiltZ),
    );
  }

  private applyColorUniforms(): void {
    hexToVector3(this.params.color, this.asciiMaterial.uniforms.uColor.value as THREE.Vector3);
    hexToVector3(
      this.params.accentColor,
      this.asciiMaterial.uniforms.uAccentColor.value as THREE.Vector3,
    );
    hexToVector3(
      this.params.background,
      this.asciiMaterial.uniforms.uBackground.value as THREE.Vector3,
    );
  }

  private buildPresetMesh(preset: PresetShapeId): THREE.Object3D {
    return new THREE.Mesh(createPresetGeometry(preset), this.buildDefaultMaterial());
  }

  // Parses an uploaded SVG, extrudes every filled path into a flat 3D slab,
  // and groups the resulting meshes into one Object3D -- the same shape
  // `setModel()`'s other branches hand to `frameObject()`. Runs once at
  // upload time (not per-frame), so the one-off cost of SVG path parsing +
  // ExtrudeGeometry triangulation is a non-issue.
  private async buildSvgGroup(url: string): Promise<THREE.Object3D> {
    this.svgLoader ??= new SVGLoader();
    const data = await this.svgLoader.loadAsync(url);

    const shapesWithColor: { color: THREE.Color | null; shape: THREE.Shape }[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const path of data.paths) {
      // fill: "none" paths are stroke-only outlines (no fill to extrude) --
      // this engine extrudes filled regions, not stroked lines, so those
      // are skipped rather than producing an invisible zero-area mesh.
      const fill = path.userData?.style?.fill as string | undefined;
      if (fill === "none") {
        continue;
      }
      const color = fill ? path.color.clone() : null;

      for (const shape of SVGLoader.createShapes(path)) {
        shapesWithColor.push({ color, shape });
        for (const point of shape.getPoints()) {
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        }
      }
    }

    if (shapesWithColor.length === 0) {
      throw new Error(
        "SVG file has no fillable shapes to extrude (only stroke-only/empty paths found).",
      );
    }

    const width = Math.max(maxX - minX, 1e-3);
    const height = Math.max(maxY - minY, 1e-3);
    // User-adjustable via `svgExtrudeDepth` (see setModel/setParams) --
    // still expressed as a ratio of the SVG's own bounding width/height
    // rather than an absolute unit count, since SVG source coordinate
    // scales vary wildly (a 24x24 icon grid vs. a 1000+-unit illustration)
    // and the result is re-normalized to a fixed on-screen size regardless
    // (frameObject scales by the object's own bounding radius).
    const depthRatio = Math.max(MIN_SVG_EXTRUDE_DEPTH_RATIO, this.params.svgExtrudeDepth);
    const depth = depthRatio * Math.max(width, height);

    const group = new THREE.Group();
    for (const { color, shape } of shapesWithColor) {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: depth * 0.12,
        bevelThickness: depth * 0.12,
        curveSegments: 12,
        depth,
      });
      const material = color ? this.buildDefaultMaterial(color) : this.buildDefaultMaterial();
      group.add(new THREE.Mesh(geometry, material));
    }

    // SVG's Y axis points down (screen space); three.js's points up. Without
    // this flip, every extruded shape renders vertically mirrored -- text
    // and asymmetric logos would read backwards top-to-bottom.
    group.scale.y = -1;
    return group;
  }

  // Shared by preset shapes and any loaded geometry-only format (STL, and
  // per-shape SVG extrusions when a path has no fill color) that doesn't
  // carry its own material/color data -- or, for SVG, to apply a color the
  // loader DID recover from the source file.
  private buildDefaultMaterial(
    color: THREE.ColorRepresentation = 0xffffff,
  ): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color,
      metalness: 0.1,
      roughness: 0.45,
    });
  }

  private frameObject(object: THREE.Object3D): THREE.Object3D {
    // Three composes each object's local matrix as T(position) * R(quaternion) * S(scale),
    // i.e. the object's own `position` is applied AFTER its own scale. Centering and
    // scaling therefore need two nested groups: an inner, unscaled group that removes the
    // bounding-box center, and an outer group that applies uniform scale around that
    // already-centered origin. Combining both offsets on a single object would scale the
    // centering offset itself and leave the model off-center for any radius other than 1.
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.0001) / 2;
    const scale = 1.3 / radius;

    const centered = new THREE.Group();
    object.position.sub(center);
    centered.add(object);

    const scaled = new THREE.Group();
    scaled.scale.setScalar(scale);
    scaled.add(centered);

    return scaled;
  }

  private isModelSourceDifferent(previous: AsciiModelSource, next: AsciiModelSource): boolean {
    if (next.kind !== previous.kind) {
      return true;
    }
    if (next.kind === "preset" && previous.kind === "preset") {
      return next.preset !== previous.preset;
    }
    if (next.kind === "url" && previous.kind === "url") {
      return next.url !== previous.url || next.format !== previous.format;
    }
    return false;
  }

  private rebuildGlyphAtlas(): void {
    const atlas = buildGlyphAtlas(this.params.characters, this.params.glyphSize, this.params.fontFamily);
    this.glyphTexture?.dispose();
    const texture = new THREE.CanvasTexture(atlas.canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    this.glyphTexture = texture;
    this.asciiMaterial.uniforms.uCharacters.value = texture;
    this.asciiMaterial.uniforms.uCharCount.value = Math.max(atlas.columns, 1);
  }

  private renderFrame(deltaSeconds: number = ASSUMED_FRAME_SECONDS): void {
    if (this.disposed) {
      return;
    }

    this.controls.update(deltaSeconds);
    this.trackRotation(this.controls.getAzimuthalAngle());
    this.renderPasses(deltaSeconds);
  }

  // The three GPU passes (scene -> trail -> ASCII composite), shared by the
  // live loop (renderFrame) and offline video capture (renderCaptureFrame).
  private renderPasses(deltaSeconds: number): void {
    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.render(this.scene, this.camera);

    const readTarget = this.trailTargets[this.trailReadIndex];
    const writeTarget = this.trailTargets[1 - this.trailReadIndex];
    this.trailMaterial.uniforms.uPrevTrail.value = readTarget.texture;
    this.trailMaterial.uniforms.uDeltaTime.value = deltaSeconds;
    this.trailMaterial.uniforms.uPointerActive.value = this.params.mouseTrail
      ? this.pointerActive
      : 0;
    this.renderer.setRenderTarget(writeTarget);
    this.renderer.render(this.trailScene, this.dummyCamera);
    this.trailReadIndex = 1 - this.trailReadIndex;
    this.asciiMaterial.uniforms.uTrail.value = writeTarget.texture;

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.asciiScene, this.dummyCamera);
  }

  private replaceMesh(object: THREE.Object3D): void {
    if (this.currentMesh) {
      this.modelGroup.remove(this.currentMesh);
      disposeObject(this.currentMesh);
    }
    this.currentMesh = object;
    this.modelGroup.add(object);
  }

  // `azimuth` is passed in rather than read from the controls: during video
  // capture the camera is posed directly (controls.update() is skipped), so
  // the controls' own cached azimuth would be stale.
  private trackRotation(azimuth: number): void {
    if (this.rotationSubscribers.size === 0) {
      return;
    }

    // Shortest-path delta so a wrap from +PI to -PI (or vice versa) reads as
    // a small step in the direction of travel, not a near-360-degree jump.
    const rawDelta = azimuth - this.previousAzimuth;
    const wrapped =
      ((rawDelta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.previousAzimuth = azimuth;
    this.cumulativeRotationDegrees += THREE.MathUtils.radToDeg(wrapped);

    for (const listener of this.rotationSubscribers) {
      listener(this.cumulativeRotationDegrees);
    }
  }

  // Resizes sceneTarget to the cell grid (derived from the full output
  // pixel size and the current granularity), oversampled -- see
  // SCENE_TARGET_OVERSAMPLE's comment for why this is safe/correct given
  // how the composite shader samples uScene. Called from both setSize()
  // (output size changed) and setParams() (granularity changed).
  private syncSceneTargetSize(fullWidth: number, fullHeight: number): void {
    const granularity = Math.max(this.params.granularity, 1);
    const cellsX = Math.max(1, Math.ceil(fullWidth / granularity));
    const cellsY = Math.max(1, Math.ceil(fullHeight / granularity));
    const targetWidth = Math.max(SCENE_TARGET_MIN_SIZE, cellsX * SCENE_TARGET_OVERSAMPLE);
    const targetHeight = Math.max(SCENE_TARGET_MIN_SIZE, cellsY * SCENE_TARGET_OVERSAMPLE);
    this.sceneTarget.setSize(targetWidth, targetHeight);
  }

  private setDistance(distance: number): void {
    const clamped = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, distance));
    const direction = this.camera.position.clone().sub(this.controls.target);

    if (direction.lengthSq() < 1e-6) {
      direction.set(0, 0, 1);
    }
    direction.setLength(clamped);
    this.camera.position.copy(this.controls.target).add(direction);
    this.controls.update();
  }
}
