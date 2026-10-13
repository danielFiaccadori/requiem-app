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

export type FollowerStatus = "waiting" | "tracking" | "uncertain" | "finished";

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

/** Confiança mínima para TROCAR de acorde por causa de um ataque. */
const SWITCH_CONFIDENCE = 0.25;
/** Margem antes da próxima nota esperada que o volante não ultrapassa (beats). */
const FLYWHEEL_GUARD = 0.25;

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
  reset() {
    // Prior inicial: qualquer ponto de reentrada é possível (inícios de
    // frase e tempos fortes pesam mais). O cantor pode começar do refrão.
    for (let i = 0; i < this.n; i++) this.alpha[i] = this.entry[i];
    this.normalize(this.alpha);
    this.started = false;
    this.anchorEvent = -1;
    this.anchorPos = 0;
    this.anchorTime = 0;
    this.lastOnsetTime = 0;
    this.chordIndex = -1;
    this.confidence = 0;
    this.status = "waiting";
    this.msPerBeat = this.nominalMsPerBeat;
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
  }

  /**
   * Novo ataque de nota detectado no microfone.
   * @param pc pitch class cantada (0-11)
   * @param t  timestamp em ms (performance.now())
   */
  observeOnset(pc: number, t: number): FollowerSnapshot {
    if (this.n === 0) return this.snapshot(t);
    const { melody } = this.score;
    const obs = (((pc - this.transpose) % 12) + 12) % 12;

    // ── 1. Predição (transição) ──
    const prev = this.alpha;
    const pred = new Float64Array(this.n);
    if (!this.started) {
      pred.set(prev);
    } else {
      const elapsedBeats = (t - this.lastOnsetTime) / this.msPerBeat;
      let mass = 0;
      for (let j = 0; j < this.n; j++) mass += prev[j];
      for (let i = 0; i < this.n; i++) {
        let p = P_STAY * prev[i];
        if (i >= 1) p += P_NEXT * prev[i - 1] * this.timing(melody[i].start - melody[i - 1].start, elapsedBeats);
        if (i >= 2) p += P_SKIP1 * prev[i - 2] * this.timing(melody[i].start - melody[i - 2].start, elapsedBeats);
        if (i >= 3) p += P_SKIP2 * prev[i - 3] * this.timing(melody[i].start - melody[i - 3].start, elapsedBeats);
        p += P_JUMP * this.entry[i] * mass;
        pred[i] = p;
      }
    }

    // ── 2. Atualização (emissão) ──
    for (let i = 0; i < this.n; i++) {
      let d = Math.abs(obs - melody[i].pc);
      if (d > 6) d = 12 - d;
      pred[i] *= EMISSION[d];
    }
    this.normalize(pred);
    this.alpha = pred;
    this.started = true;
    const predictedPos = this.anchorEvent >= 0 ? this.flywheelPosition(t, false) : -1;
    this.lastOnsetTime = t;

    // ── 3. Decisão harmônica por marginalização ──
    const chordMass = new Map<string, number>();
    for (let i = 0; i < this.n; i++) {
      const sym = this.score.chords[melody[i].chordIndex]?.symbol ?? "";
      chordMass.set(sym, (chordMass.get(sym) ?? 0) + pred[i]);
    }
    let bestSym = "";
    let bestMass = -1;
    for (const [sym, m] of chordMass) {
      if (m > bestMass) { bestMass = m; bestSym = sym; }
    }

    // Estado representativo: o mais provável entre os que têm esse acorde,
    // com desempate pela proximidade da posição prevista.
    let rep = -1;
    let repScore = -1;
    for (let i = 0; i < this.n; i++) {
      if ((this.score.chords[melody[i].chordIndex]?.symbol ?? "") !== bestSym) continue;
      let s = pred[i];
      if (predictedPos >= 0) {
        const dist = Math.abs(melody[i].start - predictedPos) / this.score.beatsPerBar;
        s *= 1 + 0.5 * Math.exp(-dist);
      }
      if (s > repScore) { repScore = s; rep = i; }
    }

    const shouldCommit = this.chordIndex < 0 || bestMass >= SWITCH_CONFIDENCE;
    this.confidence = bestMass;

    if (rep >= 0 && shouldCommit) {
      this.updateTempo(rep, t);
      this.anchorEvent = rep;
      this.anchorPos = this.pickOnset(rep, predictedPos);
      this.anchorTime = t;
      this.chordIndex = this.chordAtPosition(this.anchorPos);
      this.status = "tracking";
    } else {
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
    const pos = this.flywheelPosition(t, true);
    if (pos >= this.score.totalBeats - 0.01) {
      this.status = "finished";
    }
    const ci = this.chordAtPosition(pos);
    if (ci !== this.chordIndex) this.chordIndex = ci;
    return this.snapshot(t);
  }

  snapshot(t: number): FollowerSnapshot {
    return {
      status: this.status,
      eventIndex: this.anchorEvent,
      position: this.anchorEvent >= 0 ? this.flywheelPosition(t, true) : 0,
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

  private flywheelPosition(t: number, guard: boolean): number {
    const { melody, totalBeats } = this.score;
    let pos = this.anchorPos + (t - this.anchorTime) / this.msPerBeat;
    if (guard) {
      const next = melody[this.anchorEvent + 1];
      const limit = next ? next.start - FLYWHEEL_GUARD : totalBeats;
      pos = Math.min(pos, Math.max(this.anchorPos, limit));
    }
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
    if (step < 1 || step > 3) return;
    const beats = this.score.melody[rep].start - this.anchorPos;
    const dt = t - this.anchorTime;
    if (beats <= 0.5 || dt <= 0) return;
    const sample = dt / beats;
    // Rejeita amostras absurdas (respirações longas, erros de rastreio)
    if (sample < this.msPerBeat * 0.6 || sample > this.msPerBeat * 1.6) return;
    const next = 0.8 * this.msPerBeat + 0.2 * sample;
    this.msPerBeat = Math.min(this.nominalMsPerBeat * 1.8, Math.max(this.nominalMsPerBeat * 0.55, next));
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
