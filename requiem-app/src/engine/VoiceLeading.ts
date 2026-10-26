import { parseChord, getChordPitchClasses, ROOT_OFFSETS } from "./TonalityAdapter";

export interface PianoVoicing {
  allNotes: number[];
  rightHandNotes: number[];
  bassNote: number;
}

/**
 * Computes an acoustic piano voicing with a solid bass in the left hand (MIDI 36-47 / C2-B2)
 * and smooth voice leading in the right hand (MIDI 52-76 / E3-E5) to avoid abrupt jumps.
 */
export function computePianoVoicing(
  chordName: string,
  previousRightHandNotes: number[] = []
): PianoVoicing {
  const parsed = parseChord(chordName);
  const pcs = getChordPitchClasses(chordName);

  // 1. Left hand bass note (target range: MIDI 36..47, i.e. C2 to B2)
  const rootPc = parsed ? (ROOT_OFFSETS[parsed.root] ?? 0) : (pcs[0] ?? 0);
  const bassPc = parsed?.bass ? (ROOT_OFFSETS[parsed.bass] ?? rootPc) : rootPc;

  let bassNote = 36 + bassPc;
  if (bassNote < 36) bassNote += 12;
  if (bassNote > 47) bassNote -= 12;

  // 2. Right hand tones (unique pitch classes)
  const uniquePcs = Array.from(new Set(pcs));

  let rightHandNotes: number[] = [];

  if (previousRightHandNotes.length > 0) {
    const prevCenter = previousRightHandNotes.reduce((a, b) => a + b, 0) / previousRightHandNotes.length;

    rightHandNotes = uniquePcs.map(pc => {
      const candidates = [48 + pc, 60 + pc, 72 + pc].filter(n => n >= 52 && n <= 76);
      if (candidates.length === 0) return 60 + pc;

      let bestCandidate = candidates[0];
      let minScore = Infinity;

      for (const cand of candidates) {
        const minDistToNote = Math.min(...previousRightHandNotes.map(pn => Math.abs(cand - pn)));
        const distToCenter = Math.abs(cand - prevCenter);
        const score = minDistToNote * 1.5 + distToCenter * 0.5;

        if (score < minScore) {
          minScore = score;
          bestCandidate = cand;
        }
      }
      return bestCandidate;
    });
  } else {
    // Initial voicing centered around Middle C (MIDI 60)
    rightHandNotes = uniquePcs.map(pc => {
      let n = 60 + pc;
      if (n > 72) n -= 12;
      if (n < 53) n += 12;
      return n;
    });
  }

  // Deduplicate and sort ascending
  rightHandNotes = Array.from(new Set(rightHandNotes)).sort((a, b) => a - b);

  // Combined notes: left hand bass + right hand harmony
  const allNotes = [bassNote, ...rightHandNotes];

  return { allNotes, rightHandNotes, bassNote };
}
