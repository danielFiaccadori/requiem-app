// ─────────────────────────────────────────────────────────
//  ScoreFollower — rastreamento da posição do cantor na música
// ─────────────────────────────────────────────────────────
//
//  Modelo: HMM online (algoritmo "forward") sobre os eventos de
//  melodia da partitura de referência.
//
//    estado i      = "o cantor está cantando o evento de melodia i"
//    observação    = pitch class de um NOVO ataque detectado no microfone
//    transição     = avançar 1 (normal), ficar (re-articulação),
//                    pular 1-2 (nota perdida pelo detector) ou
//                    SALTAR para qualquer ponto (voltas, repetições,
//                    cortes de improviso — típico de casamento),
//                    com preferência por pontos de reentrada
//                    (inícios de frase e tempos fortes).
//
//  Decisão harmônica por MARGINALIZAÇÃO: em vez de escolher o estado
//  mais provável e tocar o acorde dele, somamos a probabilidade de
//  todos os estados que compartilham o mesmo acorde. Assim, quando o
//  cantor está numa estrofe que se repete (melodia idêntica em vários
//  pontos da música), a ambiguidade de posição NÃO gera ambiguidade
//  harmônica — porque estrofes repetidas têm os mesmos acordes.
//
//  Entre ataques, um "volante" (flywheel) avança a posição pelo
//  relógio usando o andamento estimado — o que permite trocar de
//  acorde no tempo certo durante notas longas e respirações. Ele
//  NUNCA avança além da próxima nota esperada da melodia: se o
//  cantor segura (fermata) ou para, o acompanhamento espera,
//  exatamente como um pianista humano faria.
//
//  ⚠ Sem dependências de runtime — testável offline em Node.
// ─────────────────────────────────────────────────────────

import type { SongScore } from "./ScoreBuilder";

export type FollowerStatus = "waiting" | "tracking" | "seeking" | "uncertain" | "finished";

export interface FollowerSnapshot {
  status: FollowerStatus;
  /** Evento de melodia ancorado (-1 = ainda não começou) */
  eventIndex: number;
  /** Posição atual em beats */
  position: number;
  /** Acorde atual (índice em score.chords, -1 = nenhum) */
  chordIndex: number;
  /** Massa de probabilidade do acorde escolhido (0-1) */
  confidence: number;
  /** Andamento estimado (ms por beat) */
  msPerBeat: number;
}

export interface FollowerOptions {
  /** Andamento inicial (ms por beat). Padrão: score.msPerBeat */
  msPerBeat?: number;
  /** Transposição do cantor em semitons relativa à tonalidade da partitura */
  transpose?: number;
}

// ── Parâmetros do modelo (calibrados na simulação offline e mic ao vivo) ──
const P_STAY = 0.1;
const P_NEXT = 0.58;
const P_SKIP1 = 0.14;
const P_SKIP2 = 0.05;
const P_JUMP = 0.13;

/** P(observado | esperado) pela distância em semitons (circular 0-6). Mais tolerante para mic ao vivo. */
const EMISSION = [0.6, 0.2, 0.1, 0.05, 0.05, 0.05, 0.05];

/** Ataques consecutivos coerentes com a previsao para entrar em modo autonomo. */
const LOCK_HITS = 3;
/** Erro maximo (beats) entre a posicao prevista e a ancorada para contar como acerto. */
const LOCK_TOLERANCE = 2;
/** Ataques incoerentes consecutivos que tiram o follower do modo autonomo. */
const UNLOCK_MISSES = 2;

export class ScoreFollower {
  readonly score: SongScore;
  private readonly n: number;
  private readonly entry: Float64Array;
  private alpha: Float64Array;
  private started = false;

  private transpose: number;
  private nominalMsPerBeat: number;
  private msPerBeat: number;

  // Âncora temporal: evento i começou (no relógio) em anchorTime, na posição anchorPos
  private anchorEvent = -1;
  private anchorPos = 0;
  private anchorTime = 0;
  private lastOnsetTime = 0;

  private chordIndex = -1;
  private confidence = 0;
  private status: FollowerStatus = "waiting";

  private locked = false;
  private hits = 0;
  private misses = 0;

  // Rastreamento de saltos de trecho (Hold & Listen / Histerese)
  private pendingJumpEvent = -1;
  private pendingJumpPos = -1;
  private pendingJumpTime = 0;
  private pendingJumpHits = 0;

  // Reconhecimento de contorno melódico e saltos aprendidos (N-grams)
  private lastObservedMidi: number | null = null;
  private recentOnsets: { pc: number; midi?: number; t: number }[] = [];

