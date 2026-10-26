import { useState, useEffect, useRef, useCallback } from "react";
import * as Tone from "tone";

export type InstrumentType = "piano" | "strings" | "pad";

export interface StringEngineApi {
  playMIDINote: (midi: number, duration?: number, velocity?: number, instrument?: InstrumentType | "orchestra") => void;
  playChord: (chordName: string, duration?: number, velocity?: number, instrument?: InstrumentType | "orchestra") => void;
  playSequence: (seq: any, offset?: number, melodyInst?: InstrumentType | "orchestra", chordsInst?: InstrumentType | "orchestra") => Promise<void>;
  stopAll: (immediate?: boolean) => void;
  isReady: boolean;
  
  // Orchestra dynamic loading
  loadOrchestraInstrument: (id: string) => Promise<void>;
  unloadOrchestraInstrument: (id: string) => void;
  activeOrchestraInstruments: string[];
  setTrackVolume: (trackIndex: number, vol: number) => void;
  setTrackMute: (trackIndex: number, muted: boolean) => void;

  // Acompanhamento ao vivo (nao afeta a tela de edicao)
  /** Toca notas sustentadas (sem release agendado). Libera as anteriores com crossfade de `overlap` segundos. */
  playLiveNotes: (midis: number[], velocity: number, instrument: InstrumentType | "orchestra", overlap?: number) => void;
  /** Libera todas as notas ao vivo com fade-out curto. */
  releaseLive: (fadeSec?: number) => void;
  /** Ajusta o ganho geral ao vivo (0-1.2) conforme a dinamica do cantor. */
  setLiveDynamics: (gain: number) => void;
  /** Toca um arpejo de piano ao vivo cancelando o anterior (sem sobreposicao). Tempos em segundos. */
  playLiveArpeggio: (notes: { midi: number; offset: number; duration: number; velocity: number }[]) => void;
}

