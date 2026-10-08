import JSZip from "jszip";

import type { ToolcraftState } from "@/toolcraft/runtime";

import {
  ASCII_CHARACTER_PRESETS,
  ASCII_FONT_PRESETS,
  type AsciiCharacterPresetId,
  type AsciiFontPresetId,
} from "../ascii-engine/ascii-presets";
import asciiEffectSource from "../ascii-engine/ascii-effect?raw";
import asciiPresetsSource from "../ascii-engine/ascii-presets?raw";
import glyphAtlasSource from "../ascii-engine/glyph-atlas?raw";
import presetsSource from "../ascii-engine/presets?raw";
import shadersSource from "../ascii-engine/shaders?raw";
import type { AsciiEffectParams } from "../ascii-engine/ascii-effect";
import { DEFAULT_KEY_MODEL_DATA_URL, DEFAULT_KEY_MODEL_FILE_NAME } from "../model-defaults";
import tagClusterAnchorsSource from "../ascii-engine/tag-cluster-anchors?raw";
import tagClusterTypesSource from "../ascii-engine/tag-cluster-types?raw";
import { resolveGroupColor, resolveTagColorOverride, type ClusterDef } from "../ascii-engine/tag-cluster-types";
import trackingTagsControllerSource from "../ascii-engine/tracking-tags-controller?raw";
import trackingTagsCssSource from "../ascii-engine/tracking-tags-overlay.css?raw";
import { DEFAULT_TAG_CLUSTERS } from "../tracking-tags/tag-cluster-defaults";

const MODEL_SOURCE_TARGET = "model.source";
const MAX_INLINE_MODEL_BYTES = 180_000;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

// Toolcraft's `color` control only stores a plain hex string until the
// picker itself is used -- once a user actually edits a color, the runtime
// stores it as `{ hex: string }` instead. Reading it with a naive
// `String(value)` for the object case produces the literal text
// "[object Object]" instead of the hex code -- this resolves either shape
// to a real hex string. (Mirrors the same fix in AsciiCanvas.tsx.)
function resolveColorValue(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return HEX_COLOR_PATTERN.test(value) ? value : fallback;
  }
  if (value && typeof value === "object" && "hex" in value) {
    const hex = String((value as { hex: unknown }).hex ?? "");
    return HEX_COLOR_PATTERN.test(hex) ? hex : fallback;
  }
  return fallback;
}

// The following four type guards + `resolveTagClusters`
// mirror AsciiCanvas.tsx's functions of the same name byte-for-byte on
// purpose (see the comment on `resolveColorValue` above for why this file
// duplicates rather than imports app-layer helpers) -- both files need to
// turn the same raw `tags.clusters` schema value into the
// same validated shape, so the live studio and the export agree on what
// "malformed state" falls back to.
function isTagDef(value: unknown): value is { text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof (value as { text: unknown }).text === "string"
  );
}

function isGroupDef(value: unknown): value is { tags: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "tags" in value &&
    Array.isArray((value as { tags: unknown }).tags)
  );
}

function isClusterDef(value: unknown): value is { groups: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "groups" in value &&
    Array.isArray((value as { groups: unknown }).groups)
  );
}

function asBooleanFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function resolveTagClusters(value: unknown): ClusterDef[] {
  if (!Array.isArray(value) || value.length === 0) {
    return DEFAULT_TAG_CLUSTERS;
  }

  const clusters = value
    .filter(isClusterDef)
    .map((cluster, clusterIndex) => ({
      giantSquare: asBooleanFlag((cluster as { giantSquare?: unknown }).giantSquare, false),
      groups: cluster.groups
        .filter(isGroupDef)
        .map((group, groupIndex) => ({
          chainLine: asBooleanFlag((group as { chainLine?: unknown }).chainLine, false),
          color: resolveGroupColor((group as { color?: unknown }).color, clusterIndex, groupIndex),
          objectLine: asBooleanFlag((group as { objectLine?: unknown }).objectLine, false),
          tags: group.tags.filter(isTagDef).map((tag) => {
            const color = resolveTagColorOverride((tag as { color?: unknown }).color);
            return {
              ...(color ? { color } : {}),
              filled: asBooleanFlag((tag as { filled?: unknown }).filled, true),
              text: tag.text,
            };
          }),
        }))
        .filter((group) => group.tags.length > 0),
    }))
    .filter((cluster) => cluster.groups.length > 0);

  return clusters.length > 0 ? clusters : DEFAULT_TAG_CLUSTERS;
}


