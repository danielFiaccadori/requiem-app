/**
 * KeyDetector — estima a tonalidade de um MIDI.
 *
 * Usa o algoritmo de Krumhansl-Schmuckler: monta um histograma de classes de
 * altura (ponderado pela duração das notas) e correlaciona com os perfis
 * maior/menor de Krumhansl-Kessler nas 12 transposições.
 * Se o MIDI tiver key signature no header e ela estiver entre as candidatas
 * mais fortes, ela é preferida (muitos arquivos trazem "C maior" por padrão,
 * então o header sozinho não é confiável).
 */

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Nomes compatíveis com ALL_TONALITIES (TonalityAdapter)
const MAJOR_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_NAMES = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];

const PC_INDEX: Record<string, number> = {
  C: 0, "B#": 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, F: 5, "E#": 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11,
};

export interface KeyDetectionResult {
  key: string;
  confidence: number; // correlação de Pearson (-1..1)
  source: "header" | "analysis";
}

interface MinimalMidi {
  header: { keySignatures?: { key: string; scale: string }[] };
  tracks: { channel?: number; notes: { midi: number; duration: number; velocity: number }[] }[];
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function detectMidiKey(midi: MinimalMidi): KeyDetectionResult | null {
  const hist = new Array(12).fill(0);
  midi.tracks.forEach(track => {
    if (track.channel === 9) return; // ignora bateria (canal 10)
    track.notes.forEach(n => {
      hist[n.midi % 12] += n.duration * (0.5 + n.velocity);
    });
  });
  if (hist.every(v => v === 0)) return null;

  const candidates: { key: string; score: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = hist.map((_, i) => hist[(i + tonic) % 12]);
    candidates.push({ key: MAJOR_NAMES[tonic], score: pearson(rotated, MAJOR_PROFILE) });
    candidates.push({ key: MINOR_NAMES[tonic], score: pearson(rotated, MINOR_PROFILE) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  const ks = midi.header.keySignatures?.[0];
  if (ks && PC_INDEX[ks.key] !== undefined) {
    const pc = PC_INDEX[ks.key];
    const headerKey = ks.scale === "minor" ? MINOR_NAMES[pc] : MAJOR_NAMES[pc];
    const match = candidates.slice(0, 3).find(c => c.key === headerKey);
    if (match && best.score - match.score < 0.1) {
      return { key: headerKey, confidence: match.score, source: "header" };
    }
  }

  return { key: best.key, confidence: best.score, source: "analysis" };
}