  constructor(score: SongScore, opts: FollowerOptions = {}) {
    this.score = score;
    this.n = score.melody.length;
    this.transpose = opts.transpose ?? 0;
    this.nominalMsPerBeat = opts.msPerBeat ?? score.msPerBeat;
    this.msPerBeat = this.nominalMsPerBeat;

    const entry = new Float64Array(this.n);
    let sum = 0;
    for (let i = 0; i < this.n; i++) {
      entry[i] = score.melody[i].entryWeight;
      sum += entry[i];
    }
    for (let i = 0; i < this.n; i++) entry[i] /= sum || 1;
    this.entry = entry;
    this.alpha = new Float64Array(this.n);
    this.reset();
  }

  /** Reinicia o rastreamento (nova performance). */
  reset(startTime: number = performance.now()) {
    for (let i = 0; i < this.n; i++) this.alpha[i] = this.entry[i];
    this.normalize(this.alpha);
    this.started = false;
    this.anchorEvent = 0;
    this.anchorPos = 0;
    this.anchorTime = startTime;
    this.lastOnsetTime = startTime;
    this.chordIndex = this.chordAtPosition(0);
    this.confidence = 1;
    this.status = "tracking";
    this.locked = true;
    this.hits = 0;
    this.misses = 0;
    this.msPerBeat = this.nominalMsPerBeat;
    this.pendingJumpEvent = -1;
    this.pendingJumpPos = -1;
    this.pendingJumpTime = 0;
    this.pendingJumpHits = 0;
    this.lastObservedMidi = null;
    this.recentOnsets = [];
  }

  /**
   * O cantor parou: sai do modo autonomo. O volante volta a esperar na
   * proxima nota esperada ate o cantor reaparecer e a posicao ser re-encontrada.
   */
  isLocked(): boolean {
    return this.locked;
  }

  halt() {
    this.locked = false;
    this.hits = 0;
    this.misses = 0;
    this.pendingJumpEvent = -1;
    this.pendingJumpPos = -1;
    this.pendingJumpHits = 0;
  }

  setTranspose(semitones: number) {
    this.transpose = semitones;
  }

  /**
   * Silêncio longo: o cantor parou. Mantém parte da crença (continuação
   * é o mais provável) mas abre espaço para reentrada em qualquer ponto.
   */
  relax() {
    for (let i = 0; i < this.n; i++) {
      const next = i > 0 ? this.alpha[i - 1] : 0;
      this.alpha[i] = 0.35 * this.alpha[i] + 0.25 * next + 0.4 * this.entry[i];
    }
    this.normalize(this.alpha);
    this.status = "waiting";
    this.pendingJumpEvent = -1;
    this.pendingJumpPos = -1;
    this.pendingJumpHits = 0;
  }

