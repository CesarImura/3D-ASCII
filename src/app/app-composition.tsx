"use client";

import {
  createToolcraftPngExportCanvas,
  shouldIncludeToolcraftPreviewBackground,
  type ToolcraftState,
} from "@/toolcraft/runtime";
import type { ToolcraftAppComposition } from "@/toolcraft/runtime/react";

import { activeAsciiEffect, AsciiCanvas } from "./AsciiCanvas";
import { appSchema } from "./app-schema";
import { buildCodeExportZip, downloadBlob, readTagsState } from "./export/build-code-export";
import { exportVideo, VideoExportError } from "./export/export-video";
import { VideoTagsLayer } from "./export/video-tags-layer";
import { TagClustersControl } from "./tracking-tags/tag-clusters-control";

const IMAGE_MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
};

function exportPng(state: ToolcraftState): void {
  const effect = activeAsciiEffect.current;
  if (!effect) {
    return;
  }

  const liveWidth = state.canvas.size.width;
  const liveHeight = state.canvas.size.height;
  const liveRenderScale = Number(state.values["canvas.renderScale"] ?? 1);
  const resolution = state.values["export.image.resolution"];
  const format = String(state.values["export.image.format"] ?? "png");
  const mimeType = IMAGE_MIME_TYPES[format] ?? "image/png";
  const background = String(state.values["appearance.background"] ?? "#0b0b0c");
  const tagsConfig = readTagsState(state);

  let exportCanvas: HTMLCanvasElement;
  try {
    exportCanvas = createToolcraftPngExportCanvas({
      background,
      includeBackground: shouldIncludeToolcraftPreviewBackground({ state }),
      render: ({ context, cssHeight, cssWidth, pixelHeight, pixelWidth }) => {
        effect.setSize(pixelWidth, pixelHeight, 1);
        effect.renderOnce();
        context.drawImage(effect.getCanvas(), 0, 0, cssWidth, cssHeight);

        // The live tags are DOM over the WebGL canvas, so they are not in the
        // canvas pixels. Mount the same offscreen overlay the video export
        // uses: it subscribes to the current rotation, places the active
        // cluster at the exact projected anchors, and paints it into the PNG.
        if (tagsConfig.enabled) {
          const tagsLayer = new VideoTagsLayer(effect, tagsConfig, liveWidth, liveHeight);
          try {
            tagsLayer.paint(context, cssWidth, cssHeight, 0);
          } finally {
            tagsLayer.dispose();
          }
        }
      },
      resolution: typeof resolution === "string" ? resolution : undefined,
      state,
    });
  } finally {
    effect.setSize(liveWidth, liveHeight, liveRenderScale);
    effect.renderOnce();
  }

  exportCanvas.toBlob((blob) => {
    if (blob) {
      downloadBlob(blob, `ascii-3d-studio.${format === "jpg" ? "jpg" : "png"}`);
    }
  }, mimeType);
}

export const appComposition: ToolcraftAppComposition = {
  canvasContent: <AsciiCanvas />,
  controlRenderers: {
    tagClusters: TagClustersControl,
  },
  onPanelAction: async ({ action, reportProgress, state }) => {
    if (action.value === "export.video") {
      const effect = activeAsciiEffect.current;
      if (!effect) {
        return;
      }
      try {
        const { blob, extension } = await exportVideo({ effect, reportProgress, state });
        downloadBlob(blob, `ascii-3d-studio.${extension}`);
      } catch (error) {
        // The runtime only console-logs rejected panel actions, so surface
        // expected failures (unsupported codec, loop too long) to the user.
        const message =
          error instanceof VideoExportError
            ? error.message
            : "Video export failed. See the browser console for details.";
        window.alert(message);
        throw error;
      }
      return;
    }

    if (action.value === "export.png") {
      exportPng(state);
      return;
    }

    if (action.value === "export.code") {
      const blob = await buildCodeExportZip(state);
      downloadBlob(blob, "ascii-3d-studio-export.zip");
    }
  },
  renderDefaultCanvasMedia: false,
  schema: appSchema,
};
