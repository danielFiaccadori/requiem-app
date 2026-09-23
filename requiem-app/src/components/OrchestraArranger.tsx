import { memo, useMemo } from 'react';

// Helpers para construir SVG Paths de seções (fatias de pizza)
function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
  return {
    x: centerX + (radius * Math.cos(angleInRadians)),
    y: centerY + (radius * Math.sin(angleInRadians))
  };
}

function describeArc(x: number, y: number, innerRadius: number, outerRadius: number, startAngle: number, endAngle: number) {
  const startOuter = polarToCartesian(x, y, outerRadius, endAngle);
  const endOuter = polarToCartesian(x, y, outerRadius, startAngle);
  const startInner = polarToCartesian(x, y, innerRadius, endAngle);
  const endInner = polarToCartesian(x, y, innerRadius, startAngle);

  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M", startOuter.x, startOuter.y,
    "A", outerRadius, outerRadius, 0, largeArcFlag, 0, endOuter.x, endOuter.y,
    "L", endInner.x, endInner.y,
    "A", innerRadius, innerRadius, 0, largeArcFlag, 1, startInner.x, startInner.y,
    "Z"
  ].join(" ");
}

export type SectionType = 'strings' | 'woodwinds' | 'brass' | 'percussion';

export interface OrchestraSection {
  id: string;
  name: string;
  type: SectionType;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
  baseColor: string; // Tailwind bg class
  activeColor: string;
}

const ORCHESTRA_LAYOUT: OrchestraSection[] = [
  // CORDAS (Verde)
  { id: 'violins', name: 'Violinos', type: 'strings', innerRadius: 50, outerRadius: 120, startAngle: -90, endAngle: -30, baseColor: 'fill-emerald-500/20', activeColor: 'fill-emerald-400' },
  { id: 'violas', name: 'Violas', type: 'strings', innerRadius: 50, outerRadius: 120, startAngle: -28, endAngle: 28, baseColor: 'fill-emerald-500/20', activeColor: 'fill-emerald-400' },
  { id: 'cellos', name: 'Violoncelos', type: 'strings', innerRadius: 50, outerRadius: 120, startAngle: 30, endAngle: 70, baseColor: 'fill-emerald-500/20', activeColor: 'fill-emerald-400' },
  { id: 'contrabass', name: 'Contrabaixos', type: 'strings', innerRadius: 50, outerRadius: 120, startAngle: 72, endAngle: 90, baseColor: 'fill-emerald-500/20', activeColor: 'fill-emerald-400' },

  // MADEIRAS (Azul)
  { id: 'flute', name: 'Flautas', type: 'woodwinds', innerRadius: 125, outerRadius: 180, startAngle: -60, endAngle: -2, baseColor: 'fill-cyan-500/20', activeColor: 'fill-cyan-400' },
  { id: 'bassoon', name: 'Fagotes', type: 'woodwinds', innerRadius: 125, outerRadius: 180, startAngle: 2, endAngle: 60, baseColor: 'fill-cyan-500/20', activeColor: 'fill-cyan-400' },

  // METAIS (Amarelo)
  { id: 'horn', name: 'Trompas', type: 'brass', innerRadius: 185, outerRadius: 240, startAngle: -90, endAngle: -47, baseColor: 'fill-amber-500/20', activeColor: 'fill-amber-400' },
  { id: 'trumpet', name: 'Trompetes', type: 'brass', innerRadius: 185, outerRadius: 240, startAngle: -45, endAngle: -2, baseColor: 'fill-amber-500/20', activeColor: 'fill-amber-400' },
  { id: 'trombone', name: 'Trombones', type: 'brass', innerRadius: 185, outerRadius: 240, startAngle: 2, endAngle: 45, baseColor: 'fill-amber-500/20', activeColor: 'fill-amber-400' },
  { id: 'tuba', name: 'Tubas', type: 'brass', innerRadius: 185, outerRadius: 240, startAngle: 47, endAngle: 90, baseColor: 'fill-amber-500/20', activeColor: 'fill-amber-400' },

  // PERCUSSÃO E HARPA (Vermelho)
  { id: 'harp', name: 'Harpa', type: 'percussion', innerRadius: 245, outerRadius: 290, startAngle: -90, endAngle: -62, baseColor: 'fill-rose-500/20', activeColor: 'fill-rose-400' },
  { id: 'marimba', name: 'Marimba', type: 'percussion', innerRadius: 245, outerRadius: 290, startAngle: -60, endAngle: -32, baseColor: 'fill-rose-500/20', activeColor: 'fill-rose-400' },
  { id: 'vibraphone', name: 'Vibrafone', type: 'percussion', innerRadius: 245, outerRadius: 290, startAngle: -30, endAngle: -2, baseColor: 'fill-rose-500/20', activeColor: 'fill-rose-400' },
  { id: 'tubular_bells', name: 'Sinos', type: 'percussion', innerRadius: 245, outerRadius: 290, startAngle: 2, endAngle: 30, baseColor: 'fill-rose-500/20', activeColor: 'fill-rose-400' },
  { id: 'timpani', name: 'Tímpanos', type: 'percussion', innerRadius: 245, outerRadius: 290, startAngle: 32, endAngle: 60, baseColor: 'fill-rose-500/20', activeColor: 'fill-rose-400' },
  { id: 'percussion', name: 'Percussão', type: 'percussion', innerRadius: 245, outerRadius: 290, startAngle: 62, endAngle: 90, baseColor: 'fill-rose-500/20', activeColor: 'fill-rose-400' },
];