  /**
   * Novo ataque de nota detectado no microfone ou instrumento (ex: violino).
   * @param pc   pitch class (0-11)
   * @param t    timestamp em ms (performance.now())
   * @param midi nota MIDI absoluta detectada (0-127, opcional para bônus de oitava/intervalos)
   */
  observeOnset(pc: number, t: number, midi?: number): FollowerSnapshot {
    if (this.n === 0) return this.snapshot(t);
    const { melody } = this.score;
    const obs = (((pc - this.transpose) % 12) + 12) % 12;
    const obsMidi = midi !== undefined ? midi - this.transpose : undefined;

    // Filtro anti-rebote: descarta ataques duplicados da mesma nota em intervalo menor que 65ms
    if (this.lastOnsetTime > 0 && t - this.lastOnsetTime < 65 && this.recentOnsets.length > 0) {
      const last = this.recentOnsets[this.recentOnsets.length - 1];
      if (last.pc === obs) {
        return this.snapshot(t);
      }
    }

    // Registra histórico de notas para reconhecimento melódico relativo
    this.recentOnsets.push({ pc: obs, midi: obsMidi, t });
    if (this.recentOnsets.length > 5) this.recentOnsets.shift();

    const predictedPos = this.anchorEvent >= 0 ? this.flywheelPosition(t) : -1;

    // ── 1. Predição (transição HMM) ──
    const prev = this.alpha;
    const pred = new Float64Array(this.n);
    if (!this.started) {
      pred.set(prev);
    } else {
      const elapsedBeats = Math.max(0.01, (t - this.lastOnsetTime) / this.msPerBeat);
      let mass = 0;
      for (let j = 0; j < this.n; j++) mass += prev[j];

      // Enquanto estamos em tracking ativo, a probabilidade de salto aleatório é minúscula (0.005)
      // para evitar que refrões repetidos roubem a posição do cantor.
      const currentPJump = this.status === "tracking" ? 0.005 : P_JUMP;
      const currentPNext = this.status === "tracking" ? 0.68 : P_NEXT;
      const currentPStay = this.status === "tracking" ? 0.16 : P_STAY;
      const currentPSkip1 = this.status === "tracking" ? 0.12 : P_SKIP1;
      const currentPSkip2 = this.status === "tracking" ? 0.03 : P_SKIP2;

      for (let i = 0; i < this.n; i++) {
        let p = currentPStay * prev[i];
        if (i >= 1) p += currentPNext * prev[i - 1] * this.timing(melody[i].start - melody[i - 1].start, elapsedBeats);
        if (i >= 2) p += currentPSkip1 * prev[i - 2] * this.timing(melody[i].start - melody[i - 2].start, elapsedBeats);
        if (i >= 3) p += currentPSkip2 * prev[i - 3] * this.timing(melody[i].start - melody[i - 3].start, elapsedBeats);
        p += currentPJump * this.entry[i] * mass;
        pred[i] = p;
      }

      // N-grams aprendidos do MIDI: usados para recuperação de posição quando o follower
      // está buscando (seeking) ou incerto, sem poluir o rastreamento linear normal.
      if (this.score.signatures && this.recentOnsets.length >= 2 && this.status !== "tracking") {
        const len = this.recentOnsets.length;
        const prev1 = this.recentOnsets[len - 2];
        const bigramKey = `${prev1.pc}_${obs}`;
        const bigramHits = this.score.signatures.bigrams[bigramKey] ?? [];

        let trigramHits: number[] = [];
        if (len >= 3) {
          const prev2 = this.recentOnsets[len - 3];
          const trigramKey = `${prev2.pc}_${prev1.pc}_${obs}`;
          trigramHits = this.score.signatures.trigrams[trigramKey] ?? [];
        }

        if (trigramHits.length > 0) {
          for (const idx of trigramHits) {
            if (idx >= 0 && idx < this.n) pred[idx] += 0.35 / trigramHits.length;
          }
        } else if (bigramHits.length > 0) {
          for (const idx of bigramHits) {
            if (idx >= 0 && idx < this.n) pred[idx] += 0.15 / bigramHits.length;
          }
        }
      }
    }

    // ── 2. Atualização (emissão multi-característica) ──
    for (let i = 0; i < this.n; i++) {
      let d = Math.abs(obs - melody[i].pc);
      if (d > 6) d = 12 - d;
      let emit = EMISSION[d];

      // Bônus/Penalidade de oitava se a altura absoluta estiver disponível
      if (obsMidi !== undefined && melody[i].midi !== undefined) {
        const semiDist = Math.abs(obsMidi - melody[i].midi);
        if (semiDist <= 2) {
          emit *= 1.45; // Altura exata da partitura
        } else if (semiDist <= 14) {
          emit *= 1.1; // Oitava próxima
        } else if (semiDist >= 24) {
          emit *= 0.55; // Muito distante do registro
        }
      }

      // Bônus de contorno melódico (intervalo em relação à nota anterior)
      if (this.lastObservedMidi !== null && obsMidi !== undefined && melody[i].intervalFromPrev !== undefined) {
        const playedInterval = obsMidi - this.lastObservedMidi;
        const expectedInterval = melody[i].intervalFromPrev;
        if (Math.abs(playedInterval - expectedInterval) <= 1) {
          emit *= 1.4; // O músico executou exatamente o salto intervalar da melodia
        }
      }

      pred[i] *= emit;
    }
    this.normalize(pred);
    this.alpha = pred;
    this.started = true;
    this.lastObservedMidi = obsMidi ?? null;
    this.lastOnsetTime = t;

    // ── 3. Decisão de Estado com Janela de Localidade ──
    // Identifica o melhor candidato na vizinhança local (±1.5 compassos) e o melhor global
    let localBest = -1;
    let localBestScore = -1;
    let globalBest = -1;
    let globalBestScore = -1;

    const localRadiusBeats = Math.max(3, this.score.beatsPerBar * 1.5);

    for (let i = 0; i < this.n; i++) {
      const p = pred[i];
      if (p > globalBestScore) {
        globalBestScore = p;
        globalBest = i;
      }

      if (predictedPos >= 0) {
        const distBeats = Math.abs(melody[i].start - predictedPos);
        if (distBeats <= localRadiusBeats) {
          // Atenuação gaussiana suave na vizinhança do volante
          const localWeight = Math.exp(-0.5 * Math.pow(distBeats / (this.score.beatsPerBar * 0.75), 2));
          const score = p * (1 + 2.5 * localWeight);
          if (score > localBestScore) {
            localBestScore = score;
            localBest = i;
          }
        }
      }
    }

    // Se temos um candidato plausível na vizinhança local do volante, ELE PREVALECE!
    // Isso garante que o acompanhamento nunca se perca durante a execução contínua.
    let rep = localBest;
    let isDistantCandidate = false;

    if (rep < 0 || (this.status !== "tracking" && globalBestScore > localBestScore * 2.5)) {
      rep = globalBest;
      if (predictedPos >= 0 && rep >= 0) {
        const distBeats = Math.abs(melody[rep].start - predictedPos);
        if (distBeats > this.score.beatsPerBar * 1.5) {
          isDistantCandidate = true;
        }
      }
    }

    if (rep >= 0) {
      const newPos = this.pickOnset(rep, predictedPos);
      const isJump = predictedPos >= 0 && (isDistantCandidate || Math.abs(newPos - predictedPos) > this.score.beatsPerBar * 1.8);

      if (isJump) {
        // HISTERESE DE SALTO: NUNCA salta imediatamente na primeira nota fora do trecho!
        // Segura a posição atual no pedal e exige 2 notas consecutivas coerentes
        // no trecho de destino antes de reposicionar a música.
        this.status = "seeking";
        this.hits = 0;
        this.locked = false;

        if (this.pendingJumpEvent < 0) {
          this.pendingJumpEvent = rep;
          this.pendingJumpPos = newPos;
          this.pendingJumpTime = t;
          this.pendingJumpHits = 1;
          // Mantém a ancoragem atual; não teletransporta
        } else {
          const elapsedBeats = (t - this.pendingJumpTime) / this.msPerBeat;
          const expectedJumpPos = this.pendingJumpPos + elapsedBeats;
          const consistency = Math.abs(newPos - expectedJumpPos);
          const isSequentialJump = rep >= this.pendingJumpEvent && rep <= this.pendingJumpEvent + 3;

          if (consistency <= Math.max(2.5, this.score.beatsPerBar) || isSequentialJump) {
            this.pendingJumpHits++;
            if (this.pendingJumpHits >= 3) {
              // CERTEZA TOTAL: 3 notas consecutivas confirmadas no novo trecho (ex: início do Refrão).
              // Transiciona suavemente a partitura para a nova seção:
              this.updateTempo(rep, t);
              this.anchorEvent = rep;
              this.anchorPos = newPos;
              this.anchorTime = t;
              this.chordIndex = this.chordAtPosition(this.anchorPos);
              this.status = "tracking";
              this.locked = true;
              this.pendingJumpEvent = -1;
              this.pendingJumpPos = -1;
              this.pendingJumpHits = 0;
            }
          } else if (Math.abs(newPos - predictedPos) <= this.score.beatsPerBar) {
            // Falso alarme: o músico continua no trecho atual
            this.pendingJumpEvent = -1;
            this.pendingJumpPos = -1;
            this.pendingJumpHits = 0;
            this.status = "tracking";
          } else {
            this.pendingJumpEvent = rep;
            this.pendingJumpPos = newPos;
            this.pendingJumpTime = t;
            this.pendingJumpHits = 1;
          }
        }
      } else {
        // Continuação regular no mesmo trecho: segue o andamento no BPM correto
        this.pendingJumpEvent = -1;
        this.pendingJumpPos = -1;
        this.pendingJumpHits = 0;

        const phaseDiff = newPos - predictedPos;
        if (predictedPos >= 0 && Math.abs(phaseDiff) <= LOCK_TOLERANCE) {
          // Ajuste suave de fase (15%) para acomodar rubato sem sobressaltos
          this.anchorPos = predictedPos + 0.15 * phaseDiff;
          this.anchorTime = t;
          this.hits++;
          if (this.hits >= LOCK_HITS) this.locked = true;
          this.misses = 0;
        } else {
          this.anchorPos = newPos;
          this.anchorTime = t;
          this.hits = 0;
        }

        this.updateTempo(rep, t);
        this.anchorEvent = rep;
        this.chordIndex = this.chordAtPosition(this.anchorPos);
        this.status = "tracking";
      }
      this.confidence = Math.max(localBestScore, globalBestScore);
    } else {
      this.misses++;
      if (this.misses >= UNLOCK_MISSES) {
        this.locked = false;
        this.hits = 0;
      }
      this.status = "uncertain";
    }
    return this.snapshot(t);
  }

