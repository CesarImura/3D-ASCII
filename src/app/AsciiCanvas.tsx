"use client";

import * as React from "react";

import { useToolcraft, useToolcraftValue } from "@/toolcraft/runtime/react";

import {
  ASCII_CHARACTER_PRESETS,
  ASCII_FONT_PRESETS,
  type AsciiCharacterPresetId,
  type AsciiFontPresetId,
} from "./ascii-engine/ascii-presets";
import { AsciiEffect, type AsciiModelSource } from "./ascii-engine/ascii-effect";
import type { PresetShapeId } from "./ascii-engine/presets";
import { DEFAULT_KEY_MODEL_DATA_URL } from "./model-defaults";
import { DEFAULT_TAG_CLUSTERS } from "./tracking-tags/tag-cluster-defaults";
import { resolveGroupColor, resolveTagColorOverride, type ClusterDef } from "./ascii-engine/tag-cluster-types";
import { TrackingTagsOverlay } from "./tracking-tags/tracking-tags-overlay";
import { useTrackingTags } from "./tracking-tags/use-tracking-tags";

const MODEL_SOURCE_TARGET = "model.source";
const PRESET_SHAPE_IDS: readonly PresetShapeId[] = ["torus", "circle", "square"];

/**
 * Module-level handle to the live effect instance, so sticky footer panel
 * actions (Export PNG, Export Code) can reach the current canvas/params
 * without threading refs through the Toolcraft composition layer.
 */
export const activeAsciiEffect: { current: AsciiEffect | null } = { current: null };

