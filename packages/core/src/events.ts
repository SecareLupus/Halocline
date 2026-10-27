import type { Health, OutputState, PlayerState, ScanStatus, Settings, YtmStatus } from './schemas'

export type HaloclineEvent =
  | { type: 'player.changed'; data: PlayerState }
  | { type: 'track.changed'; data: PlayerState }
  | { type: 'queue.changed'; data: { revision: number } }
  | { type: 'library.changed'; data: { recordingIds: string[] } }
  | { type: 'health.changed'; data: Health }
  | { type: 'settings.changed'; data: Settings }
  | { type: 'scan.changed'; data: ScanStatus }
  | { type: 'output.changed'; data: OutputState }
  | { type: 'ytm.changed'; data: YtmStatus }

export type EventType = HaloclineEvent['type']
export type StampedEvent = HaloclineEvent & { id: number; at: number }
type Listener = (event: StampedEvent) => void

/**
 * In-process event bus. Events get increasing IDs and the last few are kept
 * so SSE clients can resume with `Last-Event-ID` after a reconnect.
 */
export class EventBus {
  private nextId = 1
  private readonly recent: StampedEvent[] = []
  private readonly listeners = new Set<Listener>()

  constructor(private readonly keep = 256) {}

  publish(event: HaloclineEvent): StampedEvent {
    const stamped = { ...event, id: this.nextId++, at: Date.now() } as StampedEvent
    this.recent.push(stamped)
    if (this.recent.length > this.keep) this.recent.shift()
    for (const listener of this.listeners) listener(stamped)
    return stamped
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Events after `id`, or `undefined` if they've aged out and the client must refetch. */
  since(id: number): StampedEvent[] | undefined {
    const oldest = this.recent[0]
    if (oldest && id < oldest.id - 1) return undefined
    return this.recent.filter((e) => e.id > id)
  }
}
