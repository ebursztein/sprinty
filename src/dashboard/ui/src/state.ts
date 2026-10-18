import { useEffect, useState } from "react";
import type { SprintView } from "../../../domain/projection.js";

/** One request at a time; failed polls keep the last successful snapshot visible. */
export function useSprint() {
  const [sprint, setSprint] = useState<SprintView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch("/state", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Connection returned ${response.status}`);
        const data = await response.json();
        if (
          !data ||
          typeof data.goal !== "string" ||
          !Array.isArray(data.subsprints)
        )
          throw new Error("Sprinty returned an invalid snapshot");
        if (!stopped) {
          setSprint(data);
          setError(null);
        }
      } catch (err) {
        if (!stopped)
          setError(
            err instanceof Error ? err.message : "Unable to connect to Sprinty",
          );
      } finally {
        if (!stopped) timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [retry]);
  return { sprint, error, retry: () => setRetry((n) => n + 1) };
}

export function initialTheme(): "light" | "dark" {
  try {
    const saved = localStorage.getItem("sprinty-dashboard-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* restricted browser storage */
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}
