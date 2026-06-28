import type { ItemView, SprintView } from "./projection.js";

export const NOTE_TEXT_MAX = 500;
export const NOTE_PER_ITEM_MAX = 3;
export const OPEN_ITEMS_WITH_NOTES_MAX = 5;

export interface NotePressureItem {
  id: string;
  title: string;
  status: ItemView["status"];
  note_count: number;
  over_item_note_budget: boolean;
}

export interface NotePressureSummary {
  open_count: number;
  open_budget: number;
  items: NotePressureItem[];
  truncated: boolean;
  pressure: string | null;
}

export function validateNoteText(text: string): string | null {
  if (text.length > NOTE_TEXT_MAX) return `Note text is limited to ${NOTE_TEXT_MAX} characters. Add more items or attach long context as an artifact.`;
  if (looksLikeListOrPlan(text)) return "Notes must be short evidence breadcrumbs, not bullet lists or plans. Add more items or attach long context as an artifact.";
  return null;
}

export function notePressure(view: SprintView): NotePressureSummary {
  const allItems = view.subsprints
    .flatMap((sub) => sub.items)
    .filter((item) => item.status === "open" && item.notes.length > 0)
    .map((item) => ({
      id: item.id,
      title: truncate(item.title, 80),
      status: item.status,
      note_count: item.notes.length,
      over_item_note_budget: item.notes.length >= NOTE_PER_ITEM_MAX,
    }));
  const items = allItems.slice(0, OPEN_ITEMS_WITH_NOTES_MAX);

  return {
    open_count: allItems.length,
    open_budget: OPEN_ITEMS_WITH_NOTES_MAX,
    items,
    truncated: items.length < allItems.length,
    pressure: items.length >= OPEN_ITEMS_WITH_NOTES_MAX
      ? `${OPEN_ITEMS_WITH_NOTES_MAX} open items already have notes. Close or split one of these items before adding notes to another open item.`
      : null,
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3).trimEnd()}...`;
}

function looksLikeListOrPlan(text: string): boolean {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .some((line) => /^([-*+]\s+|\d+[.)]\s+|#{1,6}\s+|\bphase\s+\d+\b)/i.test(line));
}
