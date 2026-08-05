import { useState, useEffect, useRef, useCallback } from "react";
import {
  sequences,
  NoteSequence,
} from "@magenta/music";
import type { INoteSequence } from "@magenta/music";
import { usePitchDetector } from "./hooks/usePitchDetector";
import { useStringEngine } from "./hooks/useStringEngine";
import type { DetectedNote } from "./hooks/usePitchDetector";
import { Sidebar } from "./components/Sidebar";
import { RecordControls } from "./components/RecordControls";
import { DynamicRing } from "./components/DynamicRing";
import type { ChatSession, SerializedBlock } from "./lib/api";
import { apiSaveComposition, apiCreateSession } from "./lib/api";

import { StudioView } from "./components/StudioView";
import type { AppTab } from "./components/BottomNav";
import { generateProgression, warmUpModel } from "./engine/HarmonyEngine";
import {
  normalizeNotes,
  transposeProgression,
  normalizeProgressionToC,
  getChordPitchClasses
} from "./engine/TonalityAdapter";
import { detectKey, estimateBPM } from "./engine/AudioAnalyzer";
import { Starfield } from "./components/Starfield";

// ─────────────────────────────────────────────────────────
//  Máquina de Estados do fluxo principal
// ─────────────────────────────────────────────────────────
export type AppState =
  | "IDLE"
  | "RECORDING"
  | "REVIEW_RECORDING"
  | "PROCESSING";

export interface ChordSegment {
  id: string;
  chord: string;
  durationBeats: number;
  velocity: number;
}

export type InstrumentType = "piano" | "strings" | "pad";

export interface CompositionBlock {
  id: string;
  name: string;
  notes: DetectedNote[];
  progression: ChordSegment[];
  noteSequence?: INoteSequence;
  key: string;
  bpm: number;
  timeSignature: string;
  newlyGenerated?: boolean;
}

// ── Stale-closure-safe label map ────────────────────────
const STATE_LABELS: Record<AppState, string> = {
  IDLE: "Iniciar Captura",
  RECORDING: "Gravando · Clique para parar",
  REVIEW_RECORDING: "Analisar áudio gravado?",
  PROCESSING: "Transcrevendo áudio e gerando harmonia...",
};

// ─────────────────────────────────────────────────────────
//  Utilidades de conversão
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
//  Pré-processamento de notas detectadas
// ─────────────────────────────────────────────────────────

/**
 * Pré-processa as notas vindas do Basic Pitch.
 *
 * 1. Ordena por startTime (Basic Pitch pode retornar fora de ordem).
 * 2. Filtra notas muito curtas (< 80ms — ruído da rede neural).
 * 3. Para notas de MESMO pitch (exatamente), cola fragmentos
 *    separados por gaps < 0.25s (vibrato/tremolo).
 *
 * ⚠ NÃO funde notas de pitches diferentes (Basic Pitch é polifônico,
 *   notas simultâneas em pitches distintos são legítimas).
 */
function glueNotes(rawNotes: DetectedNote[]): DetectedNote[] {
  if (rawNotes.length === 0) return [];

  // 1. Ordenar por startTime, depois por pitch
  const sorted = [...rawNotes].sort((a, b) =>
    a.startTime !== b.startTime
      ? a.startTime - b.startTime
      : a.pitch - b.pitch,
  );

  // 2. Filtrar notas muito curtas
  const solidNotes = sorted.filter(n => (n.endTime - n.startTime) > 0.08);
  if (solidNotes.length === 0) return [];

  // 3. Agrupar por pitch e colar fragmentos do MESMO pitch
  const byPitch = new Map<number, DetectedNote[]>();
  for (const note of solidNotes) {
    if (!byPitch.has(note.pitch)) byPitch.set(note.pitch, []);
    byPitch.get(note.pitch)!.push({ ...note });
  }

  const result: DetectedNote[] = [];

  for (const [, notes] of byPitch) {
    // Notas já estão ordenadas por startTime (herdam do sorted)
    const merged: DetectedNote[] = [{ ...notes[0] }];

    for (let i = 1; i < notes.length; i++) {
      const current = notes[i];
      const last = merged[merged.length - 1];
      const gap = current.startTime - last.endTime;

      if (gap < 0.25) {
        // Mesmo pitch, gap pequeno → colar
        last.endTime = Math.max(last.endTime, current.endTime);
      } else {
        merged.push({ ...current });
      }
    }

    result.push(...merged);
  }

  // Reordenar o resultado final por startTime
  result.sort((a, b) => a.startTime - b.startTime);
  return result;
}

// ─────────────────────────────────────────────────────────
//  Conversão: Progressão de acordes → NoteSequence
// ─────────────────────────────────────────────────────────

