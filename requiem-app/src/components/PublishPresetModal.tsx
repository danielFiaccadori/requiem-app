import { useState } from 'react';
import { X, Globe, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  apiExportSession,
  apiExportSessionToStore,
  apiPublishStorePreset,
  apiSaveComposition,
  type ChatSession,
  type SerializedBlock,
  type StorePreset,
} from '../lib/api';

interface PublishPresetModalProps {
  onClose: () => void;
  activeSession: ChatSession | null;
  configurationData: SerializedBlock[];
  defaultTitle: string;
  defaultBpm: number;
  defaultTonality: string;
  defaultTimeSignature: string;
  onPublished?: (preset: StorePreset) => void;
}

const GENRE_OPTIONS = [
  'Pop',
  'Clássico',
  'Jazz',
  'Bossa Nova',
  'Lo-Fi',
  'MPB',
  'Gospel',
  'Rock',
  'Outro',
];

export function PublishPresetModal({
  onClose,
  activeSession,
  configurationData,
  defaultTitle,
  defaultBpm,
  defaultTonality,
  defaultTimeSignature,
  onPublished,
}: PublishPresetModalProps) {
  const [title, setTitle] = useState(defaultTitle || 'Meu Acompanhamento');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('Pop');
  const [tags, setTags] = useState('');
  const [bpm, setBpm] = useState(defaultBpm || 120);
  const [tonality, setTonality] = useState(defaultTonality === 'AUTO' ? 'C' : defaultTonality || 'C');
  const [timeSignature, setTimeSignature] = useState(defaultTimeSignature || '4/4');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Informe um título para o preset.');
      return;
    }
    if (!configurationData || configurationData.length === 0) {
      setError('Não há blocos de acompanhamento para publicar. Carregue um MIDI ou toque no modo livre primeiro.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      let createdPreset: StorePreset;
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        genre,
        tags: tags.trim() || undefined,
        bpm: Number(bpm) || 120,
        tonality: tonality.trim() || 'C',
        timeSignature: timeSignature.trim() || '4/4',
      };

      if (activeSession?.id) {
        // Garante que os blocos mais recentes estão salvos na sessão antes de exportar para a loja
        await apiSaveComposition(activeSession.id, configurationData, title.trim());
        const res = await apiExportSessionToStore(activeSession.id, payload);
        createdPreset = res.preset;
      } else {
        const res = await apiPublishStorePreset({
          ...payload,
          configurationData,
        });
        createdPreset = res.preset;
      }

      setSuccessMsg(`Preset "${createdPreset.title}" publicado na Loja Comunitária!`);
      onPublished?.(createdPreset);
      setTimeout(() => onClose(), 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Falha ao publicar preset na loja.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadJson = async () => {
    setError(null);
    setIsExporting(true);
    try {
      let exportObj: any;
      if (activeSession?.id) {
        await apiSaveComposition(activeSession.id, configurationData, title.trim());
        const res = await apiExportSession(activeSession.id);
        exportObj = res.export;
      } else {
        exportObj = {
          title: title.trim(),
          exportedAt: new Date().toISOString(),
          configurationData,
        };
      }
      const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.trim().toLowerCase().replace(/[^a-z0-9]+/gi, '-') || 'requiem-preset'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao exportar configuração JSON.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="relative w-full max-w-lg rounded-2xl bg-[#111216] border border-white/10 p-6 shadow-2xl text-white">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 mb-1">
          <Globe className="w-5 h-5 text-emerald-400" />
          <h2 className="text-xl font-semibold">Publicar na Loja Comunitária</h2>
        </div>
        <p className="text-xs text-white/50 mb-5">
          Compartilhe esta progressão de auto acompanhamento ({configurationData.reduce((acc, b) => acc + b.progression.length, 0)} acordes) com outros músicos no Requiem.
        </p>

        <form onSubmit={handlePublish} className="space-y-3.5">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-white/50 mb-1">
              Título do Preset *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/10 focus:border-emerald-500/50 outline-none text-sm text-white"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-white/50 mb-1">
              Descrição
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex.: Harmonia suave com cadência II-V-I ideal para voz ou violino..."
              className="w-full px-3.5 py-2 rounded-xl bg-black/50 border border-white/10 focus:border-emerald-500/50 outline-none text-sm text-white resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-white/50 mb-1">
                Gênero Musical
              </label>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-black/50 border border-white/10 focus:border-emerald-500/50 outline-none text-sm text-white"
              >
                {GENRE_OPTIONS.map((g) => (
                  <option key={g} value={g} className="bg-zinc-900">
                    {g}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-white/50 mb-1">
                Tags (separadas por vírgula)
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="piano, balada, violino"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/50 border border-white/10 focus:border-emerald-500/50 outline-none text-sm text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-white/50 mb-1">BPM</label>
              <input
                type="number"
                min={40}
                max={300}
                value={bpm}
                onChange={(e) => setBpm(parseInt(e.target.value, 10) || 120)}
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-sm text-white outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-white/50 mb-1">Tonalidade</label>
              <input
                type="text"
                value={tonality}
                onChange={(e) => setTonality(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-sm text-white outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-white/50 mb-1">Compasso</label>
              <input
                type="text"
                value={timeSignature}
                onChange={(e) => setTimeSignature(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-sm text-white outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={handleDownloadJson}
              disabled={isExporting || configurationData.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-white/80 transition-colors cursor-pointer disabled:opacity-40"
            >
              {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Exportar JSON
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
              Publicar na Loja
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

