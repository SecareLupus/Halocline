import type { OutputDevice, OutputState } from '@halocline/core'

/** Chromium has `AudioContext.setSinkId`; TypeScript's DOM types don't yet. */
type SinkableContext = AudioContext & { setSinkId(sinkId: string): Promise<void> }

/** Chromium's aliases for the system default; '' already means that. */
const ALIASES = new Set(['default', 'communications'])

/** Chromium doesn't fire `devicechange` for outputs on every platform (not on Linux), so also poll. */
const POLL_MS = 3000

/**
 * Routes the audio graph to the chosen output device (PLAN §2), e.g. a
 * PipeWire/PulseAudio virtual sink on Linux or a virtual cable on Windows. If
 * the device disappears, playback falls back to the system default and moves
 * back automatically when it returns.
 */
export class OutputRouter {
  private wanted = ''
  private state: OutputState = { devices: [], activeDeviceId: '', error: null }
  private reported = ''

  constructor(
    private readonly context: AudioContext,
    private readonly report: (state: OutputState) => void,
  ) {
    navigator.mediaDevices.addEventListener('devicechange', () => void this.refresh())
    setInterval(() => void this.refresh(), POLL_MS)
    void this.refresh()
  }

  async select(deviceId: string): Promise<void> {
    this.wanted = deviceId
    await this.refresh()
  }

  private async refresh(): Promise<void> {
    const devices = await this.listDevices()
    const present = this.wanted === '' || devices.some((d) => d.deviceId === this.wanted)
    const target = present ? this.wanted : ''
    let error: string | null = present ? null : 'The selected output device is not connected'
    if (target !== this.state.activeDeviceId) {
      try {
        await (this.context as SinkableContext).setSinkId(target)
      } catch (err) {
        error = `Cannot use the selected output device: ${String(err)}`
      }
    }
    const activeDeviceId = error && present ? this.state.activeDeviceId : target
    this.state = { devices, activeDeviceId, error }
    const serialized = JSON.stringify(this.state)
    if (serialized !== this.reported) {
      this.reported = serialized
      this.report(this.state)
    }
  }

  private async listDevices(): Promise<OutputDevice[]> {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all
      .filter((d) => d.kind === 'audiooutput' && !ALIASES.has(d.deviceId))
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Output ${i + 1}` }))
  }
}
