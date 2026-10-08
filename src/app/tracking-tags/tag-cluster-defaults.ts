import {
  defaultGroupColor,
  type ClusterDef,
  type TagDef,
} from "../ascii-engine/tag-cluster-types";

function tag(text: string, filled = true): TagDef {
  return { filled, text };
}

// 3 clusters x 3 groups x 3 tags = 9 tags on screen at once, 27 total,
// cycling one cluster every 120 degrees of rotation -- a reasonable "a lot
// of them" starting point that's still easy to read at a glance. Mixes
// filled/unfilled tags and the line/giant-square options across
// clusters/groups so all of it is visible without any setup.
export const DEFAULT_TAG_CLUSTERS: ClusterDef[] = [
  {
    // Deliberately false, not true, for THIS cluster specifically -- with
    // an odd (3) group count and cluster index 0's latitude offset of 0
    // (see CLUSTER_LATITUDE_STEPS in ../ascii-engine/tag-cluster-anchors.ts),
    // groups 0 and 2 land exactly on opposite poles of the anchor sphere,
    // canceling out of the centroid mean entirely -- so this cluster's
    // giant square would collapse onto group 1's own center instead of a
    // genuine "cluster center" point, and for the asymmetric default "key"
    // model that specific point can land off the object's actual rendered
    // silhouette, reading as a detached, empty box rather than a marker on
    // the object. Clusters 1/2 don't have this degeneracy (their nonzero
    // latitude offsets keep every group off the exact poles), so their
    // giant squares are left enabled.
    giantSquare: false,
    groups: [
      {
        chainLine: true,
        color: defaultGroupColor(0, 0),
        objectLine: false,
        tags: [tag("NODE_01"), tag("HUB_A3"), tag("SYNC_04")],
      },
      {
        chainLine: false,
        color: defaultGroupColor(0, 1),
        objectLine: true,
        tags: [tag("TRACK_A3", false), tag("LIVE_FEED", false), tag("DATA_PT")],
      },
      {
        chainLine: false,
        color: defaultGroupColor(0, 2),
        objectLine: false,
        tags: [tag("GLOBAL_NET"), tag("RELAY_02"), tag("ANCHOR_B7", false)],
      },
    ],
  },
  {
    giantSquare: false,
    groups: [
      {
        chainLine: true,
        color: defaultGroupColor(1, 0),
        objectLine: false,
        tags: [tag("PULSE_11"), tag("GRID_04"), tag("VECTOR_9")],
      },
      {
        chainLine: false,
        color: defaultGroupColor(1, 1),
        objectLine: false,
        tags: [tag("STREAM_3"), tag("NODE_02", false), tag("CORE_X1")],
      },
      {
        chainLine: false,
        color: defaultGroupColor(1, 2),
        objectLine: true,
        tags: [tag("EDGE_07"), tag("MESH_14"), tag("PING_5", false)],
      },
    ],
  },
  {
    giantSquare: true,
    groups: [
      {
        chainLine: false,
        color: defaultGroupColor(2, 0),
        objectLine: false,
        tags: [tag("UNIT_08"), tag("SCAN_12"), tag("LINK_A1")],
      },
      {
        chainLine: true,
        color: defaultGroupColor(2, 1),
        objectLine: false,
        tags: [tag("ZONE_3"), tag("BEACON_6", false), tag("ECHO_02")],
      },
      {
        chainLine: false,
        color: defaultGroupColor(2, 2),
        objectLine: true,
        tags: [tag("ORBIT_9"), tag("FLUX_04"), tag("PATH_11")],
      },
    ],
  },
];
