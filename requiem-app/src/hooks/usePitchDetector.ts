import { useCallback, useRef, useState, useEffect } from "react";
import { BasicPitch, outputToNotesPoly, noteFramesToTime } from "@spotify/basic-pitch";
import * as tf from "@tensorflow/tfjs";

// ─────────────────────────────────────────────────────────
//  usePitchDetector – detecção polifônica via Basic Pitch
// ─────────────────────────────────────────────────────────
//
//  Pipeline de transcrição (offline, alta precisão):
//  1. MediaRecorder grava áudio bruto do microfone.
//  2. Blob → AudioBuffer (sample rate nativo do hardware).
//  3. OfflineAudioContext reamostra para 22050 Hz (mono).
//  4. Float32Array → BasicPitch.evaluateModel() (rede neural).
//  5. Frames/Onsets → outputToNotesPoly → DetectedNote[].
//
//  Pipeline de feedback visual (real-time, leve):
//  - AnalyserNode + autocorrelação simples → currentNote
//  - Roda em paralelo com o MediaRecorder
//  - Apenas para UI, não influencia a transcrição final
// ─────────────────────────────────────────────────────────

export interface DetectedNote {
  /** MIDI pitch number (0–127) */
  pitch: number;
  /** Tempo de início da nota em segundos (relativo ao início da gravação) */
  startTime: number;
  /** Tempo de fim da nota em segundos */
  endTime: number;
  /** Amplitude da nota (velocidade/intensidade) */
  amplitude: number;
}

export interface UsePitchDetectorReturn {
  /** Pede permissão e liga o microfone (útil para feedback visual durante o count-in) */
  prepareListening: () => Promise<void>;
  /** Começa a gravar no MediaRecorder instantaneamente */
  startRecording: () => void;
  /** Cancela a gravação e volta ao estado inicial sem processar */
  cancelListening: () => Promise<void>;
  /** Para a gravação e guarda o áudio para decisão do usuário */
  pauseListening: () => Promise<void>;
  /** Processa o áudio previamente pausado e retorna as notas detectadas */
  processPausedAudio: () => Promise<DetectedNote[]>;
  /** Para a gravação, processa a IA e retorna as notas detectadas (atalho antigo) */
  stopListening: () => Promise<DetectedNote[]>;
  /** Se está gravando ativamente */
  isListening: boolean;
  /** Se a rede neural está processando a transcrição */
  isProcessing: boolean;
  /** Nome da nota sendo detectada em tempo real (ex: "A4", "C#5") */
  currentNote: string;
  /** Frequência atual detectada em tempo real (Hz), 0 se silêncio */
  currentFrequency: number;
}

// ── Constantes ──────────────────────────────────────────
const TARGET_SAMPLE_RATE = 22050;
const MODEL_URL =
  "https://unpkg.com/@spotify/basic-pitch@1.0.1/model/model.json";

// ── Nomes de notas para feedback visual ─────────────────
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Converte frequência Hz para MIDI pitch number. */
function freqToMidi(freq: number): number {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

/** Converte MIDI pitch para nome legível (ex: 69 → "A4"). */
function midiToNoteName(midi: number): string {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

// ─────────────────────────────────────────────────────────
//  Autocorrelação simples para detecção real-time
// ─────────────────────────────────────────────────────────
//  Leve o suficiente para rodar a cada frame sem travar.
//  Não precisa ser perfeita — é só feedback visual.
// ─────────────────────────────────────────────────────────

function autoCorrelate(buffer: Float32Array, sampleRate: number): number {
  // Verificar se tem sinal suficiente
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.015) return 0; // noise gate aumentado para não pegar ruído de fundo

  // Normalizar
  const len = buffer.length;
  const normalized = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    normalized[i] = buffer[i];
  }

  // Autocorrelação
  const correlations = new Float32Array(len);
  for (let lag = 0; lag < len; lag++) {
    let sum = 0;
    for (let i = 0; i < len - lag; i++) {
      sum += normalized[i] * normalized[i + lag];
    }
    correlations[lag] = sum;
  }

  // Encontrar o primeiro dip e depois o primeiro pico após o dip
  let d = 0;
  // Pular o pico em lag=0
  while (correlations[d] > correlations[d + 1] && d < len - 1) d++;

  let maxVal = -1;
  let maxLag = -1;
  for (let i = d; i < len; i++) {
    if (correlations[i] > maxVal) {
      maxVal = correlations[i];
      maxLag = i;
    }
  }

  // Aumentada a tolerância (confidence) de 0.3 para 0.5 para exigir uma afinação mais "firme"
  if (maxLag === -1 || maxVal < correlations[0] * 0.5) return 0;

  const freq = sampleRate / maxLag;

  // Filtro: ignorar frequências absurdas (abaixo de C3 ou muito altas)
  if (freq < 130 || freq > 2000) return 0;
  return freq;
}

// ─────────────────────────────────────────────────────────
//  Resample: Blob → Float32Array mono @ 22050 Hz
// ─────────────────────────────────────────────────────────

