// ─────────────────────────────────────────────────────────
//  Catálogo da Vitrine de Músicos
// ─────────────────────────────────────────────────────────
//
//  Cada entrada descreve COMO interpretar o arquivo MIDI de
//  referência. Arquivos MIDI gravados por humanos frequentemente
//  declaram metadados errados (ex: 4/4 @ 120 por padrão do DAW)
//  enquanto a música real está em outra fórmula de compasso.
//  Por isso a fórmula de compasso e o grid vêm do manifesto,
//  e NÃO do header do MIDI.
// ─────────────────────────────────────────────────────────

export interface SongMeter {
  numerator: number;
  denominator: number;
}

export interface SongManifest {
  id: string;
  title: string;
  artist: string;
  midiUrl: string;
  coverUrl: string;
  /** Tonalidade original do arquivo MIDI (ex: "D", "F#m"). */
  key: string;
  /** Fórmula de compasso real da música. */
  meter: SongMeter;
  /** Se true, a UI trava a fórmula de compasso enquanto a música estiver carregada. */
  lockMeter: boolean;
  /** BPM de referência (em semínimas, mesma convenção do resto do app). Usado como prior de andamento. */
  bpm: number;
  /**
   * Duração de 1 tempo do compasso (a unidade do denominador) medida em
   * semínimas do MIDI. Padrão: 4 / denominador.
   * Ex: MIDI gravado em "4/4" cuja colcheia real ocupa 0.75 semínima → 0.75.
   */
  midiBeatInQuarters?: number;
  /** Trilha do MIDI que contém a melodia. Se ausente, usa todas. */
  melodyTrack?: number;
}

export const SHOWCASE_SONGS: readonly SongManifest[] = [
  {
    id: "cant-help-falling-in-love",
    title: "Can't Help Falling In Love",
    artist: "Elvis Presley",
    midiUrl: "/music/Elvis.mid",
    coverUrl:
      "https://images.unsplash.com/photo-1520614917466-9ab5348ab692?auto=format&fit=crop&q=80&w=400",
    key: "D",
    // Fixo em 6/8 — o MIDI declara 4/4, mas os arpejos são colcheias compostas.
    meter: { numerator: 6, denominator: 8 },
    lockMeter: true,
    // Colcheia ≈ 375ms → semínima = 750ms → 80 BPM
    bpm: 80,
    midiBeatInQuarters: 0.75,
    melodyTrack: 0,
  },
];

export function findSong(id: string | undefined | null): SongManifest | undefined {
  if (!id) return undefined;
  return SHOWCASE_SONGS.find(s => s.id === id);
}
