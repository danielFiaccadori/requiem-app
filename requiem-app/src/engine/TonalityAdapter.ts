// ─────────────────────────────────────────────────────────
//  TonalityAdapter.ts
// ─────────────────────────────────────────────────────────
//  Camada de tradução entre o "World Space" (qualquer
//  tonalidade) e o "Local Space" (Dó Maior / Lá Menor)
//  usado internamente pelo HarmonyEngine.
//
//  Responsabilidades:
//  1. Normalizar notas de entrada (microfone) → C Major
//  2. Transpor acordes de saída (C Major) → tonalidade alvo
//  3. Normalizar progressões do dataset para treinar Markov
//
//  • Puramente funcional — sem mutações, sem efeitos.
//  • Fortemente tipado — offsets, parsing e mapeamento.
// ─────────────────────────────────────────────────────────

import type { DetectedNote } from "../hooks/usePitchDetector";

// ─────────────────────────────────────────────────────────
//  1. Mapa de Offsets (Semitons a partir de Dó)
// ─────────────────────────────────────────────────────────
//  Cada tonalidade é mapeada ao número de semitons que a
//  separa de Dó (C = 0). Menores usam o offset da sua
//  relativa maior (Am = 0, Em = 7, Bm = 2, ...).
// ─────────────────────────────────────────────────────────

/** Offset em semitons de cada nota fundamental em relação a Dó. */
const ROOT_OFFSETS: Readonly<Record<string, number>> = {
  C: 0,   "C#": 1,  Db: 1,
  D: 2,   "D#": 3,  Eb: 3,
  E: 4,   Fb: 4,
  F: 5,   "F#": 6,  Gb: 6,
  G: 7,   "G#": 8,  Ab: 8,
  A: 9,   "A#": 10, Bb: 10,
  B: 11,  Cb: 11,
};

/**
 * Mapa completo de tonalidades para seus offsets.
 * Maiores usam o offset direto do root.
 * Menores usam o offset da sua relativa maior.
 *
 * Ex: Am → relativa de C → offset 0
 *     Em → relativa de G → offset 7
 *     F#m → relativa de A → offset 9
 */
export const TONALITY_OFFSETS: Readonly<Record<string, number>> = {
  // ── Maiores ───────────────────────────────────────────
  C: 0,    "C#": 1,   Db: 1,
  D: 2,    "D#": 3,   Eb: 3,
  E: 4,
  F: 5,    "F#": 6,   Gb: 6,
  G: 7,    "G#": 8,   Ab: 8,
  A: 9,    "A#": 10,  Bb: 10,
  B: 11,   Cb: 11,

  // ── Menores (offset = relativa maior) ─────────────────
  Am: 0,    "A#m": 1,  Bbm: 1,
  Bm: 2,   Cm: 3,
  "C#m": 4, Dm: 5,
  "D#m": 6, Ebm: 6,   Em: 7,
  Fm: 8,   "F#m": 9,
  Gm: 10,  "G#m": 11, Abm: 11,
};

// ─────────────────────────────────────────────────────────
//  2. Nomes de Notas e Parsing
// ─────────────────────────────────────────────────────────

/**
 * Nomes padrão das 12 notas (usando sustenidos).
 * Índice = pitch class (0 = C, 1 = C#, ..., 11 = B).
 */
const NOTE_NAMES_SHARP: readonly string[] = [
  "C", "C#", "D", "D#", "E", "F",
  "F#", "G", "G#", "A", "A#", "B",
];

/**
 * Nomes alternativos usando bemóis (para tonalidades com bemóis).
 */
const NOTE_NAMES_FLAT: readonly string[] = [
  "C", "Db", "D", "Eb", "E", "F",
  "Gb", "G", "Ab", "A", "Bb", "B",
];

/**
 * Tonalidades que preferem notação com bemóis.
 * Se a tonalidade alvo estiver nesta lista, usamos NOTE_NAMES_FLAT.
 */
const FLAT_TONALITIES: ReadonlySet<string> = new Set([
  "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb",
  "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm", "Abm",
]);

/**
 * Regex para separar a tônica (root) do sufixo (qualidade) de um acorde.
 *
 * Captura:
 * - Grupo 1: Root — uma letra A-G seguida opcionalmente de # ou b
 * - Grupo 2: Suffix — tudo que sobra (m, 7, dim, sus4, maj7, etc.)
 *
 * Exemplos:
 *   "C"     → ["C",  ""]
 *   "F#m"   → ["F#", "m"]
 *   "Bbdim" → ["Bb", "dim"]
 *   "Dm7"   → ["D",  "m7"]
 *   "G#7"   → ["G#", "7"]
 */
