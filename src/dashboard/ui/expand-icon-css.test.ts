import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./src/styles.css", import.meta.url), "utf8");

describe("todo expand indicator CSS", () => {
  it("uses a chevron instead of plus/minus bars", () => {
    expect(styles).not.toMatch(/\.todo-expand::before/);
    expect(styles).toMatch(/\.todo-expand::after[\s\S]*border-r-2/);
    expect(styles).toMatch(/\.todo-expand::after[\s\S]*border-b-2/);
    expect(styles).toMatch(/\.todo-expand-open::after[\s\S]*rotate\(45deg\)/);
  });
});
