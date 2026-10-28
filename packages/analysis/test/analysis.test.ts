import { describe, expect, it } from 'vitest'
import { CLAP, camelotKey, clapFeatures, energy } from '../src'

/** The test tone the reference values were computed for. */
function tone(samples: number): Float32Array {
  return Float32Array.from({ length: samples }, (_, i) => {
    const t = i / CLAP.sampleRate
    return (
      0.3 * Math.sin(2 * Math.PI * 220 * t) +
      0.2 * Math.sin(2 * Math.PI * 3300 * t) * Math.sin(2 * Math.PI * 0.5 * t)
    )
  })
}

const mean = (x: Float32Array) => x.reduce((n, v) => n + v, 0) / x.length
const at = (x: Float32Array) => [0, 777, 30000, 64063].map((i) => x[i]!)

describe('CLAP features', () => {
  // Reference values from Hugging Face's ClapFeatureExtractor with this model's
  // preprocessor_config.json (transformers 4.x, numpy).
  it('match the reference extractor for a full 10 s clip', () => {
    const f = clapFeatures(tone(CLAP.samples))
    expect(f).toHaveLength(CLAP.frames * CLAP.mels)
    at(f).forEach((v, i) => expect(v).toBeCloseTo([13.7367, -43.7003, -98.8364, -59.2951][i]!, 2))
    expect(mean(f)).toBeCloseTo(-65.3627, 2)
  })

  it('repeat a short clip to fill 10 s, then pad with silence', () => {
    const f = clapFeatures(tone(3 * CLAP.sampleRate))
    at(f).forEach((v, i) => expect(v).toBeCloseTo([13.7367, -43.7003, -95.5908, -100][i]!, 2))
    expect(mean(f)).toBeCloseTo(-68.8011, 2)
  })
})

describe('music helpers', () => {
  it('names keys on the Camelot wheel', () => {
    expect(camelotKey('C', 'major')).toBe('8B')
    expect(camelotKey('A', 'minor')).toBe('8A')
    expect(camelotKey('F#', 'minor')).toBe('11A')
    expect(camelotKey('Gb', 'minor')).toBe('11A')
    expect(camelotKey('B', 'major')).toBe('1B')
    expect(camelotKey('X', 'major')).toBeNull()
  })

  it('rates energy from loudness and onsets', () => {
    expect(energy(-6, 6)).toBeGreaterThan(0.9)
    expect(energy(-28, 0.5)).toBeLessThan(0.1)
  })
})
