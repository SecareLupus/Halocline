import type { OverlayDocument } from '@halocline/core/overlay'

/** How an edit enters the editor's undo history (PLAN §8). */
export interface EditOptions {
  /** Edits with the same key in quick succession are one undo step: typing a value, say. */
  key?: string
  /** The document to undo back to, when it isn't the current one: where a drag started. */
  before?: OverlayDocument
  /** A step on the way, like a drag in progress: drawn and saved, but not an undo step. */
  live?: boolean
}

export type OnEdit = (doc: OverlayDocument, options?: EditOptions) => void
