"use client";

import * as React from "react";
import { ArrowCounterClockwiseIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react";

import type { ToolcraftCustomControlRenderer } from "@/toolcraft/runtime/react";
import { Button, Color, Input, Switch } from "@/toolcraft/ui";
// Swatch-only trigger + Toolcraft's own color picker popover (the same one
// every Color control uses) -- compact enough to fit inside a tag row.
import { ColorPickerPopover } from "@/toolcraft/ui/components/controls/color/color-picker-popover";

import {
  MAX_CLUSTERS,
  MAX_GROUPS_PER_CLUSTER,
  MAX_TAGS_PER_GROUP,
  defaultGroupColor,
  resolveGroupColor,
  resolveTagColor,
  type ClusterDef,
  type GroupDef,
} from "../ascii-engine/tag-cluster-types";
import styles from "./tag-clusters-control.module.css";

/**
 * Custom control for the Clusters -> Groups -> Tags value model.
 *
 * Built-in-first check: `collectionActions` (Toolcraft's built-in growable
 * list control) was considered first, since this is a growable/removable
 * item set. It doesn't fit here because its item model is a single scalar
 * value per row (text, color, slider, ...); it cannot represent a 3-level
 * nested structure where each cluster owns its own list of groups, and each
 * group owns its own list of tags. That's a genuine custom-value-model gap,
 * not a styling/layout preference, so a real custom control is justified
 * per docs/toolcraft/custom-controls.md.
 */
function makeTag(): { filled: boolean; text: string } {
  return { filled: true, text: "TAG_01" };
}

function makeGroup(color: string): GroupDef {
  return {
    chainLine: false,
    color,
    objectLine: false,
    tags: [makeTag()],
  };
}

function makeCluster(clusterIndex: number): ClusterDef {
  return { giantSquare: false, groups: [makeGroup(defaultGroupColor(clusterIndex, 0))] };
}

export const TagClustersControl: ToolcraftCustomControlRenderer = ({ setValue, value }) => {
  const clusters = Array.isArray(value) ? (value as ClusterDef[]) : [];

  function commit(next: ClusterDef[], _label: string): void {
    setValue(next);
  }

  function addCluster(): void {
    if (clusters.length >= MAX_CLUSTERS) {
      return;
    }
    commit([...clusters, makeCluster(clusters.length)], "Add cluster");
  }

  function removeCluster(clusterIndex: number): void {
    if (clusters.length <= 1) {
      return;
    }
    commit(
      clusters.filter((_, index) => index !== clusterIndex),
      "Remove cluster",
    );
  }

  function addGroup(clusterIndex: number): void {
    const cluster = clusters[clusterIndex];
    if (!cluster || cluster.groups.length >= MAX_GROUPS_PER_CLUSTER) {
      return;
    }
    commit(
      clusters.map((c, index) =>
        index === clusterIndex
          ? { ...c, groups: [...c.groups, makeGroup(defaultGroupColor(clusterIndex, c.groups.length))] }
          : c,
      ),
      "Add group",
    );
  }

  function removeGroup(clusterIndex: number, groupIndex: number): void {
    const cluster = clusters[clusterIndex];
    if (!cluster || cluster.groups.length <= 1) {
      return;
    }
    commit(
      clusters.map((c, index) =>
        index === clusterIndex
          ? { ...c, groups: c.groups.filter((_, gIndex) => gIndex !== groupIndex) }
          : c,
      ),
      "Remove group",
    );
  }

  function addTag(clusterIndex: number, groupIndex: number): void {
    const group = clusters[clusterIndex]?.groups[groupIndex];
    if (!group || group.tags.length >= MAX_TAGS_PER_GROUP) {
      return;
    }
    commit(
      clusters.map((c, cIndex) =>
        cIndex === clusterIndex
          ? {
              ...c,
              groups: c.groups.map((g, gIndex) =>
                gIndex === groupIndex ? { ...g, tags: [...g.tags, makeTag()] } : g,
              ),
            }
          : c,
      ),
      "Add tag",
    );
  }

  function removeTag(clusterIndex: number, groupIndex: number, tagIndex: number): void {
    const group = clusters[clusterIndex]?.groups[groupIndex];
    if (!group || group.tags.length <= 1) {
      return;
    }
    commit(
      clusters.map((c, cIndex) =>
        cIndex === clusterIndex
          ? {
              ...c,
              groups: c.groups.map((g, gIndex) =>
                gIndex === groupIndex
                  ? { ...g, tags: g.tags.filter((_, tIndex) => tIndex !== tagIndex) }
                  : g,
              ),
            }
          : c,
      ),
      "Remove tag",
    );
  }

  function updateTagText(
    clusterIndex: number,
    groupIndex: number,
    tagIndex: number,
    text: string,
  ): void {
    commit(
      clusters.map((c, cIndex) =>
        cIndex === clusterIndex
          ? {
              ...c,
              groups: c.groups.map((g, gIndex) =>
                gIndex === groupIndex
                  ? {
                      ...g,
                      tags: g.tags.map((t, tIndex) =>
                        tIndex === tagIndex ? { ...t, text } : t,
                      ),
                    }
                  : g,
              ),
            }
          : c,
      ),
      "Tag text",
    );
  }

  function updateTagFilled(
    clusterIndex: number,
    groupIndex: number,
    tagIndex: number,
    filled: boolean,
  ): void {
    commit(
      clusters.map((c, cIndex) =>
        cIndex === clusterIndex
          ? {
              ...c,
              groups: c.groups.map((g, gIndex) =>
                gIndex === groupIndex
                  ? {
                      ...g,
                      tags: g.tags.map((t, tIndex) =>
                        tIndex === tagIndex ? { ...t, filled } : t,
                      ),
                    }
                  : g,
              ),
            }
          : c,
      ),
      "Tag filled",
    );
  }

  // `color` undefined = clear the override (tag follows its group color again).
  function updateTagColor(
    clusterIndex: number,
    groupIndex: number,
    tagIndex: number,
    color: string | undefined,
  ): void {
    commit(
      clusters.map((c, cIndex) =>
        cIndex === clusterIndex
          ? {
              ...c,
              groups: c.groups.map((g, gIndex) =>
                gIndex === groupIndex
                  ? {
                      ...g,
                      tags: g.tags.map((t, tIndex) => {
                        if (tIndex !== tagIndex) {
                          return t;
                        }
                        if (!color) {
                          const { color: _removed, ...rest } = t;
                          return rest;
                        }
                        return { ...t, color: color.toUpperCase() };
                      }),
                    }
                  : g,
              ),
            }
          : c,
      ),
      "Tag color",
    );
  }

  function updateGroupFlag(
    clusterIndex: number,
    groupIndex: number,
    key: "chainLine" | "objectLine",
    value: boolean,
  ): void {
    commit(
      clusters.map((c, cIndex) =>
        cIndex === clusterIndex
          ? {
              ...c,
              groups: c.groups.map((g, gIndex) =>
                gIndex === groupIndex ? { ...g, [key]: value } : g,
              ),
            }
          : c,
      ),
      "Group option",
    );
  }

  function updateGroupColor(clusterIndex: number, groupIndex: number, color: string): void {
    commit(
      clusters.map((c, cIndex) =>
        cIndex === clusterIndex
          ? {
              ...c,
              groups: c.groups.map((g, gIndex) => (gIndex === groupIndex ? { ...g, color } : g)),
            }
          : c,
      ),
      "Group color",
    );
  }

  function updateClusterGiantSquare(clusterIndex: number, giantSquare: boolean): void {
    commit(
      clusters.map((c, cIndex) => (cIndex === clusterIndex ? { ...c, giantSquare } : c)),
      "Giant square",
    );
  }

  return (
    <div className={styles.clusters} data-slot="tag-clusters-control">
      {clusters.map((cluster, clusterIndex) => (
        <div className={styles.cluster} key={`cluster-${clusterIndex}`}>
          <div className={styles.clusterHeader}>
            <span className={styles.clusterTitle}>{`Cluster ${clusterIndex + 1}`}</span>
            <span className={styles.clusterGiantSquareSwitch}>
              <Switch
                checked={cluster.giantSquare}
                name="Giant square"
                onCheckedChange={(checked) => updateClusterGiantSquare(clusterIndex, checked)}
              />
            </span>
            <Button
              aria-label={`Remove cluster ${clusterIndex + 1}`}
              disabled={clusters.length <= 1}
              onClick={() => removeCluster(clusterIndex)}
              size="icon-xs"
              type="button"
              variant="outline"
            >
              <MinusIcon />
            </Button>
          </div>

          <div className={styles.groups}>
            {cluster.groups.map((group, groupIndex) => (
              <div className={styles.group} key={`group-${clusterIndex}-${groupIndex}`}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupTitle}>{`Group ${groupIndex + 1}`}</span>
                  <Button
                    aria-label={`Remove group ${groupIndex + 1}`}
                    disabled={cluster.groups.length <= 1}
                    onClick={() => removeGroup(clusterIndex, groupIndex)}
                    size="icon-xxs"
                    type="button"
                    variant="outline"
                  >
                    <MinusIcon />
                  </Button>
                </div>

                <div className={styles.groupColor}>
                  <Color
                    hex={resolveGroupColor(group.color, clusterIndex, groupIndex)}
                    name="Tag color"
                    showLabel
                    onValueChange={(next) =>
                      updateGroupColor(clusterIndex, groupIndex, next.hex)
                    }
                  />
                </div>

                <div className={styles.tags}>
                  {group.tags.map((tag, tagIndex) => (
                    <div
                      className={styles.tagRow}
                      key={`tag-${clusterIndex}-${groupIndex}-${tagIndex}`}
                    >
                      <Input
                        aria-label={`Cluster ${clusterIndex + 1} group ${groupIndex + 1} tag ${
                          tagIndex + 1
                        }`}
                        className={styles.tagInput}
                        onChange={(event) =>
                          updateTagText(clusterIndex, groupIndex, tagIndex, event.target.value)
                        }
                        size="sm"
                        value={tag.text}
                      />
                      <span className={styles.tagColor}>
                        {tag.filled ? (
                          <>
                          <ColorPickerPopover
                            label={`tag ${tag.text || tagIndex + 1} color`}
                            onColorChange={(next) =>
                              updateTagColor(clusterIndex, groupIndex, tagIndex, next)
                            }
                            pickerValue={resolveTagColor(tag, group, clusterIndex, groupIndex)}
                            size="sm"
                            swatchColor={resolveTagColor(tag, group, clusterIndex, groupIndex)}
                          />
                          {tag.color ? (
                            <Button
                              aria-label={`Reset tag ${tagIndex + 1} to group color`}
                              onClick={() =>
                                updateTagColor(clusterIndex, groupIndex, tagIndex, undefined)
                              }
                              size="icon-xxs"
                              title="Use group color"
                              type="button"
                              variant="ghost"
                            >
                              <ArrowCounterClockwiseIcon />
                            </Button>
                          ) : null}
                          </>
                        ) : null}
                      </span>
                      <span className={styles.tagFilledSwitch}>
                        <Switch
                          checked={tag.filled}
                          name="Filled"
                          onCheckedChange={(checked) =>
                            updateTagFilled(clusterIndex, groupIndex, tagIndex, checked)
                          }
                          showLabel={false}
                        />
                      </span>
                      <Button
                        aria-label={`Remove tag ${tagIndex + 1}`}
                        disabled={group.tags.length <= 1}
                        onClick={() => removeTag(clusterIndex, groupIndex, tagIndex)}
                        size="icon-xxs"
                        type="button"
                        variant="outline"
                      >
                        <MinusIcon />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className={styles.addRow}>
                  <Button
                    aria-label={`Add tag to group ${groupIndex + 1}`}
                    disabled={group.tags.length >= MAX_TAGS_PER_GROUP}
                    onClick={() => addTag(clusterIndex, groupIndex)}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    <PlusIcon />
                    Tag
                  </Button>
                </div>

                <div className={styles.groupFlags}>
                  <Switch
                    checked={group.objectLine}
                    name="Object line"
                    onCheckedChange={(checked) =>
                      updateGroupFlag(clusterIndex, groupIndex, "objectLine", checked)
                    }
                  />
                  <Switch
                    checked={group.chainLine}
                    name="Chain line"
                    onCheckedChange={(checked) =>
                      updateGroupFlag(clusterIndex, groupIndex, "chainLine", checked)
                    }
                  />
                </div>
              </div>
            ))}
          </div>

          <div className={styles.addRow}>
            <Button
              aria-label={`Add group to cluster ${clusterIndex + 1}`}
              disabled={cluster.groups.length >= MAX_GROUPS_PER_CLUSTER}
              onClick={() => addGroup(clusterIndex)}
              size="xs"
              type="button"
              variant="outline"
            >
              <PlusIcon />
              Group
            </Button>
          </div>
        </div>
      ))}

      <div className={styles.addRow}>
        <Button
          aria-label="Add cluster"
          disabled={clusters.length >= MAX_CLUSTERS}
          onClick={addCluster}
          size="xs"
          type="button"
          variant="outline"
        >
          <PlusIcon />
          Cluster
        </Button>
      </div>
    </div>
  );
};