/**
 * Constrói a melodia original como NoteSequence quantizado.
 */
function buildMelodySequence(
  notes: DetectedNote[],
  bpm: number,
): NoteSequence {
  const gluedNotes = glueNotes(notes);
  const ns = sequences.createQuantizedNoteSequence(4, bpm);
  const stepsPerSecond = sequences.stepsPerQuarterToStepsPerSecond(4, bpm);

  for (const note of gluedNotes) {
    const qStart = sequences.quantizeToStep(note.startTime, stepsPerSecond);
    const qEnd = sequences.quantizeToStep(note.endTime, stepsPerSecond);

    if (qEnd > qStart) {
      ns.notes!.push(
        NoteSequence.Note.create({
          pitch: note.pitch,
          startTime: note.startTime,
          endTime: note.endTime,
          quantizedStartStep: qStart,
          quantizedEndStep: qEnd,
          instrument: 0,
          velocity: Math.floor(Math.max(0.1, note.amplitude || 1) * 127),
          program: 0,
        }),
      );
    }
  }

  if (ns.notes!.length > 0) {
    ns.totalQuantizedSteps = Math.max(
      ...ns.notes!.map(n => n.quantizedEndStep ?? 0),
    );
  }

  ns.tempos = [{ time: 0, qpm: bpm }];

  return ns;
}

/**
 * Sintetiza a progressão de acordes em notas de harmonia
 * e as mescla com a melodia original em um NoteSequence.
 *
 * Cada acorde da progressão ocupa um compasso inteiro.
 * As notas do acorde são distribuídas numa oitava
 * confortável (MIDI 48–60 → C3–C4) como um bloco
 * sustentado (whole-note / semibreve por compasso).
 */
function progressionToNoteSequence(
  progression: ChordSegment[],
  melodyNotes: DetectedNote[],
  bpm: number,
  timeSignatureDenominator: number,
): NoteSequence {
  // 1) Montar a melodia quantizada
  const ns = buildMelodySequence(melodyNotes, bpm);
  const stepsPerSecond = sequences.stepsPerQuarterToStepsPerSecond(4, bpm);
  const secondsPerBeat = (4 / timeSignatureDenominator) * (60 / bpm);

  let currentStartTime = 0;

  // 2) Para cada segmento de acorde, adicionar as notas correspondentes
  for (const seg of progression) {
    const pitchClasses = getChordPitchClasses(seg.chord);

    const durationSeconds = seg.durationBeats * secondsPerBeat;
    const measureStartTime = currentStartTime;
    const measureEndTime = measureStartTime + durationSeconds;
    
    const qStart = sequences.quantizeToStep(measureStartTime, stepsPerSecond);
    const stepsPerChord = Math.round(durationSeconds * stepsPerSecond);
    const qEnd = Math.max(qStart + 1, qStart + stepsPerChord);

    // Distribuir pitch classes na oitava C3 (MIDI 48+)
    for (const pc of pitchClasses) {
      const midiPitch = 48 + pc; // C3 base
      ns.notes!.push(
        NoteSequence.Note.create({
          pitch: midiPitch,
          startTime: measureStartTime,
          endTime: measureEndTime,
          quantizedStartStep: qStart,
          quantizedEndStep: qEnd,
          instrument: 1, // voz 1 = harmonia
          velocity: Math.floor(Math.max(0.2, seg.velocity || 0.7) * 127),
          program: 0,
        }),
      );
    }
    
    currentStartTime = measureEndTime;
  }

  // 3) Recalcular totalQuantizedSteps
  if (ns.notes!.length > 0) {
    ns.totalQuantizedSteps = Math.max(
      ...ns.notes!.map(n => n.quantizedEndStep ?? 0),
    );
  }

  return ns;
}

// ─────────────────────────────────────────────────────────
//  App Component
// ─────────────────────────────────────────────────────────

