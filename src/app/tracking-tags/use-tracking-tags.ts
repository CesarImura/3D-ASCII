import * as React from "react";

import type { AsciiEffect } from "../ascii-engine/ascii-effect";
import {
  buildClusterAnchors,
  type ClusterAnchors,
  type LocalPoint,
} from "../ascii-engine/tag-cluster-anchors";
import { resolveTagColor, type ClusterDef } from "../ascii-engine/tag-cluster-types";

/**
 * Tag overlay behavior (Clusters -> Groups -> Tags):
 *  - Exactly one cluster is "active" at a time. Which one cycles
 *    automatically as the object turns (drag or auto-rotate): the full 360
 *    degrees of rotation is divided evenly by the number of clusters, so N
 *    clusters means the active one advances every 360/N degrees.
 *  - Every tag in every group of the active cluster renders simultaneously
 *    -- a cluster is "everything shown at the same time."
 *  - Each visible point (a tag, a cluster's giant square, or a tag's own
 *    object-line origin/marker) is pinned to a real point in the object's
 *    local space, reprojected through the live camera every rendered frame
 *    via `AsciiEffect.projectPoint` -- genuinely integrated with the 3D
 *    scene. `distanceToObject` controls how close that whole layer sits to
 *    the object -- small values deliberately let tags overlap the object's
 *    own silhouette.
 *  - Position is smoothed per point with an exponential moving average (a
 *    simple low-pass filter) instead of writing the raw projected value
 *    straight to the DOM every frame -- removes jitter without adding lag.
 *  - Simultaneously visible tags are passed through a lightweight
 *    per-frame separation pass so overlapping pills get nudged apart
 *    instead of rendering on top of each other.
 *  - Everything is written directly to DOM/SVG nodes (through ref maps)
 *    every frame, not through React state -- only which cluster is active,
 *    and the resulting list of tags/squares/lines to render, goes through
 *    `setState`, so this stays cheap even with many simultaneous tags.
 */

export type RenderedTag = {
  background: string;
  filled: boolean;
  key: string;
  text: string;
};

export type RenderedSquare = {
  key: string;
  kind: "giant" | "lineOrigin";
};

export type RenderedLine = {
  fromKey: string;
  key: string;
  toKey: string;
};

export type TrackingTagsRenderState = {
  activeClusterIndex: number;
  lines: RenderedLine[];
  squares: RenderedSquare[];
  tags: RenderedTag[];
};

type ScreenPosition = { left: number; top: number };

type OverlapCandidate = {
  halfHeightPercent: number;
  halfWidthPercent: number;
  key: string;
};

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

// Both the React list key and the ref-map lookup key for a line -- encodes
// its two endpoint point-ids directly. Split on the first "||", which never
// appears inside a point id itself (those use "::" and "-").
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

