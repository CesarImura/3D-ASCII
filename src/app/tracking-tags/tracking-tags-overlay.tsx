import * as React from "react";

import styles from "./tracking-tags-overlay.module.css";
import type { RenderedLine, RenderedSquare, RenderedTag } from "./use-tracking-tags";

export type TrackingTagsOverlayProps = {
  activeClusterIndex: number;
  chipRefs: React.RefObject<Map<string, HTMLDivElement>>;
  giantSquareColor: string;
  giantSquareSize: number;
  lineColor: string;
  lineDashed: boolean;
  lineRefs: React.RefObject<Map<string, SVGLineElement>>;
  lineThickness: number;
  lines: readonly RenderedLine[];
  paddingX: number;
  paddingY: number;
  squareRefs: React.RefObject<Map<string, HTMLDivElement>>;
  squares: readonly RenderedSquare[];
  tagScale: number;
  tags: readonly RenderedTag[];
};

/**
 * Purely decorative HTML/SVG overlay -- absolutely positioned on top of the
 * `<canvas>`, `pointer-events: none` throughout so it never intercepts the
 * drag-to-rotate/zoom interaction on the 3D view underneath. No WebGL/shader
 * involvement.
 *
 * Three layers, back to front: connector lines (SVG), square markers (both
 * the per-cluster "giant square" and the small per-line origin markers),
 * then tag chips. Position/endpoints are written directly onto each node's
 * `style`/attributes every frame by `useTrackingTags` (real 3D projection,
 * not this component) via the three ref maps -- this component only owns
 * markup and styling.
 *
 * The whole layer remounts (via `key={activeClusterIndex}`) whenever the
 * active cluster changes, which naturally replays every child's entrance
 * animation plus the layer's own brief pop/flash -- a small but visible
 * transition instead of a hard cut between clusters.
 */
export function TrackingTagsOverlay({
  activeClusterIndex,
  chipRefs,
  giantSquareColor,
  giantSquareSize,
  lineColor,
  lineDashed,
  lineRefs,
  lineThickness,
  lines,
  paddingX,
  paddingY,
  squareRefs,
  squares,
  tagScale,
  tags,
}: TrackingTagsOverlayProps): React.JSX.Element | null {
  if (tags.length === 0 && squares.length === 0 && lines.length === 0) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className={styles.layer}
      data-tracking-tags-overlay=""
      key={activeClusterIndex}
      style={
        {
          "--giant-square-size": `${giantSquareSize}px`,
          "--line-color": lineColor,
          "--line-thickness": `${lineThickness}px`,
          "--square-color": giantSquareColor,
          "--tag-padding-x": paddingX,
          "--tag-padding-y": paddingY,
          "--tag-scale": tagScale,
        } as React.CSSProperties
      }
    >
      {lines.length > 0 ? (
        <svg className={styles.linesSvg} preserveAspectRatio="none">
          {lines.map((line) => (
            <line
              className={lineDashed ? styles.lineDashed : styles.line}
              key={line.key}
              ref={(node) => {
                if (node) {
                  lineRefs.current.set(line.key, node);
                } else {
                  lineRefs.current.delete(line.key);
                }
              }}
              x1="50%"
              x2="50%"
              y1="50%"
              y2="50%"
            />
          ))}
        </svg>
      ) : null}

      {squares.map((square) => (
        <div
          className={square.kind === "giant" ? styles.squareGiant : styles.squareLineOrigin}
          key={square.key}
          ref={(node) => {
            if (node) {
              squareRefs.current.set(square.key, node);
            } else {
              squareRefs.current.delete(square.key);
            }
          }}
        />
      ))}

      {tags.map((tag) => (
        <div
          className={tag.filled ? styles.chipFilled : styles.chipUnfilled}
          key={tag.key}
          ref={(node) => {
            if (node) {
              chipRefs.current.set(tag.key, node);
            } else {
              chipRefs.current.delete(tag.key);
            }
          }}
          style={tag.filled ? ({ "--tag-bg": tag.background } as React.CSSProperties) : undefined}
        >
          {tag.text}
        </div>
      ))}
    </div>
  );
}