export default function App() {

  // ── UI state ──────────────────────────────────────────
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [qtValue, setQtValue] = useState(4);
  const [utValue, setUtValue] = useState(4);
  const [tonality, setTonality] = useState<string>("AUTO");

  const [appState, setAppState] = useState<AppState>("IDLE");
  const [preRecordTimeSignature, setPreRecordTimeSignature] = useState({ numerator: 4, denominator: 4 });
  const [preRecordBpm, setPreRecordBpm] = useState<number | "AUTO">("AUTO");
  const [preRecordTonality, setPreRecordTonality] = useState<string>("AUTO");

  const [melodyInstrument, setMelodyInstrument] = useState<InstrumentType>("piano");
  const [chordsInstrument, setChordsInstrument] = useState<InstrumentType>("piano");
  
  const [melodyVolume, setMelodyVolume] = useState(1);
  const [melodyMuted, setMelodyMuted] = useState(false);
  const [chordsVolume, setChordsVolume] = useState(1);
  const [chordsMuted, setChordsMuted] = useState(false);
  
  const [blocks, setBlocks] = useState<CompositionBlock[]>([
    { id: "1", name: "Verso 1", notes: [], progression: [], key: "C", bpm: 120, timeSignature: "4/4" }
  ]);
  const [activeBlockId, setActiveBlockId] = useState<string>("1");
  const activeBlock = blocks.find(b => b.id === activeBlockId);

  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("vibe");

  // ── Session state ───────────────────────────────────────────────
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const activeSessionRef = useRef<ChatSession | null>(null);

  // Keep ref in sync for use inside async callbacks
  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  // When user picks a session from the sidebar, restore its composition
  const handleSessionChange = useCallback((session: ChatSession | null) => {
    setActiveSession(session);
    if (!session) return;

    if (session.compositionData && session.compositionData.length > 0) {
      // Rebuild blocks from persisted data (no noteSequence — rebuilt on first play)
      const restored: CompositionBlock[] = session.compositionData.map(b => ({
        id: b.id,
        name: b.name,
        notes: b.notes as DetectedNote[],
        progression: b.progression,
        key: b.key,
        bpm: b.bpm,
        timeSignature: b.timeSignature,
        noteSequence: b.notes.length > 0 ? (() => {
          try {
            return progressionToNoteSequence(
              b.progression,
              b.notes as DetectedNote[],
              b.bpm,
              parseInt(b.timeSignature.split('/')[1] || '4')
            );
          } catch { return undefined; }
        })() : undefined,
      }));
      setBlocks(restored);
      setActiveBlockId(restored[0].id);
      setActiveTab(restored[0].noteSequence ? "studio" : "vibe");
    } else {
      // New empty session — reset to default
      const defaultBlock: CompositionBlock = {
        id: Date.now().toString(),
        name: "Verso 1",
        notes: [],
        progression: [],
        key: "C",
        bpm: 120,
        timeSignature: "4/4",
      };
      setBlocks([defaultBlock]);
      setActiveBlockId(defaultBlock.id);
      setActiveTab("vibe");
    }
  }, []);

  const handleSessionRename = useCallback((id: string, newTitle: string) => {
    setActiveSession(prev => prev?.id === id ? { ...prev, title: newTitle } : prev);
  }, []);

  // ── Refs ──────────────────────────────────────────────
  const appStateRef = useRef<AppState>("IDLE");
  const playingIndexRef = useRef<number | null>(null);
  const recordedBpmRef = useRef<number>(120);

  // Manter ref sincronizado com state (para closures)
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  // ── Hooks personalizados ──────────────────────────────
  const pitchDetector = usePitchDetector();
  const stringEngine = useStringEngine();

  // ── Sincronizar Volume/Mute com Engine ────────────────
  useEffect(() => {
    stringEngine.setTrackVolume(0, melodyVolume);
    stringEngine.setTrackMute(0, melodyMuted);
  }, [melodyVolume, melodyMuted, stringEngine]);

  useEffect(() => {
    stringEngine.setTrackVolume(1, chordsVolume);
    stringEngine.setTrackMute(1, chordsMuted);
  }, [chordsVolume, chordsMuted, stringEngine]);

  // ── Sincronizar Bloco Ativo com Global State ───────────
  useEffect(() => {
    if (activeBlock) {
      setBpm(activeBlock.bpm);
      setTonality(activeBlock.key);
      const [qt, ut] = activeBlock.timeSignature.split('/');
      setQtValue(parseInt(qt) || 4);
      setUtValue(parseInt(ut) || 4);
    }
  }, [activeBlockId]);

  // Pré-carregar modelo LSTM em background ao montar o app
  useEffect(() => { warmUpModel(); }, []);

  // ── Cleanup ao desmontar ──────────────────────────────
  useEffect(() => {
    return () => {
      if (pitchDetector.isListening) pitchDetector.stopListening();
      stringEngine.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Controle de Playback por item ─────────────────────
  const playSequence = useCallback(async (index: number, seq: INoteSequence, offset: number = 0, melodyInst: InstrumentType = "piano", chordsInst: InstrumentType = "piano") => {
    try {
      if (playingIndexRef.current === index) {
        stringEngine.stop();
        setPlayingIndex(null);
        playingIndexRef.current = null;
        return;
      }

      // Parar qualquer som anterior
      stringEngine.stop();

      setPlayingIndex(index);
      playingIndexRef.current = index;

      await stringEngine.playSequence(seq, offset, melodyInst, chordsInst);

      // Calcular a duração aproximada para liberar o botão
      const totalDuration = seq.notes?.reduce((max, note) => Math.max(max, note.endTime || 0), 0) || 0;
      setTimeout(() => {
        if (playingIndexRef.current === index) {
          setPlayingIndex(null);
          playingIndexRef.current = null;
        }
      }, (totalDuration + 0.5) * 1000);

    } catch (err) {
      console.error("Erro no playback:", err);
      setPlayingIndex(null);
      playingIndexRef.current = null;
    }
  }, [stringEngine]);

  // ── Ring Click (Cancelar ou Iniciar) ──────────────────
  const handleRingClick = useCallback(async () => {
    if (appState === "RECORDING") {
      await pitchDetector.pauseListening();
      setAppState("REVIEW_RECORDING");
    } else if (appState === "PROCESSING" || appState === "REVIEW_RECORDING") {
      pitchDetector.cancelListening();
      setAppState("IDLE");
    } else if (appState === "IDLE") {
      // Iniciar pelo anel também é válido
      // Mas para manter as regras de UI, usaremos o handleMainButtonClick
    }
  }, [appState, pitchDetector]);

  // ── Handler principal do botão ────────────────────────
  const handleMainButtonClick = useCallback(async () => {
    const current = appStateRef.current;
    setErrorMsg(null);

    switch (current) {
      // ── IDLE → RECORDING ───────────────────────────────
      case "IDLE": {
        setAppState("RECORDING");
        await pitchDetector.prepareListening(); // Prepara mic (pede permissão)
        pitchDetector.startRecording(); // Inicia imediatamente
        break;
      }

      // ── RECORDING → (agora é capturado pelo anel, mas deixamos vazio por segurança)
      case "RECORDING":
        break;

      // ── REVIEW_RECORDING → PROCESSING → PLAYING_AND_SHOWING ─
      case "REVIEW_RECORDING": {
        await processRecording();
        break;
      }

      // COUNT_IN e PROCESSING: não fazem nada no clique
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm, qtValue, utValue, tonality, activeBlockId, playSequence]);

  const processRecording = async () => {
        setAppState("PROCESSING");
        // Yield inicial para garantir a montagem do componente ProcessingText na UI
        await new Promise(resolve => setTimeout(resolve, 50));

        // 2) A rede neural do Basic Pitch avalia o áudio (demora alguns segundos)
        const detectedNotes = await pitchDetector.processPausedAudio();

        if (detectedNotes.length === 0) {
          setErrorMsg("Nenhuma nota detectada. Tente novamente.");
          setAppState("IDLE");
          return;
        }

        try {
          // Yield para liberar a UI antes do processamento intensivo
          await new Promise(resolve => setTimeout(resolve, 50));

          // 3) Pré-processar notas e remover o silêncio inicial (trim)
          let gluedNotes = glueNotes(detectedNotes);
          
          if (gluedNotes.length > 0) {
            const tMin = Math.min(...gluedNotes.map(n => n.startTime));
            gluedNotes = gluedNotes.map(n => ({
              ...n,
              startTime: n.startTime - tMin,
              endTime: n.endTime - tMin,
            }));
            const tMax = Math.max(...gluedNotes.map(n => n.endTime));
            console.log(`[Pipeline] Range temporal ajustado (sem folga inicial): 0.000s → ${tMax.toFixed(3)}s`);
          }

          // Yield antes de algoritmos custosos de análise harmônica
          await new Promise(resolve => setTimeout(resolve, 50));

          // 4) Analisar Key e BPM
          const detectedKey = preRecordTonality === "AUTO" ? detectKey(gluedNotes) : preRecordTonality;
          const estimatedBpm = preRecordBpm === "AUTO" ? estimateBPM(gluedNotes) : preRecordBpm;
          const defaultTimeSignature = `${preRecordTimeSignature.numerator}/${preRecordTimeSignature.denominator}`;

          // Sincronizar o state atual da view com os detectados
          setBpm(estimatedBpm);
          setTonality(detectedKey);
          setQtValue(preRecordTimeSignature.numerator);
          setUtValue(preRecordTimeSignature.denominator);
          recordedBpmRef.current = estimatedBpm;

          console.log(`[Pipeline] Notas brutas: ${detectedNotes.length} → Após glue: ${gluedNotes.length}`);
          console.log(`[Pipeline] Key detectada: ${detectedKey} | BPM estimado: ${estimatedBpm}`);

          // 5) Normalizar notas para C Major (Local Space) usando a tonalidade detectada
          const normalizedNotes = normalizeNotes(gluedNotes, detectedKey);

          // Yield antes de consultar a matriz de Markov e iterar no grafo
          await new Promise(resolve => setTimeout(resolve, 50));

          // 6) Gerar progressão via HarmonyEngine Neural LSTM (opera em C Major)
          const rawProgression = await generateProgression(
            normalizedNotes,
            estimatedBpm,
            preRecordTimeSignature.numerator, // 1 acorde por compasso
            preRecordTimeSignature.numerator,
            preRecordTimeSignature.denominator,
            "C",
          );

          console.log(`[Pipeline] Progressão bruta (C): [${rawProgression.join(", ")}]`);

          // 7) Transpor progressão de volta para a tonalidade detectada
          const transposedProgression = rawProgression.map(item => ({
            chord: transposeProgression([item.chord], detectedKey)[0],
            velocity: item.velocity
          }));
          
          const progression: ChordSegment[] = transposedProgression.map(item => ({
            id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
            chord: item.chord,
            durationBeats: preRecordTimeSignature.numerator,
            velocity: item.velocity
          }));

          console.log(`[Pipeline] Progressão final (${tonality}): [${progression.map(p => p.chord).join(", ")}]`);

          // Yield antes da síntese final de NoteSequence
          await new Promise(resolve => setTimeout(resolve, 50));

          // 8) Sintetizar em NoteSequence (melodia + acordes)
          const noteSequence = progressionToNoteSequence(
            progression,
            gluedNotes,
            estimatedBpm,
            preRecordTimeSignature.denominator,
          );

          // 9) Adicionar resultado
          let finalBlocks: CompositionBlock[] = [];
          setBlocks(prev => {
            const next = prev.map(b =>
              b.id === activeBlockId
                ? {
                    ...b,
                    notes: gluedNotes,
                    progression,
                    noteSequence,
                    key: detectedKey,
                    bpm: estimatedBpm,
                    timeSignature: defaultTimeSignature,
                  }
                : b
            );
            finalBlocks = next;
            return next;
          });
          setAppState("IDLE");

          // 10) Persistir no backend — cria sessão se não houver uma ativa
          setTimeout(async () => {
            try {
              let session = activeSessionRef.current;
              if (!session) {
                // Gera título musical único: "Am · Dm – G – C · 19:31"
                const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                const chordPreview = progression.map(p => p.chord).slice(0, 3).join(' – ');
                const sessionTitle = `${detectedKey} · ${chordPreview} · ${timeStr}`;

                const { session: newSession } = await apiCreateSession(sessionTitle);
                session = newSession;
                setActiveSession(newSession);
                activeSessionRef.current = newSession;
              }

              const serialized: SerializedBlock[] = finalBlocks.map(b => ({
                id: b.id,
                name: b.name,
                notes: b.notes,
                progression: b.progression,
                key: b.key,
                bpm: b.bpm,
                timeSignature: b.timeSignature,
              }));

              await apiSaveComposition(session.id, serialized);
              console.log('[Requiem] Composição salva na sessão', session.id);
            } catch (saveErr) {
              console.warn('[Requiem] Não foi possível salvar no backend:', saveErr);
            }
          }, 0);

        } catch (err) {
          console.error("Erro ao gerar harmonia:", err);
          setErrorMsg(
            "Erro ao gerar harmonia. Tente novamente."
          );
          setAppState("IDLE");
        }
  };

  const handleStopAndProcess = async () => {

    await pitchDetector.pauseListening();
    await processRecording();
  };

  // ── Atualizar Progressão ───────────────────────────────
  const handleUpdateProgression = useCallback((newProgression: ChordSegment[]) => {
    let updatedBlocks: CompositionBlock[] = [];
    setBlocks(prev => {
      const next = prev.map(b => {
        if (b.id !== activeBlockId || b.notes.length === 0) return b;
        try {
          const noteSequence = progressionToNoteSequence(
            newProgression,
            b.notes,
            bpm,
            utValue,
          );
          return { ...b, progression: newProgression, noteSequence, newlyGenerated: true };
        } catch (err) {
          console.error("Erro ao atualizar progressão:", err);
          return b;
        }
      });
      updatedBlocks = next;
      return next;
    });
    
    // Reiniciar player se estiver tocando
    if (playingIndexRef.current === 0) {
       stringEngine.stop();
       setPlayingIndex(null);
       playingIndexRef.current = null;
    }

    // Auto-save no backend
    setTimeout(async () => {
      const session = activeSessionRef.current;
      if (!session || updatedBlocks.length === 0) return;
      try {
        const serialized: SerializedBlock[] = updatedBlocks.map(b => ({
          id: b.id,
          name: b.name,
          notes: b.notes,
          progression: b.progression,
          key: b.key,
          bpm: b.bpm,
          timeSignature: b.timeSignature,
        }));
        await apiSaveComposition(session.id, serialized);
      } catch (e) {
        console.warn('[Requiem] Auto-save progressão falhou:', e);
      }
    }, 0);
  }, [bpm, utValue, activeBlockId, stringEngine]);

  // O efeito colateral reativo de BPM foi removido para evitar estiramentos cumulativos da melodia.

  // ── Derivações visuais ────────────────────────────────
  const isActive = appState !== "IDLE";
  const isRecording = appState === "RECORDING";
  const isProcessing = appState === "PROCESSING";
  const isButtonDisabled = isProcessing || !stringEngine.isLoaded;

  // Auto-switch to Studio when result is generated
  useEffect(() => {
    if (activeBlock?.noteSequence && activeTab === "vibe") {
      setActiveTab("studio");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBlock?.noteSequence]);

  const handleStartRecording = useCallback(async () => {
    // Apaga apenas o bloco ativo para regravar do zero e remove a flag de animação
    setBlocks(prev => prev.map(b => 
      b.id === activeBlockId ? { ...b, notes: [], progression: [], noteSequence: undefined, newlyGenerated: false } : b
    ));
    setActiveTab("vibe");
    
    if (appStateRef.current === "IDLE") {
      setAppState("RECORDING");
      await pitchDetector.prepareListening();
      pitchDetector.startRecording();
    }
  }, [activeBlockId, pitchDetector]);

  const handleAddBlock = useCallback(() => {
    const id = Date.now().toString();
    const newBlock: CompositionBlock = {
      id,
      name: `Seção ${blocks.length + 1}`,
      notes: [],
      progression: [],
      key: "C",
      bpm: 120,
      timeSignature: `${preRecordTimeSignature.numerator}/${preRecordTimeSignature.denominator}`
    };
    setBlocks(prev => [...prev, newBlock]);
    setActiveBlockId(id);
  }, [blocks.length, preRecordTimeSignature]);

  const handleRemoveBlock = useCallback((idToRemove: string) => {
    setBlocks(prev => {
      const next = prev.filter(b => b.id !== idToRemove);
      // Se apagar o ativo, ativa o primeiro disponível (se houver)
      if (idToRemove === activeBlockId && next.length > 0) {
        setActiveBlockId(next[0].id);
      }
      return next.length > 0 ? next : [{ id: Date.now().toString(), name: "Seção 1", notes: [], progression: [], key: "C", bpm: 120, timeSignature: `${preRecordTimeSignature.numerator}/${preRecordTimeSignature.denominator}` }];
    });
  }, [activeBlockId, preRecordTimeSignature]);

  const handleRenameBlock = useCallback((id: string, newName: string) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, name: newName } : b));
  }, []);

  // Setters que também atualizam o bloco atual
  const handleSetBpm = useCallback((newBpm: number) => {
    setBlocks(prev => {
      const nextBlocks = prev.map(b => {
        if (b.id !== activeBlockId || b.notes.length === 0) return { ...b, bpm: b.id === activeBlockId ? newBpm : b.bpm };
        
        const ratio = b.bpm / newBpm;
        const scaledNotes = b.notes.map(n => ({
          ...n,
          startTime: n.startTime * ratio,
          endTime: n.endTime * ratio
        }));
        
        const bUt = parseInt(b.timeSignature.split('/')[1] || '4');
        
        try {
          const noteSequence = progressionToNoteSequence(
            b.progression,
            scaledNotes,
            newBpm,
            bUt
          );
          return { ...b, bpm: newBpm, notes: scaledNotes, noteSequence };
        } catch (err) {
          return { ...b, bpm: newBpm };
        }
      });
      
      // Auto-save no backend após escalar a melodia
      setTimeout(async () => {
        const session = activeSessionRef.current;
        if (!session) return;
        try {
          const serialized: SerializedBlock[] = nextBlocks.map(blk => ({
            id: blk.id,
            name: blk.name,
            notes: blk.notes,
            progression: blk.progression,
            key: blk.key,
            bpm: blk.bpm,
            timeSignature: blk.timeSignature,
          }));
          await apiSaveComposition(session.id, serialized);
        } catch (e) {
          console.warn('[Requiem] Auto-save falhou:', e);
        }
      }, 0);
      
      return nextBlocks;
    });

    setBpm(newBpm);
    recordedBpmRef.current = newBpm;
    
    if (playingIndexRef.current === 0) {
       stringEngine.stop();
       setPlayingIndex(null);
       playingIndexRef.current = null;
    }
  }, [activeBlockId, stringEngine]);

  const handleSetQtValue = useCallback((newQt: number) => {
    setQtValue(newQt);
    setBlocks(prev => prev.map(b => b.id === activeBlockId ? { ...b, timeSignature: `${newQt}/${b.timeSignature.split('/')[1] || 4}` } : b));
  }, [activeBlockId]);

  const handleSetUtValue = useCallback((newUt: number) => {
    setUtValue(newUt);
    setBlocks(prev => prev.map(b => b.id === activeBlockId ? { ...b, timeSignature: `${b.timeSignature.split('/')[0] || 4}/${newUt}` } : b));
  }, [activeBlockId]);

  const handleSetTonality = useCallback((newKey: string) => {
    setTonality(newKey);
    setBlocks(prev => prev.map(b => {
      if (b.id !== activeBlockId) return b;
      
      try {
        const cProgression = normalizeProgressionToC(b.progression.map(p => p.chord), b.key);
        const newProgressionStr = transposeProgression(cProgression, newKey);
        const newProgression = b.progression.map((p, i) => ({ ...p, chord: newProgressionStr[i] }));
        
        const [, ut] = b.timeSignature.split('/');
        const noteSequence = progressionToNoteSequence(
          newProgression,
          b.notes,
          b.bpm,
          parseInt(ut) || 4
        );
        
        return { ...b, key: newKey, progression: newProgression, noteSequence };
      } catch (err) {
        console.error("Erro ao transpor tonalidade:", err);
        return { ...b, key: newKey }; // Fallback
      }
    }));
  }, [activeBlockId]);

  return (
    <div className="flex h-screen w-full bg-black text-white overflow-hidden font-sans antialiased">

      {/* ─── SIDEBAR (Present on all views) ─── */}
      <Sidebar
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        activeSessionId={activeSession?.id ?? null}
        onSessionChange={handleSessionChange}
        onSessionRename={handleSessionRename}
        activeSession={activeSession}
      />

      {/* ─── VIBE VIEW ─── */}
      {activeTab === "vibe" && (
        <main className="relative flex-1 flex flex-col justify-between p-8 overflow-hidden bg-black">

          {/* Unified Animated/Static Stars Background */}
          <Starfield animated={appState === "PROCESSING"} numStars={250} />

          {/* Corpo Central */}
          <div className="relative z-10 flex flex-col flex-1 items-center justify-center text-center overflow-hidden">
            <div className="w-full max-w-4xl px-4 flex flex-col items-center transition-all duration-500 ease-in-out">

              <div className="relative flex items-center justify-center">
                <DynamicRing 
                  isActive={isActive} 
                  currentFrequency={pitchDetector.currentFrequency}
                  currentNote={pitchDetector.currentNote}
                  onClick={handleRingClick}
                />
              </div>

              <div className={`w-full flex flex-col items-center transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isActive ? 'opacity-0 h-0 scale-90 pointer-events-none' : 'opacity-100 h-auto scale-100'}`}>
                <h1 className="text-3xl sm:text-4xl font-normal tracking-tight text-white/90 mb-10 drop-shadow-md">
                  Olá! O que iremos compor hoje?
                </h1>

                <RecordControls
                  appState={appState}
                  isRecording={isRecording}
                  isProcessing={isProcessing}
                  currentFrequency={pitchDetector.currentFrequency}
                  currentNote={pitchDetector.currentNote}
                  isButtonDisabled={isButtonDisabled}
                  handleMainButtonClick={handleMainButtonClick}
                  stateLabels={STATE_LABELS}
                  preRecordTimeSignature={preRecordTimeSignature}
                  setPreRecordTimeSignature={setPreRecordTimeSignature}
                  preRecordBpm={preRecordBpm}
                  setPreRecordBpm={setPreRecordBpm}
                  preRecordTonality={preRecordTonality}
                  setPreRecordTonality={setPreRecordTonality}
                />
            </div>
            
            {appState === "REVIEW_RECORDING" && (
              <div className="flex gap-4 mt-8 animate-fade-in z-20">
                <button 
                  onClick={() => {
                    pitchDetector.cancelListening();
                    setAppState("IDLE");
                  }}
                  className="px-6 py-2.5 rounded-full border border-white/20 text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                >
                  Descartar
                </button>
                <button 
                  onClick={handleMainButtonClick}
                  className="px-6 py-2.5 rounded-full bg-white text-black font-medium hover:scale-105 transition-transform shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                >
                  Gerar Harmonia
                </button>
              </div>
            )}

            {appState === "PROCESSING" && <ProcessingText />}

              {/* MENSAGEM DE ERRO */}
              {errorMsg && (
                <div className="mt-4 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono animate-fade-in">
                  {errorMsg}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <footer className="relative z-10 w-full text-center text-[10px] font-mono tracking-[0.2em] text-white/30 max-w-5xl mx-auto">
            &copy; {new Date().getFullYear()} REQUIEM LABS &bull; HARMONY ENGINE v1.0
          </footer>
        </main>
      )}

      {/* ─── STUDIO VIEW ─── */}
      {activeTab === "studio" && activeBlock && (
        <main className="flex-1 flex flex-col overflow-hidden">
          <StudioView
            compositionName={activeSession?.title || "Nova Composição"}
            blocks={blocks}
            activeBlockId={activeBlockId}
            onActiveBlockChange={(id) => {
            setActiveBlockId(id);
            // Ao trocar de bloco manualmente, remova a flag newlyGenerated do bloco novo (se houver) para não re-animar
            setBlocks(prev => prev.map(b => b.id === id && b.newlyGenerated ? { ...b, newlyGenerated: false } : b));
          }}
          onAddBlock={handleAddBlock}
            onRemoveBlock={handleRemoveBlock}
            onRenameBlock={handleRenameBlock}
            appState={appState}
            currentFrequency={pitchDetector.currentFrequency}
            onStopRecording={handleStopAndProcess}
            noteSequence={activeBlock.noteSequence!}
            progression={activeBlock.progression}
            bpm={bpm}
            setBpm={handleSetBpm}
            qtValue={qtValue}
            setQtValue={handleSetQtValue}
            utValue={utValue}
            setUtValue={handleSetUtValue}
            tonality={tonality}
            setTonality={handleSetTonality}
            isPlaying={playingIndex === 0}
            onPlay={(timeOffset) => {
              if (activeBlock.noteSequence) playSequence(0, activeBlock.noteSequence, timeOffset, melodyInstrument, chordsInstrument);
            }}
            onStop={() => {
              stringEngine.stop();
              setPlayingIndex(null);
              playingIndexRef.current = null;
            }}
            onUpdateProgression={handleUpdateProgression}
            onStartRecording={handleStartRecording}
            onReorderBlocks={setBlocks}
            onPlayArrangement={() => stringEngine.playFullArrangement(blocks, melodyInstrument, chordsInstrument)}
            melodyInstrument={melodyInstrument}
            setMelodyInstrument={setMelodyInstrument}
            chordsInstrument={chordsInstrument}
            setChordsInstrument={setChordsInstrument}
            melodyVolume={melodyVolume}
            setMelodyVolume={setMelodyVolume}
            melodyMuted={melodyMuted}
            setMelodyMuted={setMelodyMuted}
            chordsVolume={chordsVolume}
            setChordsVolume={setChordsVolume}
            chordsMuted={chordsMuted}
            setChordsMuted={setChordsMuted}
            isRecorded={activeBlock ? activeBlock.notes.length > 0 : false}
            preRecordBpm={preRecordBpm}
            setPreRecordBpm={setPreRecordBpm}
            preRecordTonality={preRecordTonality}
            setPreRecordTonality={setPreRecordTonality}
            preRecordTimeSignature={preRecordTimeSignature}
            setPreRecordTimeSignature={setPreRecordTimeSignature}
          />
        </main>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Componente de Processamento (Terminal Log)
// ─────────────────────────────────────────────────────────
const PROCESSING_MESSAGES = [
  "Preparando áudio gravado...",
  "Ouvindo as notas e detectando o tom...",
  "Analisando padrões harmônicos...",
  "Consultando banco de músicas para referências...",
  "Pensando nos melhores acordes...",
  "Mapeando a estrutura no Piano Roll..."
];

function ProcessingText() {
  const [msgIndex, setMsgIndex] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex(prev => prev + 1);
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  const currentIndex = Math.min(msgIndex, PROCESSING_MESSAGES.length - 1);
  
  return (
    <div className="mt-12 relative w-full max-w-md h-8 flex items-center justify-center font-sans text-xs sm:text-sm text-white/70">
      {PROCESSING_MESSAGES.map((log, i) => {
        let transformClass = "translate-y-4 opacity-0 pointer-events-none"; // futuro
        if (i === currentIndex) {
          transformClass = "translate-y-0 opacity-100"; // atual
        } else if (i < currentIndex) {
          transformClass = "-translate-y-4 opacity-0 pointer-events-none"; // passado
        }

        return (
          <div 
            key={i} 
            className={`absolute w-full text-center transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${transformClass}`}
          >
            {log}
          </div>
        );
      })}
    </div>
  );
}