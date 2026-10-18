import { useMemo, useState } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { ItemView, SprintView } from "../../../domain/projection.js";
import { gateRows } from "../model.js";
import { fmt, formatDuration } from "../presentation.js";
import { Badge, Button, Copy, safeHref } from "./ui";
import { statusTone } from "./WorkTable";
export function Markdown({ text }: { text: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(String(marked.parse(text))),
    [text],
  );
  return (
    <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
export function stallReasons(reasons: string[]) {
  return reasons.map((r) =>
    r === "owner_inactive_one_hour"
      ? "Owner has had no authenticated activity for at least one hour."
      : r === "three_other_items_completed"
        ? "Three other items completed since the last progress update."
        : r,
  );
}
export default function ItemDetail({
  item,
  sprint,
  status,
  onClose,
  onNavigate,
}: {
  item: ItemView;
  sprint: SprintView;
  status: string;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const [tab, setTab] = useState("Overview");
  const claim = item.claim;
  const timeline = sprint.timeline.filter((e) => e.id === item.id);
  return (
    <ModalOverlay
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      className="inspector-overlay"
    >
      <Modal className="inspector-modal">
        <Dialog className="inspector-dialog" aria-label={`Item ${item.id}`}>
          <header className="inspector-header">
            <div>
              <span className="eyebrow mono">{item.id}</span>
              <Heading slot="title">{item.title}</Heading>
              <Badge tone={statusTone(status)}>{status}</Badge>
            </div>
            <Button
              aria-label="Close item details"
              color="tertiary"
              onPress={onClose}
            >
              ✕
            </Button>
          </header>
          <div
            className="detail-tabs"
            role="group"
            aria-label="Item detail views"
          >
            {["Overview", "Verification", "History"].map((name) => (
              <button
                key={name}
                aria-pressed={tab === name}
                onClick={() => setTab(name)}
              >
                {name}
                {name === "Verification" && (
                  <span className="count">{item.gates.length}</span>
                )}
              </button>
            ))}
          </div>
          <div className="inspector-body">
            {!!claim?.stall_reasons.length && (
              <div className="notice warning">
                <strong>Potential stall</strong>
                {stallReasons(claim.stall_reasons).map((reason) => (
                  <p key={reason}>{reason}</p>
                ))}
                <p>
                  Ownership stays with {claim.owner_name}. Handover requires an
                  explicit explanation.
                </p>
              </div>
            )}
            {tab === "Overview" && (
              <>
                <Markdown text={item.description} />
                <dl className="detail-facts">
                  <div>
                    <dt>{item.status === "open" ? "Owner" : "Last owner"}</dt>
                    <dd>
                      {claim?.owner_name ??
                        claim?.history.at(-1)?.owner_name ??
                        "Unclaimed"}
                    </dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{fmt(item.created_at)}</dd>
                  </div>
                  <div>
                    <dt>Current claim</dt>
                    <dd>
                      {claim?.owner
                        ? formatDuration(claim.claim_duration_ms)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Total claimed</dt>
                    <dd>{formatDuration(claim?.total_claimed_ms ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>Queue wait</dt>
                    <dd>{formatDuration(claim?.queue_wait_ms ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>Observed active work</dt>
                    <dd>
                      {formatDuration(claim?.active_work_ms ?? 0)}{" "}
                      <small>Activity-derived estimate</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Last progress</dt>
                    <dd>
                      {claim?.last_progress_at
                        ? fmt(claim.last_progress_at)
                        : "No progress recorded"}
                    </dd>
                  </div>
                </dl>
                <section className="detail-section">
                  <h3>Dependencies</h3>
                  {item.dependencies.length ? (
                    item.dependencies.map((id) => (
                      <button
                        key={id}
                        className="text-link mono"
                        onClick={() => onNavigate(id)}
                      >
                        {id} ↗
                      </button>
                    ))
                  ) : (
                    <p className="muted">
                      No dependencies. This item can be worked independently.
                    </p>
                  )}
                </section>
                <section className="detail-section">
                  <h3>Code locations</h3>
                  {item.code_locations.map((path) => (
                    <code className="file-row" key={path}>
                      {path}
                    </code>
                  ))}
                  {!!item.undeclared_code_locations?.length && (
                    <p className="warning-text">
                      Also changed: {item.undeclared_code_locations.join(", ")}
                    </p>
                  )}
                </section>
                {!!item.notes?.length && (
                  <section className="detail-section">
                    <h3>Notes</h3>
                    {item.notes.map((note, i) => (
                      <Markdown key={i} text={note} />
                    ))}
                  </section>
                )}
                {item.commit_id && (
                  <section className="detail-section">
                    <h3>Commit</h3>
                    <code className="file-row">{item.commit_id}</code>
                    <Copy text={item.commit_id} label="Copy commit" />
                    {item.changelog && (
                      <p>
                        {item.changelog.verb}: {item.changelog.line}
                      </p>
                    )}
                  </section>
                )}
                {!!item.artifacts.length && (
                  <section className="detail-section">
                    <h3>Related artifacts</h3>
                    {item.artifacts.map((a) => (
                      <div className="artifact-line" key={a.id}>
                        <strong>{a.title}</strong>
                        <code>{a.uri}</code>
                        {safeHref(a.uri) ? (
                          <a
                            href={safeHref(a.uri)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open ↗
                          </a>
                        ) : (
                          <Copy text={a.uri} label="Copy path" />
                        )}
                      </div>
                    ))}
                  </section>
                )}
                {!!item.follow_ups.length && (
                  <section className="detail-section">
                    <h3>Follow-ups</h3>
                    {item.follow_ups.map((f) => (
                      <p key={f.id}>{f.description}</p>
                    ))}
                  </section>
                )}
              </>
            )}
            {tab === "Verification" && (
              <>
                <h3>Evidence, not a checkbox</h3>
                <p className="muted">
                  Results recorded when Sprinty ran each declared gate.
                </p>
                {gateRows(item).map((g, index) => (
                  <section className="gate-card" key={index}>
                    <Badge
                      tone={
                        g.state === "passed"
                          ? "success"
                          : g.state === "failed"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {g.state}
                    </Badge>
                    <span className="eyebrow">{g.kind}</span>
                    <pre>{g.spec}</pre>
                    {g.cwd && <p className="mono muted">{g.cwd}</p>}
                    {g.evidence ? (
                      <pre className="gate-evidence">{g.evidence}</pre>
                    ) : (
                      <p className="muted">No evidence recorded yet.</p>
                    )}
                  </section>
                ))}
              </>
            )}
            {tab === "History" && (
              <>
                <h3>Ownership & handovers</h3>
                {claim?.history.length ? (
                  claim.history.map((interval) => (
                    <section className="history-card" key={interval.generation}>
                      <span className="avatar">{interval.generation}</span>
                      <div>
                        <strong>{interval.owner_name}</strong>
                        <p>
                          {fmt(interval.claimed_at)} →{" "}
                          {interval.ended_at
                            ? fmt(interval.ended_at)
                            : "Present"}
                        </p>
                        {interval.explanation && (
                          <blockquote>{interval.explanation}</blockquote>
                        )}
                      </div>
                    </section>
                  ))
                ) : (
                  <p className="muted">
                    No claims recorded. Legacy items remain available without
                    attributed ownership.
                  </p>
                )}
                <h3 className="section-gap">Item activity</h3>
                {timeline
                  .slice()
                  .reverse()
                  .map((e) => (
                    <article className="timeline-entry" key={e.seq}>
                      <span className="timeline-dot" />
                      <div>
                        <strong>{e.type.replaceAll("_", " ")}</strong>
                        <p>{e.text}</p>
                        <time>{fmt(e.ts)}</time>
                      </div>
                    </article>
                  ))}
              </>
            )}
          </div>
          <footer className="inspector-footer">
            <span>Read-only view · changes happen through your agent</span>
          </footer>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