export type TagsExportConfig = {
  clusters: ClusterDef[];
  distanceToObject: number;
  enabled: boolean;
  giantSquareColor: string;
  giantSquareSize: number;
  lineColor: string;
  lineDashed: boolean;
  lineThickness: number;
  paddingX: number;
  paddingY: number;
  tagScale: number;
};

// Also reused by video export (export-video.ts), so the tags burned into a
// video resolve schema state exactly the way the code export does.
export function readTagsState(state: ToolcraftState): TagsExportConfig {
  const values = state.values;
  return {
    clusters: resolveTagClusters(values["tags.clusters"]),
    distanceToObject: Number(values["tags.distanceToObject"] ?? 1.05),
    enabled: Boolean(values["tags.enabled"] ?? true),
    giantSquareColor: resolveColorValue(values["tags.squareColor"], "#ffffff"),
    giantSquareSize: Number(values["tags.squareSize"] ?? 60),
    lineColor: resolveColorValue(values["tags.lineColor"], "#ffffff"),
    lineDashed: String(values["tags.lineStyle"] ?? "solid") === "dashed",
    lineThickness: Number(values["tags.lineThickness"] ?? 1),
    paddingX: Number(values["tags.paddingX"] ?? 4),
    paddingY: Number(values["tags.paddingY"] ?? 6),
    tagScale: Number(values["tags.size"] ?? 1),
  };
}

function readState(state: ToolcraftState): {
  params: Omit<AsciiEffectParams, "model">;
  preset: string;
  uploadedModel?: { dataUrl: string; fileName: string };
} {
  const values = state.values;
  const uploadedModel = state.mediaAssets.find(
    (asset) => asset.sourceTarget === MODEL_SOURCE_TARGET,
  );
  const characterPreset = String(values["ascii.characterPreset"] ?? "classic");
  const characters =
    characterPreset === "custom"
      ? String(values["ascii.characters"] ?? " .:-=+*#%@")
      : (ASCII_CHARACTER_PRESETS[characterPreset as AsciiCharacterPresetId] ??
        ASCII_CHARACTER_PRESETS.classic);
  const fontPreset = String(values["ascii.fontPreset"] ?? "systemMono");
  const fontFamily =
    ASCII_FONT_PRESETS[fontPreset as AsciiFontPresetId] ?? ASCII_FONT_PRESETS.systemMono;

  return {
    params: {
      accentColor: resolveColorValue(values["appearance.accentColor"], "#5ee6a8"),
      autoRotate: Boolean(values["motion.autoRotate"] ?? true),
      background: resolveColorValue(values["appearance.background"], "#0b0b0c"),
      brightness: Number(values["appearance.brightness"] ?? 0),
      characters,
      color: resolveColorValue(values["appearance.color"], "#eaeaea"),
      distance: Number(values["camera.distance"] ?? 3.4),
      fillCells: Boolean(values["ascii.fillCells"] ?? false),
      fontFamily,
      glyphSize: Number(values["ascii.glyphSize"] ?? 46),
      granularity: Number(values["ascii.granularity"] ?? 12),
      greyscaleIntensity: Number(values["ascii.greyscaleIntensity"] ?? 1),
      includeBackground: Boolean(values["export.includeBackground"] ?? true),
      invert: Boolean(values["ascii.invert"] ?? false),
      mouseTrail: Boolean(values["motion.mouseTrail"] ?? true),
      mouseTrailIntensity: Number(values["motion.mouseTrailIntensity"] ?? 0.6),
      rotateSpeed: Number(values["motion.rotateSpeed"] ?? 0.35),
      svgExtrudeDepth: Number(values["model.svgExtrudeDepth"] ?? 0.08),
      tiltX: Number(values["model.tiltX"] ?? 0),
      tiltY: Number(values["model.tiltY"] ?? 0),
      tiltZ: Number(values["model.tiltZ"] ?? 0),
    },
    // "custom" is a valid Shape-selector value but not a valid AsciiEffect
    // preset id -- if the user picked Custom without uploading anything yet,
    // fall back to "torus" for the generated example so it stays valid code.
    preset: (() => {
      const shape = String(values["model.shape"] ?? "key");
      return shape === "custom" && !uploadedModel ? "torus" : shape;
    })(),
    // "key" (the app's standard default shape) isn't a per-session upload --
    // it's embedded in the app itself (see model-defaults.ts) -- but reuses
    // the exact same "embed as data URL" code path a real upload would, so
    // the generated example stays self-contained either way.
    uploadedModel: uploadedModel
      ? { dataUrl: uploadedModel.dataUrl, fileName: uploadedModel.fileName }
      : String(values["model.shape"] ?? "key") === "key"
        ? { dataUrl: DEFAULT_KEY_MODEL_DATA_URL, fileName: DEFAULT_KEY_MODEL_FILE_NAME }
        : undefined,
  };
}

