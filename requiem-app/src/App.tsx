import { useState, useEffect, useRef, useCallback } from "react";
import { usePitchDetector } from "./hooks/usePitchDetector";
import { useStringEngine } from "./hooks/useStringEngine";
import type { DetectedNote } from "./hooks/usePitchDetector";
import { Sidebar } from "./components/Sidebar";
import { RecordControls, type TimeSignature } from "./components/RecordControls";
import { DynamicRing, type TrackingState } from "./components/DynamicRing";
import type { ChatSession, SerializedBlock, StorePreset } from "./lib/api";
import { apiCreateSession, apiGetSession, apiSaveComposition } from "./lib/api";
import * as Tone from "tone";
import { Midi } from "@tonejs/midi";
import { Upload, Globe } from "lucide-react";

import { SearchScreen } from "./components/SearchScreen";
import { ShowcaseScreen } from "./components/ShowcaseScreen";
import { PublishPresetModal } from "./components/PublishPresetModal";
import { warmUpModel, determineNextChord } from "./engine/HarmonyEngine";
import { computePianoVoicing } from "./engine/VoiceLeading";
import { Starfield } from "./components/Starfield";
import { ScoreFollower } from "./engine/ScoreFollower";
import { detectMidiKey, detectPitchClassesKey } from "./engine/KeyDetector";
import {
  buildSongScore,
  buildSongScoreFromBlocks,
  songScoreToSerializedBlocks,
  createFreeSessionBlocks,
  transposeSongScore,
  getSemitoneDifference,
  determineSongScoreChord,
  type SongScore,
} from "./engine/ScoreBuilder";
import { SHOWCASE_SONGS, type SongManifest } from "./songs/catalog";
import nebulaBg from "./assets/login-nebula.jpg";

export type AppState = "IDLE" | "LIVE";

