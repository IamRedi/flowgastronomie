import { it, expect } from "vitest";
import { createDesign, createTextLayer } from "@flowgastronomie/domain";
import { DesignHistory } from "./history";
it("bounds history, clears redo on edits and treats a multi-layer change as one command", () => {
  const first = createDesign("A4", "en");
  const history = new DesignHistory(first, 2);
  const next = {
    ...first,
    pages: [
      {
        ...first.pages[0]!,
        layers: [createTextLayer("one"), createTextLayer("two")],
      },
    ],
  };
  history.push(next);
  expect(history.undo()).toEqual(first);
  expect(history.redo()).toEqual(next);
  history.undo();
  history.push({ ...first, format: "A5" });
  expect(history.redo().format).toBe("A5");
  history.push({ ...first, format: "A6" });
  history.push({ ...first, format: "STORY" });
  history.undo();
  history.undo();
  expect(history.undo().format).toBe("A5");
});