async function blobToMonoFloat32(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const nativeCtx = new AudioContext();
  const nativeBuffer = await nativeCtx.decodeAudioData(arrayBuffer);
  await nativeCtx.close();

  const nativeSR = nativeBuffer.sampleRate;
  const nativeLength = nativeBuffer.length;
  let monoData: Float32Array;

  if (nativeBuffer.numberOfChannels === 1) {
    monoData = nativeBuffer.getChannelData(0);
  } else {
    const ch0 = nativeBuffer.getChannelData(0);
    const ch1 = nativeBuffer.getChannelData(1);
    monoData = new Float32Array(nativeLength);
    for (let i = 0; i < nativeLength; i++) {
      monoData[i] = (ch0[i] + ch1[i]) / 2;
    }
  }

  if (nativeSR === TARGET_SAMPLE_RATE) {
    return monoData;
  }

  const targetLength = Math.ceil(
    (nativeLength / nativeSR) * TARGET_SAMPLE_RATE,
  );
  const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const sourceBuffer = offlineCtx.createBuffer(1, nativeLength, nativeSR);
  sourceBuffer.copyToChannel(monoData as any, 0);

  const sourceNode = offlineCtx.createBufferSource();
  sourceNode.buffer = sourceBuffer;
  sourceNode.connect(offlineCtx.destination);
  sourceNode.start(0);

  const resampledBuffer = await offlineCtx.startRendering();
  return resampledBuffer.getChannelData(0);
}

// ─────────────────────────────────────────────────────────
//  Hook
// ─────────────────────────────────────────────────────────

