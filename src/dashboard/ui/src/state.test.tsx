import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSprint } from "./state";
import { demoSprint } from "./fixtures";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("state polling", () => {
  it("preserves the last snapshot through failure and aborts requests on unmount", async () => {
    vi.useFakeTimers();
    const state = demoSprint();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => state })
      .mockRejectedValueOnce(new Error("Offline"));
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(useSprint);
    await act(async () => {});
    expect(result.current.sprint?.goal).toBe(state.goal);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.error).toBe("Offline");
    expect(result.current.sprint?.goal).toBe(state.goal);
    const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("never overlaps slow polls and rejects malformed snapshots", async () => {
    vi.useFakeTimers();
    let complete!: (value: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(useSprint);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      complete({ ok: true, json: async () => ({ invalid: true }) });
    });
    expect(result.current.error).toContain("invalid snapshot");
    expect(result.current.sprint).toBeNull();
  });
});
