import type { AsciiEffect } from "./ascii-effect";
import { buildClusterAnchors, type ClusterAnchors, type LocalPoint } from "./tag-cluster-anchors";
import { resolveTagColor, type ClusterDef } from "./tag-cluster-types";

/**
 * TrackingTagsOverlay -- a framework-agnostic port of the studio's tag
 * overlay (Clusters -> Groups -> Tags). This is the same feature and the
 * same math as the live studio's `useTrackingTags` hook + `<TrackingTagsOverlay>`
 * React component (in `../tracking-tags/`), rewritten with plain DOM APIs so
 * it can ship in the "Export Code" bundle alongside `AsciiEffect` with no
 * framework dependency. The two implementations are intentionally kept in
 * close correspondence (same constants, same anchor generation via
 * `tag-cluster-anchors.ts` reused byte-for-byte, same smoothing/overlap-
 * avoidance algorithm) rather than merged into one, since the live studio's
 * version is wired through React refs/state for its own good reasons
 * (batched re-renders, JSX children) that don't apply to a portable,
 * dependency-free export.
 *
 * Lives in ascii-engine/ (not ../tracking-tags/), alongside ascii-effect.ts,
 * tag-cluster-anchors.ts and tag-cluster-types.ts -- all four are
 * framework-agnostic and ship byte-for-byte (via `?raw` import) into the
 * "Export Code" bundle's flat output folder. Every file this one imports has
 * to live in this same folder, or the relative import breaks once flattened
 * into the export (this file's own import of AsciiEffect used to read
 * `../ascii-engine/ascii-effect`, which is exactly the bug this fixed --
 * that path doesn't exist in the flat export folder, so the overlay failed
 * to compile in every export until this file moved here).
 *
 * Behavior (identical to the live studio):
 *  - Exactly one cluster is "active" at a time. Which one cycles
 *    automatically as the object turns (drag or auto-rotate): the full 360
 *    degrees of rotation is divided evenly by the number of clusters, so N
 *    clusters means the active one advances every 360/N degrees.
 *  - Every tag in every group of the active cluster renders simultaneously.
 *  - Each visible point (a tag, a cluster's giant square, or a tag's own
 *    object-line origin/marker) is pinned to a real point in the object's
 *    local space, reprojected through the live camera every rendered frame
 *    via `AsciiEffect.projectPoint`.
 *  - Position is smoothed per point with an exponential moving average
 *    instead of writing the raw projected value straight to the DOM every
 *    frame -- removes jitter without adding lag.
 *  - Simultaneously visible tags are passed through a lightweight
 *    per-frame separation pass so overlapping pills get nudged apart
 *    instead of rendering on top of each other.
 *  - The whole layer replays a brief pop/flash transition whenever the
 *    active cluster changes, instead of a hard cut.
 *
 * Usage:
 *
 *   const overlay = new TrackingTagsOverlay(containerElement, effect, {
 *     clusters, distanceToObject, enabled: true,
 *     giantSquareColor, giantSquareSize, lineColor, lineDashed: false,
 *     lineThickness, paddingX, paddingY, tagScale,
 *   });
 *   // container must be position: relative (or absolute/fixed) and the
 *   // same size as the canvas -- the overlay positions itself absolutely
 *   // inside it. Include tracking-tags-overlay.css on the page.
 *   // later
 *   overlay.setConfig({ tagScale: 1.4 });
 *   overlay.refresh(); // call after the container is resized
 *   // cleanup
 *   overlay.dispose();
 */

