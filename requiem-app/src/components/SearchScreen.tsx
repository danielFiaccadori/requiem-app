import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { apiGetSessions, type ChatSession } from '../lib/api';

interface SearchScreenProps {
  onSessionSelect: (session: ChatSession) => void;
  onClose: () => void;
}

export function SearchScreen({ onSessionSelect, onClose }: SearchScreenProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const { sessions: fetchedSessions } = await apiGetSessions();
        setSessions(fetchedSessions);
      } catch (err) {
        console.error("Failed to fetch sessions for search:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSessions();
  }, []);

  const filteredSessions = sessions.filter(s => 
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatSessionDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Hoje';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Ontem';
    } else {
      return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
    }
  };

  return (
    <div className="absolute inset-0 z-50 bg-[#101010] flex flex-col items-center pt-24 overflow-hidden">
      <button 
        onClick={onClose}
        className="absolute top-6 right-6 p-2 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white"
      >
        <X className="w-6 h-6" />
      </button>

      <div className="w-full max-w-2xl px-6 flex flex-col items-center">
        {/* Search Input */}
        <div className="relative w-full max-w-xl mb-12 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40 group-focus-within:text-white/80 transition-colors" />
          <input
            type="text"
            autoFocus
            placeholder="Pesquisar músicos"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 hover:bg-white/10 focus:bg-white/10 border-none outline-none text-white placeholder-white/40 rounded-lg py-4 pl-12 pr-4 transition-all"
          />
        </div>

        {/* Results */}
        <div className="w-full max-w-xl text-left">
          <h2 className="text-sm font-medium text-white/50 mb-4 px-2">Recentes</h2>
          
          {isLoading ? (
             <div className="flex flex-col gap-2">
               {[1, 2, 3].map(i => (
                 <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />
               ))}
             </div>
          ) : filteredSessions.length === 0 ? (
            <p className="text-white/40 text-sm px-2">Nenhum músico encontrado.</p>
          ) : (
            <ul className="space-y-1 overflow-y-auto max-h-[60vh] scrollbar-hide pb-20">
              {filteredSessions.map(session => (
                <li key={session.id}>
                  <button
                    onClick={() => onSessionSelect(session)}
                    className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/5 text-white/90 hover:text-white transition-colors"
                  >
                    <span className="truncate pr-4">{session.title}</span>
                    <span className="text-xs text-white/40 whitespace-nowrap">
                      {formatSessionDate(session.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
