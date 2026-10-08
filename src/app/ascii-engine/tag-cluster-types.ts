/**
 * Tag overlay value model: Clusters -> Groups -> Tags.
 *
 *  - A Tag is one label. `filled` controls whether it renders as a solid
 *    color pill (black text on a background color) or bare white text with
 *    no background -- set per tag, not per group/globally.
 *  - A Group is a set of tags that appear together, clustered near a shared
 *    point on the object (see `tag-cluster-anchors.ts`). A group can show a
 *    line from a point on the object's own surface nearest each tag
 *    ("object line", with a small square marker at that line's starting
 *    point), and/or lines chaining its tags to each other in sequence
 *    ("chain line").
 *  - A Cluster is everything visible at the same time. Only one cluster is
 *    active at once; which one is active cycles automatically as the object
 *    rotates -- the full 360 degrees is divided evenly by the number of
 *    clusters, so N clusters means the active one changes every 360/N
 *    degrees of rotation. A cluster can also show one "giant square" --
 *    a large tracking-square marker at that cluster's overall center point
 *    on the object, distinct from the small per-line origin markers.
 *
 * Plain JSON-serializable data (works with schema persistence/localStorage).
 *
 * Lives in ascii-engine/ (not tracking-tags/) alongside tag-cluster-anchors.ts
 * and tracking-tags-controller.ts -- all three are framework-agnostic and
 * ship byte-for-byte (via `?raw` import) into the "Export Code" bundle's flat
 * output folder, so every file one of them imports has to live in this same
 * folder too, or the relative import breaks once flattened into the export.
 * (See tracking-tags/use-tracking-tags.ts and tracking-tags/tag-clusters-control.tsx
 * for the React-only files that still import this from one directory up.)
 */

export type TagDef = {
  // Optional per-tag override for a FILLED tag's background (hex). When
  // absent, the tag uses its group's color.
  color?: string;
  filled: boolean;
  text: string;
};

export type GroupDef = {
  chainLine: boolean;
  // Background of every FILLED tag in this group (hex, e.g. "#C1FF00").
  // Unfilled tags stay plain white text; lines/squares keep the global
  // Line/Square colors.
  color: string;
  objectLine: boolean;
  tags: TagDef[];
};

// Default group colors, cycled by (cluster + group) index. The first three
// match the old shared "Tag colors" palette defaults, so existing setups
// look familiar after the switch to per-group colors.
export const DEFAULT_GROUP_COLORS: readonly string[] = [
  "#C1FF00",
  "#D6D4D6",
  "#0074E1",
  "#FF5C39",
  "#B388FF",
  "#FFD400",
];

export function defaultGroupColor(clusterIndex: number, groupIndex: number): string {
  return DEFAULT_GROUP_COLORS[(clusterIndex + groupIndex) % DEFAULT_GROUP_COLORS.length];
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Returns a valid hex override for a tag, or undefined (= use group color). */
export function resolveTagColorOverride(value: unknown): string | undefined {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : undefined;
}

/** Effective background of a filled tag: its own override, else its group's color. */
export function resolveTagColor(
  tag: { color?: unknown },
  group: { color?: unknown },
  clusterIndex: number,
  groupIndex: number,
): string {
  return (
    resolveTagColorOverride(tag.color) ?? resolveGroupColor(group.color, clusterIndex, groupIndex)
  );
}

/**
 * Reads a group's color from untrusted/persisted data. Accepts a plain hex
 * string or a `{ hex }` object; anything else (including groups saved
 * before per-group colors existed) falls back to `defaultGroupColor`.
 */
export function resolveGroupColor(value: unknown, clusterIndex: number, groupIndex: number): string {
  const hex =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "hex" in value
        ? String((value as { hex: unknown }).hex ?? "")
        : "";
  return HEX_COLOR.test(hex) ? hex : defaultGroupColor(clusterIndex, groupIndex);
}

export type ClusterDef = {
  giantSquare: boolean;
  groups: GroupDef[];
};

export const MAX_CLUSTERS = 8;
export const MAX_GROUPS_PER_CLUSTER = 6;
export const MAX_TAGS_PER_GROUP = 10;
