// ─────────────────────────────────────────────────────────
//  HarmonyEngine.ts  —  Motor Neural LSTM (TypeScript puro)
//
//  Carrega pesos do modelo LSTM exportados como weights.json
//  e implementa o forward pass manualmente, sem TF.js.
//
//  API pública idêntica à versão anterior:
//    generateProgression(...)  — async, retorna lista de acordes
//    warmUpModel()             — pré-carrega pesos em background
//    HARMONY_GRAPH             — grafo harmônico (para ChordBlock)
//    getNeuralProbs(history)   — probabilidades do LSTM
// ─────────────────────────────────────────────────────────

import type { DetectedNote } from "../hooks/usePitchDetector";
import { chordToRoman, getChordPitchClasses, isChordDiatonic, getTonalityOffset, normalizeProgressionToC } from "./TonalityAdapter";
import type { SongHarmonicGrammar } from "./ScoreBuilder";

// ─────────────────────────────────────────────────────────
//  1. Tipos públicos
// ─────────────────────────────────────────────────────────

export interface ChordNode {
  readonly notes: readonly number[];
  readonly allowedTransitions: readonly string[];
}

export interface ProgressionData {
  readonly title: string;
  readonly originalTonality: string;
  readonly normalizedProgression: readonly string[];
}

// ─────────────────────────────────────────────────────────
//  2. Grafo Harmônico
// ─────────────────────────────────────────────────────────