export type TrackingTagsConfig = {
  clusters: readonly ClusterDef[];
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

type ScreenPosition = { left: number; top: number };

type OverlapCandidate = {
  halfHeightPercent: number;
  halfWidthPercent: number;
  key: string;
};

const SVG_NS = "http://www.w3.org/2000/svg";
const SMOOTHING_FACTOR = 0.22;
const OVERLAP_ITERATIONS = 2;
// Rough monospace character-width-to-font-size ratio, used only to estimate
// a tag pill's on-screen footprint for overlap avoidance -- doesn't need to
// be exact, just close enough to keep pills from visually overlapping.
const CHAR_WIDTH_RATIO = 0.62;
const BASE_FONT_SIZE_PX = 10;
const MIN_GAP_PX = 3;

function giantSquareKey(clusterIndex: number): string {
  return `giant-square-${clusterIndex}`;
}

function tagKey(clusterIndex: number, groupIndex: number, tagIndex: number): string {
  return `${clusterIndex}-${groupIndex}-${tagIndex}`;
}

// Per-tag object-line origin/marker point id -- distinct from the tag's own
// key so a tag and its line's starting point can each be tracked/smoothed
// independently even though they move together.
function lineOriginKey(tagPointKey: string): string {
  return `origin::${tagPointKey}`;
}

// The DOM lookup key for a line -- encodes its two endpoint point-ids
// directly. Split on the first "||", which never appears inside a point id
// itself (those use "::" and "-").
function lineKey(fromKey: string, toKey: string): string {
  return `${fromKey}||${toKey}`;
}

function estimateHalfSize(
  text: string,
  tagScalePercent: number,
  paddingXPx: number,
  paddingYPx: number,
): { halfHeightPx: number; halfWidthPx: number } {
  const fontSizePx = BASE_FONT_SIZE_PX * tagScalePercent;
  const charWidthPx = fontSizePx * CHAR_WIDTH_RATIO;
  const textLength = Math.max(text.length, 3);
  const widthPx = charWidthPx * textLength + paddingXPx * 2 + MIN_GAP_PX;
  const heightPx = fontSizePx + paddingYPx * 2 + MIN_GAP_PX;
  return { halfHeightPx: heightPx / 2, halfWidthPx: widthPx / 2 };
}

// Lightweight iterative separation pass: pushes any pair of overlapping
// candidate bounding boxes apart along whichever axis has less overlap.
// Runs against a throwaway copy of the frame's positions (see the caller),
// never against the smoothing baseline itself, so it can't compound into
// feedback jitter.
function relaxOverlaps(
  positions: Map<string, ScreenPosition>,
  candidates: readonly OverlapCandidate[],
  iterations: number,
): void {
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let i = 0; i < candidates.length; i += 1) {
      const a = candidates[i];
      const posA = positions.get(a.key);
      if (!posA) {
        continue;
      }
      for (let j = i + 1; j < candidates.length; j += 1) {
        const b = candidates[j];
        const posB = positions.get(b.key);
        if (!posB) {
          continue;
        }

        const dx = posB.left - posA.left;
        const dy = posB.top - posA.top;
        const minX = a.halfWidthPercent + b.halfWidthPercent;
        const minY = a.halfHeightPercent + b.halfHeightPercent;
        const overlapX = minX - Math.abs(dx);
        const overlapY = minY - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) {
          continue;
        }

        if (overlapX < overlapY) {
          const sign = dx === 0 ? (a.key < b.key ? -1 : 1) : Math.sign(dx);
          const push = overlapX / 2;
          posA.left -= sign * push;
          posB.left += sign * push;
        } else {
          const sign = dy === 0 ? (a.key < b.key ? -1 : 1) : Math.sign(dy);
          const push = overlapY / 2;
          posA.top -= sign * push;
          posB.top += sign * push;
        }
      }
    }
  }
}

export class TrackingTagsOverlay {
  private readonly container: HTMLElement;
  private readonly effect: AsciiEffect;
  private config: TrackingTagsConfig;

  private layerEl: HTMLDivElement | null = null;
  private readonly chipEls = new Map<string, HTMLDivElement>();
  private readonly squareEls = new Map<string, HTMLDivElement>();
  private readonly lineEls = new Map<string, SVGLineElement>();

  private unsubscribeRotation: (() => void) | null = null;
  private activeClusterIndex = -1;
  private activeAnchors: ClusterAnchors | null = null;
  private overlapCandidates: OverlapCandidate[] = [];
  private readonly smoothedPositions = new Map<string, ScreenPosition>();
  private readonly displayPositions = new Map<string, ScreenPosition>();

  constructor(container: HTMLElement, effect: AsciiEffect, config: TrackingTagsConfig) {
    this.container = container;
    this.effect = effect;
    this.config = config;
    this.rebuild();
  }

  /** Merges in new config and fully rebuilds (cheap: DOM nodes, not the 3D scene). */
  setConfig(next: Partial<TrackingTagsConfig>): void {
    this.config = { ...this.config, ...next };
    this.rebuild();
  }

  /**
   * Call after the container element is resized (e.g. from the same
   * `resize` handler that calls `effect.setSize`) so the next cluster
   * activation's overlap-avoidance math uses fresh dimensions.
   */
  refresh(): void {
    if (this.layerEl) {
      this.activeClusterIndex = -1;
    }
  }

  dispose(): void {
    this.teardown();
  }

