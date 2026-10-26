import { useState, useEffect, useRef, useCallback } from "react";
import { usePitchDetector } from "./hooks/usePitchDetector";
import { useStringEngine } from "./hooks/useStringEngine";
import type { DetectedNote } from "./hooks/usePitchDetector";
import { Sidebar } from "./components/Sidebar";
import { RecordControls, type TimeSignature } from "./components/RecordControls";
import { DynamicRing, type TrackingState } from "./components/DynamicRing";
import type { ChatSession } from "./lib/api";
import { apiCreateSession } from "./lib/api";
import * as Tone from "tone";
import { Midi } from "@tonejs/midi";
import { Upload } from "lucide-react";

import { SearchScreen } from "./components/SearchScreen";
import { ShowcaseScreen } from "./components/ShowcaseScreen";
import { warmUpModel, determineNextChord } from "./engine/HarmonyEngine";
import { computePianoVoicing } from "./engine/VoiceLeading";
import { Starfield } from "./components/Starfield";
import { ScoreFollower } from "./engine/ScoreFollower";
import { detectMidiKey } from "./engine/KeyDetector";
import {
  buildSongScore,
  transposeSongScore,
  getSemitoneDifference,
  type SongScore,
} from "./engine/ScoreBuilder";
import { SHOWCASE_SONGS, type SongManifest } from "./songs/catalog";

export type AppState = "IDLE" | "LIVE";

