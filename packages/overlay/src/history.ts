import type { OverlayDocument } from '@halocline/core/overlay'

/** Changes this close together with the same key are one step: typing a value, say. */
const MERGE_WITHIN_MS = 1000
const MAX_STEPS = 100

/**
 * The editor's undo and redo (PLAN §8): whole documents, which are small, rather
 * than patches. `record` is called with the document as it was before a change.
 */
export class DocumentHistory {
  private undoStack: OverlayDocument[] = []
  private redoStack: OverlayDocument[] = []
  private lastKey: string | undefined
  private lastAt = 0

  /** Records the state before a change, unless it continues the last change with the same key. */
  record(before: OverlayDocument, key?: string, now = Date.now()): void {
    const merge = key !== undefined && key === this.lastKey && now - this.lastAt < MERGE_WITHIN_MS
    if (!merge) {
      this.undoStack.push(before)
      if (this.undoStack.length > MAX_STEPS) this.undoStack.shift()
    }
    this.redoStack = []
    this.lastKey = key
    this.lastAt = now
  }

  /** The document to go back to, or null; `current` becomes redoable. */
  undo(current: OverlayDocument): OverlayDocument | null {
    const previous = this.undoStack.pop()
    if (!previous) return null
    this.redoStack.push(current)
    this.lastKey = undefined
    return previous
  }

  redo(current: OverlayDocument): OverlayDocument | null {
    const next = this.redoStack.pop()
    if (!next) return null
    this.undoStack.push(current)
    this.lastKey = undefined
    return next
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.lastKey = undefined
  }
}