const CHORD_REGEX = /^([A-G][#b]?)(.*)$/;

/**
 * Faz o parsing de um nome de acorde em root + suffix.
 * Retorna null se o formato for inválido.
 */
const parseChord = (
  chordName: string,
): { root: string; suffix: string; bass?: string } | null => {
  const [base, bass] = chordName.split("/");
  const match = base.match(CHORD_REGEX);
  if (!match) return null;
  return { root: match[1], suffix: match[2], bass };
};

/**
 * Retorna o offset em semitons de uma tonalidade.
 * Fallback para 0 (Dó Maior) se desconhecida.
 */
export const getTonalityOffset = (tonality: string): number =>
  TONALITY_OFFSETS[tonality] ?? 0;

/**
 * Seleciona o array de nomes (sharps ou flats) mais
 * adequado para a tonalidade alvo.
 */
const noteNamesFor = (tonality: string): readonly string[] =>
  FLAT_TONALITIES.has(tonality) ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;

// ─────────────────────────────────────────────────────────
//  3. Transposição de Notas de Entrada (World → Local)
// ─────────────────────────────────────────────────────────

/**
 * Normaliza as notas detectadas pelo microfone, transpondo-as
 * do "World Space" (tonalidade do usuário) para o "Local Space"
 * (Dó Maior), onde o HarmonyEngine opera.
 *
 * Subtrai o offset da tonalidade escolhida do pitch MIDI de
 * cada nota. Isso faz com que uma melodia tocada em Ré Maior
 * soe, internamente, como se estivesse em Dó Maior.
 *
 * @param notes            — Notas detectadas no pitch original
 * @param targetTonality   — Tonalidade escolhida pelo usuário (ex: "D", "Am")
 * @returns                  Notas com pitch transposto para C Major
 */
export const normalizeNotes = (
  notes: readonly DetectedNote[],
  targetTonality: string,
): DetectedNote[] => {
  const offset = getTonalityOffset(targetTonality);

  // Se offset é 0 (Dó Maior / Lá Menor), nada a fazer
  if (offset === 0) return notes.map(n => ({ ...n }));

  return notes.map(n => ({
    pitch: n.pitch - offset,
    startTime: n.startTime,
    endTime: n.endTime,
  }));
};

// ─────────────────────────────────────────────────────────
//  4. Transposição de Acordes de Saída (Local → World)
// ─────────────────────────────────────────────────────────

/**
 * Transpõe um nome de acorde do "Local Space" (Dó Maior)
 * para o "World Space" (tonalidade alvo).
 *
 * 1. Separa a tônica (root) do sufixo (m, 7, dim, etc.)
 * 2. Converte a tônica para índice (0–11)
 * 3. Soma o offset da tonalidade alvo (mod 12)
 * 4. Converte de volta para nome de nota (sharps ou flats)
 * 5. Concatena com o sufixo original intacto
 *
 * @param chordName        — Nome do acorde em C Major (ex: "Dm7", "G7")
 * @param targetTonality   — Tonalidade alvo (ex: "D", "Bb", "F#m")
 * @returns                  Acorde transposto (ex: "Em7", "A7")
 *
 * @example
 * transposeChord("Dm7", "D")  → "Em7"   (offset 2: D→E)
 * transposeChord("G7",  "F")  → "C7"    (offset 5: G→C)
 * transposeChord("Am",  "G")  → "Em"    (offset 7: A→E)
 * transposeChord("C",   "C")  → "C"     (offset 0: noop)
 */
export const transposeChord = (
  chordName: string,
  targetTonality: string,
): string => {
  const parsed = parseChord(chordName);
  if (!parsed) return chordName;

  const offset = getTonalityOffset(targetTonality);
  if (offset === 0) return chordName;

  const rootIndex = ROOT_OFFSETS[parsed.root];
  if (rootIndex === undefined) return chordName;

  const newIndex = (rootIndex + offset) % 12;
  const noteNames = noteNamesFor(targetTonality);

  let bassSuffix = "";
  if (parsed.bass) {
    const bassIdx = ROOT_OFFSETS[parsed.bass];
    if (bassIdx !== undefined) {
      bassSuffix = "/" + noteNames[(bassIdx + offset) % 12];
    }
  }

  return noteNames[newIndex] + parsed.suffix + bassSuffix;
};

/**
 * Transpõe uma progressão inteira de acordes do Local para o World Space.
 */
export const transposeProgression = (
  progression: readonly string[],
  targetTonality: string,
): readonly string[] =>
  progression.map(chord => transposeChord(chord, targetTonality));

// ─────────────────────────────────────────────────────────
//  5. Normalização de Dataset (World → Local)
// ─────────────────────────────────────────────────────────
//  Transpõe uma progressão da sua tonalidade original
//  para Dó Maior, para que a Cadeia de Markov aprenda
//  padrões universais (I-V-vi-IV) independente da key.
// ─────────────────────────────────────────────────────────

/**
 * Normaliza uma progressão de acordes da sua tonalidade
 * original para Dó Maior (Local Space).
 *
 * Usado na construção da Matriz de Markov para que todos
 * os datasets contribuam para os mesmos padrões harmônicos
 * relativos (I, IV, V, vi, etc.) independente da tonalidade
 * original da composição.
 *
 * @param progression        — Progressão na tonalidade original
 * @param originalTonality   — Tonalidade original (ex: "D", "Bb")
 * @returns                    Progressão transposta para C Major
 *
 * @example
 * normalizeProgressionToC(["D", "A", "Bm", "G"], "D")
 * → ["C", "G", "Am", "F"]
 */
export const normalizeProgressionToC = (
  progression: readonly string[],
  originalTonality: string,
): readonly string[] => {
  const offset = getTonalityOffset(originalTonality);
  if (offset === 0) return [...progression];

  // Subtrair o offset = transpor "para baixo" até Dó
  return progression.map(chordName => {
    const parsed = parseChord(chordName);
    if (!parsed) return chordName;

    const rootIndex = ROOT_OFFSETS[parsed.root];
    if (rootIndex === undefined) return chordName;

    const newIndex = ((rootIndex - offset) % 12 + 12) % 12;
    let bassSuffix = "";
    if (parsed.bass) {
      const bassIdx = ROOT_OFFSETS[parsed.bass];
      if (bassIdx !== undefined) {
        bassSuffix = "/" + NOTE_NAMES_SHARP[((bassIdx - offset) % 12 + 12) % 12];
      }
    }
    // Sempre usar sharps no Local Space (consistência interna)
    return NOTE_NAMES_SHARP[newIndex] + parsed.suffix + bassSuffix;
  });
};

/** Mapeamento de intervalos em semitons (0 a 11) para Graus Relativos Base (Numerais Romanos). */
const INTERVAL_TO_ROMAN = ["I", "bII", "II", "bIII", "III", "IV", "bV", "V", "bVI", "VI", "bVII", "VII"];

/**
 * Converte um acorde absoluto (ex: "Am") para seu Grau Relativo / Numeral Romano (ex: "ii")
 * na tonalidade original fornecida.
 */
export const chordToRoman = (chord: string, tonality: string): string => {
  const parsed = parseChord(chord);
  if (!parsed) return chord;

  const rootOffset = ROOT_OFFSETS[parsed.root];
  if (rootOffset === undefined) return chord;
  
  const tonalityOffset = getTonalityOffset(tonality);

  // Intervalo em semitons da tônica da tonalidade até a tônica do acorde (0 - 11)
  const interval = (rootOffset - tonalityOffset + 12) % 12;

  let roman = INTERVAL_TO_ROMAN[interval];

  // Regra de capitalização: se for menor ou diminuto, a base do numeral é minúscula
  const isMinor = parsed.suffix.startsWith("m") && !parsed.suffix.startsWith("maj");
  const isDim = parsed.suffix.startsWith("dim");

  if (isMinor || isDim) {
    roman = roman.toLowerCase();
  }

  // Omitimos o "m" redundante (já que "ii" já implica menor) para ficar limpo
  let suffix = parsed.suffix;
  if (suffix === "m") suffix = "";
  else if (suffix.startsWith("m") && !suffix.startsWith("maj")) {
    suffix = suffix.substring(1); // "m7" vira "7", acoplado ao numeral minúsculo (ex: "ii7")
  }
  
  return roman + suffix;
};

/**
 * Verifica se um acorde pertence estritamente ao campo harmônico da tonalidade fornecida.
 * Ex: Em Dó Maior (ou Lá Menor), os acordes diatônicos são C, Dm, Em, F, G, Am, Bdim.
 */
export const isChordDiatonic = (chord: string, tonality: string): boolean => {
  if (tonality === "AUTO" || !tonality) return true;

  const parsed = parseChord(chord);
  if (!parsed) return false;

  const rootOffset = ROOT_OFFSETS[parsed.root];
  if (rootOffset === undefined) return false;
  
  const tonalityOffset = getTonalityOffset(tonality);

  // Intervalo em semitons da tônica da tonalidade até a tônica do acorde (0 - 11)
  const interval = (rootOffset - tonalityOffset + 12) % 12;

  const isMinor = parsed.suffix.startsWith("m") && !parsed.suffix.startsWith("maj");
  const isDim = parsed.suffix.startsWith("dim");
  const isMajor = !isMinor && !isDim;

  // Campo harmônico maior (e seu respectivo menor natural)
  if (interval === 0 && isMajor) return true;  // I
  if (interval === 2 && isMinor) return true;  // ii
  if (interval === 4 && isMinor) return true;  // iii
  if (interval === 5 && isMajor) return true;  // IV
  if (interval === 7 && isMajor) return true;  // V
  if (interval === 9 && isMinor) return true;  // vi
  if (interval === 11 && isDim) return true;   // vii°

  return false;
};

/**
 * Converte um Grau Relativo / Numeral Romano (ex: "ii", "V7") para um acorde absoluto (ex: "Am", "D7")
 * na tonalidade alvo.
 */
export const romanToChord = (roman: string, tonality: string): string => {
  // Regex para isolar o numeral romano do sufixo
  const romanRegex = /^([b#]?(?:III|iii|II|ii|IV|iv|VIII|viii|VII|vii|VI|vi|V|v|I|i))((?:.*))$/;
  const match = roman.match(romanRegex);
  if (!match) return roman;

  const baseRoman = match[1];
  let suffix = match[2];

  // Encontrar o intervalo buscando a versão maiúscula
  let searchBase = baseRoman.toUpperCase();
  if (searchBase.startsWith("B")) searchBase = "b" + searchBase.substring(1);
  if (searchBase.startsWith("#")) searchBase = "#" + searchBase.substring(1);

  const interval = INTERVAL_TO_ROMAN.indexOf(searchBase);
  if (interval === -1) return roman;

  // Restaurar o sufixo "m" se a base era minúscula e não tem "dim"
  const isLowerCase = baseRoman === baseRoman.toLowerCase();
  if (isLowerCase && !suffix.startsWith("dim")) {
    suffix = "m" + suffix;
  }

  const tonalityOffset = getTonalityOffset(tonality);
  const rootIndex = (tonalityOffset + interval) % 12;

  const noteNames = noteNamesFor(tonality);
  return noteNames[rootIndex] + suffix;
};

/**
 * Retorna as pitch classes reais (0-11) para qualquer acorde válido (ex: "A#", "Cm7").
 * Usado pelo sintetizador para reproduzir acordes de qualquer tonalidade,
 * já que o HARMONY_GRAPH armazena apenas os acordes relativos a Dó Maior.
 */
export const getChordPitchClasses = (chordName: string): number[] => {
  const parsed = parseChord(chordName);
  if (!parsed) return [0, 4, 7]; // Fallback genérico para Major (C)

  const rootIndex = ROOT_OFFSETS[parsed.root] ?? 0;
  let intervals = [0, 4, 7]; // Major padrão

  // Dicionário modular de sufixos e seus respectivos intervalos em semitons
  const SUFFIX_DICT: Record<string, number[]> = {
    "": [0, 4, 7],            // Major triad
    "m": [0, 3, 7],           // Minor triad
    "dim": [0, 3, 6],         // Diminished triad
    "aug": [0, 4, 8],         // Augmented triad
    "+": [0, 4, 8],           // Augmented (alias)
    "sus4": [0, 5, 7],        // Suspended 4th
    "sus2": [0, 2, 7],        // Suspended 2nd
    "5": [0, 7],              // Power chord
    "maj7": [0, 4, 7, 11],    // Major 7th
    "7": [0, 4, 7, 10],       // Dominant 7th
    "m7": [0, 3, 7, 10],      // Minor 7th
    "m7b5": [0, 3, 6, 10],    // Half-diminished 7th
    "dim7": [0, 3, 6, 9],     // Fully diminished 7th
    "add9": [0, 4, 7, 2],     // Major add9 (9th is 2 modulo 12)
    "madd9": [0, 3, 7, 2],    // Minor add9
    "sus4add9": [0, 5, 7, 2], // Sus4 add9 (cinematic staple)
    "11": [0, 4, 7, 10, 2, 5],// Dominant 11th
    "m11": [0, 3, 7, 10, 2, 5]// Minor 11th
  };

  // Aplica os intervalos baseados no sufixo exato, com fallback inteligente
  if (SUFFIX_DICT[parsed.suffix]) {
    intervals = SUFFIX_DICT[parsed.suffix];
  } else if (parsed.suffix.startsWith("m") && !parsed.suffix.startsWith("maj")) {
    intervals = [0, 3, 7]; // Fallback genérico para acordes menores não mapeados
  } else if (parsed.suffix.startsWith("sus")) {
    intervals = [0, 5, 7]; // Fallback genérico para sus
  }
  
  const res = intervals.map(interval => (rootIndex + interval) % 12);
  if (parsed.bass) {
    const bassIdx = ROOT_OFFSETS[parsed.bass];
    if (bassIdx !== undefined && !res.includes(bassIdx)) {
      res.unshift(bassIdx);
    }
  }
  return res;
};

// ─────────────────────────────────────────────────────────
//  6. Catálogo de Tonalidades para a UI
// ─────────────────────────────────────────────────────────

/** Opção de tonalidade para renderização na UI. */
export interface TonalityOption {
  /** Valor programático (ex: "C", "F#m") */
  readonly value: string;
  /** Label amigável em português (ex: "Dó Maior (C)") */
  readonly label: string;
}

/** Todas as tonalidades maiores disponíveis. */
export const MAJOR_TONALITIES: readonly TonalityOption[] = [
  { value: "C",   label: "Dó Maior (C)" },
  { value: "C#",  label: "Dó# Maior (C#)" },
  { value: "Db",  label: "Réb Maior (Db)" },
  { value: "D",   label: "Ré Maior (D)" },
  { value: "Eb",  label: "Mib Maior (Eb)" },
  { value: "E",   label: "Mi Maior (E)" },
  { value: "F",   label: "Fá Maior (F)" },
  { value: "F#",  label: "Fá# Maior (F#)" },
  { value: "Gb",  label: "Solb Maior (Gb)" },
  { value: "G",   label: "Sol Maior (G)" },
  { value: "Ab",  label: "Láb Maior (Ab)" },
  { value: "A",   label: "Lá Maior (A)" },
  { value: "Bb",  label: "Sib Maior (Bb)" },
  { value: "B",   label: "Si Maior (B)" },
];

/** Todas as tonalidades menores disponíveis. */
export const MINOR_TONALITIES: readonly TonalityOption[] = [
  { value: "Am",   label: "Lá Menor (Am)" },
  { value: "A#m",  label: "Lá# Menor (A#m)" },
  { value: "Bbm",  label: "Sib Menor (Bbm)" },
  { value: "Bm",   label: "Si Menor (Bm)" },
  { value: "Cm",   label: "Dó Menor (Cm)" },
  { value: "C#m",  label: "Dó# Menor (C#m)" },
  { value: "Dm",   label: "Ré Menor (Dm)" },
  { value: "D#m",  label: "Ré# Menor (D#m)" },
  { value: "Ebm",  label: "Mib Menor (Ebm)" },
  { value: "Em",   label: "Mi Menor (Em)" },
  { value: "Fm",   label: "Fá Menor (Fm)" },
  { value: "F#m",  label: "Fá# Menor (F#m)" },
  { value: "Gm",   label: "Sol Menor (Gm)" },
  { value: "G#m",  label: "Sol# Menor (G#m)" },
  { value: "Abm",  label: "Láb Menor (Abm)" },
];

/** Todas as tonalidades combinadas (maiores + menores). */
export const ALL_TONALITIES: readonly TonalityOption[] = [
  ...MAJOR_TONALITIES,
  ...MINOR_TONALITIES,
];

// ─────────────────────────────────────────────────────────
//  7. Opções de Fórmula de Compasso para a UI
// ─────────────────────────────────────────────────────────

/** Valores permitidos para a Unidade de Tempo (denominador). */
export const UT_OPTIONS: readonly number[] = [2, 4, 8];

/** Valores permitidos para a Quantidade de Tempos (numerador). */
export const QT_OPTIONS: readonly number[] = [2, 3, 4, 6, 9, 12];
