import { describe, expect, test } from "bun:test";
import {
  DETECTOR_IDS,
  detectors,
  selectDetectors,
} from "../../src/detectors/index.ts";

describe("selectDetectors", () => {
  test("defaults to the full ordered list", () => {
    expect(selectDetectors().map((d) => d.id)).toEqual([...DETECTOR_IDS]);
    expect(DETECTOR_IDS[0]).toBe("ghost-deps");
  });

  test("ghost-hunt mode runs the wedge detector only", () => {
    const selected = selectDetectors({ only: ["ghost-deps"] });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe("ghost-deps");
  });

  test("skip keeps the default order for the rest", () => {
    const selected = selectDetectors({ skip: ["ai-presence", "ai-unreviewed"] });
    expect(selected.map((d) => d.id)).toEqual(
      detectors
        .map((d) => d.id)
        .filter((id) => id !== "ai-presence" && id !== "ai-unreviewed"),
    );
  });

  test("unknown ids fail loudly instead of scanning less than asked", () => {
    expect(() => selectDetectors({ only: ["ghost-dep"] })).toThrow(
      /Unknown detector "ghost-dep"/,
    );
    expect(() => selectDetectors({ skip: ["nope"] })).toThrow(
      /Unknown detector "nope"/,
    );
  });

  test("an empty selection is an error, not a silent pass", () => {
    expect(() =>
      selectDetectors({ only: ["ghost-deps"], skip: ["ghost-deps"] }),
    ).toThrow(/nothing would be scanned/);
  });
});
