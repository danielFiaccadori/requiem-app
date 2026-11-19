import { useState, useEffect, useCallback } from 'react';
import {
  X,
  PlayCircle,
  Search,
  Globe,
  User as UserIcon,
  Music2,
  Download,
  Heart,
  Trash2,
  Pencil,
  Check,
  Loader2,
} from 'lucide-react';
import { SHOWCASE_SONGS } from '../songs/catalog';
import {
  apiGetStorePresets,
  apiGetStorePreset,
  apiUseStorePreset,
  apiGetMyStorePresets,
  apiUpdateStorePreset,
  apiDeleteStorePreset,
  type StorePreset,
  type ChatSession,
} from '../lib/api';

type ShowcaseTab = 'store' | 'my' | 'local';

interface ShowcaseScreenProps {
  onClose: () => void;
  onLoadMidi: (url: string, title: string, id: string, customManifest?: any) => void;
  onLoadStorePreset?: (preset: StorePreset, createdSession?: ChatSession) => void;
  customSongs?: any[];
}

const GENRES = ['Todos', 'Pop', 'Clássico', 'Jazz', 'Bossa Nova', 'Lo-Fi', 'MPB', 'Gospel', 'Rock'];

export function ShowcaseScreen({
  onClose,
  onLoadMidi,
  onLoadStorePreset,
  customSongs = [],
}: ShowcaseScreenProps) {
  const [activeTab, setActiveTab] = useState<ShowcaseTab>('store');
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('Todos');
  const [sortBy, setSortBy] = useState<'recent' | 'popular'>('popular');

  const [storePresets, setStorePresets] = useState<StorePreset[]>([]);
  const [myPresets, setMyPresets] = useState<StorePreset[]>([]);
  const [isLoadingStore, setIsLoadingStore] = useState(false);
  const [loadingPresetId, setLoadingPresetId] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);

  // Edição rápida em "Meus Presets"
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const allLocalSongs = [...SHOWCASE_SONGS, ...customSongs];

  const fetchStorePresets = useCallback(async () => {
    setIsLoadingStore(true);
    setStoreError(null);
    try {
      const { presets } = await apiGetStorePresets({
        search: search || undefined,
        genre: genre !== 'Todos' ? genre : undefined,
        sortBy,
      });
      setStorePresets(presets || []);
    } catch (err: unknown) {
      setStoreError(
        err instanceof Error
          ? err.message
          : 'Não foi possível conectar à Loja de Presets.'
      );
      setStorePresets([]);
    } finally {
      setIsLoadingStore(false);
    }
  }, [search, genre, sortBy]);

  const fetchMyPresets = useCallback(async () => {
    setIsLoadingStore(true);
    setStoreError(null);
    try {
      const { presets } = await apiGetMyStorePresets();
      setMyPresets(presets || []);
    } catch (err: unknown) {
      setStoreError(
        err instanceof Error
          ? err.message
          : 'Não foi possível carregar seus presets.'
      );
      setMyPresets([]);
    } finally {
      setIsLoadingStore(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'store') {
      const timer = setTimeout(() => {
        fetchStorePresets();
      }, 220);
      return () => clearTimeout(timer);
    } else if (activeTab === 'my') {
      fetchMyPresets();
    }
  }, [activeTab, fetchStorePresets, fetchMyPresets]);

  const handleSelectStorePreset = async (preset: StorePreset) => {
    if (!onLoadStorePreset) return;
    setLoadingPresetId(preset.id);
    setStoreError(null);
    try {
      const hasToken = Boolean(localStorage.getItem('requiem_token'));
      const res = await apiUseStorePreset(preset.id, hasToken);
      onLoadStorePreset(res.preset, res.createdSession);
      onClose();
    } catch {
      try {
        const details = await apiGetStorePreset(preset.id);
        onLoadStorePreset(details.preset);
        onClose();
      } catch (err: unknown) {
        setStoreError(
          err instanceof Error ? err.message : 'Erro ao carregar configuração do preset.'
        );
      }
    } finally {
      setLoadingPresetId(null);
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!editTitle.trim()) return;
    try {
      const { preset } = await apiUpdateStorePreset(id, {
        title: editTitle.trim(),
        description: editDesc.trim() || undefined,
      });
      setMyPresets((prev) => prev.map((p) => (p.id === id ? { ...p, ...preset } : p)));
      setEditingId(null);
    } catch (err: unknown) {
      setStoreError(err instanceof Error ? err.message : 'Falha ao atualizar preset.');
    }
  };

  const handleDeleteMyPreset = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await apiDeleteStorePreset(id);
      setMyPresets((prev) => prev.filter((p) => p.id !== id));
    } catch (err: unknown) {
      setStoreError(err instanceof Error ? err.message : 'Falha ao remover preset.');
    }
  };

  return (
    <div className="absolute inset-0 z-50 bg-[#101010]/95 backdrop-blur-md flex flex-col items-center pt-16 pb-10 overflow-y-auto animate-fade-in">
      <button
        onClick={onClose}
        className="fixed top-6 right-6 p-2 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white z-50"
        aria-label="Fechar Vitrine"
      >
        <X className="w-6 h-6" />
      </button>

      <div className="w-full max-w-5xl px-6 flex flex-col items-start">
        <h1 className="text-3xl font-medium text-white mb-2">Vitrine & Loja de Presets</h1>
        <p className="text-white/40 mb-6">
          Explore acompanhamentos publicados pela comunidade na Requiem API ou carregue arranjos MIDI de referência.
        </p>

        {/* Abas de Navegação */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <button
            onClick={() => setActiveTab('store')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              activeTab === 'store'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-white/5 text-white/60 border border-white/5 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Globe className="w-4 h-4" />
            Loja da Comunidade
          </button>

          <button
            onClick={() => setActiveTab('my')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              activeTab === 'my'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-white/5 text-white/60 border border-white/5 hover:bg-white/10 hover:text-white'
            }`}
          >
            <UserIcon className="w-4 h-4" />
            Meus Presets
          </button>

          <button
            onClick={() => setActiveTab('local')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              activeTab === 'local'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-white/5 text-white/60 border border-white/5 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Music2 className="w-4 h-4" />
            Catálogo MIDI Local ({allLocalSongs.length})
          </button>
        </div>

        {/* Filtros da Loja Pública */}
        {activeTab === 'store' && (
          <div className="w-full flex flex-col sm:flex-row gap-3 mb-8">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar presets por título, tags ou autor..."
                className="w-full bg-white/5 border border-white/10 focus:border-emerald-500/40 rounded-xl py-2.5 pl-10 pr-4 text-sm text-white placeholder-white/35 outline-none"
              />
            </div>

            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none cursor-pointer"
            >
              {GENRES.map((g) => (
                <option key={g} value={g} className="bg-zinc-900">
                  {g === 'Todos' ? 'Todos os Gêneros' : g}
                </option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'recent' | 'popular')}
              className="bg-white/5 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none cursor-pointer"
            >
              <option value="popular" className="bg-zinc-900">Mais populares</option>
              <option value="recent" className="bg-zinc-900">Mais recentes</option>
            </select>
          </div>
        )}

        {storeError && activeTab !== 'local' && (
          <div className="w-full mb-6 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
            {storeError}
          </div>
        )}

        {/* Conteúdo: Loja Pública */}
        {activeTab === 'store' && (
          <>
            {isLoadingStore ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 w-full">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-44 rounded-2xl bg-white/5 animate-pulse" />
                ))}
              </div>
            ) : storePresets.length === 0 ? (
              <div className="w-full py-12 text-center border border-dashed border-white/10 rounded-2xl text-white/40 text-sm">
                Nenhum preset encontrado na loja para os filtros selecionados.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 w-full">
                {storePresets.map((preset) => (
                  <div
                    key={preset.id}
                    onClick={() => handleSelectStorePreset(preset)}
                    className="group relative bg-white/5 rounded-2xl p-5 border border-white/5 hover:border-emerald-500/40 hover:bg-white/[0.08] transition-all cursor-pointer flex flex-col justify-between min-h-[175px]"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-[10px] font-mono uppercase">
                          {preset.genre || 'Preset'}
                        </span>
                        <div className="flex items-center gap-2 text-[11px] font-mono text-white/45">
                          {preset.tonality && <span>{preset.tonality}</span>}
                          {preset.bpm && <span>· {preset.bpm} BPM</span>}
                          {preset.timeSignature && <span>· {preset.timeSignature}</span>}
                        </div>
                      </div>

                      <h3 className="text-base font-medium text-white group-hover:text-emerald-300 transition-colors line-clamp-1">
                        {preset.title}
                      </h3>
                      <p className="text-xs text-white/50 mt-1 line-clamp-2">
                        {preset.description || 'Configuração de auto acompanhamento pronta para tocar.'}
                      </p>
                    </div>

                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5 text-xs text-white/45">
                      <span className="truncate pr-2">por {preset.authorName || 'Músico'}</span>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="flex items-center gap-1">
                          <Download className="w-3.5 h-3.5" /> {preset.downloadsCount ?? 0}
                        </span>
                        <span className="flex items-center gap-1">
                          <Heart className="w-3.5 h-3.5" /> {preset.likesCount ?? 0}
                        </span>
                        {loadingPresetId === preset.id ? (
                          <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
                        ) : (
                          <PlayCircle className="w-6 h-6 text-white/70 group-hover:text-emerald-400 transition-colors" strokeWidth={1.5} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Conteúdo: Meus Presets */}
        {activeTab === 'my' && (
          <>
            {isLoadingStore ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 w-full">
                {[1, 2].map((i) => (
                  <div key={i} className="h-44 rounded-2xl bg-white/5 animate-pulse" />
                ))}
              </div>
            ) : myPresets.length === 0 ? (
              <div className="w-full py-12 text-center border border-dashed border-white/10 rounded-2xl text-white/40 text-sm">
                Você ainda não publicou nenhum preset na loja comunitária.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 w-full">
                {myPresets.map((preset) => (
                  <div
                    key={preset.id}
                    onClick={() => editingId !== preset.id && handleSelectStorePreset(preset)}
                    className="group relative bg-white/5 rounded-2xl p-5 border border-white/5 hover:border-white/20 transition-all cursor-pointer flex flex-col justify-between min-h-[175px]"
                  >
                    {editingId === preset.id ? (
                      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg bg-black/50 border border-white/15 text-sm text-white outline-none"
                        />
                        <textarea
                          rows={2}
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg bg-black/50 border border-white/15 text-xs text-white outline-none resize-none"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2.5 py-1 rounded-lg bg-white/5 text-xs text-white/60 hover:text-white"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => handleSaveEdit(preset.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500 text-black text-xs font-semibold"
                          >
                            <Check className="w-3.5 h-3.5" /> Salvar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-white/80 text-[10px] font-mono uppercase">
                              {preset.genre || 'Preset'}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingId(preset.id);
                                  setEditTitle(preset.title);
                                  setEditDesc(preset.description || '');
                                }}
                                className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                                title="Editar preset"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => handleDeleteMyPreset(e, preset.id)}
                                className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors"
                                title="Remover preset"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          <h3 className="text-base font-medium text-white">{preset.title}</h3>
                          <p className="text-xs text-white/50 mt-1 line-clamp-2">
                            {preset.description || 'Sem descrição.'}
                          </p>
                        </div>

                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5 text-xs text-white/45">
                          <span>{preset.downloadsCount ?? 0} usos · {preset.likesCount ?? 0} curtidas</span>
                          <PlayCircle className="w-6 h-6 text-white/60 group-hover:text-emerald-400 transition-colors" strokeWidth={1.5} />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Conteúdo: Catálogo MIDI Local */}
        {activeTab === 'local' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
            {allLocalSongs.map((item) => (
              <div
                key={item.id}
                className="group relative bg-white/5 rounded-2xl overflow-hidden border border-white/5 hover:border-white/20 hover:bg-white/10 transition-all cursor-pointer"
                onClick={() => {
                  onLoadMidi(item.midiUrl, item.title, item.id, item);
                  onClose();
                }}
              >
                <div className="h-40 w-full overflow-hidden">
                  <img
                    src={item.coverUrl}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-70 group-hover:opacity-100"
                  />
                </div>
                <div className="p-5">
                  <h3 className="text-lg font-medium text-white group-hover:text-red-400 transition-colors">
                    {item.title}
                  </h3>
                  <p className="text-sm text-white/50">{item.artist}</p>
                </div>
                <div className="absolute bottom-5 right-5 opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                  <PlayCircle className="w-10 h-10 text-white drop-shadow-lg" strokeWidth={1} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