interface OrchestraArrangerProps {
  activeInstruments: string[];
  onToggleInstrument: (id: string) => void;
  loadingInstruments: string[];
}

export const OrchestraArranger = memo(function OrchestraArranger({
  activeInstruments,
  onToggleInstrument,
  loadingInstruments
}: OrchestraArrangerProps) {
  
  const cx = 300;
  const cy = 300; // Centro inferior do arco

  return (
    <div className="relative w-full max-w-[600px] aspect-[2/1] overflow-hidden rounded-t-full shadow-[0_0_50px_rgba(0,0,0,0.5)]">
      <svg 
        viewBox="0 0 600 300" 
        className="w-full h-full drop-shadow-2xl"
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {ORCHESTRA_LAYOUT.map(section => {
          const isActive = activeInstruments.includes(section.id);
          const isLoading = loadingInstruments.includes(section.id);
          const d = describeArc(cx, cy, section.innerRadius, section.outerRadius, section.startAngle, section.endAngle);
          
          return (
            <g key={section.id} className="group cursor-pointer" onClick={() => onToggleInstrument(section.id)}>
              <path 
                d={d} 
                className={`transition-all duration-300 stroke-black stroke-2 hover:brightness-150 ${isActive ? section.activeColor : section.baseColor} ${isLoading ? 'animate-pulse' : ''}`}
                style={{ filter: isActive ? 'url(#glow)' : 'none' }}
              />
              
              {/* Tooltip improvisado via Title (para acessibilidade simples) */}
              <title>{section.name} {isActive ? '(Ativo)' : '(Inativo)'} {isLoading ? '...' : ''}</title>

              {/* Rótulo de texto sobre o path se houver espaço (posicionado no centro do arco) */}
              <text 
                x={polarToCartesian(cx, cy, (section.innerRadius + section.outerRadius) / 2, (section.startAngle + section.endAngle) / 2).x} 
                y={polarToCartesian(cx, cy, (section.innerRadius + section.outerRadius) / 2, (section.startAngle + section.endAngle) / 2).y}
                textAnchor="middle"
                alignmentBaseline="middle"
                className={`text-[8px] sm:text-[10px] font-mono pointer-events-none transition-opacity duration-300 ${isActive ? 'fill-black font-bold' : 'fill-white/40 group-hover:fill-white/80'}`}
                transform={`rotate(${(section.startAngle + section.endAngle) / 2}, ${polarToCartesian(cx, cy, (section.innerRadius + section.outerRadius) / 2, (section.startAngle + section.endAngle) / 2).x}, ${polarToCartesian(cx, cy, (section.innerRadius + section.outerRadius) / 2, (section.startAngle + section.endAngle) / 2).y})`}
              >
                {isLoading ? '...' : section.name}
              </text>
            </g>
          );
        })}
        
        {/* Maestro/Podium central */}
        <circle cx={cx} cy={cy} r="45" className="fill-black stroke-white/10 stroke-2" />
        <text x={cx} y={cy - 15} textAnchor="middle" className="fill-white/60 text-xs font-mono tracking-widest">VOCÊ</text>
        <path d="M 290 290 L 310 290 L 305 270 L 295 270 Z" className="fill-white/20" />
      </svg>
    </div>
  );
});
