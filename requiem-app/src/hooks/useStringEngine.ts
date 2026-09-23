import { useState, useEffect, useRef, useCallback } from "react";
import * as Tone from "tone";

export type InstrumentType = "piano" | "strings" | "pad";

export interface StringEngineApi {
  playMIDINote: (midi: number, duration?: number, velocity?: number, instrument?: InstrumentType | "orchestra") => void;
  playChord: (chordName: string, duration?: number, velocity?: number, instrument?: InstrumentType | "orchestra") => void;
  playSequence: (seq: any, offset?: number, melodyInst?: InstrumentType | "orchestra", chordsInst?: InstrumentType | "orchestra") => Promise<void>;
  stopAll: () => void;
  isReady: boolean;
  
  // Orchestra dynamic loading
  loadOrchestraInstrument: (id: string) => Promise<void>;
  unloadOrchestraInstrument: (id: string) => void;
  activeOrchestraInstruments: string[];
  setTrackVolume: (trackIndex: number, vol: number) => void;
  setTrackMute: (trackIndex: number, muted: boolean) => void;
}

export function useStringEngine(): StringEngineApi {
  const [isReady, setIsReady] = useState(false);
  const pianoSynthRef = useRef<Tone.Sampler | null>(null);
  const padSynthRef = useRef<Tone.PolySynth | null>(null);
  const limiterRef = useRef<Tone.Limiter | null>(null);
  
  const orchestraMapRef = useRef<Record<string, Record<string, string>>>({});
  const loadedOrchestraRef = useRef<Record<string, Tone.Sampler>>({});
  const [activeOrchestraInstruments, setActiveOrchestraInstruments] = useState<string[]>([]);

  useEffect(() => {
    // 1. Instanciar Limiter e Reverb
    const limiter = new Tone.Limiter(-2).toDestination();
    limiterRef.current = limiter;
    
    const reverb = new Tone.Reverb({
      decay: 3.5,
      preDelay: 0.05,
      wet: 0.4
    });
    reverb.connect(limiter);
    reverb.generate(); // Inicializa o buffer do Reverb

    // 2. Instanciar PIANO (Sampler Base)
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
      volume: 4,
    });
    pianoSynth.connect(reverb);

    // 3. Instanciar PAD (FMSynth com Filtro Lowpass)
    const padSynth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 0.5,
      modulationIndex: 1.2,
      oscillator: { type: "sine" },
      modulation: { type: "triangle" },
      envelope: {
        attack: 1.0,
        decay: 0.5,
        sustain: 1.0,
        release: 2.0,
      },
      volume: -10,
    });
    const lowpassFilter = new Tone.Filter(800, "lowpass");
    padSynth.chain(lowpassFilter, reverb);

    pianoSynthRef.current = pianoSynth;
    padSynthRef.current = padSynth;

    // 4. Carregar Mapeamento do VSCO 2
    fetch('/samples/instrument_map.json')
      .then(r => r.json())
      .then(map => {
        orchestraMapRef.current = map;
        setIsReady(true);
      })
      .catch(e => {
        console.error("Falha ao carregar mapa de instrumentos:", e);
        setIsReady(true);
      });

    return () => {
      pianoSynth.dispose();
      padSynth.dispose();
      reverb.dispose();
      limiter.dispose();
      Object.values(loadedOrchestraRef.current).forEach(s => s.dispose());
    };
  }, []);

  const loadOrchestraInstrument = useCallback(async (id: string) => {
    if (loadedOrchestraRef.current[id]) {
      if (!activeOrchestraInstruments.includes(id)) {
        setActiveOrchestraInstruments(prev => [...prev, id]);
      }
      return; // Already loaded
    }

    const urls = orchestraMapRef.current[id];
    if (!urls) {
      console.warn(`Instrument ${id} not found in map.`);
      return;
    }

    console.log(`Loading orchestra instrument: ${id}`);
    const sampler = new Tone.Sampler({
      urls,
      baseUrl: `/samples/${id}/`,
      release: 1.5,
      attack: 0.1,
      volume: -2, // Ajuste de ganho para não clipar
      onload: () => {
        loadedOrchestraRef.current[id] = sampler;
        setActiveOrchestraInstruments(prev => [...prev, id]);
        console.log(`Instrument ${id} loaded!`);
      }
    });
    
    // Conectar ao limiter para evitar estouro de áudio no Tutti
    if (limiterRef.current) {
      sampler.connect(limiterRef.current);
    } else {
      sampler.toDestination();
    }
  }, [activeOrchestraInstruments]);

  const unloadOrchestraInstrument = useCallback((id: string) => {
    setActiveOrchestraInstruments(prev => prev.filter(i => i !== id));
    // Podemos escolher entre manter em cache (RAM) ou dar dispose. 
    // Para economizar memória, vamos remover.
    if (loadedOrchestraRef.current[id]) {
      loadedOrchestraRef.current[id].dispose();
      delete loadedOrchestraRef.current[id];
      console.log(`Instrument ${id} unloaded!`);
    }
  }, []);

  const playMIDINote = useCallback((
    midi: number,
    duration: number = 0.5,
    velocity: number = 0.8,
    instrument: InstrumentType | "orchestra" = "piano"
  ) => {
    if (!isReady) return;
    try {
      const freq = Tone.Frequency(midi, "midi").toNote();

      if (instrument === "orchestra") {
        if (activeOrchestraInstruments.length === 0) {
          // Fallback para piano se orquestra vazia
          pianoSynthRef.current?.triggerAttackRelease(freq, duration, undefined, velocity);
        } else {
          // Tocar em TODOS os instrumentos da orquestra carregados
          activeOrchestraInstruments.forEach(id => {
            loadedOrchestraRef.current[id]?.triggerAttackRelease(freq, duration, undefined, velocity);
          });
        }
      } else if (instrument === "piano") {
        pianoSynthRef.current?.triggerAttackRelease(freq, duration, undefined, velocity);
      } else if (instrument === "pad") {
        padSynthRef.current?.triggerAttackRelease(freq, duration, undefined, velocity);
      }
    } catch (e) {
      console.warn("Audio Context not started or invalid note", e);
    }
  }, [isReady, activeOrchestraInstruments]);

  const playChord = useCallback((
    chordName: string,
    duration: number = 0.5,
    velocity: number = 0.8,
    instrument: InstrumentType | "orchestra" = "piano"
  ) => {
    if (!isReady) return;
    try {
      // Usando TonalityAdapter simplificado para extrair notas (dummy parser simples)
      const parts = chordName.match(/([A-G][b#]?)(.*)/);
      if (!parts) return;
      const rootStr = parts[1];
      const rootMidi = Tone.Frequency(`${rootStr}3`).toMidi();
      
      let intervals = [0, 4, 7]; // Major
      if (chordName.includes("m") && !chordName.includes("dim")) intervals = [0, 3, 7]; // Minor
      if (chordName.includes("dim")) intervals = [0, 3, 6];
      if (chordName.includes("7")) intervals.push(10);
      
      const chordNotes = intervals.map(i => Tone.Frequency(rootMidi + i, "midi").toNote());

      if (instrument === "orchestra") {
        if (activeOrchestraInstruments.length === 0) {
          pianoSynthRef.current?.triggerAttackRelease(chordNotes, duration, undefined, velocity);
        } else {
          activeOrchestraInstruments.forEach(id => {
            loadedOrchestraRef.current[id]?.triggerAttackRelease(chordNotes, duration, undefined, velocity);
          });
        }
      } else if (instrument === "piano") {
        pianoSynthRef.current?.triggerAttackRelease(chordNotes, duration, undefined, velocity);
      } else if (instrument === "pad") {
        padSynthRef.current?.triggerAttackRelease(chordNotes, duration, undefined, velocity);
      }
    } catch (e) {
      console.warn("Audio Context error playChord", e);
    }
  }, [isReady, activeOrchestraInstruments]);

  const playSequence = useCallback(async (seq: any, offset: number = 0, melodyInst: InstrumentType | "orchestra" = "piano", chordsInst: InstrumentType | "orchestra" = "piano") => {
    if (!isReady) return;
    const now = Tone.now() + 0.1;
    
    seq.notes?.forEach((n: any) => {
      const freq = Tone.Frequency(n.pitch, "midi").toNote();
      const dur = (n.endTime - n.startTime) || 0.5;
      const time = now + n.startTime;
      if (melodyInst === "orchestra") {
        if (activeOrchestraInstruments.length === 0) pianoSynthRef.current?.triggerAttackRelease(freq, dur, time, n.velocity ?? 0.7);
        else activeOrchestraInstruments.forEach(id => loadedOrchestraRef.current[id]?.triggerAttackRelease(freq, dur, time, n.velocity ?? 0.7));
      } else if (melodyInst === "piano") pianoSynthRef.current?.triggerAttackRelease(freq, dur, time, n.velocity ?? 0.7);
      else if (melodyInst === "pad") padSynthRef.current?.triggerAttackRelease(freq, dur, time, n.velocity ?? 0.7);
    });

    seq.progression?.forEach((p: any) => {
      const dur = p.endTime - p.startTime;
      const time = now + p.startTime;
      const parts = p.chord.match(/([A-G][b#]?)(.*)/);
      if (!parts) return;
      const rootMidi = Tone.Frequency(`${parts[1]}3`).toMidi();
      let intervals = [0, 4, 7];
      if (p.chord.includes("m") && !p.chord.includes("dim")) intervals = [0, 3, 7];
      if (p.chord.includes("dim")) intervals = [0, 3, 6];
      if (p.chord.includes("7")) intervals.push(10);
      const chordNotes = intervals.map(i => Tone.Frequency(rootMidi + i, "midi").toNote());

      if (chordsInst === "orchestra") {
        if (activeOrchestraInstruments.length === 0) pianoSynthRef.current?.triggerAttackRelease(chordNotes, dur, time, p.velocity ?? 0.7);
        else activeOrchestraInstruments.forEach(id => loadedOrchestraRef.current[id]?.triggerAttackRelease(chordNotes, dur, time, p.velocity ?? 0.7));
      } else if (chordsInst === "piano") pianoSynthRef.current?.triggerAttackRelease(chordNotes, dur, time, p.velocity ?? 0.7);
      else if (chordsInst === "pad") padSynthRef.current?.triggerAttackRelease(chordNotes, dur, time, p.velocity ?? 0.7);
    });
    
    const totalDuration = seq.notes?.reduce((max: number, note: any) => Math.max(max, note.endTime || 0), 0) || 0;
    return new Promise<void>(resolve => setTimeout(resolve, totalDuration * 1000));
  }, [isReady, activeOrchestraInstruments]);

  const stopAll = useCallback(() => {
    pianoSynthRef.current?.releaseAll();
    padSynthRef.current?.releaseAll();
    Object.values(loadedOrchestraRef.current).forEach(s => s.releaseAll());
  }, []);

  const setTrackVolume = useCallback((trackIndex: number, vol: number) => {
    // No-op para a orquestra por enquanto (simplificação)
    if (trackIndex === 0 && pianoSynthRef.current) pianoSynthRef.current.volume.value = Tone.gainToDb(vol);
  }, []);

  const setTrackMute = useCallback((trackIndex: number, muted: boolean) => {
    // No-op para a orquestra por enquanto
  }, []);

  return { 
    playMIDINote, 
    playChord, 
    stopAll, 
    isReady,
    loadOrchestraInstrument,
    unloadOrchestraInstrument,
    activeOrchestraInstruments,
    setTrackVolume,
    setTrackMute,
    playSequence
  };
}
