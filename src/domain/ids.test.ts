import { describe, it, expect } from "vitest";
import { mintSubsprintId, mintItemId } from "./ids.js";

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
