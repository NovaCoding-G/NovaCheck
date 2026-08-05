import { describe, expect, test } from "bun:test";
import type { Finding } from "../../src/types/index.ts";
import {
  computeTrustScore,
  scoreBand,
  sortFindings,
  topPriorityFindings,
} from "../../src/scoring/trust-score.ts";

function f(severity: Finding["severity"], title = "x"): Finding {
  return {
    id: `${severity}:${title}`,
    detectorId: "test",
    severity,
    title,
    explanation: "why",
    fixPrompt: "fix it",
  };
}

describe("computeTrustScore", () => {
  test("perfect score with no findings", () => {
    expect(computeTrustScore([])).toBe(100);
  });

  test("subtracts severity weights", () => {
    // 100 - 25 - 12 = 63
    expect(computeTrustScore([f("critical"), f("high")])).toBe(63);
  });

  test("clamps at 0", () => {
    expect(
      computeTrustScore([
        f("critical"),
        f("critical"),
        f("critical"),
        f("critical"),
        f("critical"),
      ]),
    ).toBe(0);
  });

  test("info does not reduce score", () => {
    expect(computeTrustScore([f("info"), f("info")])).toBe(100);
  });
});

describe("priority ordering", () => {
  test("sortFindings puts critical first", () => {
    const sorted = sortFindings([f("low"), f("critical"), f("medium")]);
    expect(sorted.map((x) => x.severity)).toEqual([
      "critical",
      "medium",
      "low",
    ]);
  });

  test("topPriorityFindings limits to 5", () => {
    const many = [
      f("critical", "a"),
      f("critical", "b"),
      f("high", "c"),
      f("high", "d"),
      f("medium", "e"),
      f("medium", "f"),
    ];
    expect(topPriorityFindings(many, 5)).toHaveLength(5);
  });
});

describe("scoreBand", () => {
  test("maps bands", () => {
    expect(scoreBand(95).label).toBe("excellent");
    expect(scoreBand(75).label).toBe("good");
    expect(scoreBand(55).label).toBe("fair");
    expect(scoreBand(10).shields).toBe("red");
  });
});
