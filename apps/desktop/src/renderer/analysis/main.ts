// The hidden analysis window (PLAN §7): decodes a track with Chromium's decoders,
// measures tempo, key, loudness and energy with essentia.js, and embeds three
// 10-second excerpts with the CLAP audio encoder through ONNX Runtime (WASM).
import { CLAP, camelotKey, clapFeatures, energy } from '@halocline/analysis'
import type { AudioFeatures } from '@halocline/core'
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js'
import Essentia, { type EssentiaVector } from 'essentia.js/dist/essentia.js-core.es.js'
import * as ort from 'onnxruntime-web/wasm'
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import type { AnalysisJob } from '../../shared/ipc'

/** Essentia's rhythm, key and loudness algorithms expect 44.1 kHz. */
const ESSENTIA_RATE = 44_100
/** Where the CLAP excerpts are taken, as fractions of the track. */
const EXCERPTS = [0.3, 0.5, 0.7]

ort.env.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm }
// Threads need a cross-origin isolated page; one thread is enough for a background job.
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 1)
  : 1

const essentia = new Essentia(EssentiaWASM)
let session: Promise<ort.InferenceSession> | null = null
const encoder = () =>
  (session ??= window.halocline.analysis
    .model()
    .then((bytes) => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }))
    .catch((err: unknown) => {
      session = null
      throw err
    }))

window.halocline.analysis.onJob((job) => {
  analyze(job).then(
    (features) => window.halocline.analysis.report({ jobId: job.jobId, ok: true, features }),
    (err: unknown) =>
      window.halocline.analysis.report({
        jobId: job.jobId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
  )
})

async function analyze(job: AnalysisJob): Promise<AudioFeatures> {
  const bytes = await window.halocline.analysis.audio(job.jobId)
  const audio = await new OfflineAudioContext(2, 1, ESSENTIA_RATE).decodeAudioData(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
  const left = audio.getChannelData(0)
  const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left
  const mono = new Float32Array(left.length)
  for (let i = 0; i < mono.length; i++) mono[i] = (left[i]! + right[i]!) / 2

  const measured = measure(mono, left, right)
  return { ...measured, embedding: await embed(mono) }
}

/** Tempo, key, loudness and energy, with every essentia.js vector freed after. */
function measure(mono: Float32Array, left: Float32Array, right: Float32Array) {
  const vectors: EssentiaVector[] = []
  const vector = (a: Float32Array) => {
    const v = essentia.arrayToVector(a)
    vectors.push(v)
    return v
  }
  try {
    const signal = vector(mono)
    // 'degara' agrees with 'multifeature' on tempo here and is about six times faster.
    const rhythm = essentia.RhythmExtractor2013(signal, 208, 'degara', 40)
    vectors.push(rhythm.ticks, rhythm.estimates, rhythm.bpmIntervals)
    const key = essentia.KeyExtractor(signal)
    const loudness = essentia.LoudnessEBUR128(vector(left), vector(right))
    vectors.push(loudness.momentaryLoudness, loudness.shortTermLoudness)
    const onsets = essentia.OnsetRate(signal)
    vectors.push(onsets.onsets)
    const lufs = Number.isFinite(loudness.integratedLoudness) ? loudness.integratedLoudness : null
    return {
      bpm: rhythm.bpm > 0 ? Math.round(rhythm.bpm * 10) / 10 : null,
      camelotKey: camelotKey(key.key, key.scale),
      loudnessLufs: lufs === null ? null : Math.round(lufs * 10) / 10,
      energy: lufs === null ? null : energy(lufs, onsets.onsetRate),
    }
  } finally {
    for (const v of vectors) v.delete()
  }
}

/** The mean CLAP embedding of up to three 10 s excerpts, unit length. */
async function embed(mono: Float32Array): Promise<number[]> {
  const model = await encoder()
  const span = 10 * ESSENTIA_RATE
  const starts =
    mono.length <= span * 2
      ? [0]
      : EXCERPTS.map((at) => Math.min(mono.length - span, Math.round(at * mono.length - span / 2)))
  const sum = new Float64Array(512)
  for (const start of starts) {
    const clip = await resample(mono.subarray(start, start + span))
    const input = new ort.Tensor('float32', clapFeatures(clip), [1, 1, CLAP.frames, CLAP.mels])
    const output = await model.run({ input_features: input })
    const vector = unit(output['audio_embeds']!.data as Float32Array)
    for (let i = 0; i < sum.length; i++) sum[i] = sum[i]! + vector[i]!
  }
  return Array.from(unit(sum), (v) => Math.round(v * 1e5) / 1e5)
}

/** 44.1 kHz to CLAP's 48 kHz, through Chromium's resampler. */
async function resample(clip: Float32Array): Promise<Float32Array> {
  const source = new AudioBuffer({ length: clip.length, sampleRate: ESSENTIA_RATE })
  source.copyToChannel(new Float32Array(clip), 0)
  const length = Math.round((clip.length * CLAP.sampleRate) / ESSENTIA_RATE)
  const ctx = new OfflineAudioContext(1, length, CLAP.sampleRate)
  const node = new AudioBufferSourceNode(ctx, { buffer: source })
  node.connect(ctx.destination)
  node.start()
  return (await ctx.startRendering()).getChannelData(0)
}

function unit(v: ArrayLike<number>): Float64Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i]! * v[i]!
  norm = Math.sqrt(norm) || 1
  return Float64Array.from({ length: v.length }, (_, i) => v[i]! / norm)
}