export const HARMONY_GRAPH: Readonly<Record<string, ChordNode>> = {
  C: { notes: [0, 4, 7], allowedTransitions: ["C", "G", "F", "Am", "Dm", "Em", "G7", "C7", "E7", "A7", "D7", "Bdim"] },
  G: { notes: [7, 11, 2], allowedTransitions: ["G", "C", "D", "Em", "Am", "Bm", "D7", "G7", "B7", "E7", "F#dim"] },
  D: { notes: [2, 6, 9], allowedTransitions: ["D", "G", "A", "Bm", "Em", "F#m", "A7", "D7", "F#dim", "E7"] },
  A: { notes: [9, 1, 4], allowedTransitions: ["A", "D", "E", "F#m", "Bm", "C#m", "E7", "A7", "C#dim", "B7"] },
  E: { notes: [4, 8, 11], allowedTransitions: ["E", "A", "B", "C#m", "F#m", "G#m", "B7", "E7", "G#dim"] },
  B: { notes: [11, 3, 6], allowedTransitions: ["B", "E", "F#", "G#m", "C#m", "D#m", "F#7", "B7"] },
  "F#": { notes: [6, 10, 1], allowedTransitions: ["F#", "B", "C#", "D#m", "G#m", "F#7", "C#7"] },
  F: { notes: [5, 9, 0], allowedTransitions: ["F", "C", "Bb", "Dm", "Am", "Gm", "C7", "F7", "D7", "A7"] },
  Bb: { notes: [10, 2, 5], allowedTransitions: ["Bb", "F", "Eb", "Gm", "Dm", "Cm", "F7", "Bb7", "D7"] },
  Eb: { notes: [3, 7, 10], allowedTransitions: ["Eb", "Bb", "Ab", "Cm", "Gm", "Fm", "Bb7", "Eb7", "G7"] },
  Ab: { notes: [8, 0, 3], allowedTransitions: ["Ab", "Eb", "Db", "Fm", "Cm", "Bbm", "Eb7", "Ab7"] },
  Db: { notes: [1, 5, 8], allowedTransitions: ["Db", "Ab", "Gb", "Bbm", "Fm", "Ab7", "Db7"] },
  Am: { notes: [9, 0, 4], allowedTransitions: ["Am", "C", "Dm", "Em", "F", "G", "E7", "G7", "A7", "Bdim", "D7"] },
  Em: { notes: [4, 7, 11], allowedTransitions: ["Em", "G", "Am", "C", "D", "Bm", "B7", "D7", "F#dim", "E7"] },
  Bm: { notes: [11, 2, 6], allowedTransitions: ["Bm", "D", "Em", "G", "A", "F#m", "F#7", "A7", "F#dim"] },
  "F#m": { notes: [6, 9, 1], allowedTransitions: ["F#m", "A", "Bm", "D", "E", "C#m", "C#7", "E7", "C#dim"] },
  "C#m": { notes: [1, 4, 8], allowedTransitions: ["C#m", "E", "F#m", "A", "B", "G#m", "G#7", "B7", "G#dim"] },
  "G#m": { notes: [8, 11, 3], allowedTransitions: ["G#m", "B", "C#m", "E", "F#", "D#m", "D#7", "F#7"] },
  "D#m": { notes: [3, 6, 10], allowedTransitions: ["D#m", "F#", "G#m", "B", "D#7", "A#7"] },
  Dm: { notes: [2, 5, 9], allowedTransitions: ["Dm", "F", "Am", "C", "Bb", "Gm", "A7", "C7", "D7", "Bdim"] },
  Gm: { notes: [7, 10, 2], allowedTransitions: ["Gm", "Bb", "Dm", "F", "Eb", "Cm", "D7", "F7", "Bb7"] },
  Cm: { notes: [0, 3, 7], allowedTransitions: ["Cm", "Eb", "Gm", "Bb", "Ab", "Fm", "G7", "Bb7", "Eb7"] },
  Fm: { notes: [5, 8, 0], allowedTransitions: ["Fm", "Ab", "Cm", "Eb", "Db", "Bbm", "C7", "Eb7", "Ab7"] },
  Bbm: { notes: [10, 1, 5], allowedTransitions: ["Bbm", "Db", "Fm", "Ab", "F7", "Ab7", "Db7"] },
  G7: { notes: [7, 11, 2, 5], allowedTransitions: ["C", "Am", "Cm", "G7", "C7", "F", "Dm"] },
  D7: { notes: [2, 6, 9, 0], allowedTransitions: ["G", "Em", "Gm", "D7", "G7", "C", "Am"] },
  A7: { notes: [9, 1, 4, 7], allowedTransitions: ["D", "Bm", "Dm", "A7", "D7", "G", "Em"] },
  E7: { notes: [4, 8, 11, 2], allowedTransitions: ["A", "F#m", "Am", "E7", "A7", "D", "Bm"] },
  B7: { notes: [11, 3, 6, 9], allowedTransitions: ["E", "C#m", "Em", "B7", "E7", "A", "F#m"] },
  "F#7": { notes: [6, 10, 1, 4], allowedTransitions: ["B", "G#m", "Bm", "F#7", "B7", "E", "C#m"] },
  "C#7": { notes: [1, 5, 8, 11], allowedTransitions: ["F#", "D#m", "F#m", "C#7", "F#7", "B"] },
  C7: { notes: [0, 4, 7, 10], allowedTransitions: ["F", "Dm", "Fm", "C7", "F7", "Bb", "Gm"] },
  F7: { notes: [5, 9, 0, 3], allowedTransitions: ["Bb", "Gm", "Bbm", "F7", "Bb7", "Eb", "Cm"] },
  Bb7: { notes: [10, 2, 5, 8], allowedTransitions: ["Eb", "Cm", "Bb7", "Eb7", "Ab", "Fm"] },
  Eb7: { notes: [3, 7, 10, 1], allowedTransitions: ["Ab", "Fm", "Eb7", "Ab7", "Db"] },
  Ab7: { notes: [8, 0, 3, 6], allowedTransitions: ["Db", "Bbm", "Ab7", "Db7"] },
  Db7: { notes: [1, 5, 8, 11], allowedTransitions: ["Gb", "Db7", "Ab", "Fm"] },
  Bdim: { notes: [11, 2, 5], allowedTransitions: ["C", "Am", "G7", "Dm", "F", "Em"] },
  "F#dim": { notes: [6, 9, 0], allowedTransitions: ["G", "Em", "D7", "Am", "C", "Bm"] },
  "C#dim": { notes: [1, 4, 7], allowedTransitions: ["D", "Bm", "A7", "Em", "G", "F#m"] },
  "G#dim": { notes: [8, 11, 2], allowedTransitions: ["A", "F#m", "E7", "Bm", "D", "C#m"] },
  "C#": { notes: [1, 5, 8], allowedTransitions: ["Db", "Ab", "Gb", "Bbm", "Fm", "Ab7", "Db7"] },
  Gb: { notes: [6, 10, 1], allowedTransitions: ["F#", "B", "C#", "D#m", "G#m", "F#7", "C#7"] },
  "G#": { notes: [8, 0, 3], allowedTransitions: ["Ab", "Eb", "Db", "Fm", "Cm", "Bbm", "Eb7", "Ab7"] },
  "D#": { notes: [3, 7, 10], allowedTransitions: ["Eb", "Bb", "Ab", "Cm", "Gm", "Fm", "Bb7", "Eb7", "G7"] },
  Ebm: { notes: [3, 6, 10], allowedTransitions: ["D#m", "F#", "G#m", "B", "D#7", "A#7"] },
} as const;

