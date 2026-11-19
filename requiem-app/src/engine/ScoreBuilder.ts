// ─────────────────────────────────────────────────────────
//  ScoreBuilder — MIDI → partitura de referência para Score Following
// ─────────────────────────────────────────────────────────
//
//  Converte um arquivo MIDI (geralmente um piano cover, com arpejos)
//  em duas linhas paralelas, alinhadas no mesmo eixo de tempo musical:
//
//   1. MELODIA  → sequência de alturas (pitch classes) que o cantor
//                 deve cantar. É o que o ScoreFollower usa para
//                 descobrir ONDE o cantor está na música.
//   2. HARMONIA → sequência de acordes com início/fim. É o que o
//                 acompanhamento toca naquele trecho.
//
//  Unidade de tempo: "beat" = unidade do denominador da fórmula de
//  compasso (em 6/8, 1 beat = 1 colcheia; 1 compasso = 6 beats).
//
//  ⚠ Este módulo não tem dependências de runtime (apenas tipos),
//    para poder ser testado offline em Node.
// ─────────────────────────────────────────────────────────

import type { SongManifest, SongMeter } from "../songs/catalog";
import type { SerializedBlock, SerializedChordSegment, SerializedNote } from "../lib/api";

// ── Tipos de entrada (subconjunto estrutural do @tonejs/midi) ──
export interface MidiNoteLike {
  midi: number;
  ticks: number;
  durationTicks: number;
  velocity: number;
}
export interface MidiLike {
  header: { ppq: number };
  tracks: { notes: MidiNoteLike[] }[];
}

// ── Tipos de saída ──────────────────────────────────────
export interface MelodyEvent {
  index: number;
  /** Pitch class 0-11 */
  pc: number;
  /** Nota MIDI representativa (primeira ocorrência) */
  midi: number;
  /** Início em beats */
  start: number;
  /** Fim em beats (= início do próximo evento) */
  end: number;
  /** Duração calculada em beats */
  duration: number;
  /** Ataques internos (re-articulações da mesma nota colapsadas neste evento) */
  onsets: number[];
  bar: number;
  /** Posição do tempo dentro do compasso (0 .. beatsPerBar) */
  beatInBar: number;
  /** Se o ataque ocorre exatamente no tempo forte (downbeat) */
  isDownbeat: boolean;
  /** Peso de "ponto de reentrada" (início de frase / tempo forte) */
  entryWeight: number;
  /** Índice do acorde soando no início do evento */
  chordIndex: number;
  /** Símbolo do acorde associado */
  chordSymbol: string;
  /** Intervalo em semitons em relação à nota anterior (0 na primeira nota) */
  intervalFromPrev: number;
  /** Intervalo em semitons em relação à próxima nota (0 na última nota) */
  intervalToNext: number;
  /** Se esta nota melódica pertence à tétrade/tríade do acorde */
  isChordTone: boolean;
}

export interface ScoreChord {
  index: number;
  /** Símbolo para exibição (ex: "Bm7/A") */
  symbol: string;
  root: number;
  bass: number;
  pcs: number[];
  start: number;
  end: number;
  bar: number;
  pattern?: ArpeggioNote[];
  /** Classes de notas melódicas (0-11) esperadas durante este acorde */
  melodyPcs?: number[];
}

export interface ArpeggioNote {
  interval: number; // Semitons em relacao a tonica
  timeOffset: number; // Em compassos (beats) em relacao ao inicio do acorde
  duration: number; // Em compassos (beats)
  velocity: number;
}

export interface LearnedMelodySignature {
  /** N-gram de 2 notas: "pc1_pc2" -> lista de índices na melodia */
  bigrams: Record<string, number[]>;
  /** N-gram de 3 notas: "pc1_pc2_pc3" -> lista de índices na melodia */
  trigrams: Record<string, number[]>;
  /** Intervalos relativos entre notas sucessivas */
  intervals: Record<string, number[]>;
}

export interface ScoreNote {
  midi: number;
  start: number;
  end: number;
  duration: number;
  velocity: number;
  track: number;
}

export interface SongScore {
  songId: string;
  title: string;
  key: string;
  originalKey?: string;
  meter: SongMeter;
  beatsPerBar: number;
  /** Duração nominal de 1 beat em ms (derivada do BPM do manifesto) */
  msPerBeat: number;
  totalBeats: number;
  melody: MelodyEvent[];
  chords: ScoreChord[];
  /** Padrões N-Gram aprendidos da melodia para reconhecimento instantâneo de saltos e repetições */
  signatures?: LearnedMelodySignature;
  /** Matriz de transições de acordes aprendidas a partir do próprio MIDI */
  chordTransitions?: Record<string, { symbol: string; count: number }[]>;
  /** Gramática harmônica aprendida do MIDI para o motor generativo ao vivo */
  grammar?: SongHarmonicGrammar;
  /** Notas reais completas do arranjo MIDI para execução instrumental ao vivo */
  notes: ScoreNote[];
}

export interface SongHarmonicGrammar {
  /** Sequência cronológica de acordes do MIDI */
  sequence: string[];
  /** Vocabulário único de acordes presentes na música */
  vocabulary: string[];
  /** Transições empíricas: fromChord -> { symbol, prob, count }[] */
  transitions: Record<string, { symbol: string; prob: number; count: number }[]>;
  /** Dicionário direto para lookup O(1): fromChord -> toChord -> prob */
  transitionMatrix: Record<string, Record<string, number>>;
  /** Ritmo harmônico típico (duração de acordes em ms baseado no BPM da obra) */
  typicalChordDurationMs: number;
  /** Tonalidade principal da obra */
  key: string;
  /** Primeiro acorde da música */
  initialChord: string;
}

