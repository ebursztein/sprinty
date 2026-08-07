import { randomUUID } from "node:crypto";

export function mintSubsprintId(existingSubsprintCount: number): string {
  return `S${String(existingSubsprintCount + 1).padStart(2, "0")}`;
}

export function mintItemId(subsprintId: string, existingItemsInSubsprint: number): string {
  return `${subsprintId}-${String(existingItemsInSubsprint + 1).padStart(3, "0")}`;
}

/**
 * Note ids are random rather than positional. A seq-derived id is only unique if one writer
 * ever appends, and two processes bound to the same data_dir would mint the same note id.
 */
export function mintNoteId(): string {
  return `N${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Ledgers written before notes carried their own id derived it from the event's seq. */
export function legacyNoteId(seq: number): string {
  return `N${String(seq).padStart(3, "0")}`;
}
