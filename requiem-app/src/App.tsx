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
import * as Tone from "tone";
import { Midi } from "@tonejs/midi";
import { Upload } from "lucide-react";

import { StudioView } from "./components/StudioView";
import { SearchScreen } from "./components/SearchScreen";
import { ShowcaseScreen } from "./components/ShowcaseScreen";
import type { AppTab } from "./components/BottomNav";
import { generateProgression, warmUpModel, determineNextChord } from "./engine/HarmonyEngine";
import {
  normalizeNotes,
  transposeProgression,
  normalizeProgressionToC,
  getChordPitchClasses
} from "./engine/TonalityAdapter";
import { detectKey, estimateBPM } from "./engine/AudioAnalyzer";
import { extractChordsFromMidi } from "./engine/ChordExtractor";
import { Starfield } from "./components/Starfield";
import { ScoreFollower } from "./engine/ScoreFollower";
import { detectMidiKey } from "./engine/KeyDetector";
import {
  buildSongScore,
  scoreToChordSegments,
  transposeSongScore,
  getSemitoneDifference,
} from "./engine/ScoreBuilder";
import type { SongScore } from "./engine/ScoreBuilder";
import { SHOWCASE_SONGS, findSong } from "./songs/catalog";
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  MÃ¡quina de Estados do fluxo principal
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

export interface ExtraTrack {
  id: string;
  name: string;
  trackType?: "audio" | "midi" | "smart";
  instrument: InstrumentType;
  volume: number;
  muted: boolean;
  noteSequence?: INoteSequence;
}

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

