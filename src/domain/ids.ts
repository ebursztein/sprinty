export function mintSubsprintId(existingSubsprintCount: number): string {
  return `S${String(existingSubsprintCount + 1).padStart(2, "0")}`;
}

export function mintItemId(subsprintId: string, existingItemsInSubsprint: number): string {
  return `${subsprintId}-${String(existingItemsInSubsprint + 1).padStart(3, "0")}`;
}