function formatParamsLiteral(params: Omit<AsciiEffectParams, "model">): string {
  const lines = Object.entries(params).map(([key, value]) => {
    const literal = typeof value === "string" ? JSON.stringify(value) : String(value);
    return `  ${key}: ${literal},`;
  });
  return `{\n${lines.join("\n")}\n}`;
}

// tags.clusters is plain nested arrays of strings/booleans, so
// JSON.stringify's output is already valid TypeScript object-literal syntax
// (quoted keys are legal, just unusual for hand-written code) -- no need for
// the per-key formatting formatParamsLiteral does for the ascii params.
function formatTagsConfigLiteral(tags: TagsExportConfig): string {
  return JSON.stringify(tags, null, 2);
}

function detectFormat(fileName: string): "fbx" | "gltf" | "obj" | "stl" | "svg" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".obj")) {
    return "obj";
  }
  if (lower.endsWith(".fbx")) {
    return "fbx";
  }
  if (lower.endsWith(".stl")) {
    return "stl";
  }
  if (lower.endsWith(".svg")) {
    return "svg";
  }
  return "gltf";
}

function buildUsageFile(
  params: Omit<AsciiEffectParams, "model">,
  preset: string,
  tags: TagsExportConfig,
  uploadedModel?: { dataUrl: string; fileName: string },
): string {
  const paramsLiteral = formatParamsLiteral(params);
  const tagsConfigLiteral = formatTagsConfigLiteral(tags);
  const canEmbedModel =
    uploadedModel !== undefined && uploadedModel.dataUrl.length <= MAX_INLINE_MODEL_BYTES;

  const modelSection = uploadedModel
    ? canEmbedModel
      ? `// The model uploaded in the studio ("${uploadedModel.fileName}") is small enough to
// inline below as a data URL. For anything larger, host the .glb/.gltf/.obj/.fbx/.stl/.svg
// file yourself and point "url" at it instead -- see the commented alternative.
const UPLOADED_MODEL_DATA_URL =
  ${JSON.stringify(uploadedModel.dataUrl)};

const model = {
  kind: "url" as const,
  url: UPLOADED_MODEL_DATA_URL,
  format: "${detectFormat(uploadedModel.fileName)}" as const,
};`
      : `// You uploaded "${uploadedModel.fileName}" in the studio. It is too large to
// inline into a source file -- host it (CDN, public/ folder, S3, etc.) and
// reference its URL here instead:
const model = {
  kind: "url" as const,
  url: "/models/${uploadedModel.fileName}",
  format: "${detectFormat(uploadedModel.fileName)}" as const,
};`
    : `// No model was uploaded in the studio, so this uses the built-in shape
// you had selected ("${preset}"). Swap this for your own model any time:
//   const model = { kind: "url" as const, url: "/models/your-model.glb", format: "gltf" as const };
const model = { kind: "preset" as const, preset: "${preset}" as const };`;

  return `/**
 * ASCII 3D Studio -- generated usage example.
 *
 * This file wires up AsciiEffect (the 3D/ASCII render) AND TrackingTagsOverlay
 * (the tag/label overlay) -- see ascii-effect.ts and tracking-tags-controller.ts
 * in this folder -- with the exact parameters and tags configured in the
 * studio, so this reproduces the live preview exactly, tags included. Copy
 * the whole folder into your project, run \`npm install three\`, and adapt
 * this file to however you mount canvases (React, Vue, plain DOM -- neither
 * class has a framework dependency). The camera is user-orbitable out of the
 * box (drag to rotate, via three's OrbitControls) with idle auto-rotate.
 */

import { AsciiEffect } from "./ascii-effect";
import { TrackingTagsOverlay } from "./tracking-tags-controller";
// Bundler CSS import (Vite/webpack/etc.). No bundler? Drop tracking-tags-overlay.css
// into your page with a plain <link rel="stylesheet" href="..."> instead.
import "./tracking-tags-overlay.css";

${modelSection}

// The tags/labels configured in the studio's "Tracking Tags" section --
// passed straight into TrackingTagsOverlay below. Edit this object (or call
// tagsOverlay.setConfig({ ... }) later) to change clusters/groups/tags,
// colors, or styling without touching the studio again.
const TAGS_CONFIG = ${tagsConfigLiteral};

// TrackingTagsOverlay needs a container element the same size as the canvas,
// with position: relative (or absolute/fixed) -- it positions its tag/square/
// line layer absolutely inside it. canvas.parentElement is used for sizing
// below already, so it's reused here too; give that element
// "position: relative" in your CSS (or swap in your own container).
const canvas = document.querySelector("canvas#ascii-3d")!;
const container = canvas.parentElement ?? document.body;
const effect = new AsciiEffect(canvas, {
  ...${paramsLiteral},
  model,
});
const tagsOverlay = new TrackingTagsOverlay(container, effect, TAGS_CONFIG);

function resize(): void {
  const { clientWidth, clientHeight } = canvas.parentElement ?? canvas;
  effect.setSize(clientWidth, clientHeight, window.devicePixelRatio || 1);
  tagsOverlay.refresh();
}

window.addEventListener("resize", resize);
resize();
effect.start();

// Drag-to-rotate and damped auto-rotate both work out of the box (OrbitControls
// is wired up inside AsciiEffect). Mouse-wheel zoom is intentionally disabled
// (controls.enableZoom = false inside AsciiEffect) -- in a page with normal
// scrolling that would hijack the scroll gesture for any visitor whose cursor
// happens to be over the canvas -- so zoom is exposed as an explicit parameter
// instead:
// effect.setParams({ distance: 2.5 });  // smaller = closer

canvas.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  effect.setPointer({
    x: (event.clientX - rect.left) / rect.width,
    y: 1 - (event.clientY - rect.top) / rect.height,
  });
});
canvas.addEventListener("pointerleave", () => effect.setPointer(null));

// effect.setParams({ characters: " .:-=+*#%@", fontFamily: "Georgia, serif" }); // live update
// effect.setModel({ kind: "preset", preset: "icosahedron" });                    // swap model
// tagsOverlay.setConfig({ tagScale: 1.4 });                                      // live update
//
// Cleanup -- only pass { forceContextLoss: true } if this canvas element is
// being discarded for good (e.g. removing this widget from the page
// permanently). Never do this if the same canvas might get a fresh
// AsciiEffect mounted on it again (React re-rendering the same node, hot
// reload, etc.) -- a lost WebGL context can't be reused, so the next
// AsciiEffect constructed on that element would fail to initialize. Safe
// default (omit the option, or pass false) if you're not sure:
// effect.stop(); effect.dispose({ forceContextLoss: true }); tagsOverlay.dispose();
`;
}

