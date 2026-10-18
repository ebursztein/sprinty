import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { demoSprint } from "./fixtures";
vi.mock("./state", () => ({
  initialTheme: () => "dark",
  useSprint: () => ({ sprint: null, error: null, retry: vi.fn() }),
}));
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("React dashboard", () => {
  it("filters work, opens an accessible inspector, navigates evidence and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<App initialSprint={demoSprint()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Ship the next release",
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Search work" }),
      "work table",
    );
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      2,
    );
    await user.click(
      screen.getByRole("button", { name: /S02-002 Build the work table/ }),
    );
    const dialog = screen.getByRole("dialog", { name: "Item S02-002" });
    expect(within(dialog).getByText("Observed active work")).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: /Verification/ }),
    );
    expect(within(dialog).getByText("Evidence, not a checkbox")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("shows ownership, claim history and both stall reasons without auto-reassigning", async () => {
    const sprint = demoSprint();
    const item = sprint.subsprints[1]!.items[0]!;
    item.claim.stall_reasons = [
      "three_other_items_completed",
      "owner_inactive_one_hour",
    ];
    const user = userEvent.setup();
    render(<App initialSprint={sprint} />);
    await user.click(
      screen.getByRole("button", { name: /may need attention/ }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/Three other items completed/),
    ).toBeVisible();
    expect(within(dialog).getByText(/at least one hour/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "History" }));
    expect(within(dialog).getByText("Ownership & handovers")).toBeVisible();
    expect(within(dialog).getByText("curious-otter")).toBeVisible();
  });
  it("switches views and links agent claims back to items", async () => {
    const user = userEvent.setup();
    render(<App initialSprint={demoSprint()} />);
    await user.click(screen.getByRole("button", { name: /Agents/ }));
    expect(
      screen.getByRole("heading", { name: /Agents, together/ }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: /S02-002 Build the work table/ }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Activity" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search activity" }),
      "ownership",
    );
    expect(screen.getByText(/The sprint record/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Artifacts" }));
    expect(
      screen.getByRole("heading", { name: "Release verification report" }),
    ).toBeVisible();
  });
  it("renders queue/sleep-aware server ETA states and suppresses calendar finish while paused", () => {
    const sprint = demoSprint();
    sprint.eta = {
      ...sprint.eta,
      status: "paused",
      remaining_work_ms: 420000,
      finish_range_at: ["2026-10-18T15:00:00Z", "2026-10-18T16:00:00Z"],
    };
    render(<App initialSprint={sprint} />);
    expect(screen.getByLabelText("Sprint estimate")).toHaveTextContent("7m");
    expect(screen.getByText("Paused")).toBeVisible();
    expect(screen.queryByText(/Approx. finish/)).not.toBeInTheDocument();
  });
});