export function useTrackingTags({
  canvasHeight,
  canvasWidth,
  chipRefs,
  clusters,
  distanceToObject,
  effectRef,
  enabled,
  lineRefs,
  paddingX,
  paddingY,
  squareRefs,
  tagScale,
}: {
  canvasHeight: number;
  canvasWidth: number;
  chipRefs: React.RefObject<Map<string, HTMLDivElement>>;
  clusters: readonly ClusterDef[];
  distanceToObject: number;
  effectRef: React.RefObject<AsciiEffect | null>;
  enabled: boolean;
  lineRefs: React.RefObject<Map<string, SVGLineElement>>;
  paddingX: number;
  paddingY: number;
  squareRefs: React.RefObject<Map<string, HTMLDivElement>>;
  tagScale: number;
}): TrackingTagsRenderState {
  const [renderState, setRenderState] = React.useState<TrackingTagsRenderState>({
    activeClusterIndex: -1,
    lines: [],
    squares: [],
    tags: [],
  });
  const activeClusterIndexRef = React.useRef(-1);
  const activeAnchorsRef = React.useRef<ClusterAnchors | null>(null);
  const overlapCandidatesRef = React.useRef<OverlapCandidate[]>([]);
  const smoothedPositionsRef = React.useRef(new Map<string, ScreenPosition>());
  const displayPositionsRef = React.useRef(new Map<string, ScreenPosition>());
  const clustersKey = JSON.stringify(clusters);

  React.useEffect(() => {
    if (!enabled || clusters.length === 0) {
      setRenderState({ activeClusterIndex: -1, lines: [], squares: [], tags: [] });
      activeClusterIndexRef.current = -1;
      return;
    }

    const effect = effectRef.current;
    if (!effect) {
      return;
    }

    const clusterCount = clusters.length;
    const segmentDegrees = 360 / clusterCount;
    const safeCanvasWidth = canvasWidth > 0 ? canvasWidth : 1;
    const safeCanvasHeight = canvasHeight > 0 ? canvasHeight : 1;
    const safeDistance = distanceToObject > 0 ? distanceToObject : 1;

    function activateCluster(clusterIndex: number): void {
      activeClusterIndexRef.current = clusterIndex;
      smoothedPositionsRef.current.clear();

      const cluster = clusters[clusterIndex];
      activeAnchorsRef.current = buildClusterAnchors(cluster.groups, clusterIndex, safeDistance);

      const tags: RenderedTag[] = [];
      const squares: RenderedSquare[] = [];
      const lines: RenderedLine[] = [];
      const candidates: OverlapCandidate[] = [];

      if (cluster.giantSquare) {
        squares.push({ key: giantSquareKey(clusterIndex), kind: "giant" });
      }

      cluster.groups.forEach((group, groupIndex) => {
        const groupTagKeys = group.tags.map((_, tagIndex) =>
          tagKey(clusterIndex, groupIndex, tagIndex),
        );

        group.tags.forEach((tagDef, tagIndex) => {
          const text = tagDef.text || "TAG";
          const key = groupTagKeys[tagIndex];
          tags.push({
            background: resolveTagColor(tagDef, group, clusterIndex, groupIndex),
            filled: tagDef.filled,
            key,
            text,
          });

          if (group.objectLine) {
            lines.push({
              fromKey: lineOriginKey(key),
              key: lineKey(lineOriginKey(key), key),
              toKey: key,
            });
            squares.push({ key: lineOriginKey(key), kind: "lineOrigin" });
          }

          const { halfHeightPx, halfWidthPx } = estimateHalfSize(
            text,
            tagScale,
            paddingX,
            paddingY,
          );
          candidates.push({
            halfHeightPercent: (halfHeightPx / safeCanvasHeight) * 100,
            halfWidthPercent: (halfWidthPx / safeCanvasWidth) * 100,
            key,
          });
        });

        if (group.chainLine) {
          for (let i = 0; i < groupTagKeys.length - 1; i += 1) {
            lines.push({
              fromKey: groupTagKeys[i],
              key: lineKey(groupTagKeys[i], groupTagKeys[i + 1]),
              toKey: groupTagKeys[i + 1],
            });
          }
        }
      });

      overlapCandidatesRef.current = candidates;
      setRenderState({ activeClusterIndex: clusterIndex, lines, squares, tags });
    }

    function writePointPosition(key: string, localPoint: LocalPoint): void {
      const projection = effect!.projectPoint(localPoint);
      const previous = smoothedPositionsRef.current.get(key) ?? {
        left: projection.leftPercent,
        top: projection.topPercent,
      };
      const nextLeft =
        previous.left + (projection.leftPercent - previous.left) * SMOOTHING_FACTOR;
      const nextTop = previous.top + (projection.topPercent - previous.top) * SMOOTHING_FACTOR;
      smoothedPositionsRef.current.set(key, { left: nextLeft, top: nextTop });
    }

    const unsubscribe = effect.subscribeRotation((cumulativeDegrees) => {
      const normalized = ((cumulativeDegrees % 360) + 360) % 360;
      const clusterIndex = Math.min(
        clusterCount - 1,
        Math.floor(normalized / segmentDegrees),
      );

      if (clusterIndex !== activeClusterIndexRef.current) {
        activateCluster(clusterIndex);
      }

      const activeClusterIndex = activeClusterIndexRef.current;
      if (activeClusterIndex < 0) {
        return;
      }

      const cluster = clusters[activeClusterIndex];
      const clusterAnchors = activeAnchorsRef.current;
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
      const display = displayPositionsRef.current;
      display.clear();
      for (const [key, position] of smoothedPositionsRef.current) {
        display.set(key, { left: position.left, top: position.top });
      }
      relaxOverlaps(display, overlapCandidatesRef.current, OVERLAP_ITERATIONS);

      // Push the updated positions into the DOM/SVG.
      for (const [key, node] of chipRefs.current) {
        const position = display.get(key);
        if (position) {
          node.style.left = `${position.left}%`;
          node.style.top = `${position.top}%`;
        }
      }
      for (const [key, node] of squareRefs.current) {
        const position = display.get(key);
        if (position) {
          node.style.left = `${position.left}%`;
          node.style.top = `${position.top}%`;
        }
      }
      for (const [key, node] of lineRefs.current) {
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

    return () => {
      unsubscribe();
      activeClusterIndexRef.current = -1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    clustersKey,
    effectRef,
    chipRefs,
    squareRefs,
    lineRefs,
    canvasWidth,
    canvasHeight,
    tagScale,
    paddingX,
    paddingY,
    distanceToObject,
  ]);

  return renderState;
}
