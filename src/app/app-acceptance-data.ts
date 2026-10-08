import type {
  ToolcraftComponentAcceptance,
  ToolcraftControlSectionInventoryEntry,
  ToolcraftProductReadiness,
  ToolcraftTransferMode,
} from "./acceptance/types";

export const appTransferMode: ToolcraftTransferMode = {
  animationIntent: {
    behaviorCoverage: [
      "no-duration-control",
      "no-export-at-time",
      "no-loop-control",
      "no-play-pause",
      "no-scrub",
      "no-user-facing-transport",
    ],
    mode: "autonomous",
    reason:
      "The model auto-rotates continuously and the pointer trail decays continuously; both are ambient decoration with no user-facing transport or scrubbing. Export Video renders offline from the same autonomous motion (camera posed per frame at a deterministic azimuth, timestamps = frame / fps), with its length set in the Video Export section rather than a top timeline.",
  },
  mode: "new-toolcraft-app",
};

export const appProductReadiness: ToolcraftProductReadiness = {
  mode: "product",
  productName: "ASCII 3D Studio",
  productSummary:
    "A configurator that renders a 3D model (built-in preset shape or an uploaded GLTF/GLB/OBJ/FBX/STL/SVG) as live ASCII art in the browser, with an interactive pointer trail, and exports both a PNG snapshot and a framework-agnostic Three.js code bundle for engineers to drop into their own project.",
  requestedBehavior:
    "Recreate the dragonfly.xyz live-ASCII-3D technique (WebGL scene rendered to a texture, quantized into a character grid, luminance mapped to a glyph atlas, with a pointer heat-trail) as an editable, general-purpose tool: every visual parameter is a live control, users can upload their own GLTF/GLB/OBJ/FBX/STL model (or an SVG, which is extruded into a 3D slab) in place of the built-in preset shapes, and a sticky Export Code action downloads the exact rendering engine plus a usage example pre-filled with the current settings so developers can reuse it outside this app.",
};

export const appAcceptance: readonly ToolcraftComponentAcceptance[] = [];

