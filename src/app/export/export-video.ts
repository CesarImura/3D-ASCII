import { applyPalette, GIFEncoder, quantize } from "gifenc";
import JSZip from "jszip";
import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  type VideoCodec,
} from "mediabunny";

import { getToolcraftVideoExportSize, type ToolcraftState } from "@/toolcraft/runtime";

import type { AsciiEffect } from "../ascii-engine/ascii-effect";
import { readTagsState } from "./build-code-export";
import { VideoTagsLayer } from "./video-tags-layer";

/**
 * Offline, frame-by-frame video export (MP4 / WebM / GIF).
 *
 * Every frame is rendered deterministically: the live loop is paused, the
 * camera is posed at an exact azimuth for frame N (AsciiEffect
 * .renderCaptureFrame), the ASCII canvas plus the tag overlay are
 * composited onto a 2D frame canvas, and the frame is encoded with a
 * timestamp of N / fps. Encoding speed never affects motion speed or the
 * output duration.
 *
 * Length:
 *  - "loop": exactly one full 360 degree turn at the current Rotate speed,
 *    so the last frame flows straight into the first (seamless loop).
 *  - "custom": a user-set number of seconds at the current Rotate speed
 *    (no rotation if Auto-rotate is off).
 */

export type VideoExportFormat = "gif" | "mp4" | "webm";

export type VideoExportResult = { blob: Blob; extension: string };

export class VideoExportError extends Error {}

const GIF_FPS = 20; // GIF delays are in 1/100 s -- 20fps (50ms) is exact.
const GIF_MAX_LONG_EDGE = 720;
const MAX_LOOP_SECONDS = 120;
const MP4_CODECS: VideoCodec[] = ["avc", "hevc", "av1"];
const WEBM_CODECS: VideoCodec[] = ["vp9", "vp8", "av1"];

export type VideoLayersMode = "combined" | "separate";

