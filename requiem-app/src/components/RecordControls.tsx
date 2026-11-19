import { useState, useRef, useEffect } from "react";
import { ALL_TONALITIES } from "../engine/TonalityAdapter";
import { Plus, Settings2, Activity, Music } from "lucide-react";

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

interface RecordControlsProps {
  isLive: boolean;
  currentFrequency: number;
  currentNote: string;
  preRecordTimeSignature: TimeSignature;
  setPreRecordTimeSignature: (val: TimeSignature) => void;
  preRecordBpm: number | "AUTO";
  setPreRecordBpm: (val: number | "AUTO") => void;
  preRecordTonality: string;
  setPreRecordTonality: (val: string) => void;
  preRecordTemperature: number;
  setPreRecordTemperature: (val: number) => void;
  onToggleLive?: () => void;
}

const NUMERATOR_OPTIONS = [2, 3, 4, 6, 9];
const DENOMINATOR_OPTIONS = [4, 8];

export function RecordControls({
  isLive,
  currentFrequency,
  currentNote,
  preRecordTimeSignature,
  setPreRecordTimeSignature,
  preRecordBpm,
  setPreRecordBpm,
  preRecordTonality,
  setPreRecordTonality,
  preRecordTemperature,
  setPreRecordTemperature,
  onToggleLive,
}: RecordControlsProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [customBpmStr, setCustomBpmStr] = useState<string>("");

  useEffect(() => {
    if (preRecordBpm === "AUTO") {
      setCustomBpmStr("");
    } else {
      setCustomBpmStr(preRecordBpm.toString());
    }
  }, [preRecordBpm, isSettingsOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setIsSettingsOpen(false);
      }
    };
    if (isSettingsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isSettingsOpen]);

  return (
    <div className="w-full max-w-3xl px-4 flex flex-col items-center transition-all duration-500 mb-8 z-20">
      <div className="w-full max-w-2xl flex flex-col gap-2 relative">
        {/* Top small indicators */}
        <div className="flex justify-between items-center px-4 mb-2">
          <span className="text-[10px] text-white/40 flex items-center gap-1.5 font-mono uppercase tracking-wider">
            <svg className="w-3 h-3 text-white/30" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            Requiem Live Engine · Piano
          </span>
          <span className="text-[10px] text-white/40 flex items-center gap-1.5 font-mono uppercase tracking-wider">
            <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-ping' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse'}`} />
            {isLive ? 'Ao Vivo' : 'Pronto'}
          </span>
        </div>

        {/* Settings Popup */}
        {isSettingsOpen && !isLive && (
          <div 
            ref={settingsRef}
            className="absolute bottom-full mb-3 left-0 w-full backdrop-blur-sm p-4 flex flex-col sm:flex-row gap-6 animate-fade-in origin-bottom z-50 shadow-2xl"
            style={{
              borderRadius: '20px',
              border: '1px solid transparent',
              backgroundImage: 'linear-gradient(90deg, rgba(10, 10, 10, 0.84) 0%), linear-gradient(135deg, rgba(62, 62, 62, 0.88) 0%, transparent 40%)',
              backgroundOrigin: 'border-box',
              backgroundClip: 'padding-box, border-box',
              boxShadow: 'inset 0px 0px 5px -2px rgba(242,242,242,0.16)',
            }}
          >
            {/* Time Signature */}
            <div className="flex-1 flex flex-col gap-2 border-b sm:border-b-0 sm:border-r border-white/10 pb-4 sm:pb-0 sm:pr-6">
              <span className="text-[10px] uppercase font-mono tracking-wider text-white/40 flex items-center gap-1.5">
                <Settings2 size={12} /> Formula de Compasso
              </span>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex flex-col gap-1 w-full bg-black/40 rounded-lg p-1.5 border border-white/5">
                  {NUMERATOR_OPTIONS.map((n) => (
                    <button
                      key={`num-${n}`}
                      onClick={() => setPreRecordTimeSignature({ ...preRecordTimeSignature, numerator: n })}
                      className={`py-1.5 text-xs font-medium rounded transition-colors ${preRecordTimeSignature.numerator === n ? "bg-emerald-500/20 text-emerald-400" : "text-white/60 hover:bg-white/5 hover:text-white"}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <span className="text-white/20 text-xl font-light">/</span>
                <div className="flex flex-col gap-1 w-full bg-black/40 rounded-lg p-1.5 border border-white/5">
                  {DENOMINATOR_OPTIONS.map((d) => (
                    <button
                      key={`den-${d}`}
                      onClick={() => setPreRecordTimeSignature({ ...preRecordTimeSignature, denominator: d })}
                      className={`py-1.5 text-xs font-medium rounded transition-colors ${preRecordTimeSignature.denominator === d ? "bg-emerald-500/20 text-emerald-400" : "text-white/60 hover:bg-white/5 hover:text-white"}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* BPM */}
            <div className="flex-1 flex flex-col gap-2 border-b sm:border-b-0 sm:border-r border-white/10 pb-4 sm:pb-0 sm:pr-6">
              <span className="text-[10px] uppercase font-mono tracking-wider text-white/40 flex items-center gap-1.5">
                <Activity size={12} /> Andamento (BPM)
              </span>
              <button
                onClick={() => setPreRecordBpm("AUTO")}
                className={`mt-2 w-full py-2 rounded-lg text-xs font-medium transition-colors border ${preRecordBpm === "AUTO" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-black/40 border-white/5 text-white/60 hover:bg-white/5 hover:text-white"}`}
              >
                Auto (Score Follower)
              </button>
              <div className="mt-2">
                <input 
                  type="number"
                  min="40"
                  max="300"
                  placeholder="BPM manual (ex: 120)"
                  value={customBpmStr}
                  onChange={(e) => {
                    setCustomBpmStr(e.target.value);
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val > 0) {
                      setPreRecordBpm(val);
                    }
                  }}
                  onBlur={() => {
                    if (customBpmStr === "" && preRecordBpm !== "AUTO") {
                      setCustomBpmStr("120");
                      setPreRecordBpm(120);
                    } else if (preRecordBpm === "AUTO") {
                      setCustomBpmStr("");
                    }
                  }}
                  className="w-full bg-black/40 border border-white/5 rounded-lg py-2 px-3 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
            </div>

            {/* Tonality */}
            <div className="flex-1 flex flex-col gap-2">
              <span className="text-[10px] uppercase font-mono tracking-wider text-white/40 flex items-center gap-1.5">
                <Music size={12} /> Tonalidade
              </span>
              <button
                onClick={() => setPreRecordTonality("AUTO")}
                className={`mt-2 w-full py-2 rounded-lg text-xs font-medium transition-colors border ${preRecordTonality === "AUTO" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-black/40 border-white/5 text-white/60 hover:bg-white/5 hover:text-white"}`}
              >
                Tom original da musica
              </button>
              <select
                value={preRecordTonality}
                onChange={(e) => setPreRecordTonality(e.target.value)}
                className={`mt-2 w-full bg-black/40 border rounded-lg py-2 px-3 text-xs font-medium focus:outline-none appearance-none cursor-pointer transition-colors ${preRecordTonality !== "AUTO" ? "border-emerald-500/50 text-emerald-400" : "border-white/5 text-white/60 hover:border-white/20"}`}
              >
                <option value="AUTO" disabled>Selecionar tom manual...</option>
                {ALL_TONALITIES.map(t => (
                  <option key={t.value} value={t.value} className="bg-zinc-900 text-white">{t.label}</option>
                ))}
              </select>
            </div>
            
            {/* Temperatura (Criatividade) */}
            <div className="flex-1 flex flex-col gap-2 pl-0 sm:pl-6 border-t sm:border-t-0 sm:border-l border-white/10 pt-4 sm:pt-0">
              <span className="text-[10px] uppercase font-mono tracking-wider text-white/40 flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5"><Activity size={12} /> Criatividade Harmonica</span>
                <span className="text-emerald-400 font-bold">{preRecordTemperature.toFixed(1)}</span>
              </span>
              <input
                type="range"
                min="0.1"
                max="1.5"
                step="0.1"
                value={preRecordTemperature}
                onChange={(e) => setPreRecordTemperature(parseFloat(e.target.value))}
                className="w-full mt-3 h-1.5 bg-black/40 rounded-lg appearance-none cursor-pointer border border-white/5 accent-emerald-500"
              />
              <div className="flex justify-between text-[8px] uppercase font-mono text-white/30 mt-1">
                <span>Tradicional</span>
                <span>Inovador</span>
              </div>
            </div>

          </div>
        )}

        {/* Unboxed Controls & Action Trigger */}
        <div 
          onClick={onToggleLive}
          className="relative group flex items-center justify-between sm:justify-start gap-3 w-full py-2.5 px-2 sm:px-3 cursor-pointer transition-all duration-300"
        >
          {/* left controls */}
          <div className="flex-shrink-0 flex items-center gap-1.5 sm:gap-2 mr-1 z-30">
            {isLive ? (
               <div className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center">
                 <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
               </div>
            ) : (
               <div className="flex items-center gap-1">
                 {/* Botao de Configuracoes */}
                 <button
                   type="button"
                   onClick={(e) => {
                     e.stopPropagation();
                     setIsSettingsOpen(!isSettingsOpen);
                   }}
                   className={`flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full transition-all duration-300 ${
                     isSettingsOpen 
                       ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.25)]' 
                       : 'text-white/40 hover:text-white/90 hover:bg-white/[0.06]'
                   }`}
                   aria-label="Configuracoes Musicais"
                   title="Métrica, BPM e Tonalidade"
                 >
                   <Plus className={`w-4 h-4 sm:w-5 sm:h-5 transition-transform duration-300 ${isSettingsOpen ? 'rotate-45' : ''}`} />
                 </button>
               </div>
            )}

            {/* Custom Pills */}
            {!isLive && (
              <div className="flex items-center gap-1.5 hidden sm:flex">
                {(preRecordTimeSignature.numerator !== 4 || preRecordTimeSignature.denominator !== 4) && (
                  <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[10px] font-mono font-medium text-white/90">
                    {preRecordTimeSignature.numerator}/{preRecordTimeSignature.denominator}
                  </span>
                )}
                {preRecordBpm !== "AUTO" && (
                  <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[10px] font-mono font-medium text-white/90">
                    {preRecordBpm} BPM
                  </span>
                )}
                {preRecordTonality !== "AUTO" && (
                  <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-[10px] font-mono font-medium text-white/90">
                    Tom: {preRecordTonality}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Prompt Livre (Sem caixa no fundo) */}
          <div className="flex-1 flex items-center px-2">
            <span className={`flex items-center gap-2 text-sm sm:text-base font-light tracking-wide transition-all duration-300 ${
              isLive ? 'text-white' : 'text-white/45 group-hover:text-white/90'
            }`}>
              {!isLive && (
                <span className="w-1.5 h-1.5 rounded-full bg-white/30 group-hover:bg-emerald-400 group-hover:shadow-[0_0_8px_rgba(52,211,153,0.8)] transition-all duration-300" />
              )}
              {isLive 
                ? (currentNote ? `Ouvindo: ${currentNote} (${currentFrequency}Hz)` : 'Acompanhamento ao vivo ativo...') 
                : 'Clique para iniciar o acompanhamento'}
            </span>
          </div>
        </div>

        {/* AI Disclaimer */}
        <p className="text-center text-[11px] text-white/30 mt-3 font-medium tracking-wide">
          Requiem Live Engine - Acompanhamento Adaptativo em Tempo Real
        </p>
      </div>
    </div>
  );
}
