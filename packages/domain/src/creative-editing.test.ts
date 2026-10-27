import { it, expect } from "vitest";
import { createDesign, createTextLayer, type CreativeLayer } from "./creative";
import {
  groupCreativeLayers,
  replaceCreativeLayer,
  removeCreativeLayers,
  effectiveCreativeLayers,
  creativeExportWarnings,
  assertCreativeAssetLayer,
  duplicateCreativeLayers,
} from "./creative-editing";
it("groups, transforms, hides and removes layers with one canonical command", () => {
  const doc = createDesign("A4", "en");
  doc.pages[0]!.layers = [
    createTextLayer("one"),
    { ...createTextLayer("two"), y: 220 },
  ];
  const grouped = groupCreativeLayers(doc, ["one", "two"], "group");
  const group = grouped.pages[0]!.layers[2]!;
  const moved = replaceCreativeLayer(grouped, {
    ...group,
    x: group.x + 20,
    visible: false,
  });
  expect(moved.pages[0]!.layers[0]!.x).toBe(80);
  expect(effectiveCreativeLayers(moved)[0]!.visible).toBe(false);
  expect(removeCreativeLayers(moved, ["group"]).pages[0]!.layers).toHaveLength(
    0,
  );
  expect(doc.pages[0]!.layers[0]!.x).toBe(60);
  let id = 0;
  const duplicated = duplicateCreativeLayers(
    grouped,
    ["group"],
    () => `copy_${++id}`,
  );
  expect(duplicated.pages[0]!.layers).toHaveLength(6);
  expect(duplicated.pages[0]!.layers[3]!.groupId).toBe("copy_3");
  expect(duplicated.pages[0]!.layers[4]!.groupId).toBe("copy_3");
  const locked = replaceCreativeLayer(grouped, { ...group, locked: true });
  expect(
    removeCreativeLayers(locked, ["one", "group"]).pages[0]!.layers,
  ).toHaveLength(3);
});
it("blocks generated logos, unapproved images and covered QR codes at export", () => {
  const image: CreativeLayer = {
    id: "image",
    type: "logo",
    name: "Logo",
    x: 30,
    y: 30,
    width: 100,
    height: 100,
    opacity: 1,
    rotation: 0,
    locked: false,
    visible: true,
    groupId: null,
    bindingId: null,
    assetId: "asset",
    fit: "contain",
    focalX: 0.5,
    focalY: 0.5,
    radius: 0,
  };
  expect(() =>
    assertCreativeAssetLayer(
      image,
      { source: "GENERATED", approvedForPublicUse: true },
      false,
    ),
  ).toThrow("real logo");
  expect(() =>
    assertCreativeAssetLayer(
      { ...image, type: "image" },
      { source: "UPLOADED", approvedForPublicUse: false },
      true,
    ),
  ).toThrow("UNAPPROVED_ASSET");
  const doc = createDesign("A4", "en");
  doc.pages[0]!.layers = [
    {
      id: "qr",
      type: "qr",
      name: "QR",
      x: 40,
      y: 80,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      groupId: null,
      bindingId: "qr",
      fill: "#000000",
      background: "#ffffff",
    },
    createTextLayer("overlap"),
  ];
  expect(() => creativeExportWarnings(doc, [])).toThrow("overlaps");
});