function buildReadme(uploadedModel?: { dataUrl: string; fileName: string }): string {
  return `# ASCII 3D Studio -- exported code

Generated from the live ASCII 3D configurator. This is plain Three.js --
no Toolcraft, no app-specific framework -- so it drops into any project.

## Files

- \`ascii-effect.ts\` -- the effect engine (render-to-texture 3D scene,
  luminance-to-glyph lookup, pointer heat trail, OrbitControls camera).
  This is the exact module that powered the live preview.
- \`shaders.ts\` -- the two GLSL passes it uses.
- \`glyph-atlas.ts\` -- builds a Canvas2D character strip texture from any
  font/character string.
- \`presets.ts\` -- the built-in placeholder geometries (torus knot,
  icosahedron, sphere).
- \`ascii-presets.ts\` -- the character-set and font presets shown in the
  studio's "Characters & Font" section.
- \`tag-cluster-types.ts\` -- the Clusters -> Groups -> Tags data model for
  the tag/label overlay.
- \`tag-cluster-anchors.ts\` -- turns that data into deterministic 3D anchor
  points on the object.
- \`tracking-tags-controller.ts\` -- \`TrackingTagsOverlay\`, the framework-free
  DOM/SVG overlay that projects those anchors through the live camera every
  frame and renders the tag pills/squares/lines. This is the exact same
  overlay feature shown in the studio ("Tracking Tags" section), ported to
  plain DOM APIs so it needs no React/Toolcraft to run here.
- \`tracking-tags-overlay.css\` -- static (non-module) CSS for the overlay's
  elements. Include it however your project loads CSS.
- \`usage-example.ts\` -- a minimal, framework-free example wired up with
  the parameters AND tags you had configured in the studio.

## Setup

\`\`\`bash
npm install three
\`\`\`

Then copy this folder into your project and import from \`usage-example.ts\`,
or use \`AsciiEffect\`/\`TrackingTagsOverlay\` directly:

\`\`\`ts
import { AsciiEffect } from "./ascii-effect";
import { TrackingTagsOverlay } from "./tracking-tags-controller";
import "./tracking-tags-overlay.css";

const effect = new AsciiEffect(canvasElement, { granularity: 12 });
effect.setSize(canvasElement.clientWidth, canvasElement.clientHeight, devicePixelRatio);
effect.start();

// containerElement must be the same size as canvasElement and have
// position: relative (or absolute/fixed) -- the overlay positions its tags
// absolutely inside it, e.g. canvasElement.parentElement.
const tagsOverlay = new TrackingTagsOverlay(containerElement, effect, {
  clusters: [], distanceToObject: 1.05, enabled: true,
  giantSquareColor: "#ffffff", giantSquareSize: 60, lineColor: "#ffffff",
  lineDashed: false, lineThickness: 1, paddingX: 4, paddingY: 6, tagScale: 1,
});
\`\`\`

## Interaction

- **Rotate**: drag on the canvas (three's \`OrbitControls\`, already wired up).
- **Auto-rotate**: on by default when idle; \`autoRotate\` / \`rotateSpeed\` params.
- **Zoom**: exposed as the \`distance\` param (min 1.6, max 8), not mouse wheel or
  pinch -- \`AsciiEffect\` explicitly disables \`OrbitControls\`' wheel/pinch zoom
  (\`controls.enableZoom = false\`) because binding it would hijack normal page
  scrolling for any visitor whose cursor happens to be over the canvas. Wire your
  own scroll/pinch handler that calls \`effect.setParams({ distance })\` if you
  want that specifically.
- **Pointer trail**: call \`effect.setPointer({ x, y })\` with normalized (0..1,
  y-up) canvas coordinates on \`pointermove\`, and \`effect.setPointer(null)\` on
  \`pointerleave\`.

## Tags overlay

\`TrackingTagsOverlay\` (in \`tracking-tags-controller.ts\`) reproduces the
studio's "Tracking Tags" feature exactly: one cluster of tags is active at a
time, cycling automatically as the object turns; every tag/square/line is
pinned to a real point on the object and reprojected through the live camera
every frame. \`usage-example.ts\` already wires it up with the clusters,
colors, and styling you had configured. Requirements:

- The container element passed to it (\`canvas.parentElement\` in the example)
  needs \`position: relative\` (or absolute/fixed) in your CSS -- the overlay
  positions its layer absolutely inside it, matching the canvas underneath.
- Include \`tracking-tags-overlay.css\` on the page (bundler import or a plain
  \`<link>\` tag).
- Call \`tagsOverlay.refresh()\` whenever the container is resized, same as
  \`effect.setSize(...)\` -- \`usage-example.ts\`'s \`resize()\` already does both.

## Custom models

\`AsciiEffect\` loads five formats, each via three's own loader: GLTF/GLB
(\`GLTFLoader\`), OBJ (\`OBJLoader\`), FBX (\`FBXLoader\`), STL (\`STLLoader\`), and
SVG (\`SVGLoader\`, extruded into 3D). Pass
\`{ kind: "url", url: "...", format: "gltf" | "obj" | "fbx" | "stl" | "svg" }\`
with a same-origin or CORS-enabled URL (or a data URL) to \`setModel\` / the
constructor's \`model\` param. Draco-compressed GLB and OBJ+MTL (external
material files) are not supported -- single-file, uncompressed geometry
only. STL carries no material/color data by design (it's a geometry-only
format), so STL models render with the same default material as the
built-in preset shapes, not per-file colors. SVG is 2D by design: each
filled path is extruded into a flat slab and colored from that path's own
fill; stroke-only (fill: none) paths are skipped rather than extruded as
invisible geometry. Extrude thickness is controlled by \`params.svgExtrudeDepth\`
(0.01-0.4, default 0.08) -- a ratio of the SVG's own bounding width/height,
not an absolute unit count, since source coordinate scales vary wildly and
the result is re-normalized to a fixed on-screen size regardless. Ignored
for every other format. Changing it re-runs the extrusion (\`setParams\`
detects the change and calls \`setModel\` again), so it's safe to drive from
a live control, not just a one-time constructor value.
${
  uploadedModel
    ? `\nThe model you uploaded in the studio, \`${uploadedModel.fileName}\`, is
referenced from \`usage-example.ts\` -- see the comment there for whether it
was inlined or needs hosting.`
    : ""
}

