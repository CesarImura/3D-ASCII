import { defineToolcraft } from "@/toolcraft/runtime";

import {
  ASCII_CHARACTER_PRESET_LABELS,
  ASCII_FONT_PRESET_LABELS,
} from "./ascii-engine/ascii-presets";
import { DEFAULT_TAG_CLUSTERS } from "./tracking-tags/tag-cluster-defaults";

const MODEL_SHAPE_OPTIONS = [
  { label: "Key", value: "key" },
  { label: "Torus", value: "torus" },
  { label: "Circle", value: "circle" },
  { label: "Square", value: "square" },
  { label: "Custom", value: "custom" },
] as const;

const CHARACTER_PRESET_OPTIONS = [
  ...Object.entries(ASCII_CHARACTER_PRESET_LABELS).map(([value, label]) => ({ label, value })),
  { label: "Custom", value: "custom" },
];

const FONT_PRESET_OPTIONS = Object.entries(ASCII_FONT_PRESET_LABELS).map(([value, label]) => ({
  label,
  value,
}));

export const appSchema = defineToolcraft({
  canvas: {
    draggable: false,
    enabled: true,
    renderScale: true,
    sizing: { mode: "editable-output" },
    upload: true,
  },
  panels: {
    controls: {
      sections: [
        {
          controls: {
            shape: {
              defaultValue: "key",
              label: "Shape",
              options: [...MODEL_SHAPE_OPTIONS],
              orderRole: "primary",
              target: "model.shape",
              type: "select",
            },
          },
          title: "Shape",
        },
        {
          controls: {
            source: {
              accept: ".glb,.gltf,.obj,.fbx,.stl,.svg,model/gltf-binary,model/gltf+json,image/svg+xml",
              assetKind: "file",
              defaultValue: null,
              description:
                "Single-file formats only: GLB (binary glTF), OBJ without a separate .mtl, FBX, STL, or SVG. A .gltf that references external .bin/texture files will fail to load. STL carries no material/color data, so it renders with the same default material as the built-in shapes. SVG is extruded into a flat 3D slab, keeping each shape's own fill color; stroke-only (unfilled) paths are skipped.",
              label: "Upload model",
              orderRole: "input",
              target: "model.source",
              type: "fileDrop",
            },
          },
          title: "Custom Model",
          visibleWhen: { equals: "custom", target: "model.shape" },
        },
        {
          // A fileDrop control cannot share a section with sibling controls
          // (confirmed empirically: a slider placed alongside the "Custom
          // Model" section's `source` fileDrop silently dropped the
          // fileDrop control from the resolved schema at runtime). This
          // section exists purely because of that structural constraint,
          // not because extrude depth is a separate product entity from the
          // custom model upload above it -- same visibleWhen, same semantic
          // scope (this one upload), split only because the component
          // system requires it. Titled distinctly from "Custom Model"
          // (rather than reusing that title) to avoid two identical section
          // headers stacked back-to-back, matching how "Camera" (section)
          // and "Zoom" (its one control) are already named differently
          // elsewhere in this schema.
          controls: {
            svgExtrudeDepth: {
              defaultValue: 0.08,
              description:
                "SVG uploads only, ignored for every other format. How thick the extruded slab is, relative to the SVG's own width/height -- higher reads as a chunkier keycap/coaster, lower stays closer to a flat plaque.",
              label: "Depth",
              max: 0.4,
              min: 0.01,
              orderRole: "strength",
              sliderValueKind: "continuous",
              step: 0.01,
              target: "model.svgExtrudeDepth",
              type: "slider",
            },
          },
          title: "Model Extrusion",
          visibleWhen: { equals: "custom", target: "model.shape" },
        },
        {
          controls: {
            tiltX: {
              defaultValue: -34,
              description:
                "A fixed base angle for the object -- e.g. tilt it like a key on a ring before auto-rotate or dragging spins it. This doesn't move the camera.",
              label: "Tilt X",
              max: 180,
              min: -180,
              orderRole: "spatial",
              sliderValueKind: "continuous",
              step: 1,
              target: "model.tiltX",
              type: "slider",
              unit: "\u00b0",
            },
            tiltY: {
              defaultValue: 0,
              label: "Tilt Y",
              max: 180,
              min: -180,
              orderRole: "spatial",
              sliderValueKind: "continuous",
              step: 1,
              target: "model.tiltY",
              type: "slider",
              unit: "\u00b0",
            },
            tiltZ: {
              defaultValue: 0,
              label: "Tilt Z",
              max: 180,
              min: -180,
              orderRole: "spatial",
              sliderValueKind: "continuous",
              step: 1,
              target: "model.tiltZ",
              type: "slider",
              unit: "\u00b0",
            },
          },
          title: "Orientation",
        },
        {
          controls: {
            distance: {
              defaultValue: 6.8,
              description:
                "The reliable way to zoom -- drag on the model to orbit it; scroll/pinch over the canvas is reserved by the app's own pan-and-zoom, so it doesn't reach the 3D camera.",
              label: "Zoom",
              max: 8,
              min: 1.6,
              orderRole: "primary",
              sliderValueKind: "continuous",
              step: 0.1,
              target: "camera.distance",
              type: "slider",
            },
          },
          title: "Camera",
        },
        {
          controls: {
            autoRotate: {
              defaultValue: true,
              description: "Idle spin. Dragging the model always works, on top of this.",
              label: "Auto-rotate",
              orderRole: "primary",
              target: "motion.autoRotate",
              type: "switch",
            },
            rotateSpeed: {
              defaultValue: 0.45,
              label: "Rotate speed",
              max: 2,
              min: 0,
              orderRole: "strength",
              sliderValueKind: "continuous",
              step: 0.05,
              target: "motion.rotateSpeed",
              type: "slider",
              visibleWhen: { equals: true, target: "motion.autoRotate" },
            },
            trail: {
              defaultValue: false,
              description: "Accents glyphs near your cursor with the trail color.",
              label: "Mouse trail",
              orderRole: "primary",
              target: "motion.mouseTrail",
              type: "switch",
            },
            trailIntensity: {
              defaultValue: 0,
              label: "Mouse trail strength",
              max: 1,
              min: 0,
              orderRole: "strength",
              sliderValueKind: "continuous",
              step: 0.05,
              target: "motion.mouseTrailIntensity",
              type: "slider",
              visibleWhen: { equals: true, target: "motion.mouseTrail" },
            },
          },
          title: "Motion",
        },
        {
          controls: {
            granularity: {
              defaultValue: 27,
              label: "Grid size",
              max: 32,
              min: 4,
              orderRole: "primary",
              sliderValueKind: "continuous",
              step: 1,
              target: "ascii.granularity",
              type: "slider",
              unit: "px",
            },
            glyphSize: {
              defaultValue: 55,
              label: "Glyph weight",
              max: 64,
              min: 20,
              orderRole: "detail",
              sliderValueKind: "continuous",
              step: 1,
              target: "ascii.glyphSize",
              type: "slider",
              unit: "px",
            },
            invert: {
              defaultValue: false,
              label: "Invert",
              orderRole: "mode",
              target: "ascii.invert",
              type: "switch",
            },
            fillCells: {
              defaultValue: false,
              description: "Blend solid coverage under each glyph instead of transparent gaps.",
              label: "Fill cells",
              orderRole: "mode",
              target: "ascii.fillCells",
              type: "switch",
            },
            greyscaleIntensity: {
              defaultValue: 0.55,
              description:
                "How much glyphs are tinted by scene brightness -- 0 is a flat color, 1 fully follows scene luminance.",
              label: "Greyscale luminance",
              max: 1,
              min: 0,
              orderRole: "mode",
              sliderValueKind: "continuous",
              step: 0.05,
              target: "ascii.greyscaleIntensity",
              type: "slider",
            },
          },
          title: "ASCII Grid",
        },
        {
          controls: {
            characterPreset: {
              defaultValue: "detailed",
              label: "Character set",
              options: CHARACTER_PRESET_OPTIONS,
              orderRole: "primary",
              target: "ascii.characterPreset",
              type: "select",
            },
            characters: {
              commitMode: "content",
              defaultValue: " .:-=+*#%@",
              description: "Ramp from empty space to solid, dark tone to light tone.",
              label: "Custom characters",
              orderRole: "input",
              target: "ascii.characters",
              textValueKind: "single-line",
              type: "text",
              visibleWhen: { equals: "custom", target: "ascii.characterPreset" },
            },
            fontPreset: {
              defaultValue: "systemMono",
              label: "Font",
              options: FONT_PRESET_OPTIONS,
              orderRole: "mode",
              target: "ascii.fontPreset",
              type: "select",
            },
          },
          title: "Characters & Font",
        },
        {
          controls: {
            color: {
              defaultValue: "#eaeaea",
              label: "Glyph color",
              orderRole: "color",
              target: "appearance.color",
              type: "color",
            },
            accentColor: {
              defaultValue: "#5ee6a8",
              label: "Trail accent",
              orderRole: "color",
              target: "appearance.accentColor",
              type: "color",
            },
            brightness: {
              defaultValue: 0.1,
              description:
                "Lifts the object's own glyphs -- push it further to keep characters readable in the model's darkest shaded areas without touching the background.",
              label: "Brightness",
              max: 1,
              min: -1,
              orderRole: "strength",
              sliderValueKind: "continuous",
              step: 0.01,
              target: "appearance.brightness",
              type: "slider",
            },
          },
          title: "Appearance",
        },
        {
          controls: {
            enabled: {
              defaultValue: true,
              description:
                "Floating labels that track the object as it turns -- HTML overlay on top of the canvas, not part of the 3D render.",
              label: "Show tracking tags",
              orderRole: "primary",
              target: "tags.enabled",
              type: "switch",
            },
            clusters: {
              defaultValue: DEFAULT_TAG_CLUSTERS,
              description:
                "Clusters are everything shown at once -- only one cluster is active at a time, and which one cycles automatically as the object turns (360° split evenly across your clusters). Groups are tags that cluster together at one spot on the object, each with its own color for its filled tags. Tags are the labels themselves.",
              label: "Tags",
              orderRole: "input",
              target: "tags.clusters",
              type: "tagClusters",
              visibleWhen: { equals: true, target: "tags.enabled" },
            },
            size: {
              defaultValue: 1,
              description: "Scales every tag's text size.",
              label: "Tag size",
              max: 3,
              min: 0.5,
              orderRole: "detail",
              sliderValueKind: "continuous",
              step: 0.1,
              target: "tags.size",
              type: "slider",
              visibleWhen: { equals: true, target: "tags.enabled" },
            },
            paddingX: {
              defaultValue: 4,
              description: "Horizontal padding inside every tag pill, independent of text size.",
              label: "Tag padding X",
              max: 20,
              min: 0,
              orderRole: "detail",
              sliderValueKind: "continuous",
              step: 1,
              target: "tags.paddingX",
              type: "slider",
              unit: "px",
              visibleWhen: { equals: true, target: "tags.enabled" },
            },
            paddingY: {
              defaultValue: 6,
              description: "Vertical padding inside every tag pill, independent of text size.",
              label: "Tag padding Y",
              max: 20,
              min: 0,
              orderRole: "detail",
              sliderValueKind: "continuous",
              step: 1,
              target: "tags.paddingY",
              type: "slider",
              unit: "px",
              visibleWhen: { equals: true, target: "tags.enabled" },
            },
            distanceToObject: {
              defaultValue: 1.05,
              description:
                "How far tags/lines/squares sit from the object's center -- lower values deliberately let them overlap the object's own silhouette.",
              label: "Distance to object",
              max: 2.2,
              min: 0.5,
              orderRole: "detail",
              sliderValueKind: "continuous",
              step: 0.05,
              target: "tags.distanceToObject",
              type: "slider",
              visibleWhen: { equals: true, target: "tags.enabled" },
            },
            giantSquareSize: {
              defaultValue: 60,
              description:
                "Size of the large tracking-square marker a cluster can show at its overall center point.",
              label: "Giant square size",
              max: 200,
              min: 20,
              orderRole: "detail",
              sliderValueKind: "continuous",
              step: 2,
              target: "tags.squareSize",
              type: "slider",
              unit: "px",
              visibleWhen: { equals: true, target: "tags.enabled" },
            },
            giantSquareColor: {
              defaultValue: "#ffffff",
              label: "Giant square color",
              orderRole: "color",
              target: "tags.squareColor",
              type: "color",
              visibleWhen: { equals: true, target: "tags.enabled" },
            },
            lineColor: {
              defaultValue: "#ffffff",
              label: "Line color",
              orderRole: "color",
              target: "tags.lineColor",
              type: "color",
              visibleWhen: { equals: true, target: "tags.enabled" },
            },
            lineThickness: {
              defaultValue: 1,
              label: "Line thickness",
              max: 4,
              min: 0.5,
              orderRole: "detail",
              sliderValueKind: "continuous",
              step: 0.5,
              target: "tags.lineThickness",
              type: "slider",
              unit: "px",
              visibleWhen: { equals: true, target: "tags.enabled" },
            },
            lineStyle: {
              defaultValue: "solid",
              label: "Line style",
              options: [
                { label: "Solid", value: "solid" },
                { label: "Dashed", value: "dashed" },
              ],
              orderRole: "mode",
              target: "tags.lineStyle",
              type: "select",
              visibleWhen: { equals: true, target: "tags.enabled" },
            },
          },
          title: "Tracking Tags",
        },
        {
          controls: {
            includeBackground: {
              defaultValue: true,
              label: "Include",
              target: "export.includeBackground",
              type: "switch",
            },
            background: {
              defaultValue: "#0b0b0c",
              label: false,
              target: "appearance.background",
              type: "color",
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["includeBackground", "background"],
              layout: "inline",
            },
          ],
          title: "Background",
        },
        {
          controls: {
            imageFormat: {
              defaultValue: "png",
              label: "Format",
              options: [
                { label: "PNG", value: "png" },
                { label: "JPG", value: "jpg" },
              ],
              target: "export.image.format",
              type: "select",
            },
            imageResolution: {
              defaultValue: "4k",
              label: "Resolution",
              options: [
                { label: "2K", value: "2k" },
                { label: "4K", value: "4k" },
                { label: "8K", value: "8k" },
              ],
              target: "export.image.resolution",
              type: "select",
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["imageFormat", "imageResolution"],
              layout: "inline",
            },
          ],
          title: "Image Export",
        },
        {
          controls: {
            videoFormat: {
              defaultValue: "mp4",
              label: "Format",
              options: [
                { label: "MP4", value: "mp4" },
                { label: "WebM", value: "webm" },
                { label: "GIF", value: "gif" },
              ],
              target: "export.video.format",
              type: "select",
            },
            videoResolution: {
              defaultValue: "current",
              label: "Resolution",
              options: [
                { label: "Current", value: "current" },
                { label: "4K", value: "4k" },
              ],
              target: "export.video.resolution",
              type: "select",
            },
            videoLayers: {
              defaultValue: "combined",
              description:
                "Separate exports a zip with two videos in the chosen format: the ASCII (no tags) and the tags alone, both on the Background color (set it to green to chroma-key). Both come from the same frames, so they line up frame-for-frame in your editor.",
              label: "Layers",
              options: [
                { label: "Combined", value: "combined" },
                { label: "Separate (ASCII + tags)", value: "separate" },
              ],
              target: "export.video.layers",
              type: "select",
              visibleWhen: { equals: true, target: "tags.enabled" },
            },
            videoLength: {
              defaultValue: "loop",
              description:
                "Seamless loop records exactly one full turn at the current Rotate speed, so the video loops with no jump. Custom records a set number of seconds.",
              label: "Length",
              options: [
                { label: "Seamless loop (1 turn)", value: "loop" },
                { label: "Custom", value: "custom" },
              ],
              target: "export.video.length",
              type: "select",
            },
            videoDuration: {
              defaultValue: 8,
              label: "Duration",
              max: 60,
              min: 1,
              sliderValueKind: "continuous",
              step: 1,
              target: "export.video.duration",
              type: "slider",
              unit: "s",
              visibleWhen: { equals: "custom", target: "export.video.length" },
            },
            videoFps: {
              defaultValue: "30",
              description: "GIF always exports at 20 fps and max 720px to keep file size sane.",
              label: "Frame rate",
              options: [
                { label: "30 fps", value: "30" },
                { label: "60 fps", value: "60" },
              ],
              target: "export.video.fps",
              type: "select",
              visibleWhen: { notEquals: "gif", target: "export.video.format" },
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["videoFormat", "videoResolution"],
              layout: "inline",
            },
          ],
          title: "Video Export",
        },
        {
          controls: {
            outputActions: {
              actions: [
                {
                  icon: "upload-simple",
                  label: "Export Video",
                  role: "export-video",
                  value: "export.video",
                },
                {
                  icon: "upload-simple",
                  label: "Export PNG",
                  role: "export-image",
                  value: "export.png",
                },
                {
                  icon: "download-simple",
                  label: "Export Code",
                  value: "export.code",
                },
              ],
              target: "actions.output",
              type: "panelActions",
            },
          },
          title: "Export",
        },
      ],
      title: "Controls",
    },
  },
  persistence: {
    include: ["values", "canvas", "panels", "media"],
    key: "toolcraft:ascii-3d-studio:state:v1",
    storage: "localStorage",
    version: 1,
  },
  settingsTransfer: "auto",
  toolbar: {
    history: true,
    radar: true,
    theme: true,
    zoom: true,
  },
});
