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
import { chordToRoman, getChordPitchClasses } from "./TonalityAdapter";

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
const NEURAL_WEIGHT = 15.0;
const ACOUSTIC_WEIGHT = 1.0;
const NEURAL_OVERRIDE_THRESHOLD = 0.10;
const WEIGHT_IN_CHORD = 2.0;
const WEIGHT_ROOT_BONUS = 1.5;
const WEIGHT_OUT_PENALTY = 0.5;
const WEIGHT_STRONG_BEAT = 3.0;
const WEIGHT_WEAK_BEAT = 0.5;
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

// Matrix mul: A(m,k) × B(k,n) → C(m,n)
function matMul(A: Float32Array, B: Float32Array, m: number, k: number, n: number): Float32Array {
  const C = new Float32Array(m * n);
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let p = 0; p < k; p++) s += A[i * k + p] * B[p * n + j];
      C[i * n + j] = s;
    }
  return C;
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

function predict(chordHistory: readonly string[]): Float32Array {
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
  let h1 = new Float32Array(units1);
  let c1 = new Float32Array(units1);
  let h2 = new Float32Array(units2);
  let c2 = new Float32Array(units2);

  for (let t = 0; t < WINDOW_SIZE; t++) {
    const idx = context[t];
    if (idx === 0) continue; // PAD token — skip (mask_zero=True behavior)

    // Embedding lookup: row idx of embW (vocab_size × embDim)
    const emb = W.embW.slice(idx * embDim, idx * embDim + embDim);

    [h1, c1] = lstmCell(emb, h1, c1, W.lstm1W, W.lstm1U, W.lstm1b, embDim, units1);
    [h2, c2] = lstmCell(h1, h2, c2, W.lstm2W, W.lstm2U, W.lstm2b, units1, units2);
  }

  // Dense layers
  const d1 = relu(dense(h2, W.dense1W, W.dense1b, units2, 64));
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
  const outPenalty = isHighDensity ? WEIGHT_OUT_PENALTY * ORNAMENT_PENALTY_MULT : WEIGHT_OUT_PENALTY;

  for (const note of playedNotes) {
    const pc = Math.round(note.pitch) % 12;
    const isChordTone = chordNotes.includes(pc);
    const isRoot = pc === rootNote;
    const relTime = note.startTime - windowStart;
    const beatPhase = secondsPerBeat > 0 ? (relTime % secondsPerBeat) / secondsPerBeat : 0;
    const isStrong = beatPhase < BEAT_MARGIN_SEC || beatPhase > 1 - BEAT_MARGIN_SEC;
    const rhythmicWeight = isStrong ? WEIGHT_STRONG_BEAT : WEIGHT_WEAK_BEAT;
    const ampWeight = (note.amplitude || 0.7) / avgAmplitude;
    let regMod = 1.0;
    if (note.pitch < REGISTER_LOW_THRESHOLD && isRoot) regMod = REGISTER_BONUS;
    if (note.pitch > REGISTER_HIGH_THRESHOLD && !isChordTone) regMod = REGISTER_PENALTY;
    const baseVal = isChordTone ? WEIGHT_IN_CHORD + (isRoot ? WEIGHT_ROOT_BONUS : 0) : -outPenalty;
    score += baseVal * rhythmicWeight * ampWeight * regMod;
  }
  return score;
}

// ─────────────────────────────────────────────────────────
//  8. determineNextChord (API pública)
// ─────────────────────────────────────────────────────────

export function determineNextChord(
  chordHistory: readonly string[],
  playedNotes: readonly DetectedNote[],
  windowStart: number,
  secondsPerBeat: number,
): { chord: string; velocity: number } {
  const currentChord = chordHistory.length > 0 ? chordHistory[chordHistory.length - 1] : "C";
  if (playedNotes.length === 0) return { chord: currentChord, velocity: 0.7 };

  const currentNode = HARMONY_GRAPH[currentChord];
  const neuralProbs = predict(chordHistory);

  const density = playedNotes.length;
  const isHighDensity = density > DENSITY_THRESHOLD;
  let sumAmp = 0; let hasLeap = false;
  for (let i = 0; i < density; i++) {
    sumAmp += playedNotes[i].amplitude || 0.7;
    if (i > 0 && Math.abs(playedNotes[i].pitch - playedNotes[i - 1].pitch) >= LEAP_THRESHOLD) hasLeap = true;
  }
  const avgAmplitude = Math.max(0.2, sumAmp / density);

  let bestChord = currentChord;
  let bestScore = -Infinity;

  for (const candidateName of Object.keys(HARMONY_GRAPH)) {
    const idx = _vocabMap.get(candidateName) ?? -1;
    let neuralProb = idx >= 0 ? neuralProbs[idx] : 0;
    const isAllowedGraph = currentNode?.allowedTransitions.includes(candidateName) ?? false;
    const isAllowedNeural = neuralProb > NEURAL_OVERRIDE_THRESHOLD;
    if (!isAllowedGraph && !isAllowedNeural) continue;
    if (hasLeap && (candidateName.includes("7") || candidateName.includes("dim"))) neuralProb *= TENSION_BONUS;
    const chordNotes = getChordPitchClasses(candidateName);
    const acousticScore = computeNoteScore(chordNotes, playedNotes, windowStart, secondsPerBeat, isHighDensity, avgAmplitude);
    const finalScore = ACOUSTIC_WEIGHT * acousticScore + NEURAL_WEIGHT * neuralProb;
    if (finalScore > bestScore) { bestScore = finalScore; bestChord = candidateName; }
  }

  return { chord: bestChord, velocity: avgAmplitude };
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