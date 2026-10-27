import type { PlayerCommand, PlayerReport } from './player'

/** The two places audio can come from (PLAN §4). */
export type EngineName = 'player' | 'fallback'

/**
 * Sends the player service's commands to the engine that should hear them and
 * filters reports by who sent them. The player renderer plays local, cached
 * and direct tracks; the hidden YTM window plays fallback tracks. Only one is
 * active at a time, and loading on one stops the other, which is how in-track
 * failover hands a track from direct to fallback.
 */
export class EngineRouter {
  private active: EngineName = 'player'

  constructor(private readonly engines: Record<EngineName, (command: PlayerCommand) => void>) {}

  get activeEngine(): EngineName {
    return this.active
  }

  send(command: PlayerCommand): void {
    switch (command.type) {
      case 'load': {
        const target: EngineName = command.engine === 'fallback' ? 'fallback' : 'player'
        const other: EngineName = target === 'player' ? 'fallback' : 'player'
        if (this.active !== target) this.engines[other]({ type: 'stop' })
        this.active = target
        this.engines[target](command)
        break
      }
      // Only the player renderer preloads and fades.
      case 'cue':
      case 'configure':
        this.engines.player(command)
        break
      // Both keep the level, so a switch doesn't jump in volume.
      case 'volume':
      case 'stop':
        this.engines.player(command)
        this.engines.fallback(command)
        break
      case 'play':
      case 'pause':
      case 'seek':
        this.engines[this.active](command)
        break
    }
  }

  /** Whether a report from `from` should reach the player service. */
  accepts(from: EngineName, report: PlayerReport): boolean {
    // The output device list comes from the player renderer whichever engine plays.
    if (report.type === 'output') return from === 'player'
    return from === this.active
  }
}