export default function App() {
  // UI state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isShowcaseOpen, setIsShowcaseOpen] = useState(false);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);

  const [appState, setAppState] = useState<AppState>("IDLE");
  const [customSongs, setCustomSongs] = useState<SongManifest[]>([]);
  const [draftManifest, setDraftManifest] = useState<SongManifest | null>(null);
  const [activeBlocks, setActiveBlocks] = useState<SerializedBlock[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [preRecordTimeSignature, setPreRecordTimeSignature] = useState<TimeSignature>({ numerator: 4, denominator: 4 });
  const [preRecordBpm, setPreRecordBpm] = useState<number | "AUTO">("AUTO");
  const [preRecordTonality, setPreRecordTonality] = useState<string>("AUTO");
  const [preRecordTemperature, setPreRecordTemperature] = useState<number>(0.7);

  const [liveChord, setLiveChord] = useState<string>("");
  const [trackingState, setTrackingState] = useState<TrackingState>("idle");
  const [activeScore, setActiveScore] = useState<SongScore | null>(null);
  const activeScoreRef = useRef<SongScore | null>(null);
  useEffect(() => {
    activeScoreRef.current = activeScore;
  }, [activeScore]);

  const [activeManifest, setActiveManifest] = useState<SongManifest | null>(null);
  const scoreFollowerRef = useRef<ScoreFollower | null>(null);

  // Local persistence
  const sessionManifestsRef = useRef<Record<string, SongManifest>>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem("requiem.sessionManifests") || "{}");
      } catch {
        return {};
      }
    })()
  );

  const rememberSessionManifest = useCallback((sessionId: string, manifest: SongManifest) => {
    sessionManifestsRef.current = { ...sessionManifestsRef.current, [sessionId]: manifest };
    try {
      localStorage.setItem("requiem.sessionManifests", JSON.stringify(sessionManifestsRef.current));
    } catch (e) {
      console.warn("Falha ao salvar manifestos de sessao", e);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("requiem.customSongs");
      if (saved) setCustomSongs(JSON.parse(saved));
      const draft = localStorage.getItem("requiem.draftManifest");
      if (draft) setDraftManifest(JSON.parse(draft));
    } catch (e) {
      console.warn("Falha ao carregar musicas locais", e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("requiem.customSongs", JSON.stringify(customSongs));
    } catch (e) {
      console.warn("Falha ao salvar customSongs", e);
    }
  }, [customSongs]);

  useEffect(() => {
    try {
      if (draftManifest) localStorage.setItem("requiem.draftManifest", JSON.stringify(draftManifest));
      else localStorage.removeItem("requiem.draftManifest");
    } catch (e) {
      console.warn("Falha ao salvar rascunho de manifesto", e);
    }
  }, [draftManifest]);

  const stringEngine = useStringEngine();
  const { 
    playMIDINote, 
    stopAll, 
    playLiveNotes,
    releaseLive,
    setLiveDynamics
  } = stringEngine;

  // Session state
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const activeSessionRef = useRef<ChatSession | null>(null);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const handleSessionChange = useCallback((session: ChatSession | null) => {
    setActiveSession(session);
    if (!session) {
      setActiveScore(null);
      activeScoreRef.current = null;
      setActiveManifest(null);
      setActiveBlocks([]);
      lastScheduledBeatRef.current = -1;
      if (scoreFollowerRef.current) scoreFollowerRef.current = null;
      return;
    }

    setActiveScore(null);
    activeScoreRef.current = null;
    setActiveBlocks(session.compositionData ?? []);
    lastScheduledBeatRef.current = -1;
    if (scoreFollowerRef.current) scoreFollowerRef.current = null;

    const targetManifest = SHOWCASE_SONGS.find(s => s.title === session.title) || sessionManifestsRef.current[session.id];
    setActiveManifest(targetManifest ?? null);

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
          if (targetManifest.key && targetManifest.key !== "AUTO" && targetManifest.key !== score.key) {
            const semitones = getSemitoneDifference(score.key, targetManifest.key);
            score = transposeSongScore(score, semitones, targetManifest.key);
          }
          setActiveScore(score);
          activeScoreRef.current = score;
          setActiveBlocks(songScoreToSerializedBlocks(score, targetManifest.title));
          scoreFollowerRef.current = new ScoreFollower(score);

          setPreRecordTimeSignature({ 
            numerator: targetManifest.meter.numerator || 4, 
            denominator: targetManifest.meter.denominator || 4 
          });
          setPreRecordBpm(targetManifest.bpm || "AUTO");
          setPreRecordTonality(targetManifest.key || "AUTO");
        } catch (err) {
          console.error("Falha ao restaurar MIDI da sessao", err);
        }
      })();
    } else {
      (async () => {
        try {
          let blocks = session.compositionData ?? null;
          if (!blocks || blocks.length === 0) {
            const full = await apiGetSession(session.id);
            blocks = full.session.compositionData ?? null;
            if (blocks) setActiveSession(full.session);
          }

          if (blocks && blocks.length > 0) {
            setActiveBlocks(blocks);
            const score = buildSongScoreFromBlocks(blocks, {
              songId: session.id,
              title: session.title,
            });
            if (score) {
              setActiveScore(score);
              activeScoreRef.current = score;
              scoreFollowerRef.current = new ScoreFollower(score);
              setPreRecordTimeSignature({
                numerator: score.meter.numerator || 4,
                denominator: score.meter.denominator || 4,
              });
              setPreRecordBpm(blocks[0].bpm || "AUTO");
              setPreRecordTonality(score.key || "AUTO");
              return;
            }
          }
        } catch (err) {
          console.warn("Nao foi possivel carregar detalhes da sessao da API:", err);
        }
        setPreRecordTimeSignature({ numerator: 4, denominator: 4 });
        setPreRecordBpm("AUTO");
        setPreRecordTonality("AUTO");
      })();
    }
  }, []);

  const handleSessionRename = useCallback((id: string, newTitle: string) => {
    setActiveSession(prev => prev?.id === id ? { ...prev, title: newTitle } : prev);
  }, []);

  // Hooks personalizados
  const pitchDetector = usePitchDetector();

  // Pre-carregar modelo LSTM em background ao montar o app
  useEffect(() => {
    warmUpModel();
  }, []);

  // Acompanhamento ao Vivo
  const liveChordHistoryRef = useRef<string[]>([]);
  const lastPlayedChordRef = useRef<number[]>([]);
  const lastRightHandVoicingRef = useRef<number[]>([]);
  const lastPlayedBarRef = useRef<number>(-1);
  const lastPitchClassRef = useRef<string | null>(null);
  const stableCountRef = useRef<number>(0);
  const firedForCurrentPitchRef = useRef<boolean>(false);
  const lastPlayedChordNameRef = useRef<string | null>(null);
  const chordCooldownRef = useRef<number>(0);
  const silenceStartRef = useRef<number | null>(null);
  const liveNoteRef = useRef<string>("");
  const lastChordChangeTimeRef = useRef<number>(0);
  const lastPianoRetriggerTimeRef = useRef<number>(0);
  const liveMelodyHistoryRef = useRef<number[]>([]);
  const liveMutedRef = useRef(false);
  const arpEndRef = useRef(0);
  const smoothLevelRef = useRef(0.5);
  const lastProcessedOnsetTimestampRef = useRef<number>(0);
  const livePitchClassHistRef = useRef<number[]>(new Array(12).fill(0));
  const lastScheduledBeatRef = useRef<number>(-1);
  const currentSongChordIndexRef = useRef<number>(-1);

  // Registro completo da sessão ao vivo (para salvar compositionData e publicar na Loja)
  const liveSessionStartTimeRef = useRef<number>(0);
  const liveSessionChordsRef = useRef<string[]>([]);
  const liveSessionNotesRef = useRef<{ pitch: number; startTime: number; endTime: number; amplitude: number }[]>([]);
  const detectedLiveTonalityRef = useRef<string>("C");

  useEffect(() => {
    liveNoteRef.current = pitchDetector.currentNote;
  }, [pitchDetector.currentNote]);

  // Polling ativo a cada 100ms
  useEffect(() => {
    if (appState !== "LIVE" || !pitchDetector.isListening) {
      liveChordHistoryRef.current = [];
      livePitchClassHistRef.current = new Array(12).fill(0);
      lastScheduledBeatRef.current = -1;
      currentSongChordIndexRef.current = -1;
      setLiveChord("");
      stopAll();
      setLiveDynamics(1);
      liveMutedRef.current = false;
      arpEndRef.current = 0;
      smoothLevelRef.current = 0.5;
      lastProcessedOnsetTimestampRef.current = 0;
      lastPlayedChordRef.current = [];
      lastRightHandVoicingRef.current = [];
      lastPlayedBarRef.current = -1;
      setTrackingState("idle");
      lastPitchClassRef.current = null;
      stableCountRef.current = 0;
      firedForCurrentPitchRef.current = false;
      lastPlayedChordNameRef.current = null;
      silenceStartRef.current = null;
      lastChordChangeTimeRef.current = 0;
      lastPianoRetriggerTimeRef.current = 0;
      liveMelodyHistoryRef.current = [];
      return;
    }

    const interval = setInterval(() => {
      const now = performance.now();
      const noteName = liveNoteRef.current;
      const score = activeScoreRef.current || activeScore;

      const rms = pitchDetector.levelRef.current;
      if (noteName && rms > 0) {
        const norm = Math.min(1, Math.max(0, (20 * Math.log10(rms) + 42) / 30));
        smoothLevelRef.current = 0.6 * smoothLevelRef.current + 0.4 * norm;
      } else {
        // Quando o musico nao esta tocando, normaliza para dinamica neutra sem parar o piano
        smoothLevelRef.current = 0.96 * smoothLevelRef.current + 0.04 * 0.45;
      }
      const dyn = smoothLevelRef.current;
      const liveVelocity = Math.max(0.3, Math.min(0.95, 0.35 + 0.65 * dyn));
      setLiveDynamics(0.45 + 0.65 * dyn);

      // ── Motor de Acompanhamento Unificado Inteligente ──
      // Condicionado pelo DNA da música (quando carregada) ou livre (quando sem MIDI)
      const songGrammar = score?.grammar;

      const bpm = typeof preRecordBpm === "number" ? preRecordBpm : 0;
      const defaultMeasureDurationMs = bpm > 0 
        ? (60000 / bpm) * (4 / preRecordTimeSignature.denominator) * preRecordTimeSignature.numerator
        : 1800;
      const measureDurationMs = songGrammar?.typicalChordDurationMs
        ? Math.min(defaultMeasureDurationMs, songGrammar.typicalChordDurationMs)
        : defaultMeasureDurationMs;

      // Silêncio
      if (!noteName || noteName === "") {
        if (lastPlayedChordNameRef.current) {
          if (!silenceStartRef.current) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current > 650) {
            stopAll();
            setLiveChord("");
            lastPlayedChordNameRef.current = null;
            lastPitchClassRef.current = null;
            firedForCurrentPitchRef.current = false;
            stableCountRef.current = 0;
            silenceStartRef.current = null;
            lastChordChangeTimeRef.current = 0;
            setTrackingState("waiting");
          }
        }
        return;
      }
      silenceStartRef.current = null;

      if (now - chordCooldownRef.current < 250) return;

      const pitchClass = noteName.replace(/[0-9-]/g, '');
      if (!pitchClass) return;

      if (pitchClass === lastPitchClassRef.current) {
        stableCountRef.current++;
      } else {
        lastPitchClassRef.current = pitchClass;
        stableCountRef.current = 1;
        firedForCurrentPitchRef.current = false;

        try {
          const midiVal = Tone.Frequency(noteName).toMidi();
          liveMelodyHistoryRef.current.push(midiVal);
          if (liveMelodyHistoryRef.current.length > 8) {
            liveMelodyHistoryRef.current.shift();
          }
        } catch (e) {
          // ignore
        }
        return;
      }

      // Se a nota já disparou e o músico está sustentando, re-trigga o piano suavemente para respiro
      if (firedForCurrentPitchRef.current) {
        if (now - lastPianoRetriggerTimeRef.current > 2500) {
          lastPianoRetriggerTimeRef.current = now;
          if (lastPlayedChordRef.current && lastPlayedChordRef.current.length > 0) {
            for (const p of lastPlayedChordRef.current) {
              playMIDINote(p, 4, 0.55 * liveVelocity);
            }
          }
        }
        return;
      }

      if (stableCountRef.current < 2) return;

      // Respeita o ritmo harmônico mínimo para que o acorde respire
      if (measureDurationMs > 0 && lastChordChangeTimeRef.current > 0) {
        if (now - lastChordChangeTimeRef.current < measureDurationMs * 0.7) {
          return;
        }
      }

      const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const midi = NOTE_NAMES.indexOf(pitchClass);
      if (midi === -1) return;

      // Alimenta histograma de classes de notas para detecção tonal contínua
      livePitchClassHistRef.current[midi] += 1;

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

      // Estima a tonalidade em tempo real se o tom estiver em 'AUTO'
      let effectiveTonality = preRecordTonality;
      if (effectiveTonality === "AUTO") {
        if (songGrammar?.key && songGrammar.key !== "AUTO") {
          effectiveTonality = songGrammar.key;
        } else {
          const autoKeyResult = detectPitchClassesKey(livePitchClassHistRef.current);
          if (autoKeyResult && autoKeyResult.confidence > 0.25) {
            effectiveTonality = autoKeyResult.key;
          }
        }
      }

      try {
        let chosenChord: string | null = null;
        let newChordIndex = currentSongChordIndexRef.current;
        let shouldPlay = false;

        if (score && score.chords && score.chords.length > 0) {
          // ── MODO MIDI: Segue a progressão real da canção alinhada à melodia ──
          const timeSinceChange = now - lastChordChangeTimeRef.current;
          const res = determineSongScoreChord(score, currentSongChordIndexRef.current, midi, timeSinceChange);

          if (res.shouldChange && res.chord !== lastPlayedChordNameRef.current) {
            chosenChord = res.chord;
            newChordIndex = res.chordIndex;
            shouldPlay = true;
          } else if (res.chord === lastPlayedChordNameRef.current) {
            firedForCurrentPitchRef.current = true;
            return;
          }
        } else {
          // ── MODO LIVRE: Rede Neural LSTM + Escala Acústica Geral ──
          const secondsPerBeat = bpm > 0 ? (60 / bpm) : 0.5;
          const result = determineNextChord(
            liveChordHistoryRef.current,
            melodyNotesToPass,
            0,
            secondsPerBeat,
            preRecordTemperature,
            effectiveTonality !== "AUTO" ? effectiveTonality : "C"
          );
          if (result.chord) {
            if (result.chord === lastPlayedChordNameRef.current) {
              firedForCurrentPitchRef.current = true;
              return;
            }
            chosenChord = result.chord;
            shouldPlay = true;
            if (effectiveTonality && effectiveTonality !== "AUTO") {
              detectedLiveTonalityRef.current = effectiveTonality;
            }
          }
        }

        if (chosenChord && shouldPlay) {
          firedForCurrentPitchRef.current = true;
          lastChordChangeTimeRef.current = now;
          lastPianoRetriggerTimeRef.current = now;
          liveChordHistoryRef.current.push(chosenChord);
          if (liveChordHistoryRef.current.length > 8) liveChordHistoryRef.current.shift();

          if (!score) {
            liveSessionChordsRef.current.push(chosenChord);
            const relSec = liveSessionStartTimeRef.current > 0
              ? (now - liveSessionStartTimeRef.current) / 1000
              : 0;
            const latestPitch = liveMelodyHistoryRef.current[liveMelodyHistoryRef.current.length - 1] ?? (60 + midi);
            liveSessionNotesRef.current.push({
              pitch: latestPitch,
              startTime: Math.max(0, relSec),
              endTime: Math.max(0, relSec + 0.5),
              amplitude: liveVelocity,
            });
          }

          currentSongChordIndexRef.current = newChordIndex;

          setLiveChord(chosenChord);
          lastPlayedChordNameRef.current = chosenChord;

          stopAll(true);
          chordCooldownRef.current = now;

          const voicing = computePianoVoicing(chosenChord, lastRightHandVoicingRef.current);
          lastRightHandVoicingRef.current = voicing.rightHandNotes;
          lastPlayedChordRef.current = voicing.allNotes;

          setTrackingState("tracking");

          playLiveNotes(voicing.allNotes, liveVelocity, 0.08);
        }
      } catch (e) {
        console.error("Erro no acompanhamento:", e);
      }
    }, 30);

    return () => clearInterval(interval);
  }, [appState, pitchDetector.isListening, playMIDINote, playLiveNotes, releaseLive, setLiveDynamics, stopAll, preRecordBpm, preRecordTimeSignature, preRecordTemperature, preRecordTonality, activeScore]);

  // Cleanup ao desmontar
  useEffect(() => {
    return () => {
      pitchDetector.stopLiveListening();
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadMidi = useCallback(async (url: string, title: string, id: string, customManifest?: SongManifest) => {
    try {
      const res = await fetch(url);
      const buffer = await res.arrayBuffer();
      const parsedMidi = new Midi(buffer);
      
      let manifest = customManifest || SHOWCASE_SONGS.find(s => s.id === id);
      if (!manifest) {
        console.error("Song manifest nao encontrado para id:", id);
        return;
      }

      if (!manifest.bpm) {
        manifest = { ...manifest, bpm: parsedMidi.header.tempos.length > 0 ? parsedMidi.header.tempos[0].bpm : 120 };
      }
      if (!manifest.meter || !manifest.meter.numerator) {
        const ts = parsedMidi.header.timeSignatures.length > 0 ? parsedMidi.header.timeSignatures[0] : null;
        manifest = { ...manifest, meter: ts ? { numerator: ts.timeSignature[0], denominator: ts.timeSignature[1] } : { numerator: 4, denominator: 4 } };
      }

      if (!manifest.key || manifest.key === "AUTO") {
        const detected = detectMidiKey(parsedMidi as any);
        manifest = { ...manifest, key: detected?.key ?? "C" };
      }

      const score = buildSongScore(parsedMidi as any, manifest);
      const serializedBlocks = songScoreToSerializedBlocks(score, manifest.title);
      setActiveScore(score);
      activeScoreRef.current = score;
      setActiveBlocks(serializedBlocks);
      lastScheduledBeatRef.current = -1;
      setActiveManifest(manifest);
      if (manifest.id.startsWith("custom-")) {
        setDraftManifest(prev => (prev && prev.id === manifest!.id ? manifest! : prev));
      }
      scoreFollowerRef.current = new ScoreFollower(score);

      const bpm = manifest.bpm;
      const num = manifest.meter.numerator;
      const den = manifest.meter.denominator;

      setPreRecordTimeSignature({ numerator: num, denominator: den });
      setPreRecordBpm(bpm);
      setPreRecordTonality(manifest.key);

      try {
        const { session } = await apiCreateSession(title);
        rememberSessionManifest(session.id, manifest);
        await apiSaveComposition(session.id, serializedBlocks, title);
        setActiveSession({ ...session, compositionData: serializedBlocks });
      } catch (e) {
        console.warn("Falha ao criar/salvar sessao no backend:", e);
      }
    } catch (err) {
      console.error("Falha ao carregar MIDI:", err);
    }
  }, [rememberSessionManifest]);

  const handleLoadStorePreset = useCallback(async (preset: StorePreset, createdSession?: ChatSession) => {
    const blocks = preset.configurationData || createdSession?.compositionData || [];
    if (!blocks || blocks.length === 0) return;

    const score = buildSongScoreFromBlocks(blocks, {
      songId: preset.id,
      title: preset.title,
    });
    if (!score) return;

    const bpm = preset.bpm || blocks[0]?.bpm || 120;
    const key = preset.tonality || score.key || "C";
    const syntheticManifest: SongManifest = {
      id: `store-${preset.id}`,
      title: preset.title,
      artist: preset.authorName || "Comunidade Requiem",
      midiUrl: "",
      coverUrl: "",
      key,
      meter: score.meter,
      lockMeter: false,
      bpm,
    };

    setActiveScore(score);
    activeScoreRef.current = score;
    setActiveBlocks(blocks);
    setActiveManifest(syntheticManifest);
    setDraftManifest(null);
    lastScheduledBeatRef.current = -1;
    scoreFollowerRef.current = new ScoreFollower(score);

    setPreRecordTimeSignature(score.meter);
    setPreRecordBpm(bpm);
    setPreRecordTonality(key);

    if (createdSession) {
      setActiveSession(createdSession);
    } else {
      try {
        const { session } = await apiCreateSession(preset.title);
        await apiSaveComposition(session.id, blocks, preset.title);
        setActiveSession({ ...session, compositionData: blocks });
      } catch (e) {
        console.warn("Nao foi possivel criar sessao para o preset:", e);
      }
    }
  }, []);

  const handleDropMidi = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (/\.midi?$/i.test(file.name)) {
        const title = file.name.replace(/\.midi?$/i, '');
        const tempId = `custom-${Date.now()}`;

        const reader = new FileReader();
        reader.onload = () => {
          const url = reader.result as string;
          const tempManifest: SongManifest = {
            id: tempId,
            title: title,
            artist: "Musico Customizado",
            midiUrl: url,
            coverUrl: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=400",
            key: "AUTO",
            meter: { numerator: 0, denominator: 0 },
            lockMeter: true,
            bpm: 0,
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

  // Alternancia de Acompanhamento ao Vivo
  const handleToggleLive = useCallback(async () => {
    if (appState === "LIVE") {
      await pitchDetector.stopLiveListening();
      stopAll();
      setAppState("IDLE");

      // Se estava no Modo Improviso Livre e gerou acordes, persiste compositionData na sessão
      if (!activeScoreRef.current && liveSessionChordsRef.current.length > 0) {
        const keyToSave = preRecordTonality !== "AUTO" ? preRecordTonality : detectedLiveTonalityRef.current;
        const bpmToSave = typeof preRecordBpm === "number" ? preRecordBpm : 120;
        const blocks = createFreeSessionBlocks(
          liveSessionChordsRef.current,
          liveSessionNotesRef.current,
          {
            bpm: bpmToSave,
            key: keyToSave,
            numerator: preRecordTimeSignature.numerator,
            denominator: preRecordTimeSignature.denominator,
            name: activeSessionRef.current?.title || "Improviso Ao Vivo",
          }
        );
        setActiveBlocks(blocks);

        try {
          if (activeSessionRef.current?.id) {
            await apiSaveComposition(activeSessionRef.current.id, blocks);
            setActiveSession(prev => prev ? { ...prev, compositionData: blocks } : prev);
          } else {
            const title = `Improviso em ${keyToSave}`;
            const { session } = await apiCreateSession(title);
            await apiSaveComposition(session.id, blocks, title);
            setActiveSession({ ...session, compositionData: blocks });
          }
        } catch (err) {
          console.warn("Falha ao salvar sessao de improviso na API:", err);
        }
      }
    } else {
      if (Tone.context.state !== "running") {
        await Tone.start();
      }
      if (scoreFollowerRef.current) {
        scoreFollowerRef.current.reset(performance.now());
      }
      liveSessionStartTimeRef.current = performance.now();
      liveSessionChordsRef.current = [];
      liveSessionNotesRef.current = [];
      detectedLiveTonalityRef.current = preRecordTonality !== "AUTO" ? preRecordTonality : "C";

      lastScheduledBeatRef.current = -1;
      currentSongChordIndexRef.current = -1;
      lastPlayedChordNameRef.current = null;
      lastPlayedBarRef.current = -1;
      lastRightHandVoicingRef.current = [];
      setTrackingState("tracking");
      await pitchDetector.startLiveListening();
      setAppState("LIVE");
    }
  }, [appState, pitchDetector, stopAll, preRecordTonality, preRecordBpm, preRecordTimeSignature]);

  const handleSetTonality = useCallback((newKey: string) => {
    setPreRecordTonality(newKey);

    stopAll(true);
    lastScheduledBeatRef.current = -1;
    currentSongChordIndexRef.current = -1;
    lastPlayedChordNameRef.current = null;
    lastPlayedChordRef.current = [];

    const currentScore = activeScoreRef.current;
    if (currentScore) {
      const targetKey = newKey === "AUTO"
        ? (currentScore.originalKey && currentScore.originalKey !== "AUTO" ? currentScore.originalKey : "C")
        : newKey;

      const semitones = getSemitoneDifference(currentScore.key, targetKey);

      if (semitones !== 0 || currentScore.key !== targetKey) {
        const transposedScore = transposeSongScore(currentScore, semitones, targetKey);
        const transposedBlocks = songScoreToSerializedBlocks(transposedScore, transposedScore.title);
        setActiveScore(transposedScore);
        activeScoreRef.current = transposedScore;
        setActiveBlocks(transposedBlocks);
        scoreFollowerRef.current = new ScoreFollower(transposedScore);

        if (activeSessionRef.current?.id) {
          apiSaveComposition(activeSessionRef.current.id, transposedBlocks).catch(() => {});
        }

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
      }
    }
  }, [activeManifest, rememberSessionManifest, stopAll]);

  const isLive = appState === "LIVE";

  return (
    <div className="relative flex h-full w-full bg-black text-white overflow-hidden font-sans antialiased">
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
          onLoadStorePreset={handleLoadStorePreset}
          customSongs={customSongs}
        />
      )}

      {isPublishModalOpen && (
        <PublishPresetModal
          onClose={() => setIsPublishModalOpen(false)}
          activeSession={activeSession}
          configurationData={
            activeBlocks.length > 0
              ? activeBlocks
              : activeScore
              ? songScoreToSerializedBlocks(activeScore, activeManifest?.title || activeSession?.title)
              : []
          }
          defaultTitle={activeManifest?.title || activeSession?.title || "Meu Acompanhamento"}
          defaultBpm={typeof preRecordBpm === "number" ? preRecordBpm : 120}
          defaultTonality={preRecordTonality}
          defaultTimeSignature={`${preRecordTimeSignature.numerator}/${preRecordTimeSignature.denominator}`}
        />
      )}

      {/* Main View */}
      <main className="relative flex-1 flex flex-col justify-between p-8 overflow-hidden bg-[#07080a]">
        {/* Imagem de Fundo Cósmica (Galáxia Nebulosa) - Sutil e discreta */}
        <div
          className="absolute inset-0 z-0 bg-cover bg-center pointer-events-none opacity-[0.14] mix-blend-screen scale-105"
          style={{
            backgroundImage: `url(${nebulaBg})`,
            filter: 'contrast(1.15) brightness(0.8)',
          }}
        />

        {/* Gradiente de Fusão para manter legibilidade e foco no anel central */}
        <div
          className="absolute inset-0 z-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(circle at 50% 40%, rgba(0,0,0,0.15) 0%, rgba(7,8,10,0.85) 75%, #07080a 100%),
              linear-gradient(180deg, rgba(7,8,10,0.35) 0%, rgba(7,8,10,0.65) 60%, rgba(7,8,10,0.96) 100%)
            `,
          }}
        />

        {/* Grid Isométrico sutil no fundo */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.022] z-0"
          style={{
            backgroundImage: `
              linear-gradient(30deg, rgba(255,255,255,0.7) 1px, transparent 1px),
              linear-gradient(-30deg, rgba(255,255,255,0.7) 1px, transparent 1px)
            `,
            backgroundSize: '54px 93.53px',
            maskImage: 'radial-gradient(ellipse 80% 80% at 50% 45%, black 20%, transparent 80%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 50% 45%, black 20%, transparent 80%)',
          }}
        />

        {/* Linhas Geométricas Astronômicas Suaves (Elegantes e discretas) */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-0 opacity-15"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Eixo Vertical Central pontilhado */}
          <line x1="50%" y1="0" x2="50%" y2="100%" stroke="white" strokeWidth="0.6" strokeDasharray="4 8" />

          {/* Eixo Horizontal suave no plano do anel */}
          <line x1="0" y1="38%" x2="100%" y2="38%" stroke="white" strokeWidth="0.6" strokeDasharray="4 8" />

          {/* Curvas orbitais celestes amplas */}
          <path
            d="M -150 750 C 350 620, 750 200, 1850 80"
            stroke="white"
            strokeWidth="0.6"
            strokeDasharray="4 6"
          />
          <path
            d="M 100 900 C 650 680, 1200 300, 2050 180"
            stroke="white"
            strokeWidth="0.4"
          />

          {/* Círculos orbitais concêntricos tenues em torno do anel */}
          <circle cx="50%" cy="38%" r="220" stroke="white" strokeWidth="0.5" strokeDasharray="2 8" />
          <circle cx="50%" cy="38%" r="340" stroke="white" strokeWidth="0.35" />
        </svg>

        {!isLive && (activeBlocks.length > 0 || activeScore !== null || draftManifest !== null) && (
          <div className="absolute top-6 right-8 z-50 flex items-center gap-2.5 animate-fade-in">
            {(activeBlocks.length > 0 || activeScore !== null) && (
              <div className="relative group">
                <button
                  onClick={() => setIsPublishModalOpen(true)}
                  className="bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 px-3.5 py-2.5 rounded-full transition-all border border-emerald-500/30 flex items-center gap-2 text-xs font-medium cursor-pointer"
                  aria-label="Publicar na Loja Comunitária"
                >
                  <Globe className="w-4 h-4" />
                  <span className="hidden sm:inline">Publicar na Loja</span>
                </button>
              </div>
            )}

            {draftManifest && (
              <div className="relative group">
                <button 
                  onClick={() => {
                    const toPublish = activeManifest && activeManifest.id === draftManifest.id ? activeManifest : draftManifest;
                    setCustomSongs(prev => [...prev.filter(s => s.id !== toPublish.id), toPublish]);
                    setDraftManifest(null);
                  }}
                  className="bg-white/10 hover:bg-white/20 text-white p-2.5 rounded-full transition-all border border-white/20 cursor-pointer"
                  aria-label="Salvar na Vitrine local"
                >
                  <Upload className="w-4 h-4" />
                </button>
                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-black/80 px-2 py-1 rounded text-xs whitespace-nowrap transition-opacity pointer-events-none border border-white/10">
                  Salvar na Vitrine local
                </div>
              </div>
            )}
          </div>
        )}

        <Starfield animated={isLive} numStars={250} />

        {/* Central Content */}
        <div className="relative z-10 flex flex-col flex-1 items-center justify-center text-center overflow-hidden">
          <div className="w-full max-w-4xl px-4 flex flex-col items-center transition-all duration-500 ease-in-out">
            <div className="relative flex items-center justify-center transition-all duration-500 ease-in-out opacity-100 scale-100">
              <DynamicRing 
                isActive={isLive} 
                currentFrequency={pitchDetector.currentFrequency}
                currentNote={liveChord || pitchDetector.currentNote}
                onClick={handleToggleLive}
                onDrop={handleDropMidi}
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                isDragActive={isDragActive}
                trackingState={isLive ? trackingState : "idle"}
              />
            </div>

            <div className={`w-full flex flex-col items-center transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isLive ? 'opacity-0 h-0 scale-90 pointer-events-none' : 'opacity-100 h-auto scale-100'}`}>
              <h1 className="text-3xl sm:text-4xl font-normal tracking-tight text-white/90 mb-10 drop-shadow-md transition-all duration-500 ease-in-out opacity-100 translate-y-0">
                {activeManifest
                  ? (activeManifest.id.startsWith("custom-") || activeManifest.id.startsWith("store-") ? activeManifest.title : `${activeManifest.artist} - ${activeManifest.title}`)
                  : (activeScore ? activeScore.title : "Improviso Livre")}
              </h1>

              <RecordControls
                isLive={isLive}
                currentFrequency={pitchDetector.currentFrequency}
                currentNote={pitchDetector.currentNote}
                preRecordTimeSignature={preRecordTimeSignature}
                setPreRecordTimeSignature={setPreRecordTimeSignature}
                preRecordBpm={preRecordBpm}
                setPreRecordBpm={setPreRecordBpm}
                preRecordTonality={preRecordTonality}
                setPreRecordTonality={handleSetTonality}
                preRecordTemperature={preRecordTemperature}
                setPreRecordTemperature={setPreRecordTemperature}
                onToggleLive={handleToggleLive}
              />
            </div>
          </div>
        </div>

        <footer className="relative z-10 w-full text-center text-[10px] font-mono tracking-[0.2em] text-white/30 max-w-5xl mx-auto">
          &copy; {new Date().getFullYear()} REQUIEM LABS &bull; LIVE ENGINE
        </footer>
      </main>
    </div>
  );
}
