import type { GroupDef } from "./tag-cluster-types";

/**
 * Deterministic 3D anchor points for a cluster's groups/tags -- points in
 * the object's own local space, at a user-adjustable distance from center
 * (built-in presets/normalized uploads have a bounding radius of roughly
 * 1.2-1.4, see presets.ts / AsciiEffect.frameObject) -- a small
 * `distanceToObject` deliberately lets tags sit on/overlapping the object's
 * own silhouette for a "blob tracking" look rather than floating away from
 * it.
 *
 * Each group gets its own center point (evenly spread across the object via
 * a Fibonacci sphere distribution), and every tag in that group sits at a
 * small deterministic jitter offset from its group's center -- that jitter
 * is what makes a group's tags visually read as "together" (clustered) while
 * different groups land in different places on the object.
 *
 * The whole distribution is additionally rotated/tilted per *cluster* (see
 * `clusterIndex`) so that switching the active cluster visibly rearranges
 * where things sit on the object, instead of every cluster reusing the same
 * groupIndex -> position mapping.
 *
 * Deterministic (seeded by index, not `Math.random()`) so anchors stay
 * stable across re-renders and only change when the underlying cluster
 * structure itself changes.
 */

// Object-line origins sit well inside the tag anchor distance -- a fraction
// of `distanceToObject` -- so lines visibly start at/inside the object
// rather than out at the same distance as the tags themselves.
const SURFACE_RADIUS_RATIO = 0.55;
// Tag jitter is a fraction of `distanceToObject` too, so it scales down
// proportionally as tags are pulled in closer to the object.
const GROUP_JITTER_RATIO = 0.16;
// Golden angle -- reused as the per-cluster rotation step so each cluster's
// whole layout spins to a very different position on the object rather than
// overlapping the previous cluster's groups.
const CLUSTER_ANGLE_OFFSET = Math.PI * (3 - Math.sqrt(5));
// Small per-cluster latitude (local Y) nudge, cycling for clusters beyond
// this list's length -- combined with the angle offset this keeps clusters
// from all reading as "the same ring, just rotated." Cluster 0 intentionally
// stays at 0 (no nudge) as the baseline layout -- see the note on
// `buildClusterAnchors`'s `clusterCenter` about the one side effect of that.
const CLUSTER_LATITUDE_STEPS = [0, 0.32, -0.32, 0.18, -0.18, 0.45, -0.45, 0.05];

export type LocalPoint = { x: number; y: number; z: number };

function normalizeToRadius(point: LocalPoint, radius: number): LocalPoint {
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  const scale = radius / length;
  return { x: point.x * scale, y: point.y * scale, z: point.z * scale };
}

// Evenly distributes `total` points across a unit sphere, optionally rotated
// (angleOffset, around the local Y axis) and tilted (latitudeOffset) as a
// whole -- used to give each cluster its own distinct layout.
function fibonacciSphereDirection(
  index: number,
  total: number,
  angleOffset: number,
  latitudeOffset: number,
): LocalPoint {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const rawY = total <= 1 ? 0 : 1 - (index / (total - 1)) * 2;
  const y = Math.max(-1, Math.min(1, rawY + latitudeOffset));
  const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = goldenAngle * index + angleOffset;
  return { x: Math.cos(theta) * radiusAtY, y, z: Math.sin(theta) * radiusAtY };
}

// Small deterministic pseudo-random in [0, 1), seeded by an integer key --
// stable across renders, unlike Math.random().
function seededUnit(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

export type GroupAnchors = {
  tagPoints: LocalPoint[];
  // Per-tag "closest point on the object" -- same direction as the
  // matching entry in `tagPoints`, pulled in much closer to center. Used as
  // that tag's individual object-line origin (and its marker position).
  tagSurfacePoints: LocalPoint[];
};

export type ClusterAnchors = {
  // The cluster's overall center point -- where the "giant square" marker
  // renders when a cluster has one enabled. The centroid of all of this
  // cluster's group centers, renormalized to `distanceToObject`.
  //
  // Note: with an odd group count, the Fibonacci distribution puts the
  // first and last group exactly at opposite poles (y = +1 / -1, x = z = 0)
  // whenever that cluster's latitude offset is 0 -- their (x, z) components
  // are both zero, so they cancel out of the mean entirely, and the
  // renormalized centroid collapses onto whichever remaining group's own
  // direction dominates instead of a genuine "in between all groups" point.
  // It's still a valid point at the same radius as every other anchor, just
  // not a distinct position of its own -- worth knowing if a giant square
  // ever looks like it's just sitting on top of one group's tags rather than
  // at the cluster's visual center.
  clusterCenter: LocalPoint;
  groups: GroupAnchors[];
};

/**
 * Builds one center point per group (spread across the object and rotated
 * per-cluster), a jittered point per tag within that group (clustered near
 * its group's center), a matching per-tag surface point for object-line
 * origins/markers, and the cluster's own overall center point, for a single
 * active cluster.
 */
export function buildClusterAnchors(
  groups: readonly GroupDef[],
  clusterIndex: number,
  distanceToObject: number,
): ClusterAnchors {
  const groupCount = groups.length;
  const angleOffset = CLUSTER_ANGLE_OFFSET * clusterIndex;
  const latitudeOffset = CLUSTER_LATITUDE_STEPS[clusterIndex % CLUSTER_LATITUDE_STEPS.length];
  const surfaceRadius = distanceToObject * SURFACE_RADIUS_RATIO;
  const jitterAmount = distanceToObject * GROUP_JITTER_RATIO;

  let centerSumX = 0;
  let centerSumY = 0;
  let centerSumZ = 0;

  const groupAnchors = groups.map((group, groupIndex) => {
    const centerDirection = fibonacciSphereDirection(
      groupIndex,
      groupCount,
      angleOffset,
      latitudeOffset,
    );
    const center = normalizeToRadius(centerDirection, distanceToObject);
    centerSumX += center.x;
    centerSumY += center.y;
    centerSumZ += center.z;

    const tagPoints: LocalPoint[] = [];
    const tagSurfacePoints: LocalPoint[] = [];

    group.tags.forEach((_, tagIndex) => {
      const seed = clusterIndex * 601 + groupIndex * 97 + tagIndex * 13 + 1;
      const jitterX = (seededUnit(seed) - 0.5) * 2 * jitterAmount;
      const jitterY = (seededUnit(seed + 0.37) - 0.5) * 2 * jitterAmount;
      const jitterZ = (seededUnit(seed + 0.71) - 0.5) * 2 * jitterAmount;
      const jittered = { x: center.x + jitterX, y: center.y + jitterY, z: center.z + jitterZ };

      tagPoints.push(normalizeToRadius(jittered, distanceToObject));
      tagSurfacePoints.push(normalizeToRadius(jittered, surfaceRadius));
    });

    return { tagPoints, tagSurfacePoints };
  });

  const clusterCenter =
    groupCount > 0
      ? normalizeToRadius(
          { x: centerSumX / groupCount, y: centerSumY / groupCount, z: centerSumZ / groupCount },
          distanceToObject,
        )
      : { x: 0, y: 0, z: distanceToObject };

  return { clusterCenter, groups: groupAnchors };
}
