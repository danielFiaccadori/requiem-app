import { useState, useEffect, useCallback } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';

interface TitleBarProps {
  variant: 'login' | 'home';
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_IPC__' in window;
}

export function TitleBar({ variant }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let active = true;
    let unlisten: (() => void) | undefined;

    const syncMaximized = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        if (active) setIsMaximized(maximized);
      } catch {
        // Ignora caso fora do ambiente Tauri
      }
    };

    syncMaximized();

    appWindow
      .onResized(() => {
        syncMaximized();
      })
      .then((fn) => {
        if (active) {
          unlisten = fn;
        } else {
          fn();
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const handleMinimize = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      await appWindow.minimize();
    } catch {
      // ignore
    }
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      await appWindow.toggleMaximize();
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    } catch {
      // ignore
    }
  }, []);

  const handleClose = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      await appWindow.close();
    } catch {
      // ignore
    }
  }, []);

  const bgClass = variant === 'login' ? 'bg-black' : 'bg-[#101010]';

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={handleToggleMaximize}
      className={`h-9 w-full shrink-0 flex items-center justify-between select-none transition-colors duration-300 z-[100] ${bgClass}`}
    >
      {/* Área esquerda arrastável (sem logo) */}
      <div data-tauri-drag-region className="flex-1 h-full" />

      {/* Controles da janela (Windows / Tauri) */}
      <div
        className="flex items-center h-full"
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleMinimize}
          aria-label="Minimizar"
          title="Minimizar"
          className="h-full w-11 flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={handleToggleMaximize}
          aria-label={isMaximized ? 'Restaurar' : 'Maximizar'}
          title={isMaximized ? 'Restaurar' : 'Maximizar'}
          className="h-full w-11 flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
        >
          {isMaximized ? (
            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="2" y="3.5" width="6.5" height="6.5" rx="0.5" />
              <path d="M3.5 3.5V2.5C3.5 2.22386 3.72386 2 4 2H9.5C9.77614 2 10 2.22386 10 2.5V8C10 8.27614 9.77614 8.5 9.5 8.5H8.5" />
            </svg>
          ) : (
            <Square className="w-3 h-3" strokeWidth={1.75} />
          )}
        </button>

        <button
          type="button"
          onClick={handleClose}
          aria-label="Fechar"
          title="Fechar"
          className="h-full w-11 flex items-center justify-center text-white/55 hover:text-white hover:bg-red-600/85 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}

