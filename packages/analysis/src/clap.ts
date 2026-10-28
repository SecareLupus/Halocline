/**
 * Input features for the CLAP audio encoder (laion/larger_clap_music_and_speech),
 * matching Hugging Face's ClapFeatureExtractor with that model's settings:
 * 10 s of 48 kHz mono, a centred STFT (Hann window, n_fft 1024, hop 480), 64
 * slaney mel bands from 50 Hz to 14 kHz, power in dB. Shorter clips are repeated
 * to fill 10 s, then padded with silence.
 */
export const CLAP = {
  sampleRate: 48_000,
  samples: 480_000,
  nFft: 1024,
  hop: 480,
  mels: 64,
  fMin: 50,
  fMax: 14_000,
  /** 1 + samples / hop: the centred STFT's frame count. */
  frames: 1001,
} as const

const BINS = CLAP.nFft / 2 + 1

/** The encoder's `input_features`, [1, 1, frames, mels] flattened frame by frame. */
export function clapFeatures(clip: Float32Array): Float32Array {
  const wave = fill(clip)
  const pad = CLAP.nFft / 2
  const padded = reflectPad(wave, pad)
  const window = hann(CLAP.nFft)
  const filters = melFilters()
  const re = new Float64Array(CLAP.nFft)
  const im = new Float64Array(CLAP.nFft)
  const power = new Float64Array(BINS)
  const out = new Float32Array(CLAP.frames * CLAP.mels)
  for (let f = 0; f < CLAP.frames; f++) {
    const start = f * CLAP.hop
    for (let i = 0; i < CLAP.nFft; i++) {
      re[i] = padded[start + i]! * window[i]!
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < BINS; k++) power[k] = re[k]! * re[k]! + im[k]! * im[k]!
    for (let m = 0; m < CLAP.mels; m++) {
      const row = filters[m]!
      let sum = 0
      for (let k = row.from; k < row.to; k++) sum += row.weights[k - row.from]! * power[k]!
      out[f * CLAP.mels + m] = 10 * Math.log10(Math.max(sum, 1e-10))
    }
  }
  return out
}

/** Exactly 10 s: longer clips are cut, shorter ones repeated whole, then padded. */
function fill(clip: Float32Array): Float32Array {
  if (clip.length >= CLAP.samples) return clip.subarray(0, CLAP.samples)
  const out = new Float32Array(CLAP.samples)
  if (!clip.length) return out
  const repeats = Math.floor(CLAP.samples / clip.length)
  for (let r = 0; r < repeats; r++) out.set(clip, r * clip.length)
  return out
}

/** numpy's 'reflect' padding: mirrored without repeating the edge sample. */
function reflectPad(x: Float32Array, pad: number): Float64Array {
  const out = new Float64Array(x.length + 2 * pad)
  for (let i = 0; i < pad; i++) out[i] = x[pad - i]!
  out.set(x, pad)
  for (let i = 0; i < pad; i++) out[pad + x.length + i] = x[x.length - 2 - i]!
  return out
}

/** The periodic Hann window. */
function hann(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  return w
}

const MIN_LOG_HZ = 1000
const MIN_LOG_MEL = 15
const LOG_STEP = 27 / Math.log(6.4)
const hzToMel = (hz: number) =>
  hz >= MIN_LOG_HZ ? MIN_LOG_MEL + Math.log(hz / MIN_LOG_HZ) * LOG_STEP : (3 * hz) / 200
const melToHz = (mel: number) =>
  mel >= MIN_LOG_MEL ? MIN_LOG_HZ * Math.exp((mel - MIN_LOG_MEL) / LOG_STEP) : (200 * mel) / 3

interface MelRow {
  from: number
  to: number
  weights: Float64Array
}

let cachedFilters: MelRow[] | undefined

/** Slaney-scale triangular filters with slaney area normalisation, as sparse rows. */
function melFilters(): MelRow[] {
  if (cachedFilters) return cachedFilters
  const lo = hzToMel(CLAP.fMin)
  const hi = hzToMel(CLAP.fMax)
  const edges = Array.from({ length: CLAP.mels + 2 }, (_, i) =>
    melToHz(lo + ((hi - lo) * i) / (CLAP.mels + 1)),
  )
  const nyquist = Math.floor(CLAP.sampleRate / 2)
  const binHz = (k: number) => (nyquist * k) / (BINS - 1)
  cachedFilters = Array.from({ length: CLAP.mels }, (_, m) => {
    const [left, centre, right] = [edges[m]!, edges[m + 1]!, edges[m + 2]!]
    const norm = 2 / (right - left)
    const all = Array.from({ length: BINS }, (_, k) => {
      const hz = binHz(k)
      const down = (hz - left) / (centre - left)
      const up = (right - hz) / (right - centre)
      return Math.max(0, Math.min(down, up)) * norm
    })
    const from = all.findIndex((w) => w > 0)
    const to = all.findLastIndex((w) => w > 0) + 1
    return from < 0
      ? { from: 0, to: 0, weights: new Float64Array(0) }
      : { from, to, weights: Float64Array.from(all.slice(from, to)) }
  })
  return cachedFilters
}

/** In-place iterative radix-2 FFT; `re.length` must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const cos = Math.cos(step * k)
        const sin = Math.sin(step * k)
        const a = start + k
        const b = a + size / 2
        const tr = re[b]! * cos - im[b]! * sin
        const ti = re[b]! * sin + im[b]! * cos
        re[b] = re[a]! - tr
        im[b] = im[a]! - ti
        re[a] = re[a]! + tr
        im[a] = im[a]! + ti
      }
    }
  }
}