// ─────────────────────────────────────────────────────────
//  3. Constantes
// ─────────────────────────────────────────────────────────

const WINDOW_SIZE = 4;
const NEURAL_WEIGHT = 4.5;              // Reduzido (antes 8.0) para equilibrar com o score acústico
const ACOUSTIC_WEIGHT = 1.0;            // Mantido
const DEFAULT_TEMPERATURE = 0.1;        // Quase zero para evitar escolhas aleatórias e erráticas
const NEURAL_OVERRIDE_THRESHOLD = 0.25;
const WEIGHT_IN_CHORD = 2.0;
const WEIGHT_OUT_PENALTY = 0.5;
const WEIGHT_STRONG_BEAT = 1.5;
const WEIGHT_WEAK_BEAT = 1.0;
const BEAT_MARGIN_SEC = 0.15;
const REGISTER_LOW_THRESHOLD = 48;
const REGISTER_HIGH_THRESHOLD = 72;
const REGISTER_PENALTY = 0.2;
const REGISTER_BONUS = 1.5;
const DENSITY_THRESHOLD = 8;
const ORNAMENT_PENALTY_MULT = 0.2;
const LEAP_THRESHOLD = 7;
const TENSION_BONUS = 1.5;

// ─────────────────────────────────────────────────────────
//  4. LSTM Forward Pass em TypeScript puro
// ─────────────────────────────────────────────────────────

interface WeightEntry { shape: number[]; data_b64: string; }
interface LayerWeights { class: string; weights: WeightEntry[]; }
interface WeightsJSON {
  vocab_size: number;
  window_size: number;
  embedding_dim: number;
  lstm_units: number[];
  dense_units: number[];
  layers: Record<string, LayerWeights>;
}

// Decodifica base64 → Float32Array
function b64toF32(b64: string): Float32Array {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Float32Array(buf.buffer);
}


function sigmoid(x: number): number { return 1 / (1 + Math.exp(-x)); }
function tanh(x: number): number { return Math.tanh(x); }

function softmax(arr: Float32Array): Float32Array {
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  let sum = 0;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) { out[i] = Math.exp(arr[i] - max); sum += out[i]; }
  for (let i = 0; i < arr.length; i++) out[i] /= sum;
  return out;
}

function relu(arr: Float32Array): Float32Array {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] > 0 ? arr[i] : 0;
  return out;
}

// LSTM cell forward: input(inputDim), h_prev(units), c_prev(units) → [h, c]
function lstmCell(
  x: Float32Array, hPrev: Float32Array, cPrev: Float32Array,
  W: Float32Array, U: Float32Array, b: Float32Array,
  inputDim: number, units: number
): [Float32Array, Float32Array] {
  // Gates: i, f, c_gate, o  (stacked in W, U, b as 4*units)
  const gates = new Float32Array(4 * units);

  // gates = W^T x + U^T h_prev + b
  for (let g = 0; g < 4 * units; g++) {
    let val = b[g];
    for (let d = 0; d < inputDim; d++) val += W[d * (4 * units) + g] * x[d];
    for (let d = 0; d < units; d++)    val += U[d * (4 * units) + g] * hPrev[d];
    gates[g] = val;
  }

  const h = new Float32Array(units);
  const c = new Float32Array(units);

  for (let u = 0; u < units; u++) {
    const i_g = sigmoid(gates[u]);
    const f_g = sigmoid(gates[units + u]);
    const c_g = tanh(gates[2 * units + u]);
    const o_g = sigmoid(gates[3 * units + u]);
    c[u] = f_g * cPrev[u] + i_g * c_g;
    h[u] = o_g * tanh(c[u]);
  }
  return [h, c];
}

// Dense layer: x(inputDim) → y(outputDim)
function dense(x: Float32Array, W: Float32Array, b: Float32Array, inputDim: number, outputDim: number): Float32Array {
  const y = new Float32Array(outputDim);
  for (let j = 0; j < outputDim; j++) {
    let v = b[j];
    for (let i = 0; i < inputDim; i++) v += x[i] * W[i * outputDim + j];
    y[j] = v;
  }
  return y;
}

