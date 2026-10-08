import { describe, expect, it } from "vitest";

import { appSchema } from "./app-schema";

describe("appSchema", () => {
  it("configures an editable-output, render-scaled, upload-enabled canvas", () => {
    expect(appSchema.canvas.enabled).toBe(true);
    expect(appSchema.canvas.sizing).toEqual({ mode: "editable-output" });
    expect(appSchema.canvas.upload).toBe(true);
    expect(appSchema.canvas.renderScale).toMatchObject({ enabled: true });
  });

  it("disables the whole-canvas drag-pan so OrbitControls owns pointer drag on the 3D view", () => {
    expect(appSchema.canvas.draggable).toBe(false);
  });

  it("has no layers or timeline (single autonomous-animation output)", () => {
    expect(appSchema.panels.layers).toBeUndefined();
    expect(appSchema.panels.timeline).toBeUndefined();
  });

  it("declares the product control sections after runtime Setup", () => {
    const sectionTitles = appSchema.panels.controls?.sections.map((section) => section.title);

    expect(sectionTitles?.[0]).toBe("Setup");
    expect(sectionTitles).toEqual(
      expect.arrayContaining([
        "Shape",
        "Custom Model",
        "Orientation",
        "Camera",
        "Motion",
        "ASCII Grid",
        "Characters & Font",
        "Appearance",
        "Background",
        "Image Export",
      ]),
    );
  });

  it("exposes a single Shape selector (Key/Torus/Circle/Square/Custom) and a Custom Model upload gated by it", () => {
    const sections = appSchema.panels.controls?.sections ?? [];
    const shapeSection = sections.find((section) => section.title === "Shape");
    const customModelSection = sections.find((section) => section.title === "Custom Model");

    expect(shapeSection?.controls.shape).toMatchObject({
      defaultValue: "key",
      target: "model.shape",
      type: "select",
    });
    expect(shapeSection?.controls.shape?.options?.map((option) => option.value)).toEqual([
      "key",
      "torus",
      "circle",
      "square",
      "custom",
    ]);
    expect(customModelSection?.controls.source).toMatchObject({
      assetKind: "file",
      target: "model.source",
      type: "fileDrop",
    });
    expect(customModelSection?.visibleWhen).toEqual({ equals: "custom", target: "model.shape" });
  });

  it("widens Brightness so it can be pushed enough to guarantee glyph visibility without touching the shader", () => {
    const sections = appSchema.panels.controls?.sections ?? [];
    const appearanceSection = sections.find((section) => section.title === "Appearance");

    expect(appearanceSection?.controls.brightness).toMatchObject({
      max: 1,
      min: -1,
      target: "appearance.brightness",
      type: "slider",
    });
  });

  it("exposes a Tracking Tags overlay section gated behind its own enabled switch", () => {
    const sections = appSchema.panels.controls?.sections ?? [];
    const tagsSection = sections.find((section) => section.title === "Tracking Tags");

    expect(tagsSection?.controls.enabled).toMatchObject({
      target: "tags.enabled",
      type: "switch",
    });
    expect(tagsSection?.controls.clusters).toMatchObject({
      target: "tags.clusters",
      type: "tagClusters",
    });
    expect(tagsSection?.controls.clusters?.visibleWhen).toEqual({
      equals: true,
      target: "tags.enabled",
    });
    expect(Array.isArray(tagsSection?.controls.clusters?.defaultValue)).toBe(true);
    // Tag colors are per group (GroupDef.color), not a shared palette control.
    expect(tagsSection?.controls.colors).toBeUndefined();
    const defaultClusters = tagsSection?.controls.clusters?.defaultValue as
      | { groups: { color: string }[] }[]
      | undefined;
    for (const cluster of defaultClusters ?? []) {
      for (const group of cluster.groups) {
        expect(group.color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("exposes shared, customizable size/square/line style controls for the tag overlay", () => {
    const sections = appSchema.panels.controls?.sections ?? [];
    const tagsSection = sections.find((section) => section.title === "Tracking Tags");

    expect(tagsSection?.controls.size).toMatchObject({
      defaultValue: 1,
      target: "tags.size",
      type: "slider",
    });
    expect(tagsSection?.controls.paddingX).toMatchObject({
      defaultValue: 4,
      target: "tags.paddingX",
      type: "slider",
    });
    expect(tagsSection?.controls.paddingY).toMatchObject({
      defaultValue: 6,
      target: "tags.paddingY",
      type: "slider",
    });
    expect(tagsSection?.controls.distanceToObject).toMatchObject({
      defaultValue: 1.05,
      target: "tags.distanceToObject",
      type: "slider",
    });
    expect(tagsSection?.controls.giantSquareSize).toMatchObject({
      target: "tags.squareSize",
      type: "slider",
    });
    expect(tagsSection?.controls.giantSquareColor).toMatchObject({
      target: "tags.squareColor",
      type: "color",
    });
    expect(tagsSection?.controls.lineColor).toMatchObject({
      target: "tags.lineColor",
      type: "color",
    });
    expect(tagsSection?.controls.lineThickness).toMatchObject({
      target: "tags.lineThickness",
      type: "slider",
    });
    expect(tagsSection?.controls.lineStyle).toMatchObject({
      target: "tags.lineStyle",
      type: "select",
    });
    expect(tagsSection?.controls.lineStyle?.options?.map((option) => option.value)).toEqual([
      "solid",
      "dashed",
    ]);
  });

  it("exposes Greyscale luminance as a continuous intensity slider, not a switch", () => {
    const sections = appSchema.panels.controls?.sections ?? [];
    const asciiGridSection = sections.find((section) => section.title === "ASCII Grid");

    expect(asciiGridSection?.controls.greyscaleIntensity).toMatchObject({
      defaultValue: 0.55,
      max: 1,
      min: 0,
      target: "ascii.greyscaleIntensity",
      type: "slider",
    });
  });

  it("routes Export PNG and Export Code through the sticky footer", () => {
    const actionValues = appSchema.panels.controls?.sections
      .flatMap((section) => Object.values(section.controls))
      .filter((control) => control.type === "panelActions")
      .flatMap((control) => control.actions ?? [])
      .map((action) => (typeof action === "string" ? action : action.value));

    expect(actionValues).toEqual(expect.arrayContaining(["export.png", "export.code"]));
  });
});
