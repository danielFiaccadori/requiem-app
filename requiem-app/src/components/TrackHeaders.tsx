import { useState, useRef, useEffect } from "react";
import { Volume2, VolumeX, Keyboard, Music, Radio, ChevronDown, Dices, Sparkles, Plus, Trash2, Mic, Cpu } from "lucide-react";
import type { InstrumentType, ExtraTrack } from "../App";
import type { MIDIEvent } from "../hooks/useMIDIConnector";

export interface TrackHeadersProps {
  rulerHeight: number;
  melodyInstrument: InstrumentType;
  setMelodyInstrument: (v: InstrumentType) => void;
  chordsInstrument: InstrumentType;
  setChordsInstrument: (v: InstrumentType) => void;
  melodyVolume: number;
  setMelodyVolume: (v: number) => void;
  melodyMuted: boolean;
  setMelodyMuted: (v: boolean) => void;
  chordsVolume: number;
  setChordsVolume: (v: number) => void;
  chordsMuted: boolean;
  setChordsMuted: (v: boolean) => void;
  onReroll?: () => void;
  // Dynamic tracks
  extraTracks: ExtraTrack[];
  selectedTrackIndex: number | null;
  onSelectTrack: (index: number | null) => void;
  onAddExtraTrack: (type?: 'audio' | 'midi' | 'smart') => void;
  onRemoveExtraTrack: (index: number) => void;
  onRenameExtraTrack?: (index: number, newName: string) => void;
  onSetExtraTrackInstrument: (index: number, instrument: InstrumentType) => void;
  onSetExtraTrackVolume: (index: number, volume: number) => void;
  onSetExtraTrackMuted: (index: number, muted: boolean) => void;
  isMIDIRecording?: boolean;
  midiReady?: boolean;
  lastMIDIEvent?: MIDIEvent | null;
}

const INSTRUMENT_OPTIONS: { value: InstrumentType; label: string; icon: React.ReactNode }[] = [
  { value: "piano", label: "Acoustic Piano", icon: <Keyboard size={14} /> },
  { value: "strings", label: "Strings", icon: <Music size={14} /> },
  { value: "pad", label: "Ethereal Pad", icon: <Radio size={14} /> },
];