// ─────────────────────────────────────────────────────────
//  5. Estado do modelo
// ─────────────────────────────────────────────────────────

interface ModelWeights {
  embW: Float32Array;  // (vocab_size, emb_dim)
  lstm1W: Float32Array; // (emb_dim, 4*128)
  lstm1U: Float32Array; // (128, 4*128)
  lstm1b: Float32Array; // (4*128,)
  lstm2W: Float32Array; // (128, 4*64)
  lstm2U: Float32Array; // (64, 4*64)
  lstm2b: Float32Array; // (4*64,)
  melodyW?: Float32Array; // (12, 16)
  melodyb?: Float32Array; // (16,)
  dense1W: Float32Array;// (64, 64)
  dense1b: Float32Array;// (64,)
  dense2W: Float32Array;// (64, vocab_size)
  dense2b: Float32Array;// (vocab_size,)
}

let _weights: ModelWeights | null = null;
let _vocab: string[] = [];
let _vocabMap: Map<string, number> = new Map();
let _loadPromise: Promise<void> | null = null;

async function ensureModelLoaded(): Promise<void> {
  if (_weights) return;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    console.log("[NeuralHarmonyEngine] Carregando pesos LSTM...");

    const [wRes, vRes] = await Promise.all([
      fetch("/model/weights.json"),
      fetch("/model/vocab.json"),
    ]);

    const wData: WeightsJSON = await wRes.json();
    const vData: { vocab: string[] } = await vRes.json();

    _vocab = vData.vocab;
    _vocabMap = new Map(_vocab.map((c, i) => [c, i]));

    const L = wData.layers;
    const g = (name: string, idx: number) => b64toF32(L[name].weights[idx].data_b64);

    _weights = {
      embW: g("chord_embedding", 0),
      lstm1W: g("lstm_layer_1", 0),
      lstm1U: g("lstm_layer_1", 1),
      lstm1b: g("lstm_layer_1", 2),
      lstm2W: g("lstm_layer_2", 0),
      lstm2U: g("lstm_layer_2", 1),
      lstm2b: g("lstm_layer_2", 2),
      melodyW: L["melody_dense"] ? g("melody_dense", 0) : undefined,
      melodyb: L["melody_dense"] ? g("melody_dense", 1) : undefined,
      dense1W: g("dense_hidden", 0),
      dense1b: g("dense_hidden", 1),
      dense2W: g("chord_probabilities", 0),
      dense2b: g("chord_probabilities", 1),
    };

    console.log(`[NeuralHarmonyEngine] Pronto. Vocab: ${_vocab.length} acordes.`);
  })();

  return _loadPromise;
}

// ─────────────────────────────────────────────────────────
//  6. Inferência LSTM
// ─────────────────────────────────────────────────────────

function predict(chordHistory: readonly string[], melodyChroma?: number[]): Float32Array {
  if (!_weights || _vocab.length === 0) {
    return new Float32Array(_vocab.length || 97).fill(1 / (_vocab.length || 97));
  }

  const W = _weights;
  const embDim = 32;
  const units1 = 128;
  const units2 = 64;
  const vocabSize = _vocab.length;

  // Build padded context (WINDOW_SIZE tokens)
  const context: number[] = [];
  const slice = chordHistory.slice(-WINDOW_SIZE);
  while (context.length + slice.length < WINDOW_SIZE) context.push(0); // PAD
  for (const c of slice) context.push(_vocabMap.get(c) ?? 0);

  // Run LSTM forward pass
  // mask_zero=True: PAD tokens (idx=0) are skipped — h/c unchanged during masked steps.
  // This matches Keras Embedding(mask_zero=True) → LSTM masking behavior.
  let h1: any = new Float32Array(units1);
  let c1: any = new Float32Array(units1);
  let h2: any = new Float32Array(units2);
  let c2: any = new Float32Array(units2);

  for (let t = 0; t < WINDOW_SIZE; t++) {
    const idx = context[t];
    if (idx === 0) continue; // PAD token — skip (mask_zero=True behavior)

    // Embedding lookup: row idx of embW (vocab_size × embDim)
    const emb = W.embW.slice(idx * embDim, idx * embDim + embDim);

    [h1, c1] = lstmCell(emb, h1, c1, W.lstm1W, W.lstm1U, W.lstm1b, embDim, units1);
    [h2, c2] = lstmCell(h1, h2, c2, W.lstm2W, W.lstm2U, W.lstm2b, units1, units2);
  }

  // Dense layers & Concat
  let concat = h2;
  let in_dim = units2;
  
  if (W.melodyW && W.melodyb && melodyChroma && melodyChroma.length === 12) {
    const mChroma = new Float32Array(melodyChroma);
    const mDense = relu(dense(mChroma, W.melodyW, W.melodyb, 12, 16));
    concat = new Float32Array(units2 + 16);
    concat.set(h2, 0);
    concat.set(mDense, units2);
    in_dim = units2 + 16;
  }

  const d1 = relu(dense(concat, W.dense1W, W.dense1b, in_dim, 64));
  const logits = dense(d1, W.dense2W, W.dense2b, 64, vocabSize);
  return softmax(logits);
}