  /**
   * Avança a posição pelo relógio entre ataques (volante).
   * Chamar periodicamente (ex: a cada 40ms).
   */
  tick(t: number): FollowerSnapshot {
    if (this.anchorEvent < 0) return this.snapshot(t);

    if (this.status === "seeking" && this.pendingJumpTime > 0 && t - this.pendingJumpTime > 3500) {
      this.pendingJumpEvent = -1;
      this.pendingJumpPos = -1;
      this.pendingJumpHits = 0;
      this.status = "tracking";
    }

    const pos = this.flywheelPosition(t);
    if (pos >= this.score.totalBeats - 0.01) {
      this.status = "finished";
    }
    if (this.status !== "seeking") {
      const ci = this.chordAtPosition(pos);
      if (ci !== this.chordIndex) this.chordIndex = ci;
    }
    return this.snapshot(t);
  }

  snapshot(t: number): FollowerSnapshot {
    return {
      status: this.status,
      eventIndex: this.anchorEvent,
      position: this.anchorEvent >= 0 ? this.flywheelPosition(t) : 0,
      chordIndex: this.chordIndex,
      confidence: this.confidence,
      msPerBeat: this.msPerBeat,
    };
  }

  // ─────────────────────────────────────────────────────
  //  Internos
  // ─────────────────────────────────────────────────────

