import "../ascii-engine/tracking-tags-overlay.css";

import type { AsciiEffect } from "../ascii-engine/ascii-effect";
import {
  TrackingTagsOverlay,
  type TrackingTagsConfig,
} from "../ascii-engine/tracking-tags-controller";

/**
 * Renders the tracking-tag overlay INTO video frames.
 *
 * The live tags are HTML/SVG on top of the WebGL canvas, so they never
 * appear in the canvas pixels a video encoder sees. For export we mount a
 * second, hidden instance of the framework-agnostic `TrackingTagsOverlay`
 * (the exact class shipped in Export Code -- same anchors, smoothing,
 * overlap avoidance and cluster cycling as the live studio) in an offscreen
 * container sized like the product canvas. It updates synchronously on
 * every `renderCaptureFrame` (via `subscribeRotation`), and `paint()` then
 * draws its current DOM state onto the frame's 2D canvas.
 *
 * CSS entrance animations are fast-forwarded to their end state (Web
 * Animations API) before every paint and re-created deterministically from
 * video time instead, so the cluster-switch pop/flash looks identical no
 * matter how fast frames are encoded.
 */

const CAPTURE_ATTR = "data-ascii-video-capture";
const LAYER_FLASH_SECONDS = 0.26;
const ELEMENT_ENTER_SECONDS = 0.18;

// Approximates CSS `ease-out` (cubic-bezier(0, 0, 0.58, 1)).
function easeOut(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return 1 - (1 - p) * (1 - p);
}

function parsePx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePercent(value: string | null, size: number): number {
  if (!value) {
    return size / 2;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return size / 2;
  }
  return value.trim().endsWith("%") ? (parsed / 100) * size : parsed;
}

function isTransparent(color: string): boolean {
  return color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color.replace(/\s+/g, " "));
}

export class VideoTagsLayer {
  private readonly container: HTMLDivElement;
  private readonly overlay: TrackingTagsOverlay;
  private lastFirstElement: Element | null = null;
  private switchTimeSeconds = 0;

  constructor(
    effect: AsciiEffect,
    config: TrackingTagsConfig,
    cssWidth: number,
    cssHeight: number,
  ) {
    const container = document.createElement("div");
    container.setAttribute(CAPTURE_ATTR, "");
    container.setAttribute("aria-hidden", "true");
    Object.assign(container.style, {
      height: `${cssHeight}px`,
      left: "-100000px",
      overflow: "visible",
      pointerEvents: "none",
      position: "fixed",
      top: "0px",
      width: `${cssWidth}px`,
    });
    document.body.appendChild(container);
    this.container = container;
    this.overlay = new TrackingTagsOverlay(container, effect, config);
  }

  dispose(): void {
    this.overlay.dispose();
    this.container.remove();
  }

  /** Draws the overlay's current state, scaled to the output frame size. */
  paint(ctx: CanvasRenderingContext2D, outWidth: number, outHeight: number, timeSeconds: number): void {
    const layer = this.container.querySelector<HTMLElement>(".tt-layer");
    if (!layer) {
      return;
    }

    // Jump every CSS entrance animation to its final state so rects/opacity
    // are read un-animated; the entrance is re-applied below from video time.
    for (const animation of layer.getAnimations({ subtree: true })) {
      animation.finish();
    }

    const containerRect = this.container.getBoundingClientRect();
    const cssWidth = containerRect.width || 1;
    const cssHeight = containerRect.height || 1;
    const scale = outWidth / cssWidth;
    const scaleY = outHeight / cssHeight;

    // Cluster switches replace every child of the layer; a new first child
    // marks the switch moment for the deterministic entrance animation.
    // The cluster already showing when capture starts is NOT animated in --
    // otherwise frame 0 of a seamless loop would have no tags while the
    // last frame does, and the loop would visibly pop at the seam.
    const firstElement = layer.firstElementChild;
    if (firstElement !== this.lastFirstElement) {
      this.switchTimeSeconds =
        this.lastFirstElement === null ? Number.NEGATIVE_INFINITY : timeSeconds;
      this.lastFirstElement = firstElement;
    }
    const sinceSwitch = timeSeconds - this.switchTimeSeconds;
    const flash = easeOut(sinceSwitch / LAYER_FLASH_SECONDS);
    const layerAlpha = flash;
    const layerScale = 0.985 + 0.015 * flash;
    const elementScale = 0.85 + 0.15 * easeOut(sinceSwitch / ELEMENT_ENTER_SECONDS);

    if (layerAlpha <= 0) {
      return;
    }

    ctx.save();
    ctx.globalAlpha = layerAlpha;
    ctx.translate(outWidth / 2, outHeight / 2);
    ctx.scale(layerScale, layerScale);
    ctx.translate(-outWidth / 2, -outHeight / 2);

    // Back to front, matching the CSS z-index order: lines, line-origin
    // squares, giant square, chips.
    layer.querySelectorAll<SVGLineElement>("line").forEach((line) => {
      this.paintLine(ctx, line, outWidth, outHeight, scale);
    });
    layer.querySelectorAll<HTMLElement>(".tt-square-line-origin").forEach((el) => {
      this.paintSquare(ctx, el, containerRect, scale, scaleY, elementScale, false);
    });
    layer.querySelectorAll<HTMLElement>(".tt-square-giant").forEach((el) => {
      this.paintSquare(ctx, el, containerRect, scale, scaleY, elementScale, true);
    });
    layer.querySelectorAll<HTMLElement>(".tt-chip-filled, .tt-chip-unfilled").forEach((el) => {
      this.paintChip(ctx, el, containerRect, scale, scaleY, elementScale);
    });

    ctx.restore();
  }