// ─────────────────────────────────────────────────────────
//  7. Scoring acústico (igual ao motor original)
// ─────────────────────────────────────────────────────────

function computeNoteScore(
  chordNotes: readonly number[],
  playedNotes: readonly DetectedNote[],
  windowStart: number,
  secondsPerBeat: number,
  isHighDensity: boolean,
  avgAmplitude: number,
): number {
  let score = 0;
  const rootNote = chordNotes[0];
  const thirdNote = chordNotes.length > 1 ? chordNotes[1] : -1;
  const fifthNote = chordNotes.length > 2 ? chordNotes[2] : -1;
  const seventhNote = chordNotes.length > 3 ? chordNotes[3] : -1;
  const outPenalty = isHighDensity ? WEIGHT_OUT_PENALTY * ORNAMENT_PENALTY_MULT : WEIGHT_OUT_PENALTY;

  for (const note of playedNotes) {
    const pc = Math.round(note.pitch) % 12;
    const isChordTone = chordNotes.includes(pc);
    const isRoot = pc === rootNote;
    const isThird = pc === thirdNote;
    const isFifth = pc === fifthNote;
    const isSeventh = pc === seventhNote;

    const relTime = note.startTime - windowStart;
    const beatPhase = secondsPerBeat > 0 ? (relTime % secondsPerBeat) / secondsPerBeat : 0;
    const isStrong = beatPhase < BEAT_MARGIN_SEC || beatPhase > 1 - BEAT_MARGIN_SEC;
    const rhythmicWeight = isStrong ? WEIGHT_STRONG_BEAT : WEIGHT_WEAK_BEAT;
    const ampWeight = (note.amplitude || 0.7) / avgAmplitude;
    let regMod = 1.0;
    if (note.pitch < REGISTER_LOW_THRESHOLD && isRoot) regMod = REGISTER_BONUS;
    if (note.pitch > REGISTER_HIGH_THRESHOLD && !isChordTone) regMod = REGISTER_PENALTY;

    // Em harmonia musical funcional, a terça e a sétima são as notas mais expressivas da harmonia.
    // A nota melódica executada NÃO deve forçar o acorde a ter essa nota como fundamental!
    let baseVal = -outPenalty;
    if (isChordTone) {
      baseVal = WEIGHT_IN_CHORD;
      if (isThird) baseVal += 0.8;        // Terça: define se o acorde é maior ou menor
      else if (isSeventh) baseVal += 0.7; // Sétima: confere direção harmônica e tensão
      else if (isFifth) baseVal += 0.4;   // Quinta: estabilidade e sonoridade aberta
      else if (isRoot) baseVal += 0.3;    // Fundamental: base tonal equilibrada
    }
    score += baseVal * rhythmicWeight * ampWeight * regMod;
  }
  return score;
}

// ─────────────────────────────────────────────────────────
//  8. determineNextChord (API pública)
// ─────────────────────────────────────────────────────────

