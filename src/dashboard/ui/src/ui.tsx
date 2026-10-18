import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "./components/untitled/button";
export { Button };
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}
export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {name
        .split("-")
        .map((s) => s[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()}
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">
        ◇
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Copy({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  return (
    <>
      <Button
        color="secondary"
        size="xs"
        onPress={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setStatus("Copied");
          } catch {
            setStatus("Copy unavailable — select the text");
          }
        }}
      >
        {label}
      </Button>
      <span role="status" className="copy-status">
        {status}
      </span>
    </>
  );
}
export function safeHref(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