export const appControlSectionInventory: readonly ToolcraftControlSectionInventoryEntry[] = [
  {
    entity: "3D model source",
    groupingReason:
      "The single Shape selector (Key/Torus/Circle/Square/Custom) that drives what's rendered -- \"Key\" is the app's embedded standard-default model, selected out of the box.",
    targets: ["model.shape"],
    title: "Shape",
  },
  {
    entity: "3D model source",
    groupingReason:
      "Upload is a standalone FileDrop component (component-owned standalone layout) and cannot share a mixed-layout section with the grouped Shape Select, so it's a section-level visibleWhen-gated section that only appears once Shape is \"Custom\" -- from the user's perspective this behaves as one selector, not two competing controls.",
    targets: ["model.source"],
    title: "Custom Model",
  },
  {
    entity: "3D model source",
    groupingReason:
      "Extrude Depth (SVG uploads only, ignored for every other format) is semantically part of the custom model upload above it, not a separate product entity -- but a fileDrop control cannot share a section with sibling controls (confirmed empirically: adding this slider directly into the \"Custom Model\" section silently dropped the fileDrop control from the resolved schema), so it's forced into its own section, gated by the identical visibleWhen as \"Custom Model\" so the two always show/hide together.",
    targets: ["model.svgExtrudeDepth"],
    title: "Model Extrusion",
  },
  {
    entity: "Object base orientation",
    groupingReason:
      "A fixed X/Y/Z tilt applied to the object before any auto-rotate/drag rotation, so it can spin around a tilted axis instead of always upright.",
    targets: ["model.tiltX", "model.tiltY", "model.tiltZ"],
    title: "Orientation",
  },
  {
    entity: "Camera",
    groupingReason:
      "Camera distance is the one always-reliable zoom control; drag-to-rotate has no separate schema control since it's direct canvas interaction (OrbitControls), not a setting.",
    targets: ["camera.distance"],
    title: "Camera",
  },
  {
    entity: "Camera and pointer motion",
    groupingReason:
      "These controls tune the two autonomous/interactive motion sources: the auto-rotate loop and the pointer heat-trail. Drag-to-rotate itself is direct canvas interaction, not a schema control.",
    targets: [
      "motion.autoRotate",
      "motion.rotateSpeed",
      "motion.mouseTrail",
      "motion.mouseTrailIntensity",
    ],
    title: "Motion",
  },
  {
    entity: "ASCII conversion",
    groupingReason:
      "These controls configure how the rendered scene is quantized into cells and how luminance maps to glyph density.",
    targets: [
      "ascii.granularity",
      "ascii.glyphSize",
      "ascii.invert",
      "ascii.fillCells",
      "ascii.greyscaleIntensity",
    ],
    title: "ASCII Grid",
  },
  {
    entity: "Glyph character set and typography",
    groupingReason:
      "These controls choose which characters render (a preset ramp, or a custom one) and which font draws them; kept separate from ASCII Grid because that section is about quantization math, this one is about glyph content.",
    targets: ["ascii.characterPreset", "ascii.characters", "ascii.fontPreset"],
    title: "Characters & Font",
  },
  {
    entity: "Glyph and trail color",
    groupingReason:
      "These controls set the visible color palette and overall brightness of the ASCII output.",
    targets: ["appearance.color", "appearance.accentColor", "appearance.brightness"],
    title: "Appearance",
  },
  {
    entity: "Rotation-tracking label overlay",
    groupingReason:
      "These controls configure the floating HTML/SVG tag overlay that tracks real points on the object: whether it's shown, the nested Clusters/Groups/Tags structure (clusters are everything shown at once and cycle automatically as the object turns, each with its own distinct anchor layout on the object, and can show one large \"giant square\" marker at the cluster's overall center; groups are tags that cluster together at one spot on the object and can show a per-tag object-line from the closest point on the object's surface -- each with its own small square marker at that line's start -- plus chain connector lines between tags; tags are the labels, each independently filled (solid background in its group's color) or unfilled (plain white text, no background)), how close the whole layer sits to the object (small values let tags/lines/squares overlap its own silhouette on purpose), and the shared size/padding/thickness/style controls for tags, squares, and lines. Simultaneously visible tags are also passed through a lightweight per-frame separation pass so they don't visually overlap, and switching the active cluster plays a brief pop/flash transition instead of a hard cut. Rendered as a DOM/SVG overlay on top of the canvas whose every position is computed every frame from the live 3D camera projection, not part of the WebGL/ASCII shader output.",
    targets: [
      "tags.enabled",
      "tags.clusters",
      "tags.size",
      "tags.paddingX",
      "tags.paddingY",
      "tags.distanceToObject",
      "tags.squareSize",
      "tags.squareColor",
      "tags.lineColor",
      "tags.lineThickness",
      "tags.lineStyle",
    ],
    title: "Tracking Tags",
  },
  {
    entity: "Product background",
    groupingReason: "Required Background section: preview/export background visibility and color.",
    targets: ["export.includeBackground", "appearance.background"],
    title: "Background",
  },
  {
    entity: "PNG export settings",
    groupingReason: "Required Image Export section: still-image export format and resolution.",
    targets: ["export.image.format", "export.image.resolution"],
    title: "Image Export",
  },
  {
    entity: "Video export settings",
    groupingReason:
      "Video Export section: container format (MP4/WebM/GIF) and resolution as the standard inline pair, plus layers (combined, or separate ASCII video + tags-only video on the same background, zipped), length (seamless one-turn loop or custom seconds), custom duration, and frame rate. Rendered offline frame-by-frame with deterministic timestamps, tags overlay composited into every frame.",
    targets: [
      "export.video.format",
      "export.video.resolution",
      "export.video.layers",
      "export.video.length",
      "export.video.duration",
      "export.video.fps",
    ],
    title: "Video Export",
  },
];