export default function App() {
  // UI state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isShowcaseOpen, setIsShowcaseOpen] = useState(false);

  const [appState, setAppState] = useState<AppState>("IDLE");
  const [customSongs, setCustomSongs] = useState<SongManifest[]>([]);
  const [draftManifest, setDraftManifest] = useState<SongManifest | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [preRecordTimeSignature, setPreRecordTimeSignature] = useState<TimeSignature>({ numerator: 4, denominator: 4 });
  const [preRecordBpm, setPreRecordBpm] = useState<number | "AUTO">("AUTO");
  const [preRecordTonality, setPreRecordTonality] = useState<string>("AUTO");
  const [preRecordTemperature, setPreRecordTemperature] = useState<number>(0.7);
  const [isArrangerOpen, setIsArrangerOpen] = useState(false);

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
    loadOrchestraInstrument,
    unloadOrchestraInstrument,
    activeOrchestraInstruments,
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
    if (!session) return;

    setActiveScore(null);
    activeScoreRef.current = null;
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
      setPreRecordTimeSignature({ numerator: 4, denominator: 4 });
      setPreRecordBpm("AUTO");
      setPreRecordTonality("AUTO");
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
  const lastPadRetriggerTimeRef = useRef<number>(0);
  const liveMelodyHistoryRef = useRef<number[]>([]);
  const liveMutedRef = useRef(false);
  const arpEndRef = useRef(0);
  const smoothLevelRef = useRef(0.5);
  const lastProcessedOnsetTimestampRef = useRef<number>(0);

  const [debugLog, setDebugLog] = useState<string>("Inativo");

  useEffect(() => {
    liveNoteRef.current = pitchDetector.currentNote;
  }, [pitchDetector.currentNote]);

  // Polling ativo a cada 100ms
  useEffect(() => {
    if (appState !== "LIVE" || !pitchDetector.isListening) {
      liveChordHistoryRef.current = [];
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
      lastPadRetriggerTimeRef.current = 0;
      liveMelodyHistoryRef.current = [];
      setDebugLog("Parado");
      return;
    }

    setDebugLog("Acompanhamento ativo...");

    const interval = setInterval(() => {
      const now = performance.now();
      const noteName = liveNoteRef.current;
      const follower = scoreFollowerRef.current;
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

      // MODO 1: Score Follower (Musica de referencia carregada)
      if (follower && score) {
        let snapshot = follower.tick(now);

        // Processamento de ataques para violino e instrumentos acústicos
        const lastOnset = pitchDetector.lastOnsetRef.current;
        if (lastOnset && lastOnset.timestamp !== lastProcessedOnsetTimestampRef.current && (now - lastOnset.timestamp < 350)) {
          lastProcessedOnsetTimestampRef.current = lastOnset.timestamp;
          snapshot = follower.observeOnset(lastOnset.pc, now, lastOnset.midi);
        } else if (!noteName || noteName === "") {
          lastPitchClassRef.current = null;
          stableCountRef.current = 0;
          firedForCurrentPitchRef.current = false;
        } else {
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
              firedForCurrentPitchRef.current = true;
              const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
              const pcVal = NOTE_NAMES.indexOf(pitchClassStr);
              if (pcVal !== -1) {
                const liveMidi = pitchDetector.liveMidiRef.current ?? undefined;
                snapshot = follower.observeOnset(pcVal, now, liveMidi);
              }
            }
          }
        }

        // Fim da musica
        if (snapshot.status === "finished") {
          setDebugLog("Musica finalizada");
          releaseLive(1.5);
          return;
        }

        // Estado visual do DynamicRing e gestao do pedal na transicao de trecho
        if (snapshot.status === "seeking") {
          setTrackingState("seeking");
          setDebugLog("LOCALIZANDO: Segurando acorde atual no pedal...");
          // No modo seeking: o piano segura a nota atual no pedal, sem tocar novas notas
          return;
        } else {
          setTrackingState("tracking");
        }

        // Execucao contínua e fiel dos acordes no andamento exato (BPM e compasso)
        if (snapshot.chordIndex >= 0) {
          const nextChord = score.chords[snapshot.chordIndex]?.symbol;
          const currentBar = Math.floor(snapshot.position / score.beatsPerBar);
          const chordChanged = nextChord && nextChord !== lastPlayedChordNameRef.current;
          const barChanged = currentBar !== lastPlayedBarRef.current;

          if (nextChord && (chordChanged || barChanged)) {
            setLiveChord(nextChord);
            lastPlayedChordNameRef.current = nextChord;
            lastPlayedBarRef.current = currentBar;
            chordCooldownRef.current = now;

            // Voicing inteligente no piano: baixo profundo + conducao suave na mao direita
            const voicing = computePianoVoicing(nextChord, lastRightHandVoicingRef.current);
            lastRightHandVoicingRef.current = voicing.rightHandNotes;
            lastPlayedChordRef.current = voicing.allNotes;

            setDebugLog(`PLAYING: ${nextChord} (Compasso ${currentBar + 1})`);

            // Execucao com pedal de sustentacao no piano (troca sincopada)
            playLiveNotes(voicing.allNotes, liveVelocity, "orchestra", 0.04);
          }
        }
        return;
      }

      // MODO 2: Geracao Livre (DetermineNextChord)
      const bpm = typeof preRecordBpm === "number" ? preRecordBpm : 0;
      const measureDurationMs = bpm > 0 
        ? (60000 / bpm) * (4 / preRecordTimeSignature.denominator) * preRecordTimeSignature.numerator
        : 0;

      // Silencio
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
            setDebugLog("Silencio - acompanhamento em espera");
          }
        }
        return;
      }
      silenceStartRef.current = null;

      if (now - chordCooldownRef.current < 300) return;

      const pitchClass = noteName.replace(/[0-9-]/g, '');
      if (!pitchClass) return;

      if (pitchClass === lastPitchClassRef.current) {
        stableCountRef.current++;
        setDebugLog(`Nota: ${pitchClass} (Estavel: ${stableCountRef.current})`);
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

      if (firedForCurrentPitchRef.current) {
        if (now - lastPadRetriggerTimeRef.current > 2500) {
          lastPadRetriggerTimeRef.current = now;
          if (lastPlayedChordRef.current && lastPlayedChordRef.current.length > 0) {
            for (const p of lastPlayedChordRef.current) {
              playMIDINote(p, 4, 0.6, "orchestra");
            }
          }
        }
        return;
      }
      
      if (stableCountRef.current < 2) return;

      if (measureDurationMs > 0 && lastChordChangeTimeRef.current > 0) {
        if (now - lastChordChangeTimeRef.current < measureDurationMs) {
          return;
        }
      }

      const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const midi = NOTE_NAMES.indexOf(pitchClass);
      if (midi === -1) return;

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
          
          const voicing = computePianoVoicing(result.chord, lastRightHandVoicingRef.current);
          lastRightHandVoicingRef.current = voicing.rightHandNotes;
          lastPlayedChordRef.current = voicing.allNotes;
          
          setDebugLog(`ACORDE: ${result.chord} -> Pitches: ${voicing.allNotes.join(',')}`);
          
          playLiveNotes(voicing.allNotes, liveVelocity, "orchestra", 0.1);
        }
      } catch(e) {
        setDebugLog(`Erro determineNextChord: ${(e as Error).message}`);
      }
    }, 30);

    return () => clearInterval(interval);
  }, [appState, pitchDetector.isListening, playMIDINote, playLiveNotes, releaseLive, setLiveDynamics, activeOrchestraInstruments, stopAll, preRecordBpm, preRecordTimeSignature, preRecordTemperature, preRecordTonality, activeScore]);

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
      setActiveScore(score);
      activeScoreRef.current = score;
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
        setActiveSession(session);
      } catch (e) {
        console.warn("Falha ao criar sessao no backend:", e);
      }
    } catch (err) {
      console.error("Falha ao carregar MIDI:", err);
    }
  }, [rememberSessionManifest]);

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
    } else {
      if (Tone.context.state !== "running") {
        await Tone.start();
      }
      if (scoreFollowerRef.current) {
        scoreFollowerRef.current.reset(performance.now());
      }
      lastPlayedChordNameRef.current = null;
      lastPlayedBarRef.current = -1;
      lastRightHandVoicingRef.current = [];
      setTrackingState("tracking");
      await pitchDetector.startLiveListening();
      setAppState("LIVE");
    }
  }, [appState, pitchDetector, stopAll]);

  const handleSetTonality = useCallback((newKey: string) => {
    setPreRecordTonality(newKey);

    stopAll(true);
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
        setActiveScore(transposedScore);
        activeScoreRef.current = transposedScore;
        scoreFollowerRef.current = new ScoreFollower(transposedScore);

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
    <div className="flex h-screen w-full bg-black text-white overflow-hidden font-sans antialiased">
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

      {/* Main View */}
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
              aria-label="Publicar musico"
            >
              <Upload className="w-5 h-5" />
            </button>
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-black/80 px-2 py-1 rounded text-xs whitespace-nowrap transition-opacity pointer-events-none border border-white/10">
              Publicar musico
            </div>
          </div>
        )}

        <Starfield animated={isLive} numStars={250} />

        {/* Central Content */}
        <div className="relative z-10 flex flex-col flex-1 items-center justify-center text-center overflow-hidden">
          <div className="fixed top-0 left-0 p-4 bg-black/80 text-xs font-mono text-green-400 z-50 text-left whitespace-pre">
            AudioContext: {Tone.context.state}{"\n"}
            Engine: {pitchDetector.isListening ? "Escutando" : "Inativo"} | Estado: {appState}{"\n"}
            Orquestra: {activeOrchestraInstruments.join(", ") || "Piano Pad"}{"\n"}
            Nota Mic: {pitchDetector.currentNote || "Silencio"}{"\n"}
            Status: {debugLog}
            
            <button 
              className="mt-2 bg-white text-black px-2 py-1 rounded block"
              onClick={async () => {
                await Tone.start();
                playMIDINote(60, 1, 1, "orchestra");
              }}
            >
              TESTAR AUDIO
            </button>
          </div>
          
          <div className="w-full max-w-4xl px-4 flex flex-col items-center transition-all duration-500 ease-in-out">
            <div className={`relative flex items-center justify-center transition-all duration-500 ease-in-out ${isArrangerOpen ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'}`}>
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
              <h1 className={`text-3xl sm:text-4xl font-normal tracking-tight text-white/90 mb-10 drop-shadow-md transition-all duration-500 ease-in-out ${isArrangerOpen ? 'opacity-0 translate-y-[-10px] pointer-events-none' : 'opacity-100 translate-y-0'}`}>
                {activeManifest
                  ? (activeManifest.id.startsWith("custom-") ? activeManifest.title : `${activeManifest.artist} - ${activeManifest.title}`)
                  : "Improviso Livre"}
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
                loadOrchestraInstrument={loadOrchestraInstrument}
                unloadOrchestraInstrument={unloadOrchestraInstrument}
                activeOrchestraInstruments={activeOrchestraInstruments}
                onArrangerOpenChange={setIsArrangerOpen}
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
