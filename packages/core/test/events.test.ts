import { describe, expect, it } from 'vitest'
import { EventBus } from '../src'

describe('EventBus', () => {
  it('replays events after an id, or signals that a refetch is needed', () => {
    const bus = new EventBus(3)
    for (let i = 0; i < 5; i++) bus.publish({ type: 'queue.changed', data: { revision: i } })
    expect(bus.since(3)?.map((e) => e.id)).toEqual([4, 5])
    expect(bus.since(2)?.map((e) => e.id)).toEqual([3, 4, 5])
    expect(bus.since(1)).toBeUndefined()
  })
})
