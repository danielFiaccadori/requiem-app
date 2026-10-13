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
  /** Ataques internos (re-articulações da mesma nota colapsadas neste evento) */
  onsets: number[];
  bar: number;
  /** Peso de "ponto de reentrada" (início de frase / tempo forte) */
  entryWeight: number;
  /** Índice do acorde soando no início do evento */
  chordIndex: number;
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
}

export interface ArpeggioNote {
  interval: number; // Semitons em relacao a tonica
  timeOffset: number; // Em compassos (beats) em relacao ao inicio do acorde
  duration: number; // Em compassos (beats)
  velocity: number;
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

  return {
    ...chord,
    root,
    bass,
    pcs: chord.pcs.map(t),
    symbol: chordSymbol(root, suffix, bass, targetKey),
    ...(pattern ? { pattern } : {}),
  };
}

/** Transpõe uma SongScore completa em `semitones` para `targetKey`. */
export function transposeSongScore(score: SongScore, semitones: number, targetKey: string): SongScore {
  if (semitones === 0) return { ...score, key: targetKey };
  const tPc = (pc: number) => (((pc + semitones) % 12) + 12) % 12;

  const transposedMelody: MelodyEvent[] = score.melody.map(m => ({
    ...m,
    pc: tPc(m.pc),
    midi: Math.max(0, Math.min(127, m.midi + semitones)),
  }));

  const transposedChords: ScoreChord[] = score.chords.map(c =>
    transposeChord(c, semitones, targetKey)
  );

  return {
    ...score,
    key: targetKey,
    melody: transposedMelody,
    chords: transposedChords,
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
    return {
      index,
      pc: d.pc,
      midi: d.midi,
      start: d.start,
      end,
      onsets: d.onsets,
      bar: Math.floor(d.start / beatsPerBar),
      entryWeight,
      chordIndex: chordAt(d.start),
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
