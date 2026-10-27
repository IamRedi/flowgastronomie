import { expect, it } from "vitest";
import { assertMediaApproval, mediaDisclosure } from "./canonical-media";
it("requires explicit approval and truthful generated/demo provenance", () => {
  const demo = {
    source: "DEMO" as const,
    description: "Synthetic illustration",
  };
  expect(() => assertMediaApproval(demo, false, true)).not.toThrow();
  expect(() => assertMediaApproval(demo, true, true)).toThrow();
  expect(() => assertMediaApproval(demo, false, false)).toThrow();
  expect(() =>
    assertMediaApproval({ ...demo, source: "GENERATED" }, false, true),
  ).toThrow();
  expect(mediaDisclosure("GENERATED")).toBe("AI-generated illustration");
  expect(() =>
    assertMediaApproval(
      {
        source: "IMPORT",
        description: "Derivative",
        transformation: "EDGE_CONNECTED_BLACK_TO_ALPHA_V1",
      },
      false,
      true,
    ),
  ).toThrow("immutable original");
});