  private paintLine(
    ctx: CanvasRenderingContext2D,
    line: SVGLineElement,
    outWidth: number,
    outHeight: number,
    scale: number,
  ): void {
    const style = getComputedStyle(line);
    const x1 = parsePercent(line.getAttribute("x1"), outWidth);
    const y1 = parsePercent(line.getAttribute("y1"), outHeight);
    const x2 = parsePercent(line.getAttribute("x2"), outWidth);
    const y2 = parsePercent(line.getAttribute("y2"), outHeight);
    const dashes = style.strokeDasharray
      .split(/[\s,]+/)
      .map(parsePx)
      .filter((value) => value > 0)
      .map((value) => value * scale);

    ctx.save();
    ctx.strokeStyle = style.stroke && style.stroke !== "none" ? style.stroke : "#ffffff";
    ctx.lineWidth = Math.max(parsePx(style.strokeWidth), 0.5) * scale;
    ctx.setLineDash(dashes);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  private paintSquare(
    ctx: CanvasRenderingContext2D,
    el: HTMLElement,
    containerRect: DOMRect,
    scale: number,
    scaleY: number,
    elementScale: number,
    withCenterDot: boolean,
  ): void {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const centerX = (rect.left + rect.width / 2 - containerRect.left) * scale;
    const centerY = (rect.top + rect.height / 2 - containerRect.top) * scaleY;
    const width = rect.width * scale * elementScale;
    const height = rect.height * scaleY * elementScale;
    const borderWidth = parsePx(style.borderTopWidth) * scale;
    const color = style.borderTopColor;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = borderWidth;
    ctx.strokeRect(
      centerX - width / 2 + borderWidth / 2,
      centerY - height / 2 + borderWidth / 2,
      width - borderWidth,
      height - borderWidth,
    );
    if (withCenterDot) {
      const dot = 2 * scale;
      ctx.fillStyle = color;
      ctx.fillRect(centerX - dot / 2, centerY - dot / 2, dot, dot);
    }
    ctx.restore();
  }

  private paintChip(
    ctx: CanvasRenderingContext2D,
    el: HTMLElement,
    containerRect: DOMRect,
    scale: number,
    scaleY: number,
    elementScale: number,
  ): void {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const opacity = Number.parseFloat(style.opacity);
    const centerX = (rect.left + rect.width / 2 - containerRect.left) * scale;
    const centerY = (rect.top + rect.height / 2 - containerRect.top) * scaleY;
    const width = rect.width * scale;
    const height = rect.height * scaleY;

    ctx.save();
    ctx.globalAlpha *= Number.isFinite(opacity) ? opacity : 1;
    ctx.translate(centerX, centerY);
    ctx.scale(elementScale, elementScale);

    const background = style.backgroundColor;
    if (background && !isTransparent(background)) {
      ctx.fillStyle = background;
      ctx.fillRect(-width / 2, -height / 2, width, height);
    }

    const fontSize = parsePx(style.fontSize) * scale;
    const paddingLeft = parsePx(style.paddingLeft) * scale;
    const rawText = el.textContent ?? "";
    const text = style.textTransform === "uppercase" ? rawText.toUpperCase() : rawText;
    ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    const letterSpacingPx = parsePx(style.letterSpacing) * scale;
    const ctxWithSpacing = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
    if ("letterSpacing" in ctxWithSpacing) {
      ctxWithSpacing.letterSpacing = `${letterSpacingPx}px`;
    }
    ctx.fillStyle = style.color;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(text, -width / 2 + paddingLeft, 0);
    ctx.restore();
  }
}
