/** Isolated synthetic project for marketing screenshots; never used by production. */
import { buildItemChangeMap } from "../../../domain/change-map.js";
import { project } from "../../../domain/projection.js";
import { LedgerEvent as EventSchema, type LedgerEvent } from "../../../domain/events.js";

export function marketingSprint() {
  const base = Date.parse("2026-10-18T13:00:00Z");
  const events: LedgerEvent[] = [];
  function add(type: string, minute: number, fields: Record<string, unknown>) {
    events.push(EventSchema.parse({ type, seq: events.length, ts: new Date(base + minute * 60000).toISOString(), ...fields }));
  }
  add("sprint_created", 0, {
    goal: "Launch a product website", worktree: "/workspace/product-website", branch: "main",
    dir: "/workspace/product-website", data_dir: "/workspace/product-website/.sprinty",
    context_notes: ["Illustrative website project for marketing screenshots.", "One shared plan for research, design, content, implementation and review."],
  });
  const groups = [
    ["S01", "Research & direction", "Agree on the audience, visual direction and page structure."],
    ["S02", "Design & content", "Turn the brief into page layouts and approved copy."],
    ["S03", "Build & launch", "Build the website, verify it and prepare to publish."],
  ];
  for (const [id, description, goal] of groups) add("subsprint_created", 1, {
    subsprint_id: id, description, goals: [goal], gates: [{ kind: "manual", spec: "Review the work against the project brief" }], spawned_from_item: null, dependencies: [],
  });
  ["curious-otter", "nimble-fox", "steady-owl"].forEach((name, i) => add("agent_attached", 2, {
    id: `agent-${i}`, name, token_hash: "redacted-demo-identity", git_dir: "/workspace/product-website",
  }));
  const tasks = [
    ["S01-001", "Write the audience brief", [], "research/audience.md"],
    ["S01-002", "Choose the visual direction", ["S01-001"], "design/direction.md"],
    ["S01-003", "Map the pages and user journey", ["S01-001"], "design/sitemap.md"],
    ["S02-001", "Design the page layouts", ["S01-002"], "design/layouts.md"],
    ["S02-002", "Draft the homepage content", ["S01-001"], "content/homepage.md"],
    ["S02-003", "Review the design and copy together", ["S02-001", "S02-002"], "design/review.md"],
    ["S03-001", "Build the responsive website", ["S01-003"], "website/index.html"],
    ["S03-002", "Check accessibility and mobile layouts", ["S03-001"], "website/styles.css"],
    ["S03-003", "Publish the approved website", ["S02-003", "S03-002"], "website/launch.md"],
  ] as const;
  for (const [id, title, dependencies, path] of tasks) add("item_added", 3, {
    item_id: id, subsprint_id: id.slice(0, 3), title,
    description: id === "S03-001"
      ? "Deliver the responsive website source in **website/index.html** and **website/styles.css**.\n\nBuild the site and check the setup flow before the final accessibility and content review."
      : `${title}.\n\nKeep the deliverable and decisions attached to this task so another session can continue.`,
    high_priority: false, code_locations: [path], dependencies: [...dependencies], gate_timeout_ms: null,
    gates: id === "S03-001" ? [
      { kind: "build", spec: "node scripts/build-site.mjs" },
      { kind: "test", spec: "node --test scripts/install.test.mjs" },
    ] : [{ kind: "manual", spec: "Review the deliverable against the project brief" }],
  });
  for (const [id, minute, owner] of [["S01-001", 5, 0], ["S01-002", 11, 1], ["S01-003", 17, 2], ["S03-001", 23, 2]] as const) {
    add("item_claimed", minute, { item_id: id, owner: `agent-${owner}`, agent_id: `agent-${owner}`, generation: 1 });
    add("agent_activity", minute + 1, { id: `agent-${owner}`, agent_id: `agent-${owner}` });
    const task = tasks.find(t => t[0] === id)!;
    const commit = id === "S03-001" ? "cc85bad" : `a1b2c${owner}f`;
    add("item_resolved", minute + 5, {
      item_id: id, disposition: "completed", commit_id: commit,
      gate_results: id === "S03-001" ? [
        { kind: "build", spec: "node scripts/build-site.mjs", passed: true, evidence: "Static website built and local links checked: .site-dist/\nAll required images and setup files are present." },
        { kind: "test", spec: "node --test scripts/install.test.mjs", passed: true, evidence: "14 tests passed · 0 failed\nCodex and Claude setup, existing configuration and failure handling checked." },
      ] : [{ kind: "manual", spec: "Review the deliverable against the project brief", passed: true, evidence: "Reviewed against the audience brief and recorded the agreed direction." }],
      spawned_subsprint: null, reason: null, changelog: { verb: "added", line: task[1] },
      change_map: buildItemChangeMap(id, commit, [{ file: task[3], additions: 90, deletions: 0 }]), agent_id: `agent-${owner}`,
    });
  }
  for (const [id, owner] of [["S02-001", 0], ["S02-002", 1], ["S03-002", 2]] as const) {
    add("item_claimed", 35, { item_id: id, owner: `agent-${owner}`, agent_id: `agent-${owner}`, generation: 1 });
    add("agent_activity", 49, { id: `agent-${owner}`, agent_id: `agent-${owner}` });
  }
  add("note_added", 39, { note_id: "N001", element_id: "S02-001", text: "Approved direction: blue palette, generous spacing and a simple path from the headline to signup.", agent_id: "agent-0" });
  add("item_progress", 41, { item_id: "S02-002", message: "Homepage draft ready. Next: align the benefits with the page layouts.", agent_id: "agent-1" });
  add("item_progress", 43, { item_id: "S02-001", message: "Desktop layouts ready; refining the mobile navigation.", agent_id: "agent-0" });
  add("note_added", 45, { note_id: "N002", element_id: "S02-001", text: "Resume here after compaction: keep the approved blue direction. Finish mobile navigation, then send layouts to the design-and-copy review.", agent_id: "agent-0" });
  add("item_progress", 47, { item_id: "S03-002", message: "Keyboard navigation checked. Reviewing narrow-screen layouts next.", agent_id: "agent-2" });
  add("artifact_added", 48, { artifact_id: "A001", target_id: "S03-001", kind: "report", title: "Responsive website source", uri: "website/index.html", description: "Website deliverable retained with its build and setup-check evidence.", related_items: ["S03-001"], agent_id: "agent-2" });
  events.sort((a, b) => a.ts.localeCompare(b.ts));
  events.forEach((event, i) => { event.seq = i; });
  return project(events, base + 50 * 60000)!;
}
