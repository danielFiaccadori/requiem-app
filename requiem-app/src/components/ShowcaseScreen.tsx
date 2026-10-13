import { X, PlayCircle } from 'lucide-react';
import { SHOWCASE_SONGS } from '../songs/catalog';

interface ShowcaseScreenProps {
  onClose: () => void;
  onLoadMidi: (url: string, title: string, id: string, customManifest?: any) => void;
  customSongs?: any[];
}

export function ShowcaseScreen({ onClose, onLoadMidi, customSongs = [] }: ShowcaseScreenProps) {
  const allSongs = [...SHOWCASE_SONGS, ...customSongs];

  return (
    <div className="absolute inset-0 z-50 bg-[#101010]/95 backdrop-blur-md flex flex-col items-center pt-24 overflow-hidden animate-fade-in">
      <button 
        onClick={onClose}
        className="absolute top-6 right-6 p-2 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white"
      >
        <X className="w-6 h-6" />
      </button>

      <div className="w-full max-w-4xl px-6 flex flex-col items-start">
        <h1 className="text-3xl font-medium text-white mb-2">Vitrine de Músicos</h1>
        <p className="text-white/40 mb-12">Escolha uma música baseada em arquivos MIDI para a IA acompanhar.</p>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
          {allSongs.map(item => (
            <div 
              key={item.id} 
              className="group relative bg-white/5 rounded-2xl overflow-hidden border border-white/5 hover:border-white/20 hover:bg-white/10 transition-all cursor-pointer"
              onClick={() => {
                onLoadMidi(item.midiUrl, item.title, item.id, item);
                onClose();
              }}
            >
              <div className="h-40 w-full overflow-hidden">
                <img src={item.coverUrl} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-70 group-hover:opacity-100" />
              </div>
              <div className="p-5">
                <h3 className="text-lg font-medium text-white group-hover:text-red-400 transition-colors">{item.title}</h3>
                <p className="text-sm text-white/50">{item.artist}</p>
              </div>
              <div className="absolute bottom-5 right-5 opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                <PlayCircle className="w-10 h-10 text-white drop-shadow-lg" strokeWidth={1} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