// â”€â”€ Stale-closure-safe label map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const STATE_LABELS: Record<AppState, string> = {
  IDLE: "Iniciar Captura",
  RECORDING: "Gravando Â· Clique para parar",
  REVIEW_RECORDING: "Analisar Ã¡udio gravado?",
  PROCESSING: "Transcrevendo Ã¡udio e gerando harmonia...",
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  Utilidades de conversÃ£o
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  PrÃ©-processamento de notas detectadas
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * PrÃ©-processa as notas vindas do Basic Pitch.
 *
 * 1. Ordena por startTime (Basic Pitch pode retornar fora de ordem).
 * 2. Filtra notas muito curtas (< 80ms â€” ruÃ­do da rede neural).
 * 3. Para notas de MESMO pitch (exatamente), cola fragmentos
 *    separados por gaps < 0.25s (vibrato/tremolo).
 *
 * âš  NÃƒO funde notas de pitches diferentes (Basic Pitch Ã© polifÃ´nico,
 *   notas simultÃ¢neas em pitches distintos sÃ£o legÃ­timas).
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
    // Notas jÃ¡ estÃ£o ordenadas por startTime (herdam do sorted)
    const merged: DetectedNote[] = [{ ...notes[0] }];

    for (let i = 1; i < notes.length; i++) {
      const current = notes[i];
      const last = merged[merged.length - 1];
      const gap = current.startTime - last.endTime;

      if (gap < 0.25) {
        // Mesmo pitch, gap pequeno â†’ colar
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  ConversÃ£o: ProgressÃ£o de acordes â†’ NoteSequence
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * ConstrÃ³i a melodia original como NoteSequence quantizado.
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
 * Sintetiza a progressÃ£o de acordes em notas de harmonia
 * e as mescla com a melodia original em um NoteSequence.
 *
 * Cada acorde da progressÃ£o ocupa um compasso inteiro.
 * As notas do acorde sÃ£o distribuÃ­das numa oitava
 * confortÃ¡vel (MIDI 48â€“60 â†’ C3â€“C4) como um bloco
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  App Component
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function App() {

  // â”€â”€ UI state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isShowcaseOpen, setIsShowcaseOpen] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [qtValue, setQtValue] = useState(4);
  const [utValue, setUtValue] = useState(4);
  const [tonality, setTonality] = useState<string>("AUTO");

  const [appState, setAppState] = useState<AppState>("IDLE");
  const [customSongs, setCustomSongs] = useState<SongManifest[]>([]);
  const [draftManifest, setDraftManifest] = useState<SongManifest | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [preRecordTimeSignature, setPreRecordTimeSignature] = useState({ numerator: 4, denominator: 4 });
  const [preRecordBpm, setPreRecordBpm] = useState<number | "AUTO">("AUTO");
  const [preRecordTonality, setPreRecordTonality] = useState<string>("AUTO");
  const [preRecordTemperature, setPreRecordTemperature] = useState<number>(0.7);
  const [isArrangerOpen, setIsArrangerOpen] = useState(false);

  const [melodyInstrument, setMelodyInstrument] = useState<InstrumentType | "orchestra">("piano");
  const [chordsInstrument, setChordsInstrument] = useState<InstrumentType | "orchestra">("piano");
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number | null>(null);
  
  const [melodyVolume, setMelodyVolume] = useState(1);
  const [melodyMuted, setMelodyMuted] = useState(false);
  const [chordsVolume, setChordsVolume] = useState(1);
  const [chordsMuted, setChordsMuted] = useState(false);
  const [liveChord, setLiveChord] = useState<string>("");
  
  const [blocks, setBlocks] = useState<CompositionBlock[]>([
    { id: "1", name: "Verso 1", notes: [], progression: [], key: "C", bpm: 120, timeSignature: "4/4" }
  ]);
  const [activeBlockId, setActiveBlockId] = useState<string>("1");
  const activeBlock = blocks.find(b => b.id === activeBlockId);

  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("vibe");

  const [activeScore, setActiveScore] = useState<SongScore | null>(null);
  const activeScoreRef = useRef<SongScore | null>(null);
  useEffect(() => {
    activeScoreRef.current = activeScore;
  }, [activeScore]);
  const [activeManifest, setActiveManifest] = useState<SongManifest | null>(null);
  const scoreFollowerRef = useRef<ScoreFollower | null>(null);

  // Local persistence (TODO: replace with API persistence)
  const sessionManifestsRef = useRef<Record<string, SongManifest>>(
    (() => { try { return JSON.parse(localStorage.getItem("requiem.sessionManifests") || "{}"); } catch { return {}; } })()
  );
  const rememberSessionManifest = useCallback((sessionId: string, manifest: SongManifest) => {
    sessionManifestsRef.current = { ...sessionManifestsRef.current, [sessionId]: manifest };
    try { localStorage.setItem("requiem.sessionManifests", JSON.stringify(sessionManifestsRef.current)); } catch (e) { console.warn("Failed to persist session manifests", e); }
  }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("requiem.customSongs");
      if (saved) setCustomSongs(JSON.parse(saved));
      const draft = localStorage.getItem("requiem.draftManifest");
      if (draft) setDraftManifest(JSON.parse(draft));
    } catch (e) { console.warn("Failed to load local musicians", e); }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("requiem.customSongs", JSON.stringify(customSongs)); } catch (e) { console.warn("Failed to persist custom songs", e); }
  }, [customSongs]);
  useEffect(() => {
    try {
      if (draftManifest) localStorage.setItem("requiem.draftManifest", JSON.stringify(draftManifest));
      else localStorage.removeItem("requiem.draftManifest");
    } catch (e) { console.warn("Failed to persist draft", e); }
  }, [draftManifest]);

  const stringEngine = useStringEngine();
  const { 
    playMIDINote, 
    playChord, 
    stopAll, 
    isReady,
    loadOrchestraInstrument,
    unloadOrchestraInstrument,
    activeOrchestraInstruments
  } = stringEngine;

  // â”€â”€ Session state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // Reset followers/scores by default when switching sessions unless explicitly set by Showcase
    setActiveScore(null);
    setActiveManifest(sessionManifestsRef.current[session.id] ?? null);
    if (scoreFollowerRef.current) scoreFollowerRef.current = null;

    if (session.compositionData && session.compositionData.length > 0) {
      // Rebuild blocks from persisted data (no noteSequence â€” rebuilt on first play)
      const restored: CompositionBlock[] = session.compositionData.map(b => ({
        id: b.id,
        name: b.name,
        notes: b.notes as DetectedNote[],
        progression: b.progression.map(segment => ({ ...segment, velocity: 0.7 })),
        key: b.key,
        bpm: b.bpm,
        timeSignature: b.timeSignature,
        noteSequence: b.notes.length > 0 ? (() => {
          try {
            const restoredProgression = b.progression.map(segment => ({ ...segment, velocity: 0.7 }));
            return progressionToNoteSequence(
              restoredProgression,
              b.notes as DetectedNote[],
              b.bpm,
              parseInt(b.timeSignature.split('/')[1] || '4')
            );
          } catch { return undefined; }
        })() : undefined,
      }));
      setBlocks(restored);
      setActiveBlockId(restored[0].id);
      setActiveTab("vibe");

      // Restore UI settings from the block
      setPreRecordTimeSignature({ 
        numerator: parseInt(restored[0].timeSignature.split('/')[0]) || 4, 
        denominator: parseInt(restored[0].timeSignature.split('/')[1]) || 4 
      });
      setPreRecordBpm(restored[0].bpm);
      setPreRecordTonality(restored[0].key);

      // Check if this is a showcase session or custom session to reload MIDI
      const targetManifest = SHOWCASE_SONGS.find(s => s.title === session.title) || sessionManifestsRef.current[session.id];
      if (targetManifest && targetManifest.midiUrl) {
         (async () => {
             try {
               let parsedMidi: any;
               if (targetManifest.midiUrl.startsWith("data:")) {
                 const res = await fetch(targetManifest.midiUrl);
                 const buffer = await res.arrayBuffer();
                 parsedMidi = new Midi(buffer);
               } else {
                 parsedMidi = await Midi.fromUrl(targetManifest.midiUrl);
               }
               let score = buildSongScore(parsedMidi as any, targetManifest);
               const targetKey = restored[0]?.key || targetManifest.key;
               if (targetKey && targetKey !== score.key) {
                 const semitones = getSemitoneDifference(score.key, targetKey);
                 score = transposeSongScore(score, semitones, targetKey);
               }
               setActiveScore(score);
               scoreFollowerRef.current = new ScoreFollower(score);
               console.log("[handleSessionChange] Restored MIDI:", score);
             } catch (err) {
               console.error("Failed to restore midi", err);
             }
         })();
      }

    } else {
      // New empty session â€” reset to default
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
      
      // Reset pre-record settings for a new normal musician
      setPreRecordTimeSignature({ numerator: 4, denominator: 4 });
      setPreRecordBpm("AUTO");
      setPreRecordTonality("AUTO");
    }
  }, []);

  const handleSessionRename = useCallback((id: string, newTitle: string) => {
    setActiveSession(prev => prev?.id === id ? { ...prev, title: newTitle } : prev);
  }, []);

  // â”€â”€ Refs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const appStateRef = useRef<AppState>("IDLE");
  const playingIndexRef = useRef<number | null>(null);
  const recordedBpmRef = useRef<number>(120);

  // Manter ref sincronizado com state (para closures)
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  // â”€â”€ Hooks personalizados â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const pitchDetector = usePitchDetector();

  // â”€â”€ Sincronizar Volume/Mute com Engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    stringEngine.setTrackVolume(0, melodyVolume);
    stringEngine.setTrackMute(0, melodyMuted);
  }, [melodyVolume, melodyMuted, stringEngine]);

  useEffect(() => {
    stringEngine.setTrackVolume(1, chordsVolume);
    stringEngine.setTrackMute(1, chordsMuted);
  }, [chordsVolume, chordsMuted, stringEngine]);

  // â”€â”€ Sincronizar Bloco Ativo com Global State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (activeBlock) {
      setBpm(activeBlock.bpm);
      setTonality(activeBlock.key);
      const [qt, ut] = activeBlock.timeSignature.split('/');
      setQtValue(parseInt(qt) || 4);
      setUtValue(parseInt(ut) || 4);
    }
  }, [activeBlockId]);

  // PrÃ©-carregar modelo LSTM em background ao montar o app
  useEffect(() => { warmUpModel(); }, []);

  // â”€â”€ Acompanhamento ao Vivo (PoC) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const liveChordHistoryRef = useRef<string[]>([]);
  const lastChordTimeRef = useRef<number>(0);
  const lastPlayedChordRef = useRef<number[]>([]);
  const lastPitchClassRef = useRef<string | null>(null);
  const stableCountRef = useRef<number>(0);
  const firedForCurrentPitchRef = useRef<boolean>(false);
  const lastPlayedChordNameRef = useRef<string | null>(null);
  const chordCooldownRef = useRef<number>(0);
  const silenceStartRef = useRef<number | null>(null);
  const liveNoteRef = useRef<string>("");
  const lastChordChangeTimeRef = useRef<number>(0);
  const lastPadRetriggerTimeRef = useRef<number>(0);
  const liveMelodyHistoryRef = useRef<number[]>([]);

  const [debugLog, setDebugLog] = useState<string>("Idle");

  // Manter a ref sempre sincronizada com a string state mais recente
  useEffect(() => {
    liveNoteRef.current = pitchDetector.currentNote;
  }, [pitchDetector.currentNote]);

  // useEffect apenas para iniciar/parar o polling
  useEffect(() => {
    if (appState !== "RECORDING" || !pitchDetector.isListening) {
      liveChordHistoryRef.current = [];
      setLiveChord("");
      stopAll();
      lastPlayedChordRef.current = [];
      lastPitchClassRef.current = null;
      stableCountRef.current = 0;
      firedForCurrentPitchRef.current = false;
      lastPlayedChordNameRef.current = null;
      silenceStartRef.current = null;
      lastChordChangeTimeRef.current = 0;
      lastPadRetriggerTimeRef.current = 0;
      liveMelodyHistoryRef.current = [];
      setDebugLog("Stopped");
      return;
    }

    setDebugLog("Polling started...");

    // Polling ativo a cada 100ms â€” nÃ£o depende de re-renders do React
    const interval = setInterval(() => {
      const now = performance.now();
      const noteName = liveNoteRef.current;
      const follower = scoreFollowerRef.current;
      const score = activeScoreRef.current || activeScore;

      // â”€â”€ MODO 1: Score Follower (MÃºsica de referÃªncia carregada) â”€â”€
      if (follower && score) {
        // Flywheel advance
        let snapshot = follower.tick(now);

        // â”€â”€ SilÃªncio â”€â”€
        if (!noteName || noteName === "") {
          if (!silenceStartRef.current) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current > 2000) {
            // Se o silÃªncio for longo (2s+), relaxa o follower, mas NÃƒO para o som,
            // permitindo que o pad continue sustentando a harmonia atÃ© a prÃ³xima nota.
            follower.relax();
          }
          // NÃ£o dÃ¡ return aqui para permitir o retrigger do pad
        } else {
          silenceStartRef.current = null;
          const pitchClassStr = noteName.replace(/[0-9-]/g, '');
          if (pitchClassStr) {
            if (pitchClassStr === lastPitchClassRef.current) {
              stableCountRef.current++;
            } else {
              lastPitchClassRef.current = pitchClassStr;
              stableCountRef.current = 1;
              firedForCurrentPitchRef.current = false;
            }

            if (stableCountRef.current === 2 && !firedForCurrentPitchRef.current) {
              firedForCurrentPitchRef.current = true; // We registered this onset
              
              const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
              const pcVal = NOTE_NAMES.indexOf(pitchClassStr);
              if (pcVal !== -1) {
                snapshot = follower.observeOnset(pcVal, now);
              }
            }
          }
        }

        // Check chord change from follower
        if (snapshot.chordIndex >= 0) {
          const nextChord = score.chords[snapshot.chordIndex]?.symbol;
          if (nextChord && nextChord !== lastPlayedChordNameRef.current) {
            
            setLiveChord(nextChord);
            lastPlayedChordNameRef.current = nextChord;
            
            stopAll(true);
            chordCooldownRef.current = now;
            lastPadRetriggerTimeRef.current = now;
            
            const pcs = getChordPitchClasses(nextChord);
            const newPitches = pcs.map(pc => 48 + pc);
            lastPlayedChordRef.current = newPitches;
            
            setDebugLog(`TRACKING: ${nextChord} (Conf: ${snapshot.confidence.toFixed(2)})`);
            
            const chordObj = score.chords[snapshot.chordIndex];
            const pattern = chordObj?.pattern;
            const isPiano = chordsInstrument === "piano" || (chordsInstrument === "orchestra" && activeOrchestraInstruments.length === 0);

            if (isPiano && pattern && pattern.length > 0) {
              const beatSec = score.msPerBeat / 1000;
              for (const n of pattern) {
                // n.interval was stored relative to root in octave 3
                const pitch = 48 + chordObj.root + n.interval;
                playMIDINote(pitch, n.duration * beatSec, n.velocity, "piano", n.timeOffset * beatSec);
              }
            } else {
              for (const p of newPitches) {
                playMIDINote(p, 6, 0.8, chordsInstrument);
              }
            }
          } else if (nextChord === lastPlayedChordNameRef.current && (now - lastPadRetriggerTimeRef.current > 2500)) {
             // Retrigger contínuo (Seamless Pad Loop ou Arpejo contínuo)
             lastPadRetriggerTimeRef.current = now;
             const chordObj = score.chords[snapshot.chordIndex];
             const pattern = chordObj?.pattern;
             const isPiano = chordsInstrument === "piano" || (chordsInstrument === "orchestra" && activeOrchestraInstruments.length === 0);

             if (isPiano && pattern && pattern.length > 0) {
               setDebugLog(`Retrigger Arpeggio: ${lastPlayedChordNameRef.current}`);
               const beatSec = score.msPerBeat / 1000;
               for (const n of pattern) {
                 const pitch = 48 + chordObj.root + n.interval;
                 playMIDINote(pitch, n.duration * beatSec, n.velocity, "piano", n.timeOffset * beatSec);
               }
             } else if (lastPlayedChordRef.current && lastPlayedChordRef.current.length > 0) {
               setDebugLog(`Retrigger Pad: ${lastPlayedChordNameRef.current}`);
               for (const p of lastPlayedChordRef.current) {
                 playMIDINote(p, 4, 0.6, chordsInstrument);
               }
             }
          }
        }
        return; // Retorna para não cair no modo 2
      }

      // â”€â”€ MODO 2: GeraÃ§Ã£o Livre (DetermineNextChord) â”€â”€
      
      // CÃ¡lculo de duraÃ§Ã£o do compasso
      const bpm = typeof preRecordBpm === "number" ? preRecordBpm : 0;
      const measureDurationMs = bpm > 0 
        ? (60000 / bpm) * (4 / preRecordTimeSignature.denominator) * preRecordTimeSignature.numerator
        : 0;

      // â”€â”€ SilÃªncio â”€â”€
      if (!noteName || noteName === "") {
        if (lastPlayedChordNameRef.current) {
          if (!silenceStartRef.current) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current > 500) {
            stopAll();
            setLiveChord("");
            lastPlayedChordNameRef.current = null;
            lastPitchClassRef.current = null;
            firedForCurrentPitchRef.current = false;
            stableCountRef.current = 0;
            silenceStartRef.current = null;
            lastChordChangeTimeRef.current = 0;
            setDebugLog("Silence - stopped all");
          }
        }
        return;
      }
      silenceStartRef.current = null;

      // Anti-feedback
      if (now - chordCooldownRef.current < 300) return;

      const pitchClass = noteName.replace(/[0-9-]/g, '');
      if (!pitchClass) return;

      if (pitchClass === lastPitchClassRef.current) {
        stableCountRef.current++;
        setDebugLog(`Note: ${pitchClass} (Stable: ${stableCountRef.current})`);
      } else {
        lastPitchClassRef.current = pitchClass;
        stableCountRef.current = 1;
        firedForCurrentPitchRef.current = false;
        
        // Registrar a nova nota na melodia real (com oitava)
        try {
          const midiVal = Tone.Frequency(noteName).toMidi();
          liveMelodyHistoryRef.current.push(midiVal);
          if (liveMelodyHistoryRef.current.length > 8) {
            liveMelodyHistoryRef.current.shift();
          }
        } catch (e) {
          // ignora se parse falhar
        }

        setDebugLog(`Note changed to: ${pitchClass}`);
        return;
      }

      if (firedForCurrentPitchRef.current) {
        // Retrigger contÃ­nuo (Seamless Pad Loop)
        if (now - lastPadRetriggerTimeRef.current > 2500) {
          lastPadRetriggerTimeRef.current = now;
          if (lastPlayedChordRef.current && lastPlayedChordRef.current.length > 0) {
            setDebugLog(`Retrigger Pad: ${lastPlayedChordNameRef.current}`);
            for (const p of lastPlayedChordRef.current) {
              // Tocamos sem dar stopAll() para mesclar o som!
              playMIDINote(p, 4, 0.6, chordsInstrument);
            }
          }
        }
        return;
      }
      
      if (stableCountRef.current < 2) return;

      // â”€â”€ QuantizaÃ§Ã£o por Compasso â”€â”€
      if (measureDurationMs > 0 && lastChordChangeTimeRef.current > 0) {
        if (now - lastChordChangeTimeRef.current < measureDurationMs) {
          // Ainda estamos dentro da duraÃ§Ã£o do compasso atual!
          // Aguardamos atÃ© cruzar a fronteira do compasso para liberar a troca de acorde.
          return;
        }
      }

      const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const midi = NOTE_NAMES.indexOf(pitchClass);
      if (midi === -1) return;
      
      // Se nÃ£o houver histÃ³rico de melodia, usa a fake note
      let melodyNotesToPass: DetectedNote[] = [];
      if (liveMelodyHistoryRef.current.length === 0) {
        melodyNotesToPass = [{ pitch: midi + 60, startTime: 0, endTime: 0.1, amplitude: 0.8 }];
      } else {
        melodyNotesToPass = liveMelodyHistoryRef.current.map((p, idx) => ({
          pitch: p,
          startTime: idx * 0.5,
          endTime: (idx + 1) * 0.5,
          amplitude: 0.8
        }));
      }
      
      try {
        const result = determineNextChord(liveChordHistoryRef.current, melodyNotesToPass, 0, 0.5, preRecordTemperature, preRecordTonality);
        if (result.chord) {
          if (result.chord === lastPlayedChordNameRef.current) {
            firedForCurrentPitchRef.current = true;
            return;
          }

          firedForCurrentPitchRef.current = true;
          lastChordChangeTimeRef.current = now;
          lastPadRetriggerTimeRef.current = now;
          liveChordHistoryRef.current.push(result.chord);
          if (liveChordHistoryRef.current.length > 8) liveChordHistoryRef.current.shift();
          
          setLiveChord(result.chord);
          lastPlayedChordNameRef.current = result.chord;
          
          stopAll(true);
          chordCooldownRef.current = now;
          
          const pcs = getChordPitchClasses(result.chord);
          const newPitches = pcs.map(pc => 48 + pc);
          lastPlayedChordRef.current = newPitches;
          
          setDebugLog(`TRIGGER CHORD: ${result.chord} -> Pitches: ${newPitches.join(',')}`);
          
          for (const p of newPitches) {
            playMIDINote(p, 6, 0.8, chordsInstrument);
          }
        } else {
          setDebugLog(`DetermineNextChord returned null! weights exist?`);
        }
      } catch(e) {
        setDebugLog(`Error in determineNextChord: ${(e as Error).message}`);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [appState, pitchDetector.isListening, playMIDINote, chordsInstrument, stopAll]);

  // â”€â”€ Cleanup ao desmontar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    return () => {
      if (pitchDetector.isListening) pitchDetector.stopListening();
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // â”€â”€ Controle de Playback por item â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const playSequence = useCallback(async (index: number, seq: INoteSequence, offset: number = 0, melodyInst: InstrumentType = "piano", chordsInst: InstrumentType = "piano") => {
    try {
      if (playingIndexRef.current === index) {
        stopAll();
        setPlayingIndex(null);
        playingIndexRef.current = null;
        return;
      }

      // Parar qualquer som anterior
      stopAll();

      setPlayingIndex(index);
      playingIndexRef.current = index;

      await stringEngine.playSequence(seq, offset, melodyInst, chordsInst);

      // Calcular a duraÃ§Ã£o aproximada para liberar o botÃ£o
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

  const handleLoadMidi = useCallback(async (url: string, title: string, id: string, customManifest?: SongManifest) => {
    try {
      const res = await fetch(url);
      const buffer = await res.arrayBuffer();
      const parsedMidi = new Midi(buffer);
      console.log("[MIDI Load ToneJS]", title, parsedMidi);
      
      let manifest = customManifest || SHOWCASE_SONGS.find(s => s.id === id);
      if (!manifest) {
        console.error("Song manifest not found for id:", id);
        return;
      }

      // If it's a completely new file with no predefined manifest, infer missing fields
      if (!manifest.bpm) {
        manifest = { ...manifest, bpm: parsedMidi.header.tempos.length > 0 ? parsedMidi.header.tempos[0].bpm : 120 };
      }
      if (!manifest.meter || !manifest.meter.numerator) {
        const ts = parsedMidi.header.timeSignatures.length > 0 ? parsedMidi.header.timeSignatures[0] : null;
        manifest = { ...manifest, meter: ts ? { numerator: ts.timeSignature[0], denominator: ts.timeSignature[1] } : { numerator: 4, denominator: 4 } };
      }

      if (!manifest.key || manifest.key === "AUTO") {
        const detected = detectMidiKey(parsedMidi as any);
        console.log("[Key Detection]", detected);
        manifest = { ...manifest, key: detected?.key ?? "C" };
      }

      const sessionTitle = title;
      try {
        const { session } = await apiCreateSession(sessionTitle);
        rememberSessionManifest(session.id, manifest);
        handleSessionChange(session);
      } catch (e) {
        console.warn("Failed to create session for MIDI, continuing locally:", e);
      }

      const score = buildSongScore(parsedMidi as any, manifest);
      setActiveScore(score);
      setActiveManifest(manifest);
      if (manifest.id.startsWith("custom-")) {
        // Keep the draft in sync with inferred BPM/meter so publishing saves the real config
        setDraftManifest(prev => (prev && prev.id === manifest!.id ? manifest! : prev));
      }
      scoreFollowerRef.current = new ScoreFollower(score);

      const bpm = manifest.bpm;
      const num = manifest.meter.numerator;
      const den = manifest.meter.denominator;

      const nsNotes: NoteSequence.INote[] = [];
      parsedMidi.tracks.forEach(track => {
        track.notes.forEach(note => {
          nsNotes.push(NoteSequence.Note.create({
            pitch: note.midi,
            startTime: note.time,
            endTime: note.time + note.duration,
            velocity: Math.floor(note.velocity * 127),
          }));
        });
      });

      const stepsPerSecond = sequences.stepsPerQuarterToStepsPerSecond(4, bpm);
      nsNotes.forEach(n => {
        if (n.startTime !== undefined && n.endTime !== undefined) {
          n.quantizedStartStep = Math.round(n.startTime * stepsPerSecond);
          n.quantizedEndStep = Math.max(n.quantizedStartStep + 1, Math.round(n.endTime * stepsPerSecond));
        }
      });

      const ns = NoteSequence.create({
        notes: nsNotes,
        tempos: [{ time: 0, qpm: bpm }],
        totalQuantizedSteps: Math.max(...nsNotes.map(n => n.quantizedEndStep || 0)),
      });

      const extractedProgression = scoreToChordSegments(score);

      const midiBlock: CompositionBlock = {
        id: Date.now().toString(),
        name: "Blueprint (MIDI)",
        notes: [],
        progression: extractedProgression,
        key: manifest.key,
        bpm: bpm,
        timeSignature: `${num}/${den}`,
        noteSequence: ns,
        newlyGenerated: true
      };

      setBlocks([midiBlock]);
      setActiveBlockId(midiBlock.id);
      
      setPreRecordTimeSignature({ numerator: num, denominator: den });
      setPreRecordBpm(bpm);
      setPreRecordTonality(manifest.key);

      setActiveTab("vibe");
      
    } catch (err) {
      console.error("Failed to load MIDI:", err);
    }
  }, [handleSessionChange, rememberSessionManifest]);

  const handleDropMidi = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (/\.midi?$/i.test(file.name)) {
        const title = file.name.replace(/\.midi?$/i, '');
        const tempId = `custom-${Date.now()}`;

        // Data URL (not blob URL) so the MIDI survives reloads in localStorage
        const reader = new FileReader();
        reader.onload = () => {
          const url = reader.result as string;
          const tempManifest: SongManifest = {
            id: tempId,
            title: title,
            artist: "M\u00fasico Customizado",
            midiUrl: url,
            coverUrl: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=400",
            key: "AUTO", // detected from the MIDI in handleLoadMidi
            meter: { numerator: 0, denominator: 0 }, // inferred from MIDI in handleLoadMidi
            lockMeter: true,
            bpm: 0, // inferred from MIDI in handleLoadMidi
            midiBeatInQuarters: 1,
          };

          setDraftManifest(tempManifest);
          setActiveManifest(tempManifest);
          handleLoadMidi(url, title, tempId, tempManifest);
        };
        reader.readAsDataURL(file);
      }
    }
  }, [handleLoadMidi]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  }, []);

  // â”€â”€ Ring Click (Cancelar ou Iniciar) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleRingClick = useCallback(async () => {
    if (appState === "RECORDING") {
      await pitchDetector.pauseListening();
      setAppState("REVIEW_RECORDING");
    } else if (appState === "PROCESSING" || appState === "REVIEW_RECORDING") {
      pitchDetector.cancelListening();
      setAppState("IDLE");
    } else if (appState === "IDLE") {
      // Iniciar captaÃ§Ã£o
      setBlocks(prev => prev.map(b => 
        b.id === activeBlockId ? { ...b, notes: [], progression: [], noteSequence: undefined, newlyGenerated: false } : b
      ));
      setActiveTab("vibe");
      
      setAppState("RECORDING");
      await pitchDetector.prepareListening();
      pitchDetector.startRecording();
    }
  }, [appState, pitchDetector, activeBlockId]);

  // â”€â”€ Handler principal do botÃ£o â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleMainButtonClick = useCallback(async () => {
    const current = appStateRef.current;
    setErrorMsg(null);

    switch (current) {
      // â”€â”€ IDLE â†’ RECORDING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      case "IDLE": {
        setAppState("RECORDING");
        // O WebView2 / Navegador exige destravamento explÃ­cito via interaÃ§Ã£o de clique
        if (Tone.context.state !== "running") {
          await Tone.start();
        }
        await pitchDetector.prepareListening(); // Prepara mic (pede permissÃ£o)
        pitchDetector.startRecording(); // Inicia imediatamente
        break;
      }

      // â”€â”€ RECORDING â†’ (agora Ã© capturado pelo anel, mas deixamos vazio por seguranÃ§a)
      case "RECORDING":
        break;

      // â”€â”€ REVIEW_RECORDING â†’ PROCESSING â†’ PLAYING_AND_SHOWING â”€
      case "REVIEW_RECORDING": {
        await processRecording();
        break;
      }

      // COUNT_IN e PROCESSING: nÃ£o fazem nada no clique
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm, qtValue, utValue, tonality, activeBlockId, playSequence]);

  const processRecording = async () => {
        setAppState("PROCESSING");
        // Yield inicial para garantir a montagem do componente ProcessingText na UI
        await new Promise(resolve => setTimeout(resolve, 50));

        // 2) A rede neural do Basic Pitch avalia o Ã¡udio (demora alguns segundos)
        const detectedNotes = await pitchDetector.processPausedAudio();

        if (detectedNotes.length === 0) {
          setErrorMsg("Nenhuma nota detectada. Tente novamente.");
          setAppState("IDLE");
          return;
        }

        try {
          // Yield para liberar a UI antes do processamento intensivo
          await new Promise(resolve => setTimeout(resolve, 50));

          // 3) PrÃ©-processar notas e remover o silÃªncio inicial (trim)
          let gluedNotes = glueNotes(detectedNotes);
          
          if (gluedNotes.length > 0) {
            const tMin = Math.min(...gluedNotes.map(n => n.startTime));
            gluedNotes = gluedNotes.map(n => ({
              ...n,
              startTime: n.startTime - tMin,
              endTime: n.endTime - tMin,
            }));
            const tMax = Math.max(...gluedNotes.map(n => n.endTime));
            console.log(`[Pipeline] Range temporal ajustado (sem folga inicial): 0.000s â†’ ${tMax.toFixed(3)}s`);
          }

          // Yield antes de algoritmos custosos de anÃ¡lise harmÃ´nica
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

          console.log(`[Pipeline] Notas brutas: ${detectedNotes.length} â†’ ApÃ³s glue: ${gluedNotes.length}`);
          console.log(`[Pipeline] Key detectada: ${detectedKey} | BPM estimado: ${estimatedBpm}`);

          // 5) Normalizar notas para C Major (Local Space) usando a tonalidade detectada
          const normalizedNotes = normalizeNotes(gluedNotes, detectedKey);

          // Yield antes de consultar a matriz de Markov e iterar no grafo
          await new Promise(resolve => setTimeout(resolve, 50));

          // 6) Gerar progressÃ£o via HarmonyEngine Neural LSTM (opera em C Major)
          const rawProgression = await generateProgression(
            normalizedNotes,
            estimatedBpm,
            preRecordTimeSignature.numerator, // 1 acorde por compasso
            preRecordTimeSignature.numerator,
            preRecordTimeSignature.denominator,
            "C",
          );

          console.log(`[Pipeline] ProgressÃ£o bruta (C): [${rawProgression.join(", ")}]`);

          // 7) Transpor progressÃ£o de volta para a tonalidade detectada
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

          console.log(`[Pipeline] ProgressÃ£o final (${tonality}): [${progression.map(p => p.chord).join(", ")}]`);

          // Yield antes da sÃ­ntese final de NoteSequence
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

          // 10) Persistir no backend â€” cria sessÃ£o se nÃ£o houver uma ativa
          setTimeout(async () => {
            try {
              let session = activeSessionRef.current;
              if (!session) {
                // Gera tÃ­tulo musical Ãºnico: "Am Â· Dm â€“ G â€“ C Â· 19:31"
                const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                const chordPreview = progression.map(p => p.chord).slice(0, 3).join(' â€“ ');
                const sessionTitle = `${detectedKey} Â· ${chordPreview} Â· ${timeStr}`;

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
              console.log('[Requiem] ComposiÃ§Ã£o salva na sessÃ£o', session.id);
            } catch (saveErr) {
              console.warn('[Requiem] NÃ£o foi possÃ­vel salvar no backend:', saveErr);
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

  // â”€â”€ Atualizar ProgressÃ£o â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
          console.error("Erro ao atualizar progressÃ£o:", err);
          return b;
        }
      });
      updatedBlocks = next;
      return next;
    });
    
    // Reiniciar player se estiver tocando
    if (playingIndexRef.current === 0) {
       stopAll();
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
        console.warn('[Requiem] Auto-save progressÃ£o falhou:', e);
      }
    }, 0);
  }, [bpm, utValue, activeBlockId, stringEngine]);

  // O efeito colateral reativo de BPM foi removido para evitar estiramentos cumulativos da melodia.

  // â”€â”€ DerivaÃ§Ãµes visuais â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const isActive = appState !== "IDLE";
  const isRecording = appState === "RECORDING";
  const isProcessing = appState === "PROCESSING";
  const isButtonDisabled = isProcessing || !isReady;

  // Auto-switch to Studio removed to prioritize live accompaniment

  const handleStartRecording = useCallback(async () => {
    // Apaga apenas o bloco ativo para regravar do zero e remove a flag de animaÃ§Ã£o
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
      name: `SeÃ§Ã£o ${blocks.length + 1}`,
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
      // Se apagar o ativo, ativa o primeiro disponÃ­vel (se houver)
      if (idToRemove === activeBlockId && next.length > 0) {
        setActiveBlockId(next[0].id);
      }
      return next.length > 0 ? next : [{ id: Date.now().toString(), name: "SeÃ§Ã£o 1", notes: [], progression: [], key: "C", bpm: 120, timeSignature: `${preRecordTimeSignature.numerator}/${preRecordTimeSignature.denominator}` }];
    });
  }, [activeBlockId, preRecordTimeSignature]);

  const handleRenameBlock = useCallback((id: string, newName: string) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, name: newName } : b));
  }, []);

  // Setters que tambÃ©m atualizam o bloco atual
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
      
      // Auto-save no backend apÃ³s escalar a melodia
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
       stopAll();
       setPlayingIndex(null);
       playingIndexRef.current = null;
    }
  }, [activeBlockId, stopAll]);

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
    setPreRecordTonality(newKey);

    // Stop currently sounding notes so nothing hangs in the previous key
    stopAll(true);
    lastPlayedChordNameRef.current = null;
    lastPlayedChordRef.current = [];

    // ── CASE 1: If there is an active MIDI reference score loaded ──
    const currentScore = activeScoreRef.current;
    if (currentScore) {
      const targetKey = newKey === "AUTO"
        ? (currentScore.originalKey && currentScore.originalKey !== "AUTO" ? currentScore.originalKey : "C")
        : newKey;

      const semitones = getSemitoneDifference(currentScore.key, targetKey);

      if (semitones !== 0 || currentScore.key !== targetKey) {
        const transposedScore = transposeSongScore(currentScore, semitones, targetKey);
        setActiveScore(transposedScore);
        activeScoreRef.current = transposedScore;
        scoreFollowerRef.current = new ScoreFollower(transposedScore);
        console.log(`[Tonality Change] Transposed MIDI from ${currentScore.key} to ${targetKey} (${semitones > 0 ? '+' : ''}${semitones} semitones)`);

        if (activeManifest) {
          const updatedManifest = { ...activeManifest, key: targetKey };
          setActiveManifest(updatedManifest);
          if (activeSessionRef.current) {
            rememberSessionManifest(activeSessionRef.current.id, updatedManifest);
          }
          if (updatedManifest.id.startsWith("custom-")) {
            setDraftManifest(prev => (prev && prev.id === updatedManifest.id ? updatedManifest : prev));
          }
        }

        const newProgression = scoreToChordSegments(transposedScore);

        setBlocks(prev => prev.map(b => {
          if (b.id !== activeBlockId && !b.name.includes("MIDI") && !b.progression.length) return b;

          let newNs = b.noteSequence;
          if (newNs && newNs.notes && newNs.notes.length > 0 && semitones !== 0) {
            const transposedNotes = newNs.notes.map(n => ({
              ...n,
              pitch: Math.max(0, Math.min(127, (n.pitch ?? 60) + semitones)),
            }));
            newNs = NoteSequence.create({
              ...newNs,
              notes: transposedNotes,
            });
          }

          return {
            ...b,
            key: targetKey,
            progression: newProgression,
            noteSequence: newNs,
          };
        }));
      }
      return;
    }

    // ── CASE 2: No MIDI score, but standard composition blocks ──
    if (newKey !== "AUTO") {
      setBlocks(prev => prev.map(b => {
        if (b.id !== activeBlockId) return b;
        
        try {
          if (b.notes.length > 0) {
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
          } else {
            return { ...b, key: newKey };
          }
        } catch (err) {
          console.error("Erro ao transpor tonalidade:", err);
          return { ...b, key: newKey };
        }
      }));
    }
  }, [activeBlockId, activeManifest, rememberSessionManifest, stopAll]);

  return (
    <div className="flex h-screen w-full bg-black text-white overflow-hidden font-sans antialiased">

      {/* â”€â”€â”€ SIDEBAR (Present on all views) â”€â”€â”€ */}
      <Sidebar
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        activeSessionId={activeSession?.id ?? null}
        onSessionChange={handleSessionChange}
        onSessionRename={handleSessionRename}
        activeSession={activeSession}
        onSearchClick={() => setIsSearchOpen(true)}
        onShowcaseClick={() => setIsShowcaseOpen(true)}
      />

      {isSearchOpen && (
        <SearchScreen 
          onClose={() => setIsSearchOpen(false)}
          onSessionSelect={(session) => {
            handleSessionChange(session);
            setIsSearchOpen(false);
          }}
        />
      )}

      {isShowcaseOpen && (
        <ShowcaseScreen
          onClose={() => setIsShowcaseOpen(false)}
          onLoadMidi={handleLoadMidi}
          customSongs={customSongs}
        />
      )}

      {/* â”€â”€â”€ VIBE VIEW â”€â”€â”€ */}
      {activeTab === "vibe" && (
        <main className="relative flex-1 flex flex-col justify-between p-8 overflow-hidden bg-black">

          {draftManifest && (
            <div className="absolute top-6 right-20 z-50 animate-fade-in group">
              <button 
                onClick={() => {
                  const toPublish = activeManifest && activeManifest.id === draftManifest.id ? activeManifest : draftManifest;
                  setCustomSongs(prev => [...prev.filter(s => s.id !== toPublish.id), toPublish]);
                  setDraftManifest(null);
                }}
                className="bg-white/10 hover:bg-white/20 text-white p-3 rounded-full transition-all border border-white/20"
                aria-label="Publicar músico"
              >
                <Upload className="w-5 h-5" />
              </button>
              <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-black/80 px-2 py-1 rounded text-xs whitespace-nowrap transition-opacity pointer-events-none border border-white/10">
                Publicar músico
              </div>
            </div>
          )}

          {/* Unified Animated/Static Stars Background */}
          <Starfield animated={appState === "PROCESSING"} numStars={250} />

          {/* Corpo Central */}
          <div className="relative z-10 flex flex-col flex-1 items-center justify-center text-center overflow-hidden">
            <div className="fixed top-0 left-0 p-4 bg-black/80 text-xs font-mono text-green-400 z-50 text-left whitespace-pre">
              AudioContext: {Tone.context.state}{"\n"}
              Mic Status: {pitchDetector.isListening ? "Listening" : "Off"} | AppState: {appState}{"\n"}
              Loaded: {activeOrchestraInstruments.join(", ") || "None"}{"\n"}
              Raw Note: {pitchDetector.currentNote || "SILENCE"}{"\n"}
              State Log: {debugLog}
              
              <button 
                className="mt-2 bg-white text-black px-2 py-1 rounded block"
                onClick={async () => {
                  await Tone.start();
                  // Teste do playMIDINote
                  playMIDINote(60, 1, 1, "orchestra");
                }}
              >
                TEST SOUND
              </button>
            </div>
            
            <div className="w-full max-w-4xl px-4 flex flex-col items-center transition-all duration-500 ease-in-out">

              <div className={`relative flex items-center justify-center transition-all duration-500 ease-in-out ${isArrangerOpen ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'}`}>
                <DynamicRing 
                  isActive={isActive} 
                  currentFrequency={pitchDetector.currentFrequency}
                  currentNote={liveChord || pitchDetector.currentNote}
                  onClick={handleRingClick}
                  onDrop={handleDropMidi}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  isDragActive={isDragActive}
                />
              </div>

              <div className={`w-full flex flex-col items-center transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isActive ? 'opacity-0 h-0 scale-90 pointer-events-none' : 'opacity-100 h-auto scale-100'}`}>
                <h1 className={`text-3xl sm:text-4xl font-normal tracking-tight text-white/90 mb-10 drop-shadow-md transition-all duration-500 ease-in-out ${isArrangerOpen ? 'opacity-0 translate-y-[-10px] pointer-events-none' : 'opacity-100 translate-y-0'}`}>
                  {activeManifest
                    ? (activeManifest.id.startsWith("custom-") ? activeManifest.title : `${activeManifest.artist} - ${activeManifest.title}`)
                    : "Improviso Livre"}
                </h1>

                <RecordControls
                  appState={appState}
                  isRecording={isRecording}
                  isProcessing={isProcessing}
                  currentFrequency={pitchDetector.currentFrequency}
                  currentNote={pitchDetector.currentNote}
                  stateLabels={STATE_LABELS}
                  preRecordTimeSignature={preRecordTimeSignature}
                  setPreRecordTimeSignature={setPreRecordTimeSignature}
                  preRecordBpm={preRecordBpm}
                  setPreRecordBpm={setPreRecordBpm}
                  preRecordTonality={preRecordTonality}
                  setPreRecordTonality={handleSetTonality}
                  preRecordTemperature={preRecordTemperature}
                  setPreRecordTemperature={setPreRecordTemperature}
                  loadOrchestraInstrument={loadOrchestraInstrument}
                  unloadOrchestraInstrument={unloadOrchestraInstrument}
                  activeOrchestraInstruments={activeOrchestraInstruments}
                  onArrangerOpenChange={setIsArrangerOpen}
                  chordsInstrument={chordsInstrument}
                  setChordsInstrument={setChordsInstrument}
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

      {/* â”€â”€â”€ STUDIO VIEW â”€â”€â”€ */}
      {activeTab === "studio" && activeBlock && (
        <main className="flex-1 flex flex-col overflow-hidden">
          <StudioView
            compositionName={activeSession?.title || "Novo mÃºsico"}
            blocks={blocks}
            activeBlockId={activeBlockId}
            onActiveBlockChange={(id) => {
            setActiveBlockId(id);
            // Ao trocar de bloco manualmente, remova a flag newlyGenerated do bloco novo (se houver) para nÃ£o re-animar
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
              stopAll();
              setPlayingIndex(null);
              playingIndexRef.current = null;
            }}
            onUpdateProgression={handleUpdateProgression}
            onStartRecording={handleStartRecording}
            onReorderBlocks={setBlocks}
            selectedTrackIndex={selectedTrackIndex}
            onSelectTrack={setSelectedTrackIndex}
            onPlayArrangement={() => {
              console.warn("Play full arrangement not implemented in UI layer yet");
            }}
            melodyInstrument={melodyInstrument as InstrumentType}
            setMelodyInstrument={(val) => setMelodyInstrument(val as InstrumentType)}
            chordsInstrument={chordsInstrument as InstrumentType | "orchestra"}
            setChordsInstrument={(val) => setChordsInstrument(val as InstrumentType | "orchestra")}
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
            setPreRecordTonality={handleSetTonality}
            preRecordTimeSignature={preRecordTimeSignature}
            setPreRecordTimeSignature={setPreRecordTimeSignature}
          />
        </main>
      )}
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Componente de Processamento (Terminal Log)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PROCESSING_MESSAGES = [
  "Preparando Ã¡udio gravado...",
  "Ouvindo as notas e detectando o tom...",
  "Analisando padrÃµes harmÃ´nicos...",
  "Consultando banco de mÃºsicas para referÃªncias...",
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