function readLayersMode(state: ToolcraftState): VideoLayersMode {
  return String(state.values["export.video.layers"] ?? "combined") === "separate"
    ? "separate"
    : "combined";
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function readVideoFormat(state: ToolcraftState): VideoExportFormat {
  const value = String(state.values["export.video.format"] ?? "mp4");
  return value === "webm" || value === "gif" ? value : "mp4";
}

type FramePlan = {
  durationSeconds: number;
  fps: number;
  frameCount: number;
  radiansPerFrame: number;
};

function planFrames(
  effect: AsciiEffect,
  state: ToolcraftState,
  format: VideoExportFormat,
): FramePlan {
  const values = state.values;
  const fps = format === "gif" ? GIF_FPS : Number(values["export.video.fps"] ?? 30) === 60 ? 60 : 30;
  const lengthMode = String(values["export.video.length"] ?? "loop");

  // Same speed OrbitControls uses live: 2*PI/60 * (rotateSpeed * 6) rad/s.
  // Azimuth decreases over time, matching OrbitControls' auto-rotate direction.
  const rotateSpeed = Number(effect.getParams().rotateSpeed);

  if (lengthMode === "loop") {
    if (!(rotateSpeed > 0)) {
      throw new VideoExportError(
        "Seamless loop needs a Rotate speed above 0. Raise Motion > Rotate speed, or switch Length to Custom.",
      );
    }
    const radiansPerSecond = ((Math.PI * 2) / 60) * rotateSpeed * 6;
    const periodSeconds = (Math.PI * 2) / radiansPerSecond;
    if (periodSeconds > MAX_LOOP_SECONDS) {
      throw new VideoExportError(
        `One full rotation at this Rotate speed takes ${Math.round(periodSeconds)}s (max ${MAX_LOOP_SECONDS}s). Raise Rotate speed or switch Length to Custom.`,
      );
    }
    const frameCount = Math.max(2, Math.round(periodSeconds * fps));
    return {
      durationSeconds: frameCount / fps,
      fps,
      frameCount,
      // Exactly one turn over frameCount frames, so frame N == frame 0.
      radiansPerFrame: -(Math.PI * 2) / frameCount,
    };
  }

  const durationSeconds = Math.min(60, Math.max(1, Number(values["export.video.duration"] ?? 8)));
  const frameCount = Math.max(1, Math.round(durationSeconds * fps));
  return {
    durationSeconds: frameCount / fps,
    fps,
    frameCount,
    radiansPerFrame: -effect.getAutoRotateRadiansPerSecond() / fps,
  };
}

function outputSize(state: ToolcraftState, format: VideoExportFormat): { height: number; width: number } {
  const resolution = String(state.values["export.video.resolution"] ?? "current");
  const size = getToolcraftVideoExportSize({ resolution, state });
  if (format !== "gif") {
    return { height: size.height, width: size.width };
  }
  const longEdge = Math.max(size.width, size.height);
  const shrink = Math.min(1, GIF_MAX_LONG_EDGE / longEdge);
  return { height: even(size.height * shrink), width: even(size.width * shrink) };
}

type FrameSink = {
  addFrame: (index: number, plan: FramePlan) => Promise<void>;
  cancel: () => Promise<void>;
  finish: () => Promise<VideoExportResult>;
};

async function createVideoSink(
  frameCanvas: HTMLCanvasElement,
  format: "mp4" | "webm",
  fps: number,
): Promise<FrameSink> {
  if (typeof VideoEncoder === "undefined") {
    throw new VideoExportError(
      "This browser can't encode video (WebCodecs is unavailable). Use a recent Chrome, Edge or Safari, or export a GIF.",
    );
  }
  const candidates = format === "mp4" ? MP4_CODECS : WEBM_CODECS;
  const codec = await getFirstEncodableVideoCodec(candidates, {
    height: frameCanvas.height,
    width: frameCanvas.width,
  });
  if (!codec) {
    throw new VideoExportError(
      `This browser can't encode ${format.toUpperCase()} at ${frameCanvas.width}x${frameCanvas.height}. Try the other format, "Current" resolution, or GIF.`,
    );
  }

  const output = new Output({
    format: format === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(frameCanvas, { codec, quality: QUALITY_HIGH });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  return {
    addFrame: (index, plan) => source.add(index / plan.fps, 1 / plan.fps),
    cancel: async () => {
      await output.cancel();
    },
    finish: async () => {
      await output.finalize();
      const buffer = output.target.buffer;
      if (!buffer) {
        throw new VideoExportError("Video encoding produced no data.");
      }
      return {
        blob: new Blob([buffer], { type: format === "mp4" ? "video/mp4" : "video/webm" }),
        extension: format,
      };
    },
  };
}

function createGifSink(frameCanvas: HTMLCanvasElement): FrameSink {
  const context = frameCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new VideoExportError("GIF export requires a 2D canvas context.");
  }
  const gif = GIFEncoder();
  const delayMs = Math.round(1000 / GIF_FPS);

  return {
    addFrame: async (index) => {
      const { data, height, width } = context.getImageData(0, 0, frameCanvas.width, frameCanvas.height);
      const palette = quantize(data, 256);
      const indexed = applyPalette(data, palette);
      gif.writeFrame(indexed, width, height, {
        delay: delayMs,
        palette,
        ...(index === 0 ? { repeat: 0 } : {}),
      });
    },
    cancel: async () => {},
    finish: async () => {
      gif.finish();
      const bytes = gif.bytes();
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      return { blob: new Blob([copy.buffer], { type: "image/gif" }), extension: "gif" };
    },
  };
}

function buildLayersReadme({
  asciiFile,
  background,
  durationSeconds,
  fps,
  frameCount,
  height,
  tagsFile,
  width,
}: {
  asciiFile: string;
  background: string;
  durationSeconds: number;
  fps: number;
  frameCount: number;
  height: number;
  tagsFile: string;
  width: number;
}): string {
  return `ASCII 3D Studio -- separate layers export

Both videos were rendered from the SAME frames, so they line up exactly:
  fps:          ${fps}
  frames:       ${frameCount}
  duration:     ${durationSeconds.toFixed(3)} s
  size:         ${width} x ${height}
  background:   ${background.toUpperCase()} (both videos)

Files
  ${asciiFile}   ASCII layer, no tags
  ${tagsFile}    Tags layer only (tags, lines, squares), same background

How to combine (After Effects / Premiere / DaVinci / CapCut)
  1. Put ${asciiFile} on the bottom track and ${tagsFile} on the track above,
     both starting at 0:00 -- frame N of one matches frame N of the other.
  2. Key out ${background.toUpperCase()} on the tags track (Keylight / Ultra Key /
     3D Keyer / Chroma Key), or on either track you want to overlay.
`;
}

export async function exportVideo({
  effect,
  reportProgress,
  state,
}: {
  effect: AsciiEffect;
  reportProgress: (progress: number) => void;
  state: ToolcraftState;
}): Promise<VideoExportResult> {
  const format = readVideoFormat(state);
  const plan = planFrames(effect, state, format);
  const { height, width } = outputSize(state, format);
  const background = String(effect.getParams().background);
  const tagsConfig = readTagsState(state);
  // Separate layers only make sense when there are tags to separate.
  const separate = readLayersMode(state) === "separate" && tagsConfig.enabled;

  const frameCanvas = document.createElement("canvas");
  frameCanvas.width = width;
  frameCanvas.height = height;
  const frameContext = frameCanvas.getContext("2d", { willReadFrequently: format === "gif" });
  if (!frameContext) {
    throw new VideoExportError("Video export requires a 2D canvas context.");
  }

  // Tags layer canvas (separate mode): same size and same background color
  // as the ASCII frames (so it can be chroma-keyed), painted from the very
  // same capture frame.
  let tagsCanvas: HTMLCanvasElement | null = null;
  let tagsContext: CanvasRenderingContext2D | null = null;
  if (separate) {
    tagsCanvas = document.createElement("canvas");
    tagsCanvas.width = width;
    tagsCanvas.height = height;
    tagsContext = tagsCanvas.getContext("2d", { willReadFrequently: format === "gif" });
    if (!tagsContext) {
      throw new VideoExportError("Video export requires a 2D canvas context.");
    }
  }

  const sink =
    format === "gif" ? createGifSink(frameCanvas) : await createVideoSink(frameCanvas, format, plan.fps);

  // Tags video: same container/codec as the ASCII video.
  let tagsSink: FrameSink | null = null;
  if (separate && tagsCanvas) {
    try {
      tagsSink =
        format === "gif"
          ? createGifSink(tagsCanvas)
          : await createVideoSink(tagsCanvas, format, plan.fps);
    } catch (error) {
      await sink.cancel().catch(() => {});
      throw error;
    }
  }
  const zip = separate ? new JSZip() : null;

  const liveWidth = state.canvas.size.width;
  const liveHeight = state.canvas.size.height;
  const liveRenderScale = Number(state.values["canvas.renderScale"] ?? 1);
  const tagsLayer = tagsConfig.enabled
    ? new VideoTagsLayer(effect, tagsConfig, liveWidth, liveHeight)
    : null;

  const startAzimuth = effect.beginCapture();
  let finished = false;
  try {
    // Render at the SAME backing size as the live preview (canvas size x
    // Resolution scale), then scale into the output frame. Glyph density is
    // tied to backing pixels (granularity is in pixels), so rendering at the
    // output size instead would give a visibly coarser/finer character grid
    // than what's on screen.
    effect.setSize(
      Math.max(2, Math.round(liveWidth * liveRenderScale)),
      Math.max(2, Math.round(liveHeight * liveRenderScale)),
      1,
    );
    frameContext.imageSmoothingEnabled = true;
    frameContext.imageSmoothingQuality = "high";

    // Warm-up: run ~1s of frames leading into the start angle without
    // encoding them, so the tag overlay's position smoothing is already at
    // its steady-state lag on frame 0. Without this, frame 0 has zero lag
    // and the last frame has normal lag -- tags would jump at the loop seam.
    const warmupFrames = Math.min(plan.frameCount, plan.fps);
    for (let index = -warmupFrames; index < 0; index += 1) {
      effect.renderCaptureFrame(startAzimuth + plan.radiansPerFrame * index, 1 / plan.fps);
    }

    for (let index = 0; index < plan.frameCount; index += 1) {
      const timeSeconds = index / plan.fps;
      effect.renderCaptureFrame(startAzimuth + plan.radiansPerFrame * index, 1 / plan.fps);

      // Video keeps its background even when "Include" is off (MP4/GIF
      // have no alpha, and a transparent WebM would read as black in most
      // players).
      frameContext.globalAlpha = 1;
      frameContext.fillStyle = background;
      frameContext.fillRect(0, 0, width, height);
      frameContext.drawImage(effect.getCanvas(), 0, 0, width, height);

      if (tagsCanvas && tagsContext) {
        // Separate: tags go on their own canvas over the same background
        // color, from this same capture frame -- so frame N of both files is
        // the same moment.
        tagsContext.globalAlpha = 1;
        tagsContext.fillStyle = background;
        tagsContext.fillRect(0, 0, width, height);
        tagsLayer?.paint(tagsContext, width, height, timeSeconds);
        await tagsSink?.addFrame(index, plan);
      } else {
        tagsLayer?.paint(frameContext, width, height, timeSeconds);
      }

      await sink.addFrame(index, plan);
      reportProgress(((index + 1) / plan.frameCount) * (zip ? 0.95 : 1));
      if (index % 4 === 3) {
        await nextTask();
      }
    }

    const asciiResult = await sink.finish();
    if (!zip) {
      finished = true;
      return asciiResult;
    }

    const asciiFile = `ascii.${asciiResult.extension}`;
    zip.file(asciiFile, asciiResult.blob, { compression: "STORE" });
    if (!tagsSink) {
      throw new VideoExportError("Tags video encoder was not created.");
    }
    const tagsResult = await tagsSink.finish();
    const tagsFile = `tags.${tagsResult.extension}`;
    zip.file(tagsFile, tagsResult.blob, { compression: "STORE" });
    zip.file(
      "README.txt",
      buildLayersReadme({
        asciiFile,
        background,
        durationSeconds: plan.durationSeconds,
        fps: plan.fps,
        frameCount: plan.frameCount,
        height,
        tagsFile,
        width,
      }),
    );
    const blob = await zip.generateAsync({ type: "blob" });
    reportProgress(1);
    finished = true;
    return { blob, extension: "zip" };
  } finally {
    if (!finished) {
      await sink.cancel().catch(() => {});
      await tagsSink?.cancel().catch(() => {});
    }
    tagsLayer?.dispose();
    effect.setSize(liveWidth, liveHeight, liveRenderScale);
    effect.endCapture();
  }
}
