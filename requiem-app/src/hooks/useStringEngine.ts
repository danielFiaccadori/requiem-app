import { useState, useEffect, useRef, useCallback } from "react";
import * as Tone from "tone";

export interface SequenceNote {
  pitch: number;
  startTime: number;
  endTime: number;
  velocity?: number;
}

export interface SequenceChord {
  chord: string;
  startTime: number;
  endTime: number;
  velocity?: number;
}

export interface PianoSequence {
  notes?: SequenceNote[];
  progression?: SequenceChord[];
}

export interface StringEngineApi {
  playMIDINote: (midi: number, duration?: number, velocity?: number, delay?: number) => void;
  playChord: (chordName: string, duration?: number, velocity?: number) => void;
  playSequence: (seq: PianoSequence) => Promise<void>;
  stopAll: (immediate?: boolean) => void;
  isReady: boolean;

  setTrackVolume: (trackIndex: number, vol: number) => void;
  setTrackMute: (trackIndex: number, muted: boolean) => void;

  // Acompanhamento ao vivo (nao afeta a tela de edicao)
  /** Toca notas sustentadas (sem release agendado). Libera as anteriores com crossfade de `overlap` segundos. */
  playLiveNotes: (midis: number[], velocity: number, overlap?: number) => void;
  /** Libera todas as notas ao vivo com fade-out curto. */
  releaseLive: (fadeSec?: number) => void;
  /** Ajusta o ganho geral ao vivo (0-1.2) conforme a dinamica do cantor. */
  setLiveDynamics: (gain: number) => void;
  /** Toca um arpejo de piano ao vivo cancelando o anterior (sem sobreposicao). Tempos em segundos. */
  playLiveArpeggio: (notes: { midi: number; offset: number; duration: number; velocity: number }[]) => void;
}

const PIANO_PEDAL_SUSTAIN_RELEASE = 3.5;
const PIANO_DAMPER_CHANGE_FADE = 0.45;

