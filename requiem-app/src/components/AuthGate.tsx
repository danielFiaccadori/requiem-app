import type { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LoginPage } from './LoginPage';
import { TitleBar } from './TitleBar';

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const isLoginOrLoading = isLoading || !user;

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-black text-white">
      <TitleBar variant={isLoginOrLoading ? 'login' : 'home'} />

      <div className="relative flex-1 min-h-0 w-full overflow-hidden">
        {isLoading ? (
          <div className="flex h-full w-full bg-black items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <svg className="animate-spin w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-white/30 text-sm font-mono tracking-widest">CARREGANDO...</span>
            </div>
          </div>
        ) : !user ? (
          <LoginPage />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