// ─────────────────────────────────────────────────────────
//  Teoria básica
// ─────────────────────────────────────────────────────────
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"]);

const NAME_TO_PC: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

export function keyRootPc(key: string): number | null {
  const m = key.match(/^([A-G][#b]?)/);
  if (!m) return null;
  return NAME_TO_PC[m[1]] ?? null;
}

export function spellPc(pc: number, key: string): string {
  const names = FLAT_KEYS.has(key) ? FLAT_NAMES : SHARP_NAMES;
  return names[((pc % 12) + 12) % 12];
}

interface ChordTemplate {
  suffix: string;
  intervals: number[];
}

const TEMPLATES: ChordTemplate[] = [
  { suffix: "", intervals: [0, 4, 7] },
  { suffix: "m", intervals: [0, 3, 7] },
  { suffix: "dim", intervals: [0, 3, 6] },
  { suffix: "sus4", intervals: [0, 5, 7] },
  { suffix: "7", intervals: [0, 4, 7, 10] },
  { suffix: "maj7", intervals: [0, 4, 7, 11] },
  { suffix: "m7", intervals: [0, 3, 7, 10] },
];

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PCS = [0, 2, 4, 5, 7, 9, 11];
/** Quantos "graus de letra" acima da fundamental cada intervalo ocupa (3ª, 5ª, 7ª...). */
const INTERVAL_LETTER_STEPS = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];

/** Soletra uma nota como intervalo da fundamental (ex: 3ª maior de C# = E#, não F). */
function spellFromRoot(rootName: string, interval: number): string {
  const letterIdx = LETTERS.indexOf(rootName[0]);
  const rootPc = NAME_TO_PC[rootName] ?? 0;
  const targetPc = (rootPc + interval) % 12;
  const letter = (letterIdx + INTERVAL_LETTER_STEPS[interval]) % 7;
  let diff = (targetPc - LETTER_PCS[letter] + 12) % 12;
  if (diff > 6) diff -= 12;
  if (Math.abs(diff) > 2) return SHARP_NAMES[targetPc];
  const acc = diff > 0 ? "#".repeat(diff) : "b".repeat(-diff);
  return LETTERS[letter] + acc;
}

/** Monta o símbolo de um acorde (com baixo invertido quando aplicável). */
export function chordSymbol(root: number, suffix: string, bass: number, key: string): string {
  const rootName = spellPc(root, key);
  const base = rootName + suffix;
  if (bass === root) return base;
  return `${base}/${spellFromRoot(rootName, (bass - root + 12) % 12)}`;
}

/** Calcula a menor distância em semitons entre duas tonalidades [-5..+6]. */
export function getSemitoneDifference(fromKey: string, toKey: string): number {
  if (fromKey === toKey) return 0;
  const fromPc = keyRootPc(fromKey);
  const toPc = keyRootPc(toKey);
  if (fromPc === null || toPc === null) return 0;
  let diff = (toPc - fromPc) % 12;
  if (diff > 6) diff -= 12;
  if (diff < -5) diff += 12;
  return diff;
}

/** Transpõe um ScoreChord em `semitones`, re-soletrando para a tonalidade alvo. */
export function transposeChord(chord: ScoreChord, semitones: number, targetKey: string): ScoreChord {
  if (semitones === 0) return chord;
  const t = (pc: number) => (((pc + semitones) % 12) + 12) % 12;
  const suffix = chord.symbol.replace(/^[A-G][#b]?/, "").replace(/\/.*$/, "");
  const root = t(chord.root);
  const bass = t(chord.bass);

  let pattern: ArpeggioNote[] | undefined = undefined;
  if (chord.pattern) {
    const intervalShift = chord.root + semitones - root;
    pattern = chord.pattern.map(p => ({
      ...p,
      interval: p.interval + intervalShift,
    }));
  }

  const melodyPcs = chord.melodyPcs ? chord.melodyPcs.map(t) : undefined;

  return {
    ...chord,
    root,
    bass,
    pcs: chord.pcs.map(t),
    symbol: chordSymbol(root, suffix, bass, targetKey),
    ...(pattern ? { pattern } : {}),
    ...(melodyPcs ? { melodyPcs } : {}),
  };
}

/** Constrói o índice N-Gram melódico (bi-gramas, tri-gramas e intervalos) para identificação instantânea de saltos/voltas. */
export function buildLearnedSignatures(melody: MelodyEvent[]): LearnedMelodySignature {
  const bigrams: Record<string, number[]> = {};
  const trigrams: Record<string, number[]> = {};
  const intervals: Record<string, number[]> = {};

  for (let i = 0; i < melody.length - 1; i++) {
    const bKey = `${melody[i].pc}_${melody[i + 1].pc}`;
    if (!bigrams[bKey]) bigrams[bKey] = [];
    bigrams[bKey].push(i + 1);

    const intKey = `${melody[i + 1].midi - melody[i].midi}`;
    if (!intervals[intKey]) intervals[intKey] = [];
    intervals[intKey].push(i + 1);
  }

  for (let i = 0; i < melody.length - 2; i++) {
    const tKey = `${melody[i].pc}_${melody[i + 1].pc}_${melody[i + 2].pc}`;
    if (!trigrams[tKey]) trigrams[tKey] = [];
    trigrams[tKey].push(i + 2);

    const int2Key = `${melody[i + 1].midi - melody[i].midi}_${melody[i + 2].midi - melody[i + 1].midi}`;
    if (!intervals[int2Key]) intervals[int2Key] = [];
    intervals[int2Key].push(i + 2);
  }

  return { bigrams, trigrams, intervals };
}

/** Extrai a matriz empírica de transição de acordes aprendida da própria obra. */
export function buildChordTransitions(chords: ScoreChord[]): Record<string, { symbol: string; count: number }[]> {
  const counts: Record<string, Record<string, number>> = {};
  for (let i = 0; i < chords.length - 1; i++) {
    const from = chords[i].symbol;
    const to = chords[i + 1].symbol;
    if (!counts[from]) counts[from] = {};
    counts[from][to] = (counts[from][to] || 0) + 1;
  }
  const result: Record<string, { symbol: string; count: number }[]> = {};
  for (const [from, toMap] of Object.entries(counts)) {
    result[from] = Object.entries(toMap).map(([symbol, count]) => ({ symbol, count }));
  }
  return result;
}

/** Extrai a gramática harmônica completa (vocabulário, matriz Markov e ritmo) aprendida do MIDI. */
export function extractHarmonicGrammar(
  chords: ScoreChord[],
  key: string,
  _bpm: number,
  beatsPerBar: number,
  msPerBeat: number
): SongHarmonicGrammar {
  const sequence = chords.map(c => c.symbol).filter(Boolean);
  const vocabulary = Array.from(new Set(sequence));
  const counts: Record<string, Record<string, number>> = {};
  const totalFrom: Record<string, number> = {};

  for (let i = 0; i < sequence.length - 1; i++) {
    const from = sequence[i];
    const to = sequence[i + 1];
    if (!counts[from]) counts[from] = {};
    counts[from][to] = (counts[from][to] || 0) + 1;
    totalFrom[from] = (totalFrom[from] || 0) + 1;
  }

  // Permite fechar o ciclo (refrão -> verso / fim -> início)
  if (sequence.length > 1) {
    const last = sequence[sequence.length - 1];
    const first = sequence[0];
    if (!counts[last]) counts[last] = {};
    counts[last][first] = (counts[last][first] || 0) + 1;
    totalFrom[last] = (totalFrom[last] || 0) + 1;
  }

  const transitions: Record<string, { symbol: string; prob: number; count: number }[]> = {};
  const transitionMatrix: Record<string, Record<string, number>> = {};

  for (const [from, toMap] of Object.entries(counts)) {
    transitions[from] = [];
    transitionMatrix[from] = {};
    const total = totalFrom[from] || 1;
    for (const [to, count] of Object.entries(toMap)) {
      const prob = count / total;
      transitions[from].push({ symbol: to, prob, count });
      transitionMatrix[from][to] = prob;
    }
    transitions[from].sort((a, b) => b.prob - a.prob);
  }

  const durations = chords.map(c => (c.end - c.start) * msPerBeat);
  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : beatsPerBar * msPerBeat;

  return {
    sequence,
    vocabulary,
    transitions,
    transitionMatrix,
    typicalChordDurationMs: Math.max(800, avgDuration),
    key,
    initialChord: sequence[0] || (key && key !== "AUTO" ? key : "C")
  };
}

/** Transpõe uma SongScore completa em `semitones` para `targetKey`. */
export function transposeSongScore(score: SongScore, semitones: number, targetKey: string): SongScore {
  if (semitones === 0) return { ...score, key: targetKey };
  const tPc = (pc: number) => (((pc + semitones) % 12) + 12) % 12;

  const transposedChords: ScoreChord[] = score.chords.map(c =>
    transposeChord(c, semitones, targetKey)
  );

  const transposedMelody: MelodyEvent[] = score.melody.map(m => {
    const chord = transposedChords[m.chordIndex];
    const newPc = tPc(m.pc);
    return {
      ...m,
      pc: newPc,
      midi: Math.max(0, Math.min(127, m.midi + semitones)),
      chordSymbol: chord ? chord.symbol : m.chordSymbol,
      isChordTone: chord ? chord.pcs.includes(newPc) : m.isChordTone,
    };
  });

  const transposedNotes: ScoreNote[] = (score.notes || []).map(n => ({
    ...n,
    midi: Math.max(0, Math.min(127, n.midi + semitones)),
  }));

  const grammar = extractHarmonicGrammar(
    transposedChords,
    targetKey,
    score.meter ? (60000 / score.msPerBeat) * (4 / score.meter.denominator) : 120,
    score.beatsPerBar,
    score.msPerBeat
  );

  return {
    ...score,
    key: targetKey,
    melody: transposedMelody,
    chords: transposedChords,
    signatures: buildLearnedSignatures(transposedMelody),
    chordTransitions: buildChordTransitions(transposedChords),
    grammar,
    notes: transposedNotes,
  };
}

// ─────────────────────────────────────────────────────────
//  Construção
// ─────────────────────────────────────────────────────────
interface BeatNote {
  midi: number;
  start: number;
  end: number;
  velocity: number;
  track: number;
}

export function buildSongScore(midi: MidiLike, manifest: SongManifest): SongScore {
  const { meter } = manifest;
  const beatsPerBar = meter.numerator;
  const beatInQuarters = manifest.midiBeatInQuarters ?? 4 / meter.denominator;
  const ticksPerBeat = midi.header.ppq * beatInQuarters;
  // BPM do app é em semínimas → duração de 1 beat (unidade do denominador)
  const msPerBeat = (60000 / manifest.bpm) * (4 / meter.denominator);

  const notes: BeatNote[] = [];
  midi.tracks.forEach((track, ti) => {
    for (const n of track.notes) {
      notes.push({
        midi: n.midi,
        start: n.ticks / ticksPerBeat,
        end: (n.ticks + Math.max(1, n.durationTicks)) / ticksPerBeat,
        velocity: n.velocity || 0.7,
        track: ti,
      });
    }
  });
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);

  const lastEnd = notes.reduce((m, n) => Math.max(m, n.end), 0);
  const totalBars = Math.max(1, Math.ceil(lastEnd / beatsPerBar - 0.05));
  const totalBeats = totalBars * beatsPerBar;

  const chords = extractHarmony(notes, beatsPerBar, totalBeats, meter, manifest.key);
  const melody = extractMelody(notes, manifest.melodyTrack, beatsPerBar, totalBeats, chords);

  // Associa cada evento melódico ao seu respectivo acorde na partitura
  for (const m of melody) {
    if (m.chordIndex >= 0 && m.chordIndex < chords.length) {
      if (!chords[m.chordIndex].melodyPcs) {
        chords[m.chordIndex].melodyPcs = [];
      }
      if (!chords[m.chordIndex].melodyPcs!.includes(m.pc)) {
        chords[m.chordIndex].melodyPcs!.push(m.pc);
      }
    }
  }

  const signatures = buildLearnedSignatures(melody);
  const chordTransitions = buildChordTransitions(chords);
  const grammar = extractHarmonicGrammar(chords, manifest.key, manifest.bpm, beatsPerBar, msPerBeat);

  const scoreNotes: ScoreNote[] = notes.map(n => ({
    midi: n.midi,
    start: n.start,
    end: n.end,
    duration: Math.max(0.05, n.end - n.start),
    velocity: n.velocity,
    track: n.track,
  }));

  return {
    songId: manifest.id,
    title: manifest.title,
    key: manifest.key,
    originalKey: manifest.key,
    meter,
    beatsPerBar,
    msPerBeat,
    totalBeats,
    melody,
    chords,
    signatures,
    chordTransitions,
    grammar,
    notes: scoreNotes,
  };
}

// ─────────────────────────────────────────────────────────
//  Harmonia: template matching por janela harmônica
// ─────────────────────────────────────────────────────────

/** Tamanho da janela de análise harmônica em beats. */
function harmonicWindow(meter: SongMeter): number {
  const { numerator, denominator } = meter;
  // Compasso composto (6/8, 9/8, 12/8): 1 tempo = semínima pontuada = 3 colcheias
  if (denominator === 8 && numerator % 3 === 0 && numerator > 3) return 3;
  if (numerator === 4) return 2;
  return numerator;
}

function extractHarmony(
  notes: BeatNote[],
  beatsPerBar: number,
  totalBeats: number,
  meter: SongMeter,
  key: string,
): ScoreChord[] {
  const win = harmonicWindow(meter);
  const raw: Omit<ScoreChord, "index">[] = [];

  let prev: { root: number; suffix: string } | null = null;

  for (let ws = 0; ws < totalBeats; ws += win) {
    const we = ws + win;
    const weights = new Array<number>(12).fill(0);
    let total = 0;
    let lowest: BeatNote | null = null;
    const notesInWindow: BeatNote[] = [];

    for (const n of notes) {
      if (n.start >= we) break;
      // Tolerância de 0.15 beat: ataques "adiantados" do pianista pertencem à janela
      if (n.end <= ws + 0.15) continue;
      const overlap = Math.min(n.end, we) - Math.max(n.start, ws - 0.15);
      if (overlap <= 0) continue;
      const w = overlap * (0.4 + n.velocity);
      weights[n.midi % 12] += w;
      total += w;
      // Baixo: nota mais grave com presença relevante na janela
      if (overlap >= 0.5 && (!lowest || n.midi < lowest.midi)) lowest = n;
      
      notesInWindow.push(n);
    }

    if (total < 0.5) {
      // Janela vazia: sustenta o acorde anterior
      if (raw.length > 0) raw[raw.length - 1].end = we;
      continue;
    }

    const bassPc = lowest ? lowest.midi % 12 : -1;
    let best = { score: -Infinity, root: 0, t: TEMPLATES[0] };

    for (let root = 0; root < 12; root++) {
      for (const t of TEMPLATES) {
        const members = new Set(t.intervals.map(i => (root + i) % 12));
        let inside = 0;
        for (const pc of members) inside += weights[pc];
        const outside = total - inside;
        let score = inside - 0.6 * outside;
        // Notas do template ausentes na janela também pesam (evita "acordes fantasmas")
        for (const pc of members) if (weights[pc] < 0.04 * total) score -= 0.12 * total;
        if (bassPc === root) score += 0.25 * total;
        else if (members.has(bassPc)) score += 0.08 * total;
        // Tétrades só quando a 7ª é realmente presente
        if (t.intervals.length > 3) score -= 0.06 * total;
        // Histerese: continuidade com o acorde anterior
        if (prev && prev.root === root && prev.suffix === t.suffix) score += 0.1 * total;
        if (score > best.score) best = { score, root, t };
      }
    }

    const pcs = best.t.intervals.map(i => (best.root + i) % 12);
    const bass = pcs.includes(bassPc) ? bassPc : best.root;
    const symbol = chordSymbol(best.root, best.t.suffix, bass, key);
    prev = { root: best.root, suffix: best.t.suffix };

    const last = raw[raw.length - 1];
    
    // Construir padrão de arpejo com as notas que atacam nesta janela de harmonia
    const attackNotes = notes.filter(n => n.start >= ws - 0.1 && n.start < we - 0.05);

    const pattern: ArpeggioNote[] = attackNotes.map(n => ({
      interval: n.midi - (48 + best.root),
      timeOffset: Math.max(0, n.start - ws),
      duration: Math.max(0.25, n.end - n.start),
      velocity: Math.max(0.65, Math.min(1.0, (n.velocity || 0.7) * 1.4)),
    }));

    if (last && last.symbol === symbol) {
      last.end = we;
      if (last.pattern) {
        // Acumula ataques deslocados pelo tempo desde o início do acorde
        last.pattern.push(...pattern.map(p => ({ ...p, timeOffset: p.timeOffset + (ws - last.start) })));
      }
    } else {
      raw.push({ symbol, root: best.root, bass, pcs, start: ws, end: we, bar: Math.floor(ws / beatsPerBar), pattern });
    }
  }

  return raw.map((c, index) => ({ ...c, index }));
}

// ─────────────────────────────────────────────────────────
//  Melodia: "skyline sustentado"
// ─────────────────────────────────────────────────────────
//  Uma nota é melodia se NENHUMA nota mais aguda está soando
//  sobre ela (iniciada antes/junto e ainda soando meio beat depois).
//  Isso remove as notas internas dos arpejos — que soam ABAIXO da
//  nota de melodia sustentada pela mão direita.
function extractMelody(
  notes: BeatNote[],
  melodyTrack: number | undefined,
  beatsPerBar: number,
  totalBeats: number,
  chords: ScoreChord[],
): MelodyEvent[] {
  const pool = melodyTrack === undefined ? notes : notes.filter(n => n.track === melodyTrack);

  const sky: BeatNote[] = [];
  for (let i = 0; i < pool.length; i++) {
    const n = pool[i];
    let covered = false;
    for (let j = 0; j < pool.length; j++) {
      const m = pool[j];
      if (m.start > n.start + 0.15) break;
      if (m === n || m.midi <= n.midi) continue;
      if (m.end > n.start + 0.5) { covered = true; break; }
    }
    if (!covered) sky.push(n);
  }

  // Remove notas muito rápidas (escalas/ornamentos instrumentais que ninguém canta)
  const filtered = sky.filter((n, i) => {
    const next = sky[i + 1];
    const ioi = next ? next.start - n.start : n.end - n.start;
    return ioi >= 0.6;
  });

  // Colapsa repetições consecutivas da mesma pitch class
  type Draft = { pc: number; midi: number; start: number; onsets: number[] };
  const drafts: Draft[] = [];
  for (const n of filtered) {
    const pc = n.midi % 12;
    const last = drafts[drafts.length - 1];
    if (last && last.pc === pc) {
      last.onsets.push(n.start);
    } else {
      drafts.push({ pc, midi: n.midi, start: n.start, onsets: [n.start] });
    }
  }

  const chordAt = (beat: number) => {
    for (let i = chords.length - 1; i >= 0; i--) if (chords[i].start <= beat + 0.01) return i;
    return 0;
  };

  return drafts.map((d, index) => {
    const end = index + 1 < drafts.length ? drafts[index + 1].start : totalBeats;
    const prevDur = index > 0 ? d.start - drafts[index - 1].start : Infinity;
    const posInBar = d.start % beatsPerBar;
    const onDownbeat = posInBar < 0.35 || posInBar > beatsPerBar - 0.35;
    // Pontos de reentrada prováveis: depois de nota longa (respiração) e tempos fortes
    let entryWeight = 1;
    if (prevDur >= beatsPerBar) entryWeight += 4;
    if (onDownbeat) entryWeight += 2;
    const ci = chordAt(d.start);
    const chord = chords[ci];
    const isChordTone = chord ? chord.pcs.includes(d.pc) : false;
    const intervalFromPrev = index > 0 ? d.midi - drafts[index - 1].midi : 0;
    const intervalToNext = index + 1 < drafts.length ? drafts[index + 1].midi - d.midi : 0;

    return {
      index,
      pc: d.pc,
      midi: d.midi,
      start: d.start,
      end,
      duration: end - d.start,
      onsets: d.onsets,
      bar: Math.floor(d.start / beatsPerBar),
      beatInBar: posInBar,
      isDownbeat: onDownbeat,
      entryWeight,
      chordIndex: ci,
      chordSymbol: chord?.symbol ?? "",
      intervalFromPrev,
      intervalToNext,
      isChordTone,
    };
  });
}

/** Índice do acorde soando em `beat` (busca binária). */
export function chordIndexAt(score: SongScore, beat: number): number {
  const { chords } = score;
  let lo = 0, hi = chords.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chords[mid].start <= beat + 1e-6) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Projeção da harmonia no formato legado de blocos (ChordSegment). */
export function scoreToChordSegments(score: SongScore) {
  return score.chords.map(c => ({
    id: `${score.songId}_c${c.index}`,
    chord: c.symbol,
    durationBeats: c.end - c.start,
    velocity: 0.7,
  }));
}

/**
 * Determina o próximo acorde da partitura baseado na nota cantada/tocada ao vivo,
 * respeitando a linha do tempo harmônica e a melodia esperada da canção.
 */
export function determineSongScoreChord(
  score: SongScore,
  currentChordIndex: number,
  currentPitchClass: number,
  timeSinceLastChordChangeMs: number
): {
  chord: string;
  chordIndex: number;
  shouldChange: boolean;
} {
  const chords = score.chords;
  if (!chords || chords.length === 0) {
    return { chord: "C", chordIndex: 0, shouldChange: false };
  }

  // 1. Caso inicial: nenhum acorde foi ancorado ainda (início da execução)
  if (currentChordIndex < 0) {
    let bestStartIdx = 0;
    let found = false;

    // Procura nos primeiros 25 acordes o primeiro que tem essa nota melódica
    for (let i = 0; i < Math.min(chords.length, 25); i++) {
      const c = chords[i];
      if (c.melodyPcs && c.melodyPcs.includes(currentPitchClass)) {
        bestStartIdx = i;
        found = true;
        break;
      }
    }

    if (!found) {
      for (let i = 0; i < Math.min(chords.length, 25); i++) {
        const c = chords[i];
        if (c.pcs.includes(currentPitchClass)) {
          bestStartIdx = i;
          found = true;
          break;
        }
      }
    }

    return {
      chord: chords[bestStartIdx].symbol,
      chordIndex: bestStartIdx,
      shouldChange: true,
    };
  }

  const currentChord = chords[currentChordIndex];
  const isChordTone = currentChord.pcs.includes(currentPitchClass);
  const isMelodyTone = currentChord.melodyPcs ? currentChord.melodyPcs.includes(currentPitchClass) : false;
  const isTooSoon = timeSinceLastChordChangeMs < 450;

  // Pontuação para SUSTENTAR o acorde atual (STAY)
  let stayScore = 0;
  if (isMelodyTone) stayScore += 8.0; // Se a nota atual pertence à melodia deste acorde, mantém firme!
  if (isChordTone) stayScore += 4.0;  // Se for nota do acorde, mantém a harmonia
  if (isTooSoon) stayScore += 3.5;    // Não troca em menos de 450ms
  if (timeSinceLastChordChangeMs > 2500) stayScore -= 2.0;

  let bestCandidateIdx = currentChordIndex;
  let bestCandidateScore = stayScore;

  // Avalia avançar de 1 a 4 acordes na sequência da partitura
  for (let offset = 1; offset <= 4; offset++) {
    const candidateIdx = (currentChordIndex + offset) % chords.length;
    const cand = chords[candidateIdx];

    let advanceScore = 0;
    const candIsMelodyTone = cand.melodyPcs ? cand.melodyPcs.includes(currentPitchClass) : false;
    const candIsChordTone = cand.pcs.includes(currentPitchClass);

    if (candIsMelodyTone) advanceScore += 7.5; // Acerto direto na melodia esperada pelo arranjo!
    else if (candIsChordTone) advanceScore += 3.5;
    else continue; // Se o acorde candidato não tem a nota, não avança para ele

    advanceScore -= (offset - 1) * 1.5; // Prefere o próximo imediato sobre pular 2 ou 3

    if (timeSinceLastChordChangeMs >= 500) {
      advanceScore += 2.0;
    } else {
      advanceScore -= 2.5; // Evita trocas precipitadas
    }

    if (advanceScore > bestCandidateScore) {
      bestCandidateScore = advanceScore;
      bestCandidateIdx = candidateIdx;
    }
  }

  // 3. Salto de seção / repetição de estrofe:
  // Se a nota não bate com o trecho atual, verifica se o músico voltou para o início
  // ou pulou para outra estrofe/refrão da música
  if (bestCandidateScore < 3.0) {
    for (let i = 0; i < chords.length; i++) {
      if (Math.abs(i - currentChordIndex) <= 4) continue;
      const cand = chords[i];
      if (cand.melodyPcs && cand.melodyPcs.includes(currentPitchClass)) {
        bestCandidateScore = 4.0;
        bestCandidateIdx = i;
        break;
      }
    }
  }

  if (bestCandidateIdx !== currentChordIndex) {
    return {
      chord: chords[bestCandidateIdx].symbol,
      chordIndex: bestCandidateIdx,
      shouldChange: true,
    };
  }

  return {
    chord: currentChord.symbol,
    chordIndex: currentChordIndex,
    shouldChange: false,
  };
}

// ─────────────────────────────────────────────────────────
//  Serialização Bidirecional: SongScore ↔ SerializedBlock[]
//  (Compatível com compositionData e configurationData da API)
// ─────────────────────────────────────────────────────────

const BLOCK_SUFFIX_INTERVALS: Record<string, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  "+": [0, 4, 8],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  "5": [0, 7],
  "6": [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  "9": [0, 4, 7, 10, 2],
  maj9: [0, 4, 7, 11, 2],
  m9: [0, 3, 7, 10, 2],
  add9: [0, 4, 7, 2],
  madd9: [0, 3, 7, 2],
  "7b9": [0, 4, 7, 10, 1],
  "7#9": [0, 4, 7, 10, 3],
  "7b5": [0, 4, 6, 10],
  "7alt": [0, 4, 8, 10, 1],
};

function parseChordSymbolToComponents(symbol: string): {
  root: number;
  bass: number;
  pcs: number[];
} {
  const [basePart, bassPart] = symbol.trim().split("/");
  const match = basePart.match(/^([A-G][#b]?)(.*)$/);
  if (!match) {
    return { root: 0, bass: 0, pcs: [0, 4, 7] };
  }

  const rootName = match[1];
  const suffix = (match[2] || "").replace(/[()]/g, "");
  const root = NAME_TO_PC[rootName] ?? 0;

  let intervals = BLOCK_SUFFIX_INTERVALS[suffix];
  if (!intervals) {
    if (suffix.startsWith("m7b5")) intervals = BLOCK_SUFFIX_INTERVALS.m7b5;
    else if (suffix.startsWith("maj7") || suffix.startsWith("maj9")) intervals = BLOCK_SUFFIX_INTERVALS.maj7;
    else if (suffix.startsWith("m") && !suffix.startsWith("maj")) intervals = suffix.includes("7") ? BLOCK_SUFFIX_INTERVALS.m7 : BLOCK_SUFFIX_INTERVALS.m;
    else if (suffix.startsWith("dim")) intervals = BLOCK_SUFFIX_INTERVALS.dim;
    else if (suffix.includes("7")) intervals = BLOCK_SUFFIX_INTERVALS["7"];
    else if (suffix.startsWith("sus")) intervals = BLOCK_SUFFIX_INTERVALS.sus4;
    else intervals = [0, 4, 7];
  }

  const pcs = Array.from(new Set(intervals.map(i => (root + i) % 12)));
  let bass = root;
  if (bassPart) {
    const bassMatch = bassPart.match(/^([A-G][#b]?)/);
    if (bassMatch && NAME_TO_PC[bassMatch[1]] !== undefined) {
      bass = NAME_TO_PC[bassMatch[1]];
      if (!pcs.includes(bass)) pcs.unshift(bass);
    }
  }

  return { root, bass, pcs };
}

function parseTimeSignatureString(ts?: string): SongMeter {
  if (!ts) return { numerator: 4, denominator: 4 };
  const match = ts.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return { numerator: 4, denominator: 4 };
  const numerator = Math.max(1, parseInt(match[1], 10) || 4);
  const denominator = Math.max(1, parseInt(match[2], 10) || 4);
  return { numerator, denominator };
}

/**
 * Converte uma SongScore em um array de SerializedBlock compatível com
 * compositionData (PATCH /sessions/:id) e configurationData (/store/presets).
 */
export function songScoreToSerializedBlocks(
  score: SongScore,
  blockName = "Arranjo Principal"
): SerializedBlock[] {
  const secPerBeat = score.msPerBeat / 1000;
  const bpm = Math.round((60000 / score.msPerBeat) * (4 / score.meter.denominator));

  const progression: SerializedChordSegment[] = score.chords.map((c, idx) => ({
    id: `chord-${idx + 1}`,
    chord: c.symbol,
    durationBeats: Number(Math.max(0.25, c.end - c.start).toFixed(3)),
  }));

  const notes: SerializedNote[] = score.melody.map(m => ({
    pitch: m.midi,
    startTime: Number((m.start * secPerBeat).toFixed(3)),
    endTime: Number((Math.max(m.start + 0.1, m.end) * secPerBeat).toFixed(3)),
    amplitude: 0.8,
  }));

  return [
    {
      id: `block-${score.songId || Date.now()}`,
      name: blockName,
      bpm: bpm > 0 ? bpm : 120,
      key: score.key || "C",
      timeSignature: `${score.meter.numerator}/${score.meter.denominator}`,
      progression,
      notes,
    },
  ];
}

/**
 * Constrói um bloco serializado a partir de uma execução ao vivo no Modo Improviso Livre.
 */
export function createFreeSessionBlocks(
  chordHistory: readonly string[],
  recordedNotes: readonly { pitch: number; startTime: number; endTime: number; amplitude: number }[],
  config: {
    bpm: number;
    key: string;
    numerator: number;
    denominator: number;
    name?: string;
  }
): SerializedBlock[] {
  const beatsPerBar = config.numerator || 4;
  const progression: SerializedChordSegment[] = chordHistory.map((chord, idx) => ({
    id: `free-seg-${idx + 1}`,
    chord,
    durationBeats: beatsPerBar,
  }));

  const notes: SerializedNote[] = recordedNotes.map(n => ({
    pitch: n.pitch,
    startTime: Number(n.startTime.toFixed(3)),
    endTime: Number(Math.max(n.startTime + 0.05, n.endTime).toFixed(3)),
    amplitude: Number((n.amplitude ?? 0.8).toFixed(3)),
  }));

  return [
    {
      id: `block-${Date.now()}`,
      name: config.name || "Improviso Ao Vivo",
      bpm: config.bpm || 120,
      key: config.key || "C",
      timeSignature: `${config.numerator || 4}/${config.denominator || 4}`,
      progression,
      notes,
    },
  ];
}

/**
 * Reconstrói uma SongScore executável pelo ScoreFollower e pelo motor ao vivo
 * a partir de SerializedBlock[] retornados pela API (/sessions ou /store/presets).
 */
export function buildSongScoreFromBlocks(
  blocks: SerializedBlock[],
  options: { songId?: string; title?: string } = {}
): SongScore | null {
  if (!blocks || blocks.length === 0) return null;

  const first = blocks[0];
  const meter = parseTimeSignatureString(first.timeSignature);
  const beatsPerBar = meter.numerator;
  const bpm = first.bpm && first.bpm > 0 ? first.bpm : 120;
  const msPerBeat = (60000 / bpm) * (4 / meter.denominator);
  const key = first.key || "C";

  const chords: ScoreChord[] = [];
  const rawMelodyNotes: { midi: number; start: number; end: number; amplitude: number }[] = [];

  let cursorBeat = 0;

  for (const block of blocks) {
    const blockMeter = parseTimeSignatureString(block.timeSignature || first.timeSignature);
    const blockBpm = block.bpm && block.bpm > 0 ? block.bpm : bpm;
    const blockMsPerBeat = (60000 / blockBpm) * (4 / blockMeter.denominator);
    const blockSecToBeats = 1000 / blockMsPerBeat;

    let blockChordBeats = 0;
    for (const seg of block.progression || []) {
      const dur = seg.durationBeats && seg.durationBeats > 0 ? seg.durationBeats : blockMeter.numerator;
      const start = cursorBeat + blockChordBeats;
      const end = start + dur;
      const parsed = parseChordSymbolToComponents(seg.chord);

      chords.push({
        index: chords.length,
        symbol: seg.chord,
        root: parsed.root,
        bass: parsed.bass,
        pcs: parsed.pcs,
        start,
        end,
        bar: Math.floor(start / beatsPerBar),
      });

      blockChordBeats += dur;
    }

    let maxNoteBeat = 0;
    for (const n of block.notes || []) {
      const startBeat = cursorBeat + Math.max(0, n.startTime) * blockSecToBeats;
      const endBeat = cursorBeat + Math.max(n.startTime + 0.1, n.endTime) * blockSecToBeats;
      rawMelodyNotes.push({
        midi: n.pitch,
        start: startBeat,
        end: endBeat,
        amplitude: n.amplitude ?? 0.8,
      });
      if (endBeat - cursorBeat > maxNoteBeat) maxNoteBeat = endBeat - cursorBeat;
    }

    cursorBeat += Math.max(blockChordBeats, maxNoteBeat, beatsPerBar);
  }

  if (chords.length === 0) return null;

  const totalBeats = Math.max(beatsPerBar, Math.ceil(cursorBeat / beatsPerBar) * beatsPerBar);

  rawMelodyNotes.sort((a, b) => a.start - b.start);

  const chordAt = (beat: number) => {
    for (let i = chords.length - 1; i >= 0; i--) {
      if (chords[i].start <= beat + 0.01) return i;
    }
    return 0;
  };

  const melody: MelodyEvent[] = rawMelodyNotes.map((n, index) => {
    const pc = ((Math.round(n.midi) % 12) + 12) % 12;
    const nextStart = index + 1 < rawMelodyNotes.length ? rawMelodyNotes[index + 1].start : n.end;
    const end = Math.max(n.end, nextStart);
    const posInBar = n.start % beatsPerBar;
    const onDownbeat = posInBar < 0.35 || posInBar > beatsPerBar - 0.35;
    const ci = chordAt(n.start);
    const chord = chords[ci];
    const isChordTone = chord ? chord.pcs.includes(pc) : false;

    if (chord) {
      if (!chord.melodyPcs) chord.melodyPcs = [];
      if (!chord.melodyPcs.includes(pc)) chord.melodyPcs.push(pc);
    }

    return {
      index,
      pc,
      midi: Math.round(n.midi),
      start: n.start,
      end,
      duration: Math.max(0.1, end - n.start),
      onsets: [n.start],
      bar: Math.floor(n.start / beatsPerBar),
      beatInBar: posInBar,
      isDownbeat: onDownbeat,
      entryWeight: onDownbeat ? 3 : 1,
      chordIndex: ci,
      chordSymbol: chord?.symbol ?? "",
      intervalFromPrev: index > 0 ? Math.round(n.midi) - Math.round(rawMelodyNotes[index - 1].midi) : 0,
      intervalToNext: index + 1 < rawMelodyNotes.length ? Math.round(rawMelodyNotes[index + 1].midi) - Math.round(n.midi) : 0,
      isChordTone,
    };
  });

  const scoreNotes: ScoreNote[] = rawMelodyNotes.map(n => ({
    midi: Math.round(n.midi),
    start: n.start,
    end: n.end,
    duration: Math.max(0.05, n.end - n.start),
    velocity: n.amplitude,
    track: 0,
  }));

  return {
    songId: options.songId || first.id || `blocks-${Date.now()}`,
    title: options.title || first.name || "Acompanhamento",
    key,
    originalKey: key,
    meter,
    beatsPerBar,
    msPerBeat,
    totalBeats,
    melody,
    chords,
    signatures: buildLearnedSignatures(melody),
    chordTransitions: buildChordTransitions(chords),
    grammar: extractHarmonicGrammar(chords, key, bpm, beatsPerBar, msPerBeat),
    notes: scoreNotes,
  };
}
