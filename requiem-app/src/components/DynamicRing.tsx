import { memo } from "react";

interface DynamicRingProps {
  isActive: boolean;
  currentFrequency: number;
  currentNote?: string;
  onClick?: () => void;
  intensity?: number; 
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnter?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  isDragActive?: boolean;
}

export const DynamicRing = memo(function DynamicRing({
  isActive,
  currentFrequency,
  currentNote,
  onClick,
  intensity,
  onDrop,
  onDragOver,
  onDragEnter,
  onDragLeave,
  isDragActive,
}: DynamicRingProps) {
  const hasFreq = currentFrequency > 0;
  
  // Normaliza a frequência (aprox. 100Hz a 1000Hz) de 0 a 1
  const normalizedFreq = Math.min(Math.max((currentFrequency - 100) / 900, 0), 1);
  
  // Usa a prop de intensidade para volume e velocidade
  const activeIntensity = intensity !== undefined ? Math.min(Math.max(intensity, 0), 1) : normalizedFreq;
  
  const sizeClass = isActive 
    ? "w-48 h-48 sm:w-64 sm:h-64 mb-8" 
    : "w-32 h-32 sm:w-48 sm:h-48 mb-8";

  // Expansão mais orgânica e elástica baseada no volume, se arrastando fica um pouco maior
  const scale = isDragActive ? 1.1 : (hasFreq ? 1 + activeIntensity * 0.35 : 1);
  
  // Velocidade da rotação principal
  const rotationDuration = hasFreq 
    ? Math.max(3, 14 - (activeIntensity * 10)) 
    : (isActive ? 18 : 25);
  
  // Abertura do anel altamente responsiva à intensidade do som
  const radiusOffset = hasFreq ? 35 + activeIntensity * 50 : (isActive ? 28 : 18);
  
  // Hue dinâmico: Graves (Frio) -> Agudos (Quente)
  const baseHue = 240 - (normalizedFreq * 260);

  // Desfoque dramático controlado pela força do som (intensity)
  const blurAmount = hasFreq ? 12 + activeIntensity * 45 : (isActive ? 24 : 12);

  // Array de luzes com offsets assimétricos (orbitMorph) para quebrar o círculo perfeito
  const lights = [
    { size: "w-24 h-24 sm:w-32 sm:h-32", hueOffset: 0,   orbitMorph: 1.15, blob: "28% 72% 65% 35% / 55% 35% 65% 45%" },
    { size: "w-32 h-32 sm:w-40 sm:h-40", hueOffset: 55,  orbitMorph: 0.85, blob: "72% 28% 20% 80% / 35% 75% 25% 65%" },
    { size: "w-20 h-20 sm:w-28 sm:h-28", hueOffset: -40, orbitMorph: 1.25, blob: "22% 78% 80% 20% / 20% 25% 75% 80%" },
    { size: "w-36 h-36 sm:w-48 sm:h-48", hueOffset: 80,  orbitMorph: 0.9,  blob: "80% 20% 35% 65% / 25% 80% 40% 60%" },
    { size: "w-24 h-24 sm:w-32 sm:h-32", hueOffset: -65, orbitMorph: 1.1,  blob: "45% 55% 18% 82% / 78% 22% 55% 45%" },
    { size: "w-28 h-28 sm:w-36 sm:h-36", hueOffset: 35,  orbitMorph: 0.95, blob: "33% 67% 75% 25% / 68% 32% 72% 28%" },
    { size: "w-24 h-24 sm:w-32 sm:h-32", hueOffset: -85, orbitMorph: 1.2,  blob: "75% 25% 40% 60% / 30% 70% 35% 65%" },
    { size: "w-20 h-20 sm:w-28 sm:h-28", hueOffset: 60,  orbitMorph: 0.8,  blob: "18% 82% 55% 45% / 42% 58% 78% 22%" },
  ];

  // Micro-partículas de poeira/estrela orbitando o anel
  const particles = Array.from({ length: 18 }, (_, i) => ({
    angle: (i * 360) / 18 + (i % 3) * 7,        // Distribuição com leve irregularidade
    distance: 70 + (i % 5) * 14 + (i % 3) * 8,  // Distância orbital variada (70–120px)
    size: 0.6 + (i % 3) * 0.45,                   // Tamanho: 0.6px – 1.5px
    hueOffset: ((i * 17) % 60) - 30,              // Variação de cor
    speed: 25 + (i % 4) * 8,                      // Velocidade orbital (25–49s)
    delay: -(i * 1.3),                             // Delay do twinkle
    brightness: 0.4 + (i % 3) * 0.25,             // Brilho base variado
  }));

  return (
    <div 
      className={`relative flex items-center justify-center mt-4 transition-all duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] ${sizeClass} ${!isActive ? 'animate-pulse-subtle' : ''} ${onClick ? 'cursor-pointer hover:scale-105' : ''} ${isDragActive ? 'scale-110 shadow-[0_0_50px_rgba(255,255,255,0.3)] rounded-full ring-2 ring-white/50' : ''}`}
      onClick={onClick}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
    >
      
      {/* Brilho de fundo pulsante unificado */}
      <div 
        className="absolute inset-0 rounded-full transition-all duration-700 ease-out mix-blend-screen pointer-events-none"
        style={{
          backgroundColor: hasFreq ? `hsla(${baseHue}, 80%, 60%, ${0.15 + activeIntensity * 0.25})` : 'transparent',
          filter: `blur(${blurAmount * 1.8}px)`,
          transform: `scale(${scale * 1.3})`,
        }}
      />

      {/* Camada orbital externa (Dança lenta e elíptica) */}
      <div 
        className="absolute inset-0 flex items-center justify-center animate-spin transition-all duration-500 ease-out"
        style={{ 
          animationDuration: `${rotationDuration}s`,
          transform: `scale(${scale})`
        }}
      >
        {lights.map((light, index) => {
          const angle = (index * 360) / lights.length;
          const currentHue = baseHue + light.hueOffset;
          const dynamicColor = `hsl(${currentHue}, 85%, 65%)`;
          
          return (
            <div
              key={`outer-${index}`}
              className={`absolute transition-all duration-700 ease-out mix-blend-screen ${light.size}`}
              style={{
                backgroundColor: dynamicColor,
                filter: `blur(${blurAmount}px)`,
                opacity: hasFreq ? 0.65 + (activeIntensity * 0.35) : (isActive ? 0.4 : 0.15),
                borderRadius: light.blob,
                // A combinação de rotate(angle) com rotate(-angle/2) cria um movimento circular que torce a forma geométrica
                transform: `rotate(${angle}deg) translateY(-${radiusOffset * light.orbitMorph}px) rotate(-${angle / 2}deg) scale(${1 + activeIntensity * 0.25})`,
              }}
            />
          );
        })}
      </div>

      {/* Camada orbital interna reversa (Cria o aspecto hipnotizante) */}
      <div 
        className="absolute inset-0 flex items-center justify-center animate-spin transition-all duration-700 ease-out opacity-70"
        style={{ 
          animationDuration: `${rotationDuration * 1.6}s`,
          animationDirection: 'reverse',
          transform: `scale(${scale * 0.75})`
        }}
      >
        {lights.slice(0, 5).map((light, index) => {
          const angle = (index * 360) / 5;
          const currentHue = baseHue + light.hueOffset * 1.5;
          const dynamicColor = `hsl(${currentHue}, 90%, 55%)`;

          return (
            <div
              key={`inner-${index}`}
              className={`absolute transition-all duration-700 ease-out mix-blend-screen ${light.size}`}
              style={{
                backgroundColor: dynamicColor,
                filter: `blur(${blurAmount * 1.3}px)`,
                opacity: hasFreq ? 0.5 + (activeIntensity * 0.4) : (isActive ? 0.3 : 0.1),
                borderRadius: light.blob,
                transform: `rotate(${angle + 45}deg) translateY(-${radiusOffset * 0.5 * light.orbitMorph}px) rotate(${angle}deg) scale(${1 + activeIntensity * 0.3})`,
              }}
            />
          );
        })}
      </div>

      {/* Micro-partículas de poeira estelar orbitando */}
      {particles.map((p, i) => {
        const particleHue = baseHue + p.hueOffset;
        const particleOpacity = hasFreq
          ? p.brightness + activeIntensity * 0.4
          : (isActive ? p.brightness * 0.8 : p.brightness * 0.5);

        // Distância reativa: cresce junto com o anel para nunca ficar escondida
        const dynamicDistance = (p.distance + radiusOffset * 0.8) * scale;

        return (
          <div
            key={`particle-${i}`}
            className="absolute inset-0 flex items-center justify-center animate-spin pointer-events-none"
            style={{
              animationDuration: `${p.speed}s`,
              animationDirection: i % 2 === 0 ? 'normal' : 'reverse',
            }}
          >
            <div
              className="absolute rounded-full"
              style={{
                width: `${p.size}px`,
                height: `${p.size}px`,
                backgroundColor: `hsl(${particleHue}, 85%, 75%)`,
                opacity: particleOpacity,
                transform: `rotate(${p.angle}deg) translateY(-${dynamicDistance}px)`,
                animation: `twinkle ${2.5 + (i % 3) * 1.2}s ease-in-out ${p.delay}s infinite`,
              }}
            />
          </div>
        );
      })}

      {/* Brilho neon na borda interna (entre o anel e o núcleo) */}
      <div 
        className="absolute inset-6 sm:inset-10 rounded-full pointer-events-none z-[9] transition-all duration-700"
        style={{
          background: `radial-gradient(circle, transparent 50%, hsla(${baseHue}, 90%, 80%, ${hasFreq ? 0.15 + activeIntensity * 0.25 : (isActive ? 0.08 : 0.04)}) 75%, transparent 100%)`,
          transform: `scale(${scale * 0.9})`,
          filter: `blur(${3 + activeIntensity * 4}px)`,
        }}
      />

      {/* Núcleo de absorção (Traz profundidade ao centro) */}
      <div 
        className="absolute inset-8 sm:inset-12 rounded-full bg-black transition-all duration-700 z-10"
        style={{
          opacity: 1,
          transform: `scale(${scale * 0.85})`,
          boxShadow: `0 0 ${40 + activeIntensity * 60}px ${15 + activeIntensity * 40}px rgba(0,0,0,0.95) inset`,
          filter: `blur(${6 + activeIntensity * 10}px)`
        }}
      />
      
      {/* Tipografia refinada da nota */}
      {isActive && currentNote && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 transition-opacity duration-300">
          <span 
            className="text-white/95 text-4xl sm:text-6xl font-light tracking-tighter drop-shadow-2xl transition-all duration-200"
            style={{ 
              textShadow: hasFreq ? `0 0 ${15 + activeIntensity * 25}px hsla(${baseHue}, 90%, 70%, 0.9)` : '0 2px 10px rgba(0,0,0,0.5)',
              transform: `scale(${1 + activeIntensity * 0.08})`
            }}
          >
            {currentNote.replace(/[0-9]/g, '')}
            <span className="text-xl sm:text-3xl text-white/60 ml-1 font-medium">{currentNote.match(/[0-9]/)?.[0]}</span>
          </span>
        </div>
      )}
    </div>
  );
});