function InstrumentSelector({ 
  value, 
  onChange 
}: { 
  value: InstrumentType; 
  onChange: (v: InstrumentType) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentOption = INSTRUMENT_OPTIONS.find(o => o.value === value) || INSTRUMENT_OPTIONS[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 bg-black/40 hover:bg-black/60 border border-white/5 hover:border-white/20 rounded-md transition-colors"
        title="Trocar Timbre"
      >
        <span className="text-white/70">{currentOption.icon}</span>
        <ChevronDown size={10} className="text-white/40" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-40 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl overflow-hidden z-50 animate-fade-in">
          {INSTRUMENT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
                value === opt.value 
                  ? "bg-emerald-500/10 text-emerald-400" 
                  : "text-white/60 hover:bg-white/5 hover:text-white"
              }`}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddTrackMenu({ onAdd }: { onAdd: (type: 'audio' | 'midi' | 'smart') => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative flex-none" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-10 flex items-center justify-center gap-2 text-white/30 hover:text-white/60 hover:bg-white/[0.03] border-b border-white/5 transition-all group"
        title="Adicionar Track"
      >
        <Plus size={14} className="group-hover:text-emerald-400 transition-colors" />
        <span className="text-[10px] font-semibold tracking-wider uppercase">Adicionar Track</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-4 mb-2 w-48 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl overflow-hidden z-50 animate-fade-in">
          <button
            onClick={() => { onAdd('audio'); setIsOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-3 text-xs font-medium text-white/70 hover:bg-white/5 hover:text-white transition-colors"
          >
            <Mic size={14} className="text-blue-400" />
            <div className="flex flex-col items-start">
              <span>Track de Áudio</span>
              <span className="text-[9px] text-white/30">Gravar áudio externo</span>
            </div>
          </button>
          <button
            onClick={() => { onAdd('midi'); setIsOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-3 text-xs font-medium text-white/70 hover:bg-white/5 hover:text-white transition-colors border-t border-white/5"
          >
            <Keyboard size={14} className="text-emerald-400" />
            <div className="flex flex-col items-start">
              <span>Track MIDI</span>
              <span className="text-[9px] text-white/30">Sequenciador de notas</span>
            </div>
          </button>
          <button
            onClick={() => { onAdd('smart'); setIsOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-3 text-xs font-medium text-white/70 hover:bg-white/5 hover:text-white transition-colors border-t border-white/5"
          >
            <Cpu size={14} className="text-purple-400" />
            <div className="flex flex-col items-start">
              <span>Track Inteligente</span>
              <span className="text-[9px] text-white/30">Geração IA generativa</span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

export function TrackHeaders({ 
  rulerHeight,
  melodyInstrument,
  setMelodyInstrument,
  chordsInstrument,
  setChordsInstrument,
  melodyVolume,
  setMelodyVolume,
  melodyMuted,
  setMelodyMuted,
  chordsVolume,
  setChordsVolume,
  chordsMuted,
  setChordsMuted,
  onReroll,
  // Dynamic tracks
  extraTracks,
  selectedTrackIndex,
  onSelectTrack,
  onAddExtraTrack,
  onRemoveExtraTrack,
  onRenameExtraTrack,
  onSetExtraTrackInstrument,
  onSetExtraTrackVolume,
  onSetExtraTrackMuted,
  isMIDIRecording = false,
  midiReady = false,
  lastMIDIEvent = null,
}: TrackHeadersProps) {
  const [editingTrackIndex, setEditingTrackIndex] = useState<number | null>(null);
  const [editingTrackName, setEditingTrackName] = useState("");

  return (
    <div className="w-[220px] flex flex-col shrink-0 bg-[#131313] z-20 border-r border-white/5 overflow-y-auto">
      <div style={{ height: `${rulerHeight}px` }} className="bg-[#1e1e1e] border-b border-white/5 shrink-0" />
      
      {/* ── TRACK 1: CHORDS (hardcoded) ── */}
      <div className="h-[96px] flex-none flex flex-col justify-center bg-[#121212] border-b border-white/5 relative px-3">
        <div className="flex items-start justify-between opacity-90 hover:opacity-100 transition-opacity">
          <div className="flex items-center gap-2">
            <div className="w-1 h-8 bg-white/50 rounded-full" />
            <div>
              <div className="text-[10px] font-bold tracking-widest text-white/50 uppercase">Track 1</div>
              <div className="flex items-center gap-2">
                <div className="text-xs sm:text-sm font-semibold tracking-wide text-white/90">CHORDS</div>
                <InstrumentSelector value={chordsInstrument} onChange={setChordsInstrument} />
              </div>
            </div>
          </div>
          
          {/* Botão Reroll */}
          {onReroll && (
            <button
              onClick={onReroll}
              className="group flex items-center justify-center p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.4)]"
              title="Gerar nova progressão"
            >
              <div className="relative">
                <Dices size={14} className="text-white/70 group-hover:text-emerald-400 transition-colors" />
                <Sparkles size={8} className="absolute -top-1 -right-1 text-emerald-300 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          )}
        </div>

        {/* Volume/Mute Controls */}
        <div className="flex items-center justify-end gap-2 mt-1 px-1 opacity-60 hover:opacity-100 transition-opacity">
          <input 
            type="range" 
            min="0" max="1" step="0.05"
            value={chordsVolume}
            onChange={(e) => setChordsVolume(parseFloat(e.target.value))}
            className="w-16 h-1 bg-white/20 rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
          />
          <button 
            onClick={() => setChordsMuted(!chordsMuted)}
            className={`p-1 rounded-md transition-colors ${chordsMuted ? 'text-red-400 bg-red-400/10' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
          >
            {chordsMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
          </button>
        </div>
      </div>

      {/* ── TRACK 2: LEAD MELODY (hardcoded) ── */}
      <div className="h-40 flex-none flex flex-col bg-[#181818] border-b border-white/5">
        <div className="flex items-start justify-between px-3 py-3 opacity-90 hover:opacity-100 transition-opacity">
          <div className="flex items-center gap-2">
            <div className="w-1 h-8 bg-white/80 rounded-full" />
            <div>
              <div className="text-[10px] font-bold tracking-widest text-white/50 uppercase">Track 2</div>
              <div className="text-xs sm:text-sm font-semibold tracking-wide text-white/90">LEAD MELODY</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-3 pb-3 mt-auto">
          {/* Instrument Selector */}
          <InstrumentSelector value={melodyInstrument} onChange={setMelodyInstrument} />

          {/* Volume/Mute Controls */}
          <div className="flex items-center gap-2">
            <input 
              type="range" 
              min="0" max="1" step="0.05"
              value={melodyVolume}
              onChange={(e) => setMelodyVolume(parseFloat(e.target.value))}
              className="w-16 h-1 bg-white/20 rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
            />
            <button 
              onClick={() => setMelodyMuted(!melodyMuted)}
              className={`p-1.5 rounded-md transition-colors ${melodyMuted ? 'text-red-400 bg-red-400/10' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
            >
              {melodyMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── DYNAMIC EXTRA TRACKS ── */}
      {extraTracks.map((track, index) => {
        const isSelected = selectedTrackIndex === index;
        const isThisRecording = isSelected && isMIDIRecording;

        return (
          <div 
            key={track.id}
            onClick={() => onSelectTrack(isSelected ? null : index)}
            className={`group h-32 flex-none flex flex-col bg-[#161616] border-b border-white/5 cursor-pointer transition-all ${
              isThisRecording 
                ? "ring-1 ring-red-500/50 bg-red-500/5" 
                : isSelected 
                  ? "ring-1 ring-emerald-500/30 bg-emerald-500/5" 
                  : "hover:bg-white/[0.02]"
            }`}
          >
            <div className="flex items-start justify-between px-3 py-2.5 opacity-90 hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-2">
                <div className={`w-1 h-7 rounded-full transition-colors ${
                  isThisRecording ? "bg-red-400 animate-pulse" : isSelected ? "bg-emerald-400" : "bg-white/30"
                }`} />
                <div>
                  <div className="text-[10px] font-bold tracking-widest text-white/50 uppercase flex items-center gap-1.5">
                    Track {3 + index}
                    {isThisRecording && (
                      <span className="flex items-center gap-1 text-red-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                        REC
                      </span>
                    )}
                    {isSelected && !isMIDIRecording && midiReady && (!track.trackType || track.trackType === 'midi') && (
                      <span className="text-emerald-400/70 text-[9px] font-normal tracking-normal">MIDI</span>
                    )}
                  </div>
                  <div className="text-xs font-semibold tracking-wide text-white/80 flex items-center gap-1.5 cursor-text">
                    {track.trackType === 'audio' && <Mic size={12} className="text-blue-400" />}
                    {track.trackType === 'smart' && <Cpu size={12} className="text-purple-400" />}
                    {(!track.trackType || track.trackType === 'midi') && <Keyboard size={12} className="text-emerald-400" />}
                    
                    {editingTrackIndex === index ? (
                      <input 
                        autoFocus
                        value={editingTrackName}
                        onChange={(e) => setEditingTrackName(e.target.value)}
                        onBlur={() => {
                          onRenameExtraTrack?.(index, editingTrackName || track.name);
                          setEditingTrackIndex(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onRenameExtraTrack?.(index, editingTrackName || track.name);
                            setEditingTrackIndex(null);
                          }
                          if (e.key === 'Escape') {
                            setEditingTrackIndex(null);
                          }
                        }}
                        className="bg-transparent text-xs font-semibold tracking-wide text-white outline-none w-24 border-b border-white/20 pb-0.5 focus:border-white/50"
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div 
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingTrackIndex(index);
                          setEditingTrackName(track.name);
                        }}
                      >
                        {track.name}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Delete button */}
              {!isThisRecording && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveExtraTrack(index); }}
                  className="p-1 text-white/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                  title="Remover Track"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>

            {/* Last MIDI note indicator */}
            {isThisRecording && lastMIDIEvent && lastMIDIEvent.action === "note-on" && (
              <div className="px-3 mb-1">
                <span className="text-[10px] font-mono text-red-300/80 animate-pulse">
                  ♪ {lastMIDIEvent.note} (vel: {lastMIDIEvent.velocity})
                </span>
              </div>
            )}

            <div className="flex items-center justify-between px-3 pb-2 mt-auto" onClick={e => e.stopPropagation()}>
              <InstrumentSelector 
                value={track.instrument} 
                onChange={(v) => onSetExtraTrackInstrument(index, v)} 
              />
              <div className="flex items-center gap-2">
                <input 
                  type="range" 
                  min="0" max="1" step="0.05"
                  value={track.volume}
                  onChange={(e) => onSetExtraTrackVolume(index, parseFloat(e.target.value))}
                  className="w-14 h-1 bg-white/20 rounded-full appearance-none outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                />
                <button 
                  onClick={() => onSetExtraTrackMuted(index, !track.muted)}
                  className={`p-1 rounded-md transition-colors ${track.muted ? 'text-red-400 bg-red-400/10' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
                >
                  {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* ── ADD TRACK BUTTON ── */}
      <AddTrackMenu onAdd={onAddExtraTrack} />

    </div>
  );
}
