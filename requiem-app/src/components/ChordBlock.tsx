import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { ChordRoll } from "./ChordRoll";
import { HARMONY_GRAPH, getNeuralProbs } from "../engine/HarmonyEngine";

export interface ChordBlockProps {
  chord: string;
  left: number;
  width: number;
  prevChord: string;
  tonality: string;
  onReplace: (c: string) => void;
  onResizeStart: (e: React.MouseEvent, dir: "left" | "right") => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onRemove: () => void;
}

export function ChordBlock({
  chord, left, width, prevChord, tonality, onReplace, onResizeStart,
  draggable, onDragStart, onDragOver, onDrop, onRemove
}: ChordBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const blockRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          blockRef.current && !blockRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    
    const updatePosition = () => {
      if (isOpen && blockRef.current) {
        const rect = blockRef.current.getBoundingClientRect();
        setMenuPos({ top: rect.bottom + 8, left: rect.left + rect.width / 2 });
      }
    };

    if (isOpen) {
      updatePosition();
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  const { mathChords, dataChords } = useMemo(() => {
    const node = HARMONY_GRAPH[prevChord] || HARMONY_GRAPH[tonality] || HARMONY_GRAPH["C"];
    const transitions = Array.from(node.allowedTransitions);

    // Probabilidades neurais do LSTM para o acorde anterior
    const neuralProbs = getNeuralProbs([prevChord]);

    // "Dataset Patterns" = acordes que o LSTM prefere com prob > 5%
    const dataList = Array.from(neuralProbs.entries())
      .filter(([c, p]) => p >= 0.05 && c !== chord && c in HARMONY_GRAPH)
      .map(([c, p]) => ({ chord: c, prob: p }))
      .sort((a, b) => b.prob - a.prob)
      .slice(0, 8);

    const dataSet = new Set(dataList.map(x => x.chord));
    // "Alternativas Teóricas" = transições do grafo não cobertas pelo neural
    const mathList = transitions.filter(c => c !== chord && !dataSet.has(c));

    return { mathChords: mathList, dataChords: dataList };
  }, [chord, prevChord, tonality]);

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const handleSelect = (e: React.MouseEvent, c: string) => {
    e.stopPropagation();
    onReplace(c);
    setIsOpen(false);
  };

  return (
    <div 
      ref={blockRef}
      className="absolute top-2 bottom-2 transition-all cursor-pointer group" 
      style={{ left: `${left + 2}px`, width: `${width - 4}px` }} 
      onClick={toggleMenu}
      draggable={draggable && !isOpen}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ChordRoll 
         chord={chord}
         width={width - 4}
         isSelected={isOpen}
         onResizeStart={(e, dir) => { e.stopPropagation(); onResizeStart(e, dir); }}
      />

      {!isOpen && (
        <button 
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute -top-1.5 -right-1.5 p-1 bg-white text-black hover:bg-gray-200 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-md scale-90 hover:scale-100 z-[60]"
          title="Excluir Acorde"
        >
          <Trash2 size={12} strokeWidth={2.5} />
        </button>
      )}

      {/* Smart Menu Hover / Popover (Portal) */}
      {isOpen && typeof document !== "undefined" && createPortal(
        <div 
          ref={menuRef} 
          className="fixed w-64 backdrop-blur-sm shadow-2xl z-[9999] animate-fade-in cursor-default flex flex-col"
          style={{ 
            top: `${menuPos.top}px`, 
            left: `${menuPos.left}px`,
            transform: 'translateX(-50%)',
            borderRadius: '20px',
            border: '1px solid transparent',
            backgroundImage: 'linear-gradient(90deg, rgba(10, 10, 10, 0.84) 0%), linear-gradient(135deg, rgba(62, 62, 62, 0.88) 0%, transparent 40%)',
            backgroundOrigin: 'border-box',
            backgroundClip: 'padding-box, border-box',
            boxShadow: 'inset 0px 0px 5px -2px rgba(242,242,242,0.16)',
          }} 
          onClick={e => e.stopPropagation()}
        >
          <div className="max-h-80 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/30 rounded-[20px] pb-1">
            {/* Section 1: Math Alternatives */}
            {mathChords.length > 0 && (
              <div className="p-2 pt-3">
                <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest px-2 pb-1.5 mb-1 flex items-center gap-1.5">
                  <ShieldCheck size={12} /> Alternativas Teóricas
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2 px-1">
                  {mathChords.map((c, i) => (
                    <button
                      key={`math-${i}`}
                      onClick={(e) => handleSelect(e, c)}
                      className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 rounded-md text-xs font-mono font-medium text-white/70 hover:text-white transition-colors"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Section 2: Neural Model (✨) */}
            {dataChords.length > 0 && (
              <div className="p-2 bg-zinc-950/20 mt-1">
                <div className="text-[10px] font-mono text-white/80 uppercase tracking-widest px-2 pb-1.5 mb-1 flex items-center gap-1.5">
                  <Sparkles size={12} /> Neural Patterns
                </div>
                <div className="mt-1">
                  {dataChords.map((s, i) => (
                    <button
                      key={`data-${i}`}
                      onClick={(e) => handleSelect(e, s.chord)}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 rounded-lg transition-colors group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-white/5 rounded text-xs font-mono font-bold text-white/90 group-hover:bg-white group-hover:text-black">
                          ✨ {s.chord}
                        </span>
                      </div>
                      <span className="text-[10px] text-white/40 font-mono">{(s.prob * 100).toFixed(0)}% prob</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
