import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("./src/App.svelte", import.meta.url), "utf8");
const styles = readFileSync(new URL("./src/styles.css", import.meta.url), "utf8");

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? "";
}

describe("dashboard presentation", () => {
  it("keeps blocked item rows readable without blue ids or strikeout", () => {
    expect(cssBlock(".todo-blocked .todo-title")).not.toContain("line-through");
    expect(cssBlock(".tree-id,\n  .todo-id")).not.toContain("text-primary");
    expect(cssBlock(".tree-id,\n  .todo-id")).toContain("text-base-content");
  });

  it("renders ledger rows without seq or event columns and puts target first", () => {
    expect(app).toContain("<tr><th>Target</th><th>Type</th><th>Verb</th><th>Text</th><th>Time</th></tr>");
    expect(app).not.toContain("<th>Seq</th>");
    expect(app).not.toContain("<th>Event</th>");
    expect(app).not.toContain("<td>{row.seq}</td>");
    expect(app).not.toContain("<td><code>{row.type}</code></td>");
  });

  it("uses color-coded ledger text instead of pill styling", () => {
    expect(cssBlock(".ledger-chip")).not.toContain("rounded-full");
    expect(cssBlock(".ledger-chip")).not.toContain("ring-1");
    expect(cssBlock(".ledger-chip")).toContain("font-semibold");
  });
});