function parseChordNotes(chordName: string): string[] | null {
  const parts = chordName.match(/([A-G][b#]?)(.*)/);
  if (!parts) return null;
  const rootMidi = Tone.Frequency(`${parts[1]}3`).toMidi();

  let intervals = [0, 4, 7];
  if (chordName.includes("m") && !chordName.includes("dim")) intervals = [0, 3, 7];
  if (chordName.includes("dim")) intervals = [0, 3, 6];
  if (chordName.includes("7")) intervals.push(10);

  return intervals.map(i => Tone.Frequency(rootMidi + i, "midi").toNote());
}

export function useStringEngine(): StringEngineApi {
  const [isReady, setIsReady] = useState(false);
  const pianoSynthRef = useRef<Tone.Sampler | null>(null);
  const limiterRef = useRef<Tone.Limiter | null>(null);
  const liveGainRef = useRef<Tone.Gain | null>(null);
  const arpTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let disposed = false;

    const limiter = new Tone.Limiter(-2).toDestination();
    limiterRef.current = limiter;

    const liveGain = new Tone.Gain(1).connect(limiter);
    liveGainRef.current = liveGain;

    const reverb = new Tone.Reverb({
      decay: 3.5,
      preDelay: 0.05,
      wet: 0.4,
    });
    reverb.connect(liveGain);
    reverb.generate();

    const pianoSynth = new Tone.Sampler({
      urls: {
        A0: "A0.mp3",
        C1: "C1.mp3",
        C2: "C2.mp3",
        C3: "C3.mp3",
        C4: "C4.mp3",
        C5: "C5.mp3",
        C6: "C6.mp3",
        C7: "C7.mp3",
      },
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      release: PIANO_PEDAL_SUSTAIN_RELEASE,
      volume: 4,
      onload: () => {
        if (!disposed) setIsReady(true);
      },
      onerror: (err) => {
        console.error("Falha ao carregar samples do piano:", err);
        if (!disposed) setIsReady(true);
      },
    });
    pianoSynth.connect(reverb);
    pianoSynthRef.current = pianoSynth;

    return () => {
      disposed = true;
      arpTimersRef.current.forEach(clearTimeout);
      arpTimersRef.current = [];
      pianoSynth.dispose();
      reverb.dispose();
      liveGain.dispose();
      limiter.dispose();
    };
  }, []);

  const playMIDINote = useCallback((
    midi: number,
    duration: number = 0.5,
    velocity: number = 0.8,
    delay: number = 0
  ) => {
    const piano = pianoSynthRef.current;
    if (!isReady || !piano) return;
    try {
      const freq = Tone.Frequency(midi, "midi").toNote();
      const time = Tone.now() + Math.max(0.005, delay);
      piano.triggerAttackRelease(freq, duration, time, velocity);
    } catch (e) {
      console.warn("Audio Context not started or invalid note", e);
    }
  }, [isReady]);

  const playChord = useCallback((
    chordName: string,
    duration: number = 0.5,
    velocity: number = 0.8
  ) => {
    const piano = pianoSynthRef.current;
    if (!isReady || !piano) return;
    try {
      const chordNotes = parseChordNotes(chordName);
      if (!chordNotes) return;
      piano.triggerAttackRelease(chordNotes, duration, undefined, velocity);
    } catch (e) {
      console.warn("Audio Context error playChord", e);
    }
  }, [isReady]);

  const playSequence = useCallback(async (seq: PianoSequence) => {
    const piano = pianoSynthRef.current;
    if (!isReady || !piano) return;
    const now = Tone.now() + 0.1;

    seq.notes?.forEach((n) => {
      const freq = Tone.Frequency(n.pitch, "midi").toNote();
      const dur = (n.endTime - n.startTime) || 0.5;
      const time = now + n.startTime;
      piano.triggerAttackRelease(freq, dur, time, n.velocity ?? 0.7);
    });

    seq.progression?.forEach((p) => {
      const chordNotes = parseChordNotes(p.chord);
      if (!chordNotes) return;
      const dur = p.endTime - p.startTime;
      const time = now + p.startTime;
      piano.triggerAttackRelease(chordNotes, dur, time, p.velocity ?? 0.7);
    });

    const totalDuration = seq.notes?.reduce((max, note) => Math.max(max, note.endTime || 0), 0) || 0;
    return new Promise<void>(resolve => setTimeout(resolve, totalDuration * 1000));
  }, [isReady]);

  const stopAll = useCallback((immediate: boolean = false) => {
    const piano = pianoSynthRef.current;
    if (!piano) return;

    if (immediate) {
      piano.release = 0.05;
    }

    piano.releaseAll();

    if (immediate) {
      setTimeout(() => {
        if (pianoSynthRef.current) {
          pianoSynthRef.current.release = PIANO_PEDAL_SUSTAIN_RELEASE;
        }
      }, 100);
    }
  }, []);

  const setTrackVolume = useCallback((trackIndex: number, vol: number) => {
    if (trackIndex === 0 && pianoSynthRef.current) {
      pianoSynthRef.current.volume.value = Tone.gainToDb(vol);
    }
  }, []);

  const setTrackMute = useCallback((trackIndex: number, muted: boolean) => {
    if (trackIndex === 0 && pianoSynthRef.current) {
      pianoSynthRef.current.volume.value = muted ? -Infinity : 4;
    }
  }, []);

  const playLiveNotes = useCallback((
    midis: number[],
    velocity: number,
    overlap: number = 0
  ) => {
    const piano = pianoSynthRef.current;
    if (!isReady || !piano || midis.length === 0) return;
    try {
      const notes = midis.map(m => Tone.Frequency(m, "midi").toNote());
      const releaseAt = Tone.now() + 0.03 + overlap;
      const startAt = Tone.now() + 0.03;
      const vel = Math.min(1, Math.max(0.05, velocity));

      // Troca sincopada de pedal: abafa o acorde anterior suavemente
      piano.release = PIANO_DAMPER_CHANGE_FADE;
      piano.releaseAll(releaseAt);

      // Novo ataque com pedal de sustentacao abaixado
      piano.release = PIANO_PEDAL_SUSTAIN_RELEASE;
      piano.triggerAttack(notes, startAt, vel);
    } catch (e) {
      console.warn("Audio error playLiveNotes", e);
    }
  }, [isReady]);

  const clearArpTimers = useCallback(() => {
    arpTimersRef.current.forEach(clearTimeout);
    arpTimersRef.current = [];
  }, []);

  const releaseLive = useCallback((fadeSec: number = 0.4) => {
    clearArpTimers();
    const piano = pianoSynthRef.current;
    if (!piano) return;

    piano.release = fadeSec;
    piano.releaseAll(Tone.now());
    setTimeout(() => {
      if (pianoSynthRef.current) {
        pianoSynthRef.current.release = PIANO_PEDAL_SUSTAIN_RELEASE;
      }
    }, 100);
  }, [clearArpTimers]);

  const playLiveArpeggio = useCallback((
    notes: { midi: number; offset: number; duration: number; velocity: number }[]
  ) => {
    const piano = pianoSynthRef.current;
    if (!isReady || !piano) return;
    clearArpTimers();
    piano.releaseAll(Tone.now());

    notes.forEach(n => {
      const name = Tone.Frequency(n.midi, "midi").toNote();
      const vel = Math.min(1, Math.max(0.05, n.velocity));
      arpTimersRef.current.push(setTimeout(() => {
        const prev = piano.release;
        piano.release = 0.5;
        piano.triggerAttack(name, Tone.now(), vel);
        piano.release = prev;
      }, Math.max(0, n.offset * 1000)));
      arpTimersRef.current.push(setTimeout(() => {
        piano.triggerRelease(name, Tone.now());
      }, Math.max(0, (n.offset + n.duration) * 1000)));
    });
  }, [isReady, clearArpTimers]);

  const setLiveDynamics = useCallback((gain: number) => {
    liveGainRef.current?.gain.rampTo(Math.min(1.2, Math.max(0, gain)), 0.08);
  }, []);

  return {
    playMIDINote,
    playChord,
    stopAll,
    isReady,
    setTrackVolume,
    setTrackMute,
    playSequence,
    playLiveNotes,
    releaseLive,
    setLiveDynamics,
    playLiveArpeggio,
  };
}
