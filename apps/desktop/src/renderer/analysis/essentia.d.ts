// essentia.js ships ES builds without type declarations for them.
declare module 'essentia.js/dist/essentia-wasm.es.js' {
  export const EssentiaWASM: unknown
}

declare module 'essentia.js/dist/essentia.js-core.es.js' {
  export interface EssentiaVector {
    delete(): void
  }
  export default class Essentia {
    constructor(wasm: unknown)
    arrayToVector(array: Float32Array): EssentiaVector
    vectorToArray(vector: EssentiaVector): Float32Array
    RhythmExtractor2013(
      signal: EssentiaVector,
      maxTempo?: number,
      method?: string,
      minTempo?: number,
    ): {
      bpm: number
      confidence: number
      ticks: EssentiaVector
      estimates: EssentiaVector
      bpmIntervals: EssentiaVector
    }
    KeyExtractor(audio: EssentiaVector): { key: string; scale: string; strength: number }
    LoudnessEBUR128(
      left: EssentiaVector,
      right: EssentiaVector,
    ): {
      integratedLoudness: number
      loudnessRange: number
      momentaryLoudness: EssentiaVector
      shortTermLoudness: EssentiaVector
    }
    OnsetRate(signal: EssentiaVector): { onsetRate: number; onsets: EssentiaVector }
  }
}