## API surface

\`\`\`ts
new AsciiEffect(canvas, params?)
effect.setParams(partialParams)             // includes distance, fontFamily, characters, colors, ...
effect.setModel({ kind: "preset", preset } | { kind: "url", url, format })
effect.setSize(cssWidth, cssHeight, pixelRatio)
effect.setPointer({ x, y } | null)          // normalized 0..1, y-up
effect.start() / effect.stop()
effect.dispose(options?)                    // { forceContextLoss?: boolean }, default false -- see comment above

new TrackingTagsOverlay(container, effect, config)
tagsOverlay.setConfig(partialConfig)        // clusters (incl. per-group color), distanceToObject, styling, ...
tagsOverlay.refresh()                       // call after the container resizes
tagsOverlay.dispose()
\`\`\`
`;
}

/**
 * Builds a downloadable .zip containing the framework-agnostic ASCII
 * effect engine, the tag/label overlay, and a usage example pre-filled with
 * the studio's current parameters AND tags, so it can be handed directly to
 * engineers and reproduces the live preview exactly.
 */
export async function buildCodeExportZip(state: ToolcraftState): Promise<Blob> {
  const { params, preset, uploadedModel } = readState(state);
  const tags = readTagsState(state);
  const zip = new JSZip();
  const folder = zip.folder("ascii-3d-studio-export") ?? zip;

  folder.file("ascii-effect.ts", asciiEffectSource);
  folder.file("shaders.ts", shadersSource);
  folder.file("glyph-atlas.ts", glyphAtlasSource);
  folder.file("presets.ts", presetsSource);
  folder.file("ascii-presets.ts", asciiPresetsSource);
  folder.file("tag-cluster-types.ts", tagClusterTypesSource);
  folder.file("tag-cluster-anchors.ts", tagClusterAnchorsSource);
  folder.file("tracking-tags-controller.ts", trackingTagsControllerSource);
  folder.file("tracking-tags-overlay.css", trackingTagsCssSource);
  folder.file("usage-example.ts", buildUsageFile(params, preset, tags, uploadedModel));
  folder.file("README.md", buildReadme(uploadedModel));

  return zip.generateAsync({ type: "blob" });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
