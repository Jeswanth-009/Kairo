import { describe, expect, it } from "vitest";
import { ORIGIN_BADGES, originBadge, originState, utcNow } from "./origin";

describe("originState — the honest review ladder", () => {
  it("imported records start at the bottom", () => {
    expect(originState({ origin: "imported" })).toBe("imported");
  });

  it("an import that the user changed reads as edited", () => {
    expect(originState({ origin: "imported", editedAt: "2026-10-02 10:00:00" })).toBe("edited");
  });

  it("evidence outranks edited", () => {
    expect(
      originState({ origin: "imported", editedAt: "2026-10-02 10:00:00", evidenceCount: 2 }),
    ).toBe("evidenced");
  });

  it("explicit verification wins over everything", () => {
    expect(
      originState({
        origin: "imported",
        editedAt: "2026-10-02 10:00:00",
        evidenceCount: 2,
        verifiedAt: "2026-10-02 11:00:00",
      }),
    ).toBe("verified");
  });

  it("manual records have no review state", () => {
    expect(originState({ origin: "manual", evidenceCount: 3 })).toBe("evidenced");
    expect(originState({})).toBe("manual");
    expect(originState({ origin: "manual" })).toBe("manual");
  });
});

describe("originBadge labels never overstate trust", () => {
  it("uses the exact phase-2 wording", () => {
    expect(ORIGIN_BADGES.imported.label).toBe("Imported from resume");
    expect(ORIGIN_BADGES.edited.label).toBe("Edited by you");
    expect(ORIGIN_BADGES.evidenced.label).toBe("Evidence attached");
    expect(ORIGIN_BADGES.verified.label).toBe("Verified by you");
  });

  it("manual records get no badge at all", () => {
    expect(originBadge({ origin: "manual" })).toBeNull();
    expect(originBadge({})).toBeNull();
  });

  it("imports always get a badge", () => {
    expect(originBadge({ origin: "imported" })?.label).toBe("Imported from resume");
    expect(originBadge({ origin: "imported", verifiedAt: "x" })?.label).toBe("Verified by you");
  });
});

describe("utcNow", () => {
  it("formats like SQLite datetime('now')", () => {
    expect(utcNow()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
