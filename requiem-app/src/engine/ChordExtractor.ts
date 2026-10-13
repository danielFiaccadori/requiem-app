import type { Midi, Track } from "@tonejs/midi";
import type { ChordSegment } from "../App";

const CHORD_TEMPLATES = [
  { suffix: "", intervals: [0, 4, 7] },
  { suffix: "m", intervals: [0, 3, 7] },
  { suffix: "dim", intervals: [0, 3, 6] },
  { suffix: "aug", intervals: [0, 4, 8] },
  { suffix: "7", intervals: [0, 4, 7, 10] },
  { suffix: "maj7", intervals: [0, 4, 7, 11] },
  { suffix: "m7", intervals: [0, 3, 7, 10] }
];

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Divide a trilha MIDI em compassos e tenta identificar o acorde de cada compasso.
 */
export function extractChordsFromMidi(midi: Midi): ChordSegment[] {
  // 1. Pegar informações de tempo globais
  const bpm = midi.header.tempos.length > 0 ? midi.header.tempos[0].bpm : 120;
  const timeSig = midi.header.timeSignatures.length > 0 ? midi.header.timeSignatures[0].timeSignature : [4, 4];
  
  const beatsPerMeasure = timeSig[0];
  const secondsPerBeat = 60 / bpm;
  const secondsPerMeasure = beatsPerMeasure * secondsPerBeat;
  
  // 2. Juntar todas as notas de todas as trilhas (ou poderíamos focar só na trilha de acompanhamento)
  let allNotes = [];
  midi.tracks.forEach(track => {
    allNotes.push(...track.notes);
  });
  
  // Ordenar por tempo
  allNotes.sort((a, b) => a.time - b.time);
  
  if (allNotes.length === 0) return [];
  
  const totalDuration = allNotes[allNotes.length - 1].time + allNotes[allNotes.length - 1].duration;
  const totalMeasures = Math.ceil(totalDuration / secondsPerMeasure);
  
  const progression: ChordSegment[] = [];
  
  // 3. Analisar compasso por compasso
  for (let m = 0; m < totalMeasures; m++) {
    const measureStart = m * secondsPerMeasure;
    const measureEnd = measureStart + secondsPerMeasure;
    
    // Pegar notas que tocam neste compasso
    const notesInMeasure = allNotes.filter(n => 
      (n.time >= measureStart && n.time < measureEnd) || // começa dentro
      (n.time < measureStart && n.time + n.duration > measureStart) // transpassa
    );
    
    if (notesInMeasure.length === 0) {
      // Se tiver vazio, repete o último acorde (se houver) ou C
      const lastChord = progression.length > 0 ? progression[progression.length - 1].chord : "C";
      progression.push({
        id: `m_${m}`,
        chord: lastChord,
        durationBeats: beatsPerMeasure,
        velocity: 0.7
      });
      continue;
    }
    
    // 4. Somar durações por pitch class
    const pcWeights = new Array(12).fill(0);
    notesInMeasure.forEach(n => {
      // O peso é a duração da nota dentro do compasso
      const overlapStart = Math.max(n.time, measureStart);
      const overlapEnd = Math.min(n.time + n.duration, measureEnd);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      
      const pc = n.midi % 12;
      // Multiplica pela velocidade para dar mais peso às notas fortes
      pcWeights[pc] += overlap * n.velocity; 
    });
    
    // 5. Encontrar o melhor template
    let bestChord = "C";
    let maxScore = -1;
    
    for (let root = 0; root < 12; root++) {
      for (const template of CHORD_TEMPLATES) {
        let score = 0;
        let valid = true;
        
        // Pontua positivamente as notas do template
        for (const interval of template.intervals) {
          const pc = (root + interval) % 12;
          score += pcWeights[pc];
        }
        
        // Penaliza notas fora do template fortemente presentes
        let penalty = 0;
        for (let i = 0; i < 12; i++) {
          const isIncluded = template.intervals.some(inv => (root + inv) % 12 === i);
          if (!isIncluded) {
            penalty += pcWeights[i] * 0.5; // penalidade
          }
        }
        
        const finalScore = score - penalty;
        
        if (finalScore > maxScore) {
          maxScore = finalScore;
          bestChord = PITCH_CLASSES[root] + template.suffix;
        }
      }
    }
    
    progression.push({
      id: `m_${m}`,
      chord: maxScore > 0 ? bestChord : (progression.length > 0 ? progression[progression.length - 1].chord : "C"),
      durationBeats: beatsPerMeasure,
      velocity: 0.7
    });
  }
  
  return progression;
}
