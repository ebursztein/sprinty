import { actors } from "../domain/agents.js";
import { orderOpenItems } from "../domain/work-order.js";
import type { SprintView } from "../domain/projection.js";

/**
 * Suggests the next calls to make, derived from actual sprint state.
 *
 * The previous static `help` string was the largest field in most responses, identical on every
 * call, and built ids from a regex fallback - so on a fresh sprint it advertised item_get on
 * "S01-001" and subsprint_get on "S01", both of which error with Unknown. Every id here comes
 * from the view, and when nothing exists yet the suggestion is to create something.
 */
export function nextTools(view: SprintView | null, context: { id?: string | undefined } = {}): string[] {
  if (!view) return [`info({ git_dir })`, `sprint_new({ goal, git_dir })`];
  if (view.status !== "active") return [`info({ git_dir })`, `sprint_new({ goal, git_dir })`];

  const subsprints = view.subsprints;
  if (subsprints.length === 0) return [`subsprint_new({ description, goals, gates })`];

  // A subsprint with no items is open work that its (absent) items cannot report.
  const empty = subsprints.find((sub) => sub.status === "open" && sub.items.length === 0);
  if (empty) {
    return [
      `item_add({ subsprint: "${empty.id}", title, description, code_locations, gates })`,
      `item_deprecate({ id: "${empty.id}", reason })`,
    ];
  }

  const items = subsprints.flatMap((sub) => sub.items);
  const open = items.filter((item) => item.status === "open");

  if (open.length === 0) {
    return [`sprint_close({ coverage })`];
  }

  const { available } = orderOpenItems(view, items, actors.getStore()?.id);

  if (available.length === 0) {
    const blocked = open[0]!;
    return [`next({})`, `item_get({ id: "${blocked.id}" })`];
  }

  // Bias to the item the caller just touched, so the common path costs no extra lookup.
  const focus = available.find((item) => item.id === context.id) ?? available[0]!;
  return [
    `item_get({ id: "${focus.id}" })`,
    ...(view.agents.length && focus.claim.owner !== actors.getStore()?.id ? [`item_claim({ id: "${focus.id}" })`] : [`item_done({ id: "${focus.id}", commit_id, changelog })`]),
  ];
}

export interface SprintBriefing {
  goal: string;
  status: SprintView["status"];
  counts: {
    subsprints: { open: number; closed: number };
    items: { open: number; closed: number; blocked: number };
    notes: number;
    artifacts: number;
  };
  current?: { id: string; subsprint: string; title: string };
  blocked?: string[];
  last_resolved?: Array<{ id: string; title: string }>;
  recent_notes?: Array<{ id: string; item: string; text: string }>;
}

const MAX_BLOCKED = 5;
const MAX_RESOLVED = 3;
const MAX_NOTES = 3;
const NOTE_CHARS = 72;
const GOAL_CHARS = 100;
const TITLE_CHARS = 48;

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

/**
 * What an agent needs after context loss: counts, the one item to work on, what is stuck, and the
 * most recent breadcrumbs. Bounded hard - this replaces several orientation calls, so it only pays
 * for itself if it stays smaller than the calls it saves.
 */
export function briefing(view: SprintView, notes: Array<{ id: string; item: string; text: string }>): SprintBriefing {
  const items = view.subsprints.flatMap((sub) => sub.items);
  const open = items.filter((item) => item.status === "open");
  const { available, blocked } = orderOpenItems(view, items, actors.getStore()?.id);
  const current = available[0];
  const resolved = items.filter((item) => item.status !== "open").slice(-MAX_RESOLVED).reverse();
  const itemIds = new Set(items.map((item) => item.id));

  return {
    goal: clip(view.goal, GOAL_CHARS),
    status: view.status,
    counts: {
      subsprints: {
        open: view.subsprints.filter((sub) => sub.status === "open").length,
        closed: view.subsprints.filter((sub) => sub.status !== "open").length,
      },
      items: { open: open.length, closed: items.length - open.length, blocked: blocked.length },
      notes: notes.filter((note) => itemIds.has(note.item)).length,
      artifacts: view.artifacts.filter((artifact) => artifact.status === "active").length,
    },
    ...(current ? { current: { id: current.id, subsprint: current.subsprint_id, title: clip(current.title, TITLE_CHARS) } } : {}),
    ...(blocked.length ? { blocked: blocked.slice(0, MAX_BLOCKED).map((item) => item.id) } : {}),
    ...(resolved.length ? { last_resolved: resolved.map((item) => ({ id: item.id, title: clip(item.title, TITLE_CHARS) })) } : {}),
    ...(notes.length ? {
      recent_notes: notes.slice(-MAX_NOTES).reverse().map((note) => ({
        id: note.id,
        item: note.item,
        text: clip(note.text, NOTE_CHARS),
      })),
    } : {}),
  };
}