export function useStringEngine(): StringEngineApi {
  const [isReady, setIsReady] = useState(false);
  const pianoSynthRef = useRef<Tone.Sampler | null>(null);
  const padSynthRef = useRef<Tone.PolySynth | null>(null);
  const limiterRef = useRef<Tone.Limiter | null>(null);
  const liveGainRef = useRef<Tone.Gain | null>(null);
  const arpTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  
  const orchestraMapRef = useRef<Record<string, Record<string, string>>>({});
  const loadedOrchestraRef = useRef<Record<string, Tone.Sampler>>({});
  const [activeOrchestraInstruments, setActiveOrchestraInstruments] = useState<string[]>([]);

  useEffect(() => {
    // 1. Instanciar Limiter e Reverb
    const limiter = new Tone.Limiter(-2).toDestination();
    limiterRef.current = limiter;
    
    const liveGain = new Tone.Gain(1).connect(limiter);
    liveGainRef.current = liveGain;

    const reverb = new Tone.Reverb({
      decay: 3.5,
      preDelay: 0.05,
      wet: 0.4
    });
    reverb.connect(liveGain);
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
    fetch(`/samples/instrument_map.json?v=${Date.now()}`)
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
      liveGain.dispose();
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

    // O navegador bloqueia áudio até que uma interação do usuário chame Tone.start()
    if (Tone.context.state !== "running") {
      Tone.start().catch(e => console.warn("Tone.start error:", e));
    }

    console.log(`Loading orchestra instrument: ${id}`);
    
    // Configuração de blend (crossfade):
    // Instrumentos percussivos têm ataque rápido. Cordas/Sopros têm ataque suave (fade-in) e release longo (fade-out)
    const isPercussive = id === "piano" || id === "harp";
    const attackTime = isPercussive ? 0.05 : 1.2;
    const releaseTime = isPercussive ? 1.5 : 2.5;

    const sampler = new Tone.Sampler({
      urls,
      baseUrl: `/samples/${id}/`,
      release: releaseTime,
      attack: attackTime,
      volume: -2, // Ajuste de ganho para não clipar
      onload: () => {
        loadedOrchestraRef.current[id] = sampler;
        setActiveOrchestraInstruments(prev => [...prev, id]);
        console.log(`Instrument ${id} loaded!`);
      }
    });
    
    // Conectar ao ganho geral (-> limiter) para evitar estouro de audio no Tutti
    if (liveGainRef.current) {
      sampler.connect(liveGainRef.current);
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
    instrument: InstrumentType | "orchestra" = "piano",
    delay: number = 0
  ) => {
    if (!isReady) return;
    try {
      const freq = Tone.Frequency(midi, "midi").toNote();
      const time = Tone.now() + 0.05 + delay; // 50ms delay to prevent releaseAll() cancelling the attack

      if (instrument === "orchestra") {
        if (activeOrchestraInstruments.length === 0) {
          // Fallback para piano se orquestra vazia
          pianoSynthRef.current?.triggerAttackRelease(freq, duration, time, velocity);
        } else {
          // Tocar em TODOS os instrumentos da orquestra carregados
          activeOrchestraInstruments.forEach(id => {
            loadedOrchestraRef.current[id]?.triggerAttackRelease(freq, duration, time, velocity);
          });
        }
      } else if (instrument === "piano") {
        pianoSynthRef.current?.triggerAttackRelease(freq, duration, time, velocity);
      } else if (instrument === "pad") {
        padSynthRef.current?.triggerAttackRelease(freq, duration, time, velocity);
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

  const playSequence = useCallback(async (seq: any, _offset: number = 0, melodyInst: InstrumentType | "orchestra" = "piano", chordsInst: InstrumentType | "orchestra" = "piano") => {
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

  const stopAll = useCallback((immediate: boolean = false) => {
    if (immediate) {
      if (pianoSynthRef.current) (pianoSynthRef.current as any).release = 0.05;
      if (padSynthRef.current) padSynthRef.current.set({ envelope: { release: 0.05 } });
      Object.values(loadedOrchestraRef.current).forEach(s => {
        (s as any).release = 0.05;
      });
    }

    pianoSynthRef.current?.releaseAll();
    padSynthRef.current?.releaseAll();
    Object.values(loadedOrchestraRef.current).forEach(s => s.releaseAll());

    if (immediate) {
      setTimeout(() => {
        if (pianoSynthRef.current) (pianoSynthRef.current as any).release = 1.5;
        if (padSynthRef.current) padSynthRef.current.set({ envelope: { release: 2.0 } });
        Object.values(loadedOrchestraRef.current).forEach(s => {
          (s as any).release = 2.5; // restore normal string release
        });
      }, 100);
    }
  }, []);

  const setTrackVolume = useCallback((trackIndex: number, vol: number) => {
    // No-op para a orquestra por enquanto (simplificação)
    if (trackIndex === 0 && pianoSynthRef.current) pianoSynthRef.current.volume.value = Tone.gainToDb(vol);
  }, []);

  const setTrackMute = useCallback((_trackIndex: number, _muted: boolean) => {
    // No-op para a orquestra por enquanto
  }, []);

  // ── Acompanhamento ao vivo ──────────────────────────────
  const LIVE_SAMPLER_RELEASE = 0.45;
  const PIANO_PEDAL_SUSTAIN_RELEASE = 3.5;
  const PIANO_DAMPER_CHANGE_FADE = 0.45;

  const liveTargets = useCallback((instrument: InstrumentType | "orchestra") => {
    const samplers: Tone.Sampler[] = [];
    let pad: Tone.PolySynth | null = null;
    if (instrument === "orchestra") {
      const loaded = Object.values(loadedOrchestraRef.current);
      if (loaded.length > 0) samplers.push(...loaded);
      else if (pianoSynthRef.current) samplers.push(pianoSynthRef.current);
    } else if (instrument === "piano") {
      if (pianoSynthRef.current) samplers.push(pianoSynthRef.current);
    } else if (padSynthRef.current) {
      pad = padSynthRef.current;
    }
    return { samplers, pad };
  }, []);

  const playLiveNotes = useCallback((
    midis: number[],
    velocity: number,
    instrument: InstrumentType | "orchestra",
    overlap: number = 0
  ) => {
    if (!isReady || midis.length === 0) return;
    try {
      const isPiano = instrument === "piano" || (instrument === "orchestra" && activeOrchestraInstruments.length === 0);
      const { samplers, pad } = liveTargets(instrument);
      const notes = midis.map(m => Tone.Frequency(m, "midi").toNote());
      const releaseAt = Tone.now() + 0.03 + overlap;
      const startAt = Tone.now() + 0.03;
      const vel = Math.min(1, Math.max(0.05, velocity));

      if (isPiano) {
        // Comportamento de pedal exclusivo para o piano
        const piano = pianoSynthRef.current;
        if (piano) {
          // 1. Troca sincopada de pedal: abafa o acorde anterior suavemente
          piano.release = PIANO_DAMPER_CHANGE_FADE;
          piano.releaseAll(releaseAt);

          // 2. Novo ataque com pedal de sustentacao abaixado: ressonancia acustica prolongada
          piano.release = PIANO_PEDAL_SUSTAIN_RELEASE;
          piano.triggerAttack(notes, startAt, vel);
        }
      } else {
        samplers.forEach(s => {
          s.releaseAll(releaseAt);
          const prev = s.release;
          s.release = LIVE_SAMPLER_RELEASE;
          s.triggerAttack(notes, startAt, vel);
          s.release = prev;
        });
      }

      if (pad) {
        pad.releaseAll(releaseAt);
        pad.triggerAttack(notes, startAt, vel);
      }
    } catch (e) {
      console.warn("Audio error playLiveNotes", e);
    }
  }, [isReady, liveTargets, activeOrchestraInstruments]);

  const clearArpTimers = useCallback(() => {
    arpTimersRef.current.forEach(clearTimeout);
    arpTimersRef.current = [];
  }, []);

  const releaseLive = useCallback((fadeSec: number = 0.4) => {
    clearArpTimers();
    const t = Tone.now();
    if (pianoSynthRef.current) {
      pianoSynthRef.current.release = fadeSec;
      pianoSynthRef.current.releaseAll(t);
      setTimeout(() => {
        if (pianoSynthRef.current) pianoSynthRef.current.release = PIANO_PEDAL_SUSTAIN_RELEASE;
      }, 100);
    }
    Object.values(loadedOrchestraRef.current).forEach(s => s.releaseAll(t));
    const pad = padSynthRef.current;
    if (pad) {
      pad.set({ envelope: { release: fadeSec } });
      pad.releaseAll(t);
      setTimeout(() => pad.set({ envelope: { release: 2.0 } }), 150);
    }
  }, [clearArpTimers]);

  const playLiveArpeggio = useCallback((
    notes: { midi: number; offset: number; duration: number; velocity: number }[]
  ) => {
    const piano = pianoSynthRef.current;
    if (!isReady || !piano) return;
    // Cancela o arpejo anterior e silencia suas notas (release curto)
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
    loadOrchestraInstrument,
    unloadOrchestraInstrument,
    activeOrchestraInstruments,
    setTrackVolume,
    setTrackMute,
    playSequence,
    playLiveNotes,
    releaseLive,
    setLiveDynamics,
    playLiveArpeggio
  };
}