export function usePitchDetector(): UsePitchDetectorReturn {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentNote, setCurrentNote] = useState("");
  const [currentFrequency, setCurrentFrequency] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("");
  const basicPitchRef = useRef<BasicPitch | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelReadyRef = useRef<Promise<void> | null>(null);

  // Refs para detecção em tempo real
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const isListeningRef = useRef(false);

  // ── Inicialização do Modelo ───────────────────────────
  useEffect(() => {
    modelReadyRef.current = (async () => {
      try {
        await tf.setBackend("cpu");
        await tf.ready();
        basicPitchRef.current = new BasicPitch(MODEL_URL);
      } catch (err) {
        console.error("[BasicPitch] Erro ao inicializar modelo:", err);
      }
    })();
  }, []);

  // ── Loop de detecção real-time (visual feedback) ──────
  const detectLoop = useCallback(() => {
    if (!isListeningRef.current || !analyserRef.current) return;

    const analyser = analyserRef.current;
    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);

    const freq = autoCorrelate(buffer, analyser.context.sampleRate);

    if (freq > 0) {
      const midi = freqToMidi(freq);
      setCurrentFrequency(Math.round(freq));
      setCurrentNote(midiToNoteName(midi));
    } else {
      setCurrentFrequency(0);
      setCurrentNote("");
    }

    rafRef.current = requestAnimationFrame(detectLoop);
  }, []);

  // ── 1. Prepare (Mic On, Visuals On, NO RECORDING YET) ─
  const prepareListening = useCallback(async () => {
    if (streamRef.current || isProcessing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,   // Essencial para evitar que o mic capte os acordes das caixas
          noiseSuppression: false,  // Mantemos off para fidelidade na transcrição offline
          autoGainControl: false,
          channelCount: 1,
        },
      });

      streamRef.current = stream;

      // ── AnalyserNode para detecção real-time (visual) ─
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);

      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      isListeningRef.current = true;

      setCurrentNote("");
      setCurrentFrequency(0);

      // Iniciar loop de detecção visual
      rafRef.current = requestAnimationFrame(detectLoop);
    } catch (err) {
      console.error("Erro ao acessar microfone:", err);
    }
  }, [isProcessing, detectLoop]);

  // ── 2. Start Recording (Instantâneo) ──────────────────
  const startRecording = useCallback(() => {
    if (!streamRef.current || isListening) return;

    const stream = streamRef.current;
    const mediaRecorder = new MediaRecorder(stream);
    audioChunksRef.current = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.start();
    mimeTypeRef.current = mediaRecorder.mimeType;
    mediaRecorderRef.current = mediaRecorder;
    setIsListening(true);
    console.log(`[Recorder] Iniciado com mimeType: ${mediaRecorder.mimeType}`);
  }, [isListening]);


  // ── Cancelamento Instantâneo ──────────────────────────
  const cancelListening = useCallback(async () => {
    setIsListening(false);
    setIsProcessing(false);
    setCurrentNote("");
    setCurrentFrequency(0);

    isListeningRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null; // evita que o onstop processe áudio
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (audioCtxRef.current) {
      await audioCtxRef.current.close();
      audioCtxRef.current = null;
      analyserRef.current = null;
    }
  }, []);

  // ── Stop & Process ────────────────────────────────────
  const capturedChunksRef = useRef<Blob[]>([]);

  const pauseListening = useCallback(async () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      setIsListening(false);
      return;
    }

    isListeningRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    setIsListening(false);

    const finalChunks = await new Promise<Blob[]>((resolve) => {
      const recorder = mediaRecorderRef.current!;
      recorder.onstop = () => {
        resolve([...audioChunksRef.current]);
      };
      recorder.stop();
    });

    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    capturedChunksRef.current = finalChunks;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (audioCtxRef.current) {
      await audioCtxRef.current.close();
      audioCtxRef.current = null;
      analyserRef.current = null;
    }
  }, []);

  const processPausedAudio = useCallback(async (): Promise<DetectedNote[]> => {
    const finalChunks = capturedChunksRef.current;
    if (finalChunks.length === 0) {
      return [];
    }
    
    setIsProcessing(true);
    setCurrentNote("");
    setCurrentFrequency(0);

    try {

      if (finalChunks.length === 0) {
        setIsProcessing(false);
        return [];
      }

      // ── 2. Blob → Float32Array mono @ 22050 Hz ────────
      const audioBlob = new Blob(finalChunks, { type: mimeTypeRef.current });
      console.log(
        `[BasicPitch] Blob: ${(audioBlob.size / 1024).toFixed(1)} KB, tipo: ${audioBlob.type}`,
      );

      const monoAudio = await blobToMonoFloat32(audioBlob);
      const audioDuration = monoAudio.length / TARGET_SAMPLE_RATE;
      console.log(
        `[BasicPitch] Áudio: ${monoAudio.length} amostras (${audioDuration.toFixed(2)}s)`,
      );

      let maxAmp = 0;
      for (let i = 0; i < monoAudio.length; i++) {
        const abs = Math.abs(monoAudio[i]);
        if (abs > maxAmp) maxAmp = abs;
      }
      console.log(`[BasicPitch] Amplitude máx: ${maxAmp.toFixed(6)}`);

      if (maxAmp < 0.001) {
        console.warn("[BasicPitch] Áudio silencioso.");
        setIsProcessing(false);
        return [];
      }

      // ── 3. Garantir modelo carregado ──────────────────
      if (modelReadyRef.current) {
        await modelReadyRef.current;
      }
      if (!basicPitchRef.current) {
        await tf.setBackend("cpu");
        await tf.ready();
        basicPitchRef.current = new BasicPitch(MODEL_URL);
      }

      // Yield para a UI atualizar logs antes da inferência
      await new Promise(resolve => setTimeout(resolve, 50));

      // ── 4. Inferência ─────────────────────────────────
      let frames: number[][] = [];
      let onsets: number[][] = [];

      console.log("[BasicPitch] Inferência iniciada...");
      await basicPitchRef.current.evaluateModel(
        monoAudio,
        (f, o, _c) => {
          // O modelo Basic Pitch processa o áudio em blocos (chunks).
          // Precisamos ACUMULAR os frames e onsets, e não sobrescrevê-los.
          frames.push(...f);
          onsets.push(...o);
        },
        (percent) => {
          if (Math.floor(percent * 4) !== Math.floor((percent - 0.01) * 4)) {
            console.log(`[BasicPitch] ${(percent * 100).toFixed(0)}%`);
          }
        },
      );
      console.log(`[BasicPitch] Frames: ${frames.length}`);

      // Yield para garantir que a UI respire antes da conversão final
      await new Promise(resolve => setTimeout(resolve, 50));

      // ── 5. Converter → DetectedNote[] ─────────────────
      const noteEvents = outputToNotesPoly(frames, onsets, 0.5, 0.3, 11, true, null, null, true, 11);
      const notesTime = noteFramesToTime(noteEvents);

      const mappedNotes: DetectedNote[] = notesTime.map((note) => ({
        pitch: note.pitchMidi,
        startTime: note.startTimeSeconds,
        endTime: note.startTimeSeconds + note.durationSeconds,
        amplitude: note.amplitude || 0.7,
      }));

      // Log detalhado de cada nota
      console.log(`[BasicPitch] Notas detectadas: ${mappedNotes.length}`);
      console.table(
        mappedNotes.map((n) => ({
          nota: midiToNoteName(n.pitch),
          midi: n.pitch,
          início: n.startTime.toFixed(3) + "s",
          fim: n.endTime.toFixed(3) + "s",
          duração: (n.endTime - n.startTime).toFixed(3) + "s",
        })),
      );

      setIsProcessing(false);
      return mappedNotes;
    } catch (err) {
      console.error("Erro na inferência do Basic Pitch:", err);
      setIsProcessing(false);
      return [];
    }
  }, []);

  const stopListening = useCallback(async (): Promise<DetectedNote[]> => {
    await pauseListening();
    return await processPausedAudio();
  }, [pauseListening, processPausedAudio]);

  return {
    prepareListening,
    startRecording,
    cancelListening,
    pauseListening,
    processPausedAudio,
    stopListening,
    isListening,
    isProcessing,
    currentNote,
    currentFrequency,
  };
}
