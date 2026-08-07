import { describe, it, expect } from "vitest";
import { mintSubsprintId, mintItemId, mintNoteId, legacyNoteId } from "./ids.js";

describe("id minting", () => {
  it("subsprint ids are S + 2-digit, 1-based", () => {
    expect(mintSubsprintId(0)).toBe("S01");
    expect(mintSubsprintId(8)).toBe("S09");
    expect(mintSubsprintId(11)).toBe("S12");
  });
  it("item ids are <subsprint>-<3-digit>, 1-based within the subsprint", () => {
    expect(mintItemId("S01", 0)).toBe("S01-001");
    expect(mintItemId("S01", 41)).toBe("S01-042");
    expect(mintItemId("S12", 9)).toBe("S12-010");
  });
});

describe("note ids", () => {
  it("mints a 12-hex id, not a positional counter", () => {
    const id = mintNoteId();
    expect(id).toMatch(/^N[0-9a-f]{12}$/);
  });

  it("does not collide across many notes, unlike seq-derived ids under concurrent writers", () => {
    const ids = new Set(Array.from({ length: 5_000 }, () => mintNoteId()));
    expect(ids.size).toBe(5_000);
  });

  it("still resolves ids in ledgers written before notes carried their own id", () => {
    // Old events had no note_id; the id was derived from the event's seq.
    expect(legacyNoteId(0)).toBe("N000");
    expect(legacyNoteId(42)).toBe("N042");
  });
});
