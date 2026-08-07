# Sprinty Learnings

This document stays open as a running product memory. Each revision records what failed, what changed, and what guardrail we added so Sprinty does not relearn the same lesson through another overloaded sprint.

## 2026-06-27: Notes Became a Hidden Task System

### Failure Mode

In the Capsem sprint ledger, agents used notes as progress breadcrumbs and mini changelog entries instead of closing items with `item_done`. One item accumulated 18 notes and 7,770 note characters, while another open release item carried five notes and remained unresolved. The dashboard then showed a wall of `note + add` rows, which made the sprint look busy without increasing closure.

### Change

Sprinty now treats notes as short evidence breadcrumbs, not work tracking. Notes are capped at 500 characters, each item can have at most three notes, notes that look like bullet lists, numbered lists, headings, or phase plans are rejected, and only five open items may have notes at the same time. When that open-item note budget is reached, `note_add` returns the open noted items so the agent must close, split, or move long context into an artifact.

### Dashboard Follow-Up

The activity chart now treats `note_added` as editing an existing record rather than adding new work. Activity and completion charts also use a rolling four-hour window so old pauses do not flatten the current momentum view.
