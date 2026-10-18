import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkTable, { type WorkRow } from "./WorkTable";
import { demoSprint } from "./fixtures";
import { Markdown } from "./ItemDetail";
afterEach(cleanup);
function rows(): WorkRow[] {
  const item = demoSprint().subsprints[0]!.items[0]!;
  return Array.from({ length: 31 }, (_, i) => ({
    ...item,
    id: `S01-${String(i + 1).padStart(3, "0")}`,
    title: `Task ${String(31 - i).padStart(2, "0")}`,
    displayStatus: "Completed",
    subsprintLabel: "Feature",
  }));
}
describe("work table behavior", () => {
  it("sorts through TanStack and resets pagination when filtering", async () => {
    const user = userEvent.setup();
    render(<WorkTable rows={rows()} onSelect={vi.fn()} />);
    expect(screen.getByText("1–15 of 31 items")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next", exact: true }));
    expect(screen.getByText("16–30 of 31 items")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Work item/ }));
    const first = within(screen.getByRole("table")).getAllByRole("row")[1]!;
    expect(first).toHaveTextContent("Task 16");
    await user.click(
      screen.getByRole("button", { name: "Previous", exact: true }),
    );
    expect(
      within(screen.getByRole("table")).getAllByRole("row")[1]!,
    ).toHaveTextContent("Task 01");
    await user.click(screen.getByRole("button", { name: "Next", exact: true }));
    await user.type(
      screen.getByRole("textbox", { name: "Search work" }),
      "Task 01",
    );
    expect(screen.getByText("1–1 of 1 items")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Previous", exact: true }),
    ).toBeDisabled();
  });
  it("shows an empty result without dropping the table controls", async () => {
    const user = userEvent.setup();
    render(<WorkTable rows={rows()} onSelect={vi.fn()} />);
    await user.type(
      screen.getByRole("textbox", { name: "Search work" }),
      "missing",
    );
    expect(screen.getByText("No matching work")).toBeVisible();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
  it("sanitizes rendered markdown", () => {
    const { container } = render(
      <Markdown
        text={
          '<img src=x onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">Unsafe</a>'
        }
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")?.hasAttribute("onerror")).toBe(false);
    expect(container.querySelector("a")?.hasAttribute("href")).toBe(false);
  });
});