  /**
   * Compatibilidade entre o tempo decorrido real e a distância na partitura.
   * Assimétrico: chegar CEDO demais é penalizado; atrasar (respirar,
   * segurar) é tolerado.
   */
  private timing(scoreBeats: number, elapsedBeats: number): number {
    if (scoreBeats <= 0) return 1;
    const r = Math.log((elapsedBeats + 0.5) / (scoreBeats + 0.5));
    const sigma = r < 0 ? 0.55 : 1.4;
    return 0.15 + 0.85 * Math.exp(-(r * r) / (2 * sigma * sigma));
  }

  private flywheelPosition(t: number): number {
    const { totalBeats } = this.score;
    // Fluxo musical contínuo: o acompanhamento nunca congela ou para no meio da canção.
    // Ele mantém o andamento e o ritmo como um pianista profissional tocando com a banda.
    const pos = this.anchorPos + (t - this.anchorTime) / this.msPerBeat;
    return Math.min(pos, totalBeats);
  }

  /** Dentro de um evento com re-articulações, escolhe o ataque mais coerente com a previsão. */
  private pickOnset(i: number, predictedPos: number): number {
    const ev = this.score.melody[i];
    if (ev.onsets.length === 1 || predictedPos < 0) return ev.start;
    let best = ev.onsets[0];
    for (const o of ev.onsets) {
      if (Math.abs(o - predictedPos) < Math.abs(best - predictedPos)) best = o;
    }
    // Re-articulação no mesmo evento: nunca volta para trás
    if (i === this.anchorEvent && best < this.anchorPos) {
      best = ev.onsets.find(o => o > this.anchorPos + 0.5) ?? this.anchorPos;
    }
    return best;
  }

  private updateTempo(rep: number, t: number) {
    if (this.anchorEvent < 0) return;
    const step = rep - this.anchorEvent;
    // Atualização de tempo apenas em passos consecutivos graduais (1 ou 2 eventos)
    if (step < 1 || step > 2) return;
    const beats = this.score.melody[rep].start - this.anchorPos;
    const dt = t - this.anchorTime;
    if (beats <= 0.5 || dt <= 0) return;
    const sample = dt / beats;
    // Rejeita amostras extremas (respirações longas, notas seguradas ou ruídos)
    if (sample < this.nominalMsPerBeat * 0.6 || sample > this.nominalMsPerBeat * 1.6) return;
    // Média móvel suave (15% nova amostra, 85% histórico)
    const next = 0.85 * this.msPerBeat + 0.15 * sample;
    this.msPerBeat = Math.min(this.nominalMsPerBeat * 1.5, Math.max(this.nominalMsPerBeat * 0.65, next));
  }

  private chordAtPosition(pos: number): number {
    const { chords } = this.score;
    let lo = 0, hi = chords.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (chords[mid].start <= pos + 1e-6) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  private normalize(arr: Float64Array) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    if (s <= 0 || !isFinite(s)) {
      for (let i = 0; i < arr.length; i++) arr[i] = this.entry[i];
      return;
    }
    for (let i = 0; i < arr.length; i++) arr[i] /= s;
  }
}