function detectModelFormat(fileName: string): "fbx" | "gltf" | "obj" | "stl" | "svg" {
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

function readModelSource(
  shape: string,
  uploaded: { dataUrl: string; fileName: string } | undefined,
): AsciiModelSource {
  if (shape === "custom") {
    if (uploaded) {
      return { format: detectModelFormat(uploaded.fileName), kind: "url", url: uploaded.dataUrl };
    }
    // "Custom" chosen but nothing uploaded yet -- show a preset rather than
    // an empty scene until the user actually drops a file in.
    return { kind: "preset", preset: "torus" };
  }

  if (shape === "key") {
    // The app's standard default shape -- embedded as a data URL (see
    // model-defaults.ts) so it renders with zero setup, no upload needed.
    return { format: "obj", kind: "url", url: DEFAULT_KEY_MODEL_DATA_URL };
  }

  const presetId = PRESET_SHAPE_IDS.includes(shape as PresetShapeId)
    ? (shape as PresetShapeId)
    : "torus";
  return { kind: "preset", preset: presetId };
}

function resolveCharacters(preset: string, customCharacters: string): string {
  if (preset === "custom") {
    return customCharacters || " .:-=+*#%@";
  }
  return ASCII_CHARACTER_PRESETS[preset as AsciiCharacterPresetId] ?? ASCII_CHARACTER_PRESETS.classic;
}

function resolveFontFamily(preset: string): string {
  return ASCII_FONT_PRESETS[preset as AsciiFontPresetId] ?? ASCII_FONT_PRESETS.systemMono;
}

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

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

// Toolcraft's `color` control only stores a plain hex string until the
// picker itself is used -- once a user actually edits a color, the runtime
// stores it as `{ hex: string }` instead (see
// `toolcraft/runtime/react/controls-panel/values/controls-panel-color-values.ts`'s
// `asColorValue`). Reading it with a naive `String(value)` for the object
// case produces the literal text "[object Object]" instead of the hex code
// -- this resolves either shape to a real hex string.
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


/**
 * Toolcraft-facing product renderer. Owns the `<canvas>` element and an
 * `AsciiEffect` instance, and keeps the effect's parameters in sync with
 * runtime schema state. All rendering logic itself lives in
 * `ascii-engine/ascii-effect.ts`, which has no Toolcraft/React dependency.
 */
export function AsciiCanvas(): React.JSX.Element {
  const { state } = useToolcraft();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const effectRef = React.useRef<AsciiEffect | null>(null);

  const modelShape = String(useToolcraftValue("model.shape") ?? "key");
  const granularity = Number(useToolcraftValue("ascii.granularity") ?? 12);
  const characterPreset = String(useToolcraftValue("ascii.characterPreset") ?? "classic");
  const customCharacters = String(useToolcraftValue("ascii.characters") ?? " .:-=+*#%@");
  const fontPreset = String(useToolcraftValue("ascii.fontPreset") ?? "systemMono");
  const glyphSize = Number(useToolcraftValue("ascii.glyphSize") ?? 46);
  const invert = Boolean(useToolcraftValue("ascii.invert") ?? false);
  const fillCells = Boolean(useToolcraftValue("ascii.fillCells") ?? false);
  const greyscaleIntensity = Number(useToolcraftValue("ascii.greyscaleIntensity") ?? 1);
  const color = resolveColorValue(useToolcraftValue("appearance.color"), "#eaeaea");
  const accentColor = resolveColorValue(useToolcraftValue("appearance.accentColor"), "#5ee6a8");
  const brightness = Number(useToolcraftValue("appearance.brightness") ?? 0);
  const background = resolveColorValue(useToolcraftValue("appearance.background"), "#0b0b0c");
  const includeBackground = Boolean(useToolcraftValue("export.includeBackground") ?? true);
  const autoRotate = Boolean(useToolcraftValue("motion.autoRotate") ?? true);
  const rotateSpeed = Number(useToolcraftValue("motion.rotateSpeed") ?? 0.35);
  const mouseTrail = Boolean(useToolcraftValue("motion.mouseTrail") ?? true);
  const mouseTrailIntensity = Number(useToolcraftValue("motion.mouseTrailIntensity") ?? 0.6);
  const distance = Number(useToolcraftValue("camera.distance") ?? 3.4);
  const tiltX = Number(useToolcraftValue("model.tiltX") ?? 0);
  const tiltY = Number(useToolcraftValue("model.tiltY") ?? 0);
  const tiltZ = Number(useToolcraftValue("model.tiltZ") ?? 0);
  const svgExtrudeDepth = Number(useToolcraftValue("model.svgExtrudeDepth") ?? 0.08);
  const renderScale = Number(useToolcraftValue("canvas.renderScale") ?? 1);
  const tagsEnabled = Boolean(useToolcraftValue("tags.enabled") ?? true);
  const tagsClustersRaw = useToolcraftValue("tags.clusters");
  const tagsSize = Number(useToolcraftValue("tags.size") ?? 1);
  const tagsPaddingX = Number(useToolcraftValue("tags.paddingX") ?? 4);
  const tagsPaddingY = Number(useToolcraftValue("tags.paddingY") ?? 6);
  const tagsDistanceToObject = Number(useToolcraftValue("tags.distanceToObject") ?? 1.05);
  const tagsGiantSquareSize = Number(useToolcraftValue("tags.squareSize") ?? 60);
  const tagsGiantSquareColor = resolveColorValue(useToolcraftValue("tags.squareColor"), "#ffffff");
  const tagsLineColor = resolveColorValue(useToolcraftValue("tags.lineColor"), "#ffffff");
  const tagsLineThickness = Number(useToolcraftValue("tags.lineThickness") ?? 1);
  const tagsLineStyle = String(useToolcraftValue("tags.lineStyle") ?? "solid");
  const chipRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const squareRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const lineRefs = React.useRef<Map<string, SVGLineElement>>(new Map());

  const characters = resolveCharacters(characterPreset, customCharacters);
  const fontFamily = resolveFontFamily(fontPreset);

  const uploadedModel = state.mediaAssets.find(
    (asset) => asset.sourceTarget === MODEL_SOURCE_TARGET,
  );
  const modelSource = readModelSource(
    modelShape,
    uploadedModel ? { dataUrl: uploadedModel.dataUrl, fileName: uploadedModel.fileName } : undefined,
  );
  const modelSourceKey =
    modelSource.kind === "url"
      ? `url:${modelSource.format}:${modelSource.url.length}`
      : `preset:${modelSource.preset}`;

  // Mount the effect once.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const effect = new AsciiEffect(canvas);
    effectRef.current = effect;
    activeAsciiEffect.current = effect;
    effect.start();

    return () => {
      effect.dispose();
      effectRef.current = null;
      if (activeAsciiEffect.current === effect) {
        activeAsciiEffect.current = null;
      }
    };
  }, []);

  // Keep params in sync every render (cheap: uniform writes only, no
  // reallocation unless characters/glyphSize/font/colors/model actually
  // changed -- see AsciiEffect.setParams).
  React.useEffect(() => {
    effectRef.current?.setParams({
      accentColor,
      autoRotate,
      background,
      brightness,
      characters,
      color,
      distance,
      fillCells,
      fontFamily,
      glyphSize,
      granularity,
      greyscaleIntensity,
      includeBackground,
      invert,
      model: modelSource,
      mouseTrail,
      mouseTrailIntensity,
      rotateSpeed,
      svgExtrudeDepth,
      tiltX,
      tiltY,
      tiltZ,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accentColor,
    autoRotate,
    background,
    brightness,
    characters,
    color,
    distance,
    fillCells,
    fontFamily,
    glyphSize,
    granularity,
    greyscaleIntensity,
    includeBackground,
    invert,
    modelSourceKey,
    mouseTrail,
    mouseTrailIntensity,
    rotateSpeed,
    svgExtrudeDepth,
    tiltX,
    tiltY,
    tiltZ,
  ]);

  React.useEffect(() => {
    const width = state.canvas.size.width;
    const height = state.canvas.size.height;
    effectRef.current?.setSize(width, height, renderScale);
  }, [state.canvas.size.width, state.canvas.size.height, renderScale]);

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = 1 - (event.clientY - rect.top) / rect.height;
    effectRef.current?.setPointer({ x, y });
  }, []);

  const handlePointerLeave = React.useCallback(() => {
    effectRef.current?.setPointer(null);
  }, []);

  const tagClusters = resolveTagClusters(tagsClustersRaw);
  const trackingRenderState = useTrackingTags({
    canvasHeight: state.canvas.size.height,
    canvasWidth: state.canvas.size.width,
    chipRefs,
    clusters: tagsEnabled ? tagClusters : [],
    distanceToObject: tagsDistanceToObject,
    effectRef,
    enabled: tagsEnabled,
    lineRefs,
    paddingX: tagsPaddingX,
    paddingY: tagsPaddingY,
    squareRefs,
    tagScale: tagsSize,
  });

  return (
    <div style={{ height: "100%", position: "relative", width: "100%" }}>
      <canvas
        data-toolcraft-product-output=""
        onPointerLeave={handlePointerLeave}
        onPointerMove={handlePointerMove}
        ref={canvasRef}
        style={{ display: "block", height: "100%", width: "100%" }}
      />
      <TrackingTagsOverlay
        activeClusterIndex={trackingRenderState.activeClusterIndex}
        chipRefs={chipRefs}
        giantSquareColor={tagsGiantSquareColor}
        giantSquareSize={tagsGiantSquareSize}
        lineColor={tagsLineColor}
        lineDashed={tagsLineStyle === "dashed"}
        lineRefs={lineRefs}
        lineThickness={tagsLineThickness}
        lines={trackingRenderState.lines}
        paddingX={tagsPaddingX}
        paddingY={tagsPaddingY}
        squareRefs={squareRefs}
        squares={trackingRenderState.squares}
        tagScale={tagsSize}
        tags={trackingRenderState.tags}
      />
    </div>
  );
}