  private teardown(): void {
    this.unsubscribeRotation?.();
    this.unsubscribeRotation = null;
    this.layerEl?.remove();
    this.layerEl = null;
    this.chipEls.clear();
    this.squareEls.clear();
    this.lineEls.clear();
    this.activeClusterIndex = -1;
    this.activeAnchors = null;
    this.overlapCandidates = [];
    this.smoothedPositions.clear();
    this.displayPositions.clear();
  }

  private rebuild(): void {
    this.teardown();

    const { clusters, enabled } = this.config;
    if (!enabled || clusters.length === 0) {
      return;
    }

    const layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.setAttribute("data-tracking-tags-overlay", "");
    layer.className = "tt-layer";
    this.applyLayerVars(layer);
    this.container.appendChild(layer);
    this.layerEl = layer;

    const clusterCount = clusters.length;
    const segmentDegrees = 360 / clusterCount;
    const safeDistance = this.config.distanceToObject > 0 ? this.config.distanceToObject : 1;

    const activateCluster = (clusterIndex: number): void => {
      this.activeClusterIndex = clusterIndex;
      this.smoothedPositions.clear();
      this.chipEls.clear();
      this.squareEls.clear();
      this.lineEls.clear();
      layer.replaceChildren();
      // Restart the layer's own CSS "pop" animation on every cluster switch
      // (new child elements already replay their own entrance animation
      // automatically just by being freshly inserted -- only this
      // persistent outer element needs the forced-reflow trick).
      layer.style.animation = "none";
      void layer.offsetWidth;
      layer.style.animation = "";

      const cluster = clusters[clusterIndex];
      this.activeAnchors = buildClusterAnchors(cluster.groups, clusterIndex, safeDistance);

      const rect = this.container.getBoundingClientRect();
      const safeCanvasWidth = rect.width > 0 ? rect.width : 1;
      const safeCanvasHeight = rect.height > 0 ? rect.height : 1;
      const candidates: OverlapCandidate[] = [];

      let svg: SVGSVGElement | null = null;
      const ensureSvg = (): SVGSVGElement => {
        if (!svg) {
          svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
          svg.setAttribute("class", "tt-lines-svg");
          svg.setAttribute("preserveAspectRatio", "none");
          layer.appendChild(svg);
        }
        return svg;
      };
      const appendLine = (key: string): void => {
        const line = document.createElementNS(SVG_NS, "line") as SVGLineElement;
        line.setAttribute("class", this.config.lineDashed ? "tt-line-dashed" : "tt-line");
        line.setAttribute("x1", "50%");
        line.setAttribute("y1", "50%");
        line.setAttribute("x2", "50%");
        line.setAttribute("y2", "50%");
        ensureSvg().appendChild(line);
        this.lineEls.set(key, line);
      };

      if (cluster.giantSquare) {
        const key = giantSquareKey(clusterIndex);
        const el = document.createElement("div");
        el.className = "tt-square-giant";
        layer.appendChild(el);
        this.squareEls.set(key, el);
      }

      cluster.groups.forEach((group, groupIndex) => {
        const groupTagKeys = group.tags.map((_, tagIndex) =>
          tagKey(clusterIndex, groupIndex, tagIndex),
        );

        group.tags.forEach((tagDef, tagIndex) => {
          const text = tagDef.text || "TAG";
          const key = groupTagKeys[tagIndex];

          const chip = document.createElement("div");
          chip.className = tagDef.filled ? "tt-chip-filled" : "tt-chip-unfilled";
          chip.textContent = text;
          if (tagDef.filled) {
            chip.style.setProperty(
              "--tag-bg",
              resolveTagColor(tagDef, group, clusterIndex, groupIndex),
            );
          }
          layer.appendChild(chip);
          this.chipEls.set(key, chip);

          if (group.objectLine) {
            const originKey = lineOriginKey(key);
            const originEl = document.createElement("div");
            originEl.className = "tt-square-line-origin";
            layer.appendChild(originEl);
            this.squareEls.set(originKey, originEl);
            appendLine(lineKey(originKey, key));
          }

          const { halfHeightPx, halfWidthPx } = estimateHalfSize(
            text,
            this.config.tagScale,
            this.config.paddingX,
            this.config.paddingY,
          );
          candidates.push({
            halfHeightPercent: (halfHeightPx / safeCanvasHeight) * 100,
            halfWidthPercent: (halfWidthPx / safeCanvasWidth) * 100,
            key,
          });
        });

        if (group.chainLine) {
          for (let i = 0; i < groupTagKeys.length - 1; i += 1) {
            appendLine(lineKey(groupTagKeys[i], groupTagKeys[i + 1]));
          }
        }
      });

      this.overlapCandidates = candidates;
    };

    const writePointPosition = (key: string, localPoint: LocalPoint): void => {
      const projection = this.effect.projectPoint(localPoint);
      const previous = this.smoothedPositions.get(key) ?? {
        left: projection.leftPercent,
        top: projection.topPercent,
      };
      const nextLeft = previous.left + (projection.leftPercent - previous.left) * SMOOTHING_FACTOR;
      const nextTop = previous.top + (projection.topPercent - previous.top) * SMOOTHING_FACTOR;
      this.smoothedPositions.set(key, { left: nextLeft, top: nextTop });
    };

    this.unsubscribeRotation = this.effect.subscribeRotation((cumulativeDegrees) => {
      const normalized = ((cumulativeDegrees % 360) + 360) % 360;
      const clusterIndex = Math.min(clusterCount - 1, Math.floor(normalized / segmentDegrees));

      if (clusterIndex !== this.activeClusterIndex) {
        activateCluster(clusterIndex);
      }

      const activeClusterIndex = this.activeClusterIndex;
      if (activeClusterIndex < 0) {
        return;
      }

      const cluster = clusters[activeClusterIndex];
      const clusterAnchors = this.activeAnchors;
      if (!clusterAnchors) {
        return;
      }

      if (cluster.giantSquare) {
        writePointPosition(giantSquareKey(activeClusterIndex), clusterAnchors.clusterCenter);
      }

      cluster.groups.forEach((group, groupIndex) => {
        const anchors = clusterAnchors.groups[groupIndex];
        if (!anchors) {
          return;
        }

        if (group.objectLine) {
          group.tags.forEach((_tag, tagIndex) => {
            const surfacePoint = anchors.tagSurfacePoints[tagIndex];
            const key = tagKey(activeClusterIndex, groupIndex, tagIndex);
            if (surfacePoint) {
              writePointPosition(lineOriginKey(key), surfacePoint);
            }
          });
        }

        group.tags.forEach((_tag, tagIndex) => {
          const localPoint = anchors.tagPoints[tagIndex];
          if (localPoint) {
            writePointPosition(tagKey(activeClusterIndex, groupIndex, tagIndex), localPoint);
          }
        });
      });

      // Resolve pill-vs-pill overlap on a disposable copy of this frame's
      // smoothed positions -- never on the smoothing baseline itself, so the
      // push can't feed back into next frame's EMA and compound into jitter.
      const display = this.displayPositions;
      display.clear();
      for (const [key, position] of this.smoothedPositions) {
        display.set(key, { left: position.left, top: position.top });
      }
      relaxOverlaps(display, this.overlapCandidates, OVERLAP_ITERATIONS);

      for (const [key, node] of this.chipEls) {
        const position = display.get(key);
        if (position) {
          node.style.left = `${position.left}%`;
          node.style.top = `${position.top}%`;
        }
      }
      for (const [key, node] of this.squareEls) {
        const position = display.get(key);
        if (position) {
          node.style.left = `${position.left}%`;
          node.style.top = `${position.top}%`;
        }
      }
      for (const [key, node] of this.lineEls) {
        const separatorIndex = key.indexOf("||");
        if (separatorIndex < 0) {
          continue;
        }
        const fromKey = key.slice(0, separatorIndex);
        const toKey = key.slice(separatorIndex + 2);
        const from = display.get(fromKey);
        const to = display.get(toKey);
        if (from && to) {
          node.setAttribute("x1", `${from.left}%`);
          node.setAttribute("y1", `${from.top}%`);
          node.setAttribute("x2", `${to.left}%`);
          node.setAttribute("y2", `${to.top}%`);
        }
      }
    });
  }

  private applyLayerVars(layer: HTMLDivElement): void {
    layer.style.setProperty("--giant-square-size", `${this.config.giantSquareSize}px`);
    layer.style.setProperty("--line-color", this.config.lineColor);
    layer.style.setProperty("--line-thickness", `${this.config.lineThickness}px`);
    layer.style.setProperty("--square-color", this.config.giantSquareColor);
    layer.style.setProperty("--tag-padding-x", String(this.config.paddingX));
    layer.style.setProperty("--tag-padding-y", String(this.config.paddingY));
    layer.style.setProperty("--tag-scale", String(this.config.tagScale));
  }
}