function sampleWithTemperature(candidates: string[], scores: number[], temp: number): string {
  if (candidates.length === 0) return "C";
  if (temp <= 0.05) {
    let maxI = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[maxI]) maxI = i;
    return candidates[maxI];
  }

  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const range = maxScore - minScore;

  if (range < 1e-4) return candidates[0];

  // Normalização de logits para escala adaptativa (~0 a 3.5).
  // Isso resolve matematicamente o problema da temperatura não ter efeito:
  // Agora temperaturas baixas (0.1) são firmes/tradicionais e altas (1.2+)
  // abrem espaço real para opções inovadoras e ricas.
  const scaleFactor = Math.max(1.0, range / 3.5);
  const scaledScores = scores.map(s => (s - maxScore) / scaleFactor);

  const exps = scaledScores.map(s => Math.exp(s / Math.max(0.1, temp)));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  let rand = Math.random() * sumExps;
  for (let i = 0; i < exps.length; i++) {
    rand -= exps[i];
    if (rand <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

export function determineNextChord(
  chordHistory: readonly string[],
  playedNotes: readonly DetectedNote[],
  windowStart: number,
  secondsPerBeat: number,
  temperature: number = DEFAULT_TEMPERATURE,
  tonality: string = "AUTO",
  songGrammar?: SongHarmonicGrammar | null,
  songPositionIndex: number = -1
): { chord: string; velocity: number; nextSongChordIndex?: number } {
  const currentChord = chordHistory.length > 0 
    ? chordHistory[chordHistory.length - 1] 
    : (songGrammar?.initialChord || "C");

  if (playedNotes.length === 0) {
    return { 
      chord: currentChord, 
      velocity: 0.7, 
      nextSongChordIndex: songPositionIndex >= 0 ? songPositionIndex : 0 
    };
  }

  const currentNode = HARMONY_GRAPH[currentChord];
  
  const melodyChroma = new Array(12).fill(0);
  for (const n of playedNotes) {
    const pc = Math.round(n.pitch) % 12;
    melodyChroma[pc] = 1;
  }

  // Se uma tonalidade estiver ativa, transpõe o histórico e o chroma para o Local Space (C Major)
  // para que o modelo LSTM treinado funcione perfeitamente em QUALQUER tom (D, G, E, Bb, etc.)
  let neuralHistory = chordHistory;
  let neuralMelodyChroma = melodyChroma;
  let tonalityOffset = 0;

  if (tonality !== "AUTO" && tonality) {
    tonalityOffset = getTonalityOffset(tonality);
    neuralHistory = normalizeProgressionToC(chordHistory, tonality);
    if (tonalityOffset !== 0) {
      neuralMelodyChroma = new Array(12).fill(0);
      for (let i = 0; i < 12; i++) {
        neuralMelodyChroma[(i - tonalityOffset + 12) % 12] = melodyChroma[i];
      }
    }
  }

  const neuralProbs = predict(neuralHistory, neuralMelodyChroma);

  const density = playedNotes.length;
  const isHighDensity = density > DENSITY_THRESHOLD;
  let sumAmp = 0; let hasLeap = false;
  for (let i = 0; i < density; i++) {
    sumAmp += playedNotes[i].amplitude || 0.7;
    if (i > 0 && Math.abs(playedNotes[i].pitch - playedNotes[i - 1].pitch) >= LEAP_THRESHOLD) hasLeap = true;
  }
  const avgAmplitude = Math.max(0.2, sumAmp / density);

  // ── Heurística de Contorno e Cadência ──
  let isDescendingToTonic = false;
  let isDescendingToDominant = false;
  
  if (tonality !== "AUTO" && tonality && density >= 3) {
    const recentPitches = playedNotes.map(n => n.pitch);
    const startPitch = recentPitches[0];
    const endPitch = recentPitches[density - 1];
    const isDescending = startPitch - endPitch >= 2;
    
    if (isDescending) {
      const currentPc = Math.round(endPitch) % 12;
      if (currentPc === tonalityOffset) {
        isDescendingToTonic = true;
      } else if (
        currentPc === (tonalityOffset + 7) % 12 ||
        currentPc === (tonalityOffset + 2) % 12 ||
        currentPc === (tonalityOffset + 11) % 12
      ) {
        isDescendingToDominant = true;
      }
    }
  }

  const candidates: string[] = [];
  const scores: number[] = [];

  // Se houver gramática da música aprendida do MIDI, o espaço de busca foca nos acordes da obra!
  const hasSongGrammar = Boolean(songGrammar && songGrammar.vocabulary && songGrammar.vocabulary.length > 0);
  const pool = hasSongGrammar
    ? (temperature > 0.65 
        ? Array.from(new Set([...songGrammar!.vocabulary, ...Object.keys(HARMONY_GRAPH)]))
        : songGrammar!.vocabulary)
    : Object.keys(HARMONY_GRAPH);

  for (const candidateName of pool) {
    // Busca probabilidade neural mapeando o candidato para o Local Space
    let localCandidate = candidateName;
    if (tonality !== "AUTO" && tonality) {
      localCandidate = normalizeProgressionToC([candidateName], tonality)[0] || candidateName;
    }
    const idx = _vocabMap.get(localCandidate) ?? -1;
    let neuralProb = idx >= 0 ? neuralProbs[idx] : 0;

    const isAllowedGraph = currentNode?.allowedTransitions.includes(candidateName) ?? false;
    const isAllowedNeural = neuralProb > NEURAL_OVERRIDE_THRESHOLD;
    const isSongChord = hasSongGrammar && songGrammar!.vocabulary.includes(candidateName);

    // Se NÃO tiver gramática, aplica a regra padrão do grafo ou neural
    if (!hasSongGrammar && !isAllowedGraph && !isAllowedNeural) continue;
    if (hasLeap && (candidateName.includes("7") || candidateName.includes("dim"))) neuralProb *= TENSION_BONUS;

    const chordNotes = getChordPitchClasses(candidateName);

    // Score acústico equilibrado pela densidade
    const acousticScoreRaw = computeNoteScore(chordNotes, playedNotes, windowStart, secondsPerBeat, isHighDensity, avgAmplitude);
    const acousticScore = acousticScoreRaw / Math.max(1, density);

    let finalScore = ACOUSTIC_WEIGHT * acousticScore + NEURAL_WEIGHT * neuralProb;

    // ── Condicionamento com o DNA Harmônico do MIDI (Song Grammar) ──
    if (hasSongGrammar && songGrammar) {
      // 1. Transição aprendida do MIDI: P(candidato | acordeAtual)
      const transProb = songGrammar.transitionMatrix[currentChord]?.[candidateName] ?? 0;
      if (transProb > 0) {
        finalScore += transProb * 4.5; // Forte bônus de transição estrutural da música
      }

      // 2. Expectativa sequencial com base na linha do tempo da música
      if (songPositionIndex >= 0 && songGrammar.sequence.length > 0) {
        const nextIdx = (songPositionIndex + 1) % songGrammar.sequence.length;
        const nextExpectedChord = songGrammar.sequence[nextIdx];
        if (candidateName === nextExpectedChord) {
          finalScore += 3.5; // Avanço harmônico natural da canção
        }

        const currentExpectedChord = songGrammar.sequence[songPositionIndex % songGrammar.sequence.length];
        if (candidateName === currentExpectedChord) {
          finalScore += 1.8; // Estabilidade no acorde atual enquanto canta notas da mesma harmonia
        }
      }

      // 3. Vocabulário da música
      if (isSongChord) {
        finalScore += 2.0;
      } else {
        finalScore -= 6.0; // Desestimula acordes alienígenas à canção
      }
    }

    // ── Filtro Funcional de Campo Harmônico (Scale Masking) ──
    if (tonality !== "AUTO" && tonality) {
      const roman = chordToRoman(candidateName, tonality);
      const baseRoman = roman.replace(/[^IVvxi]/g, '');

      if (isChordDiatonic(candidateName, tonality)) {
        // Forte bônus tonal para acordes diatônicos
        const scaleBias = Math.max(1.3, 2.4 / Math.max(0.2, temperature));
        finalScore *= scaleBias;

        // Bônus funcional para cadências no tom (I, IV, V, ii)
        if (baseRoman === "I" || baseRoman === "i") finalScore += 1.2;
        else if (baseRoman === "IV" || baseRoman === "iv" || baseRoman === "ii") finalScore += 0.8;
        else if (baseRoman === "V" || baseRoman === "v") finalScore += 1.0;
      } else {
        // Acorde fora do tom: se fizer parte do arranjo do MIDI, respeita!
        if (isSongChord) {
          finalScore *= 1.2; // O arranjo escolheu esse acorde expressivo intencionalmente
        } else {
          const penalty = Math.min(0.7, 0.15 + (temperature * 0.35));
          finalScore *= penalty;
        }
      }

      // ── Anti-Estagnação Harmônica ──
      if (chordHistory.length >= 2) {
        const last1 = chordHistory[chordHistory.length - 1];
        const last2 = chordHistory[chordHistory.length - 2];
        if (candidateName === last1 && last1 === last2) {
          finalScore *= 0.55;
        } else if (candidateName === last1) {
          finalScore *= 0.88;
        }
      }

      // ── Bônus de Contorno (Cadências) ──
      if (isDescendingToTonic && (baseRoman === "I" || baseRoman === "i")) {
        finalScore += 3.0;
      } else if (isDescendingToDominant && (baseRoman === "V" || baseRoman === "v" || baseRoman === "vii")) {
        finalScore += 2.5;
      }
    }

    candidates.push(candidateName);
    scores.push(finalScore);
  }

  const bestChord = candidates.length > 0 ? sampleWithTemperature(candidates, scores, temperature) : currentChord;

  let nextSongChordIndex = songPositionIndex;
  if (hasSongGrammar && songGrammar && songGrammar.sequence.length > 0) {
    if (songPositionIndex >= 0) {
      const nextExpected = (songPositionIndex + 1) % songGrammar.sequence.length;
      if (songGrammar.sequence[nextExpected] === bestChord) {
        nextSongChordIndex = nextExpected;
      } else if (songGrammar.sequence[songPositionIndex % songGrammar.sequence.length] === bestChord) {
        nextSongChordIndex = songPositionIndex;
      } else {
        const seq = songGrammar.sequence;
        let found = -1;
        for (let offset = 1; offset < seq.length; offset++) {
          const idx = (songPositionIndex + offset) % seq.length;
          if (seq[idx] === bestChord) {
            found = idx;
            break;
          }
        }
        nextSongChordIndex = found !== -1 ? found : seq.indexOf(bestChord);
      }
    } else {
      nextSongChordIndex = songGrammar.sequence.indexOf(bestChord);
    }
  }

  return { chord: bestChord, velocity: avgAmplitude, nextSongChordIndex };
}

// ─────────────────────────────────────────────────────────
//  9. generateProgression (API pública)
// ─────────────────────────────────────────────────────────

export async function generateProgression(
  playedNotes: readonly DetectedNote[],
  bpm: number,
  _harmonicRhythmBeats: number,
  timeSignatureNumerator: number,
  timeSignatureDenominator: number,
  startChord: string = "C",
): Promise<readonly { chord: string; velocity: number }[]> {
  await ensureModelLoaded();
  if (playedNotes.length === 0) return [{ chord: startChord, velocity: 0.7 }];

  const secondsPerBeat = (4 / timeSignatureDenominator) * (60 / bpm);
  const secondsPerMeasure = secondsPerBeat * timeSignatureNumerator;
  const totalStart = Math.min(...playedNotes.map(n => n.startTime));
  const totalEnd = Math.max(...playedNotes.map(n => n.endTime));
  const windowCount = Math.max(1, Math.ceil((totalEnd - totalStart) / secondsPerMeasure));

  const progression: { chord: string; velocity: number }[] = [];
  const history: string[] = [startChord];

  for (let w = 0; w < windowCount; w++) {
    const windowStart = totalStart + w * secondsPerMeasure;
    const windowEnd = windowStart + secondsPerMeasure;
    const clipped = playedNotes
      .filter(n => n.startTime < windowEnd && n.endTime > windowStart)
      .map(n => ({ pitch: n.pitch, startTime: Math.max(n.startTime, windowStart), endTime: Math.min(n.endTime, windowEnd), amplitude: n.amplitude }));
    const result = determineNextChord(history, clipped, windowStart, secondsPerBeat);
    progression.push(result);
    history.push(result.chord);
  }
  return progression;
}

// ─────────────────────────────────────────────────────────
//  10. Utilitários públicos
// ─────────────────────────────────────────────────────────

/** Retorna probabilidades neurais para o histórico dado (usado pelo ChordBlock). */
export function getNeuralProbs(chordHistory: string[]): Map<string, number> {
  const probs = predict(chordHistory);
  const result = new Map<string, number>();
  for (const [chord, idx] of _vocabMap) {
    result.set(chord, probs[idx] ?? 0);
  }
  return result;
}

/** Pré-carrega o modelo em background. */
export function warmUpModel(): void {
  ensureModelLoaded().catch(err =>
    console.warn("[NeuralHarmonyEngine] Falha ao pré-carregar:", err)
  );
}