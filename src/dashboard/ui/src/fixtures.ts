/** Deterministic synthetic sprint for component tests and documentation screenshots. */
import { buildItemChangeMap } from "../../../domain/change-map.js";
import { project } from "../../../domain/projection.js";
import {
  LedgerEvent as EventSchema,
  type LedgerEvent,
} from "../../../domain/events.js";
export function demoSprint() {
  const base = Date.parse("2026-10-18T13:00:00Z");
  const events: LedgerEvent[] = [];
  function add(type: string, at: number, fields: Record<string, unknown> = {}) {
    events.push(
      EventSchema.parse({
        type,
        seq: events.length,
        ts: new Date(base + at * 60000).toISOString(),
        ...fields,
      }),
    );
  }
  add("sprint_created", 0, {
    goal: "Ship the next release. Keep every agent in sync.",
    worktree: "/workspace/sprinty",
    branch: "main",
    dir: "/workspace/sprinty",
    data_dir: "/workspace/sprinty/.sprinty",
    context_notes: [
      "Keep the shared plan durable through context compaction.",
      "Every completed item needs a resolving commit and executable evidence.",
    ],
  });
  for (const [id, description, goals] of [
    [
      "S01",
      "Concurrent agents & ownership",
      ["Give every item one accountable owner."],
    ],
    [
      "S02",
      "Dashboard & visibility",
      ["Make progress, stalls, and handovers easy to inspect."],
    ],
    ["S03", "Verification & release", ["Close only after the gates pass."]],
  ] as const)
    add("subsprint_created", 1, {
      subsprint_id: id,
      description,
      goals,
      gates: [{ kind: "command", spec: "npm test" }],
      spawned_from_item: null,
      dependencies: [],
    });
  const names = ["curious-otter", "nimble-fox", "steady-owl"];
  names.forEach((name, i) =>
    add("agent_attached", 2, {
      id: `agent-${i}`,
      name,
      token_hash: "redacted-demo-identity",
      git_dir: "/workspace/sprinty",
    }),
  );
  const titles = [
    "Make item claims atomic across processes",
    "Preserve ownership through context recovery",
    "Fence writes after an explicit handover",
    "Record progress separately from activity",
    "Add the agent roster and ownership filters",
    "Build the work table and item inspector",
    "Show claim history and potential stalls",
    "Keep the dashboard ETA in sync with tools",
    "Run verification outside the write lock",
    "Recover interrupted multi-event transactions",
    "Validate the published package",
    "Write the release notes and client guidance",
  ];
  titles.forEach((title, i) => {
    const sub = `S0${Math.floor(i / 4) + 1}`;
    const id = `${sub}-00${(i % 4) + 1}`;
    add("item_added", 3 + i, {
      item_id: id,
      subsprint_id: sub,
      title,
      description: `${title}.\n\nKeep the workflow reliable for every coding session and subagent.\n\n- Preserve an auditable record.\n- Verify the behavior with meaningful tests.`,
      high_priority: i === 0,
      code_locations: [
        i < 4
          ? "src/store/store.ts"
          : i < 8
            ? "src/dashboard/ui"
            : "src/gates/run.ts",
      ],
      gates: [
        { kind: "test", spec: "npm test" },
        { kind: "typecheck", spec: "npm run typecheck" },
      ],
      gate_timeout_ms: null,
      dependencies: i === 11 ? ["S03-003"] : [],
    });
  });
  for (let i = 0; i < 3; i++) {
    const id = `S01-00${i + 1}`;
    add("item_claimed", 18 + i * 8, {
      item_id: id,
      owner: `agent-${i}`,
      agent_id: `agent-${i}`,
      generation: 1,
    });
    add("agent_activity", 20 + i * 8, {
      id: `agent-${i}`,
      agent_id: `agent-${i}`,
    });
    add("item_resolved", 23 + i * 8, {
      item_id: id,
      disposition: "completed",
      commit_id: `a1b2c${i}f`,
      gate_results: [
        {
          kind: "test",
          spec: "npm test",
          passed: true,
          evidence: "All focused tests passed. No failed or timed-out gates.",
        },
        {
          kind: "typecheck",
          spec: "npm run typecheck",
          passed: true,
          evidence: "TypeScript checked successfully.",
        },
      ],
      spawned_subsprint: null,
      reason: null,
      changelog: { verb: "added", line: titles[i] },
      change_map: buildItemChangeMap(id, `a1b2c${i}f`, [
        {
          file:
            i === 0
              ? "src/ledger/transaction.ts"
              : i === 1
                ? "src/tools/register.ts"
                : "src/store/store.ts",
          additions: 80 + i * 18,
          deletions: 12 + i * 4,
        },
      ]),
      agent_id: `agent-${i}`,
    });
  }
  add("item_claimed", 20, {
    item_id: "S02-001",
    owner: "agent-0",
    generation: 1,
    agent_id: "agent-0",
  });
  add("item_claimed", 41, {
    item_id: "S01-004",
    owner: "agent-0",
    generation: 1,
    agent_id: "agent-0",
  });
  add("item_released", 42, {
    item_id: "S01-004",
    generation: 1,
    agent_id: "agent-0",
  });
  add("item_claimed", 43, {
    item_id: "S01-004",
    owner: "agent-1",
    generation: 2,
    explanation:
      "Taking over progress tracking while curious-otter reviews the roster. Previous claim was explicitly released.",
    agent_id: "agent-1",
  });
  add("item_claimed", 43, {
    item_id: "S02-002",
    owner: "agent-2",
    generation: 1,
    agent_id: "agent-2",
  });
  add("item_progress", 46, {
    item_id: "S02-002",
    message:
      "Work table and inspector implemented; checking keyboard navigation.",
    agent_id: "agent-2",
  });
  add("note_added", 47, {
    note_id: "Ndemo",
    element_id: "S02-002",
    text: "Resume from the persisted ledger after compaction. The current claim and verification settings remain attached to this item.",
    agent_id: "agent-2",
  });
  for (const i of [1, 2])
    add("agent_activity", 49, { id: `agent-${i}`, agent_id: `agent-${i}` });
  add("artifact_added", 49, {
    artifact_id: "A001",
    target_id: "sprint",
    kind: "report",
    title: "Release verification report",
    uri: "reports/verification.json",
    description: "Focused tests, claim-race checks, and package smoke results.",
    related_items: ["S03-003"],
    agent_id: "agent-1",
  });
  // Place earlier events in chronological order so simulated stall and activity boundaries are honest.
  events.sort((a, b) => a.ts.localeCompare(b.ts));
  events.forEach((event, i) => {
    event.seq = i;
  });
  return project(events, base + 50 * 60000)!;
}
