import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import nebulaBg from '../assets/login-nebula.jpg';
import { Starfield } from './Starfield';
import { DynamicRing } from './DynamicRing';
import { Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';

type AuthMode = 'login' | 'register';

const SHOWCASE_PHRASES = [
  {
    title: "Acompanhamento ao vivo,",
    highlight: "o seu músico.",
    desc: "O Requiem ouve sua execução em tempo real, prevê a harmonia e orquestra arranjos adaptativos para acompanhar a sua arte.",
    badge: "MOTOR VIVO",
  },
  {
    title: "Harmonia que respira",
    highlight: "no seu tempo.",
    desc: "Detecção polifônica instantânea com condução de vozes avançada alimentada por inteligência musical.",
    badge: "HARMONY ENGINE",
  },
  {
    title: "Da partitura clássica",
    highlight: "ao improviso livre.",
    desc: "Toque com Score Follower preciso ou explore novas tonalidades e progressões espontâneas sem amarras.",
    badge: "SCORE FOLLOWER",
  },
];

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Animação suave e orgânica para o anel no showcase
  const [ambientFreq, setAmbientFreq] = useState(340);
  const [activePhraseIdx, setActivePhraseIdx] = useState(0);

  useEffect(() => {
    let t = 0;
    const interval = setInterval(() => {
      t += 0.035;
      setAmbientFreq(360 + Math.sin(t) * 110);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  // Transição periódica suave das frases de efeito com fade cinematográfico
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setIsFading(true);
      setTimeout(() => {
        setActivePhraseIdx((prev) => (prev + 1) % SHOWCASE_PHRASES.length);
        setIsFading(false);
      }, 350);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  const handlePhraseSelect = (idx: number) => {
    if (idx === activePhraseIdx) return;
    setIsFading(true);
    setTimeout(() => {
      setActivePhraseIdx(idx);
      setIsFading(false);
    }, 250);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, name, password);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao processar autenticação');
    } finally {
      setIsLoading(false);
    }
  };

  const switchMode = () => {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setError(null);
    setEmail('');
    setName('');
    setPassword('');
  };

  const currentPhrase = SHOWCASE_PHRASES[activePhraseIdx];

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#07080a] text-white flex flex-col lg:flex-row select-none">
      {/* Background estrelado sutil no fundo geral */}
      <Starfield animated={false} numStars={140} />

      {/* Grid Isométrico sutil no fundo (idêntico à referência visual Orion) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.035] z-0"
        style={{
          backgroundImage: `
            linear-gradient(30deg, rgba(255,255,255,0.8) 1px, transparent 1px),
            linear-gradient(-30deg, rgba(255,255,255,0.8) 1px, transparent 1px)
          `,
          backgroundSize: '48px 83.14px',
          maskImage: 'radial-gradient(ellipse 90% 90% at 20% 70%, black 30%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 90% at 20% 70%, black 30%, transparent 80%)',
        }}
      />

      {/* Brilhos atmosféricos de profundidade */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div className="absolute top-1/4 left-1/6 w-[450px] h-[450px] rounded-full bg-blue-500/[0.025] blur-[140px]" />
        <div className="absolute bottom-10 right-1/4 w-[550px] h-[550px] rounded-full bg-emerald-500/[0.03] blur-[150px]" />
      </div>

      {/* ========================================================
          COLUNA ESQUERDA: CAMPOS SOLTOS (SEM CAIXA / CARD)
          ======================================================== */}
      <section className="relative z-10 w-full lg:w-[48%] xl:w-[44%] h-full flex flex-col justify-between p-4 sm:p-6 lg:p-8 xl:p-10 overflow-hidden">
        {/* Topo (sem logo do Requiem no canto superior esquerdo) */}
        <div className="flex items-center justify-end min-h-[24px]">
          <div className="text-[10px] font-mono tracking-[0.25em] text-white/30 uppercase hidden sm:block">
            HARMONY ENGINE
          </div>
        </div>

        {/* Versão Compacta do Anel para Telas Menores / Mobile */}
        <div className="lg:hidden flex flex-col items-center justify-center my-2 scale-75">
          <DynamicRing
            isActive={true}
            currentFrequency={ambientFreq}
            intensity={0.35}
            trackingState="tracking"
          />
        </div>

        {/* Centro: Formulário com campos soltos e limpos */}
        <div className="w-full max-w-sm mx-auto my-auto py-2">
          <div className="mb-4 sm:mb-5">
            <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
              {mode === 'login' ? 'Entrar na conta' : 'Criar nova conta'}
            </h1>
            <p className="text-xs sm:text-sm text-white/40 mt-1 font-light">
              {mode === 'login'
                ? 'Insira seus dados para continuar compondo'
                : 'Junte-se à orquestra viva e comece hoje'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-2.5 sm:space-y-3">
            {mode === 'register' && (
              <div className="space-y-1 animate-fade-in">
                <label
                  htmlFor="auth-name"
                  className="block text-[11px] font-medium text-white/50 tracking-wider uppercase"
                >
                  Nome completo
                </label>
                <input
                  id="auth-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm text-white placeholder-white/20 bg-[#121317]/80 hover:bg-[#15171d]/90 focus:bg-[#16181f] border border-white/[0.08] focus:border-white/35 outline-none transition-all duration-200 focus:ring-1 focus:ring-white/20"
                />
              </div>
            )}

            <div className="space-y-1">
              <label
                htmlFor="auth-email"
                className="block text-[11px] font-medium text-white/50 tracking-wider uppercase"
              >
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                className="w-full px-3.5 py-2.5 rounded-xl text-sm text-white placeholder-white/20 bg-[#121317]/80 hover:bg-[#15171d]/90 focus:bg-[#16181f] border border-white/[0.08] focus:border-white/35 outline-none transition-all duration-200 focus:ring-1 focus:ring-white/20"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="auth-password"
                className="block text-[11px] font-medium text-white/50 tracking-wider uppercase"
              >
                Senha
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'Mínimo 6 caracteres' : '••••••••'}
                  required
                  className="w-full px-3.5 py-2.5 pr-11 rounded-xl text-sm text-white placeholder-white/20 bg-[#121317]/80 hover:bg-[#15171d]/90 focus:bg-[#16181f] border border-white/[0.08] focus:border-white/35 outline-none transition-all duration-200 focus:ring-1 focus:ring-white/20"
                />
                <button
                  id="toggle-password-visibility-btn"
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  tabIndex={-1}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/80 transition-colors p-1"
                  aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Mensagem de Erro */}
            {error && (
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs animate-fade-in">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Botão de Ação Primária - Estilo pílula suave e refinada */}
            <button
              id="auth-submit"
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-xl font-semibold text-sm text-[#070907] bg-[#a2b897] hover:bg-[#b2c7a7] active:scale-[0.99] transition-all duration-200 relative overflow-hidden mt-2 shadow-[0_4px_24px_rgba(162,184,151,0.22)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="animate-spin w-4 h-4" />
                  {mode === 'login' ? 'Entrando...' : 'Criando conta...'}
                </span>
              ) : mode === 'login' ? (
                'Continuar com email'
              ) : (
                'Criar conta'
              )}
            </button>

            {/* Termos e Condições */}
            <p className="text-[10px] sm:text-[11px] text-white/35 text-center leading-relaxed pt-1">
              Ao continuar, você concorda com nossos{' '}
              <span className="text-white/50 hover:text-white cursor-pointer underline transition-colors">
                Termos de Serviço
              </span>{' '}
              e{' '}
              <span className="text-white/50 hover:text-white cursor-pointer underline transition-colors">
                Política de Privacidade
              </span>
              .
            </p>
          </form>
        </div>

        {/* Rodapé da Coluna Esquerda: Pílula de Alternância de Conta (Fiel ao design da referência) */}
        <div className="w-full max-w-sm mx-auto pt-1">
          <div className="flex items-center justify-between p-2.5 px-4 rounded-2xl bg-white/[0.03] border border-white/[0.07] backdrop-blur-md">
            <span className="text-xs text-white/50 font-normal">
              {mode === 'login' ? 'Ainda não possui uma conta?' : 'Já possui uma conta?'}
            </span>
            <button
              id="switch-auth-mode-btn"
              type="button"
              onClick={switchMode}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white/90 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.09] transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            >
              {mode === 'login' ? 'Criar conta' : 'Entrar'}
            </button>
          </div>
        </div>
      </section>

      {/* ========================================================
          COLUNA DIREITA: PORTAL CÓSMICO EM ARCO
          ACIMA: O ANEL DO REQUIEM (DynamicRing)
          ABAIXO: FRASES ("Acompanhamento ao vivo, o seu músico", etc...)
          ======================================================== */}
      <section className="hidden lg:flex flex-1 relative items-center justify-center p-3 xl:p-5 z-10 overflow-hidden h-full">
        {/* Estrutura Arquitetônica em Arco (Portal Estelar da Referência) */}
        <div
          className="relative w-full max-w-[480px] h-[92%] max-h-[720px] rounded-t-[240px] rounded-b-[32px] border border-white/[0.12] overflow-hidden flex flex-col justify-between items-center p-5 xl:p-6 shadow-[0_20px_80px_rgba(0,0,0,0.85)]"
          style={{
            background: 'linear-gradient(180deg, #090c10 0%, #05070a 100%)',
          }}
        >
          {/* Imagem de Fundo Cósmica (Nebulosa e Galáxia Espiral com cores ricas) */}
          <div
            className="absolute inset-0 z-0 bg-cover bg-center opacity-45 mix-blend-screen scale-105 pointer-events-none"
            style={{
              backgroundImage: `url(${nebulaBg})`,
              filter: 'contrast(1.2) brightness(0.95)',
            }}
          />

          {/* Gradiente de Fusão para legibilidade */}
          <div
            className="absolute inset-0 z-[1] pointer-events-none"
            style={{
              background: `
                radial-gradient(circle at 50% 32%, rgba(0,0,0,0.1) 0%, rgba(5,7,10,0.8) 85%),
                linear-gradient(180deg, rgba(5,7,10,0.2) 0%, rgba(5,7,10,0.65) 60%, rgba(5,7,10,0.98) 100%)
              `,
            }}
          />

          {/* Linhas Geométricas / Retículas Astronômicas (Estilo Orion) */}
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none z-[2] opacity-35"
            viewBox="0 0 480 720"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Eixo Vertical Central */}
            <line x1="240" y1="0" x2="240" y2="720" stroke="white" strokeWidth="0.75" />

            {/* Eixo Horizontal Intermediário */}
            <line x1="0" y1="280" x2="480" y2="280" stroke="white" strokeWidth="0.75" />

            {/* Curvas Logarítmicas / Órbitas Intersectantes */}
            <path
              d="M 30 620 A 340 340 0 0 1 450 180"
              stroke="white"
              strokeWidth="0.75"
              strokeDasharray="4 4"
            />
            <path
              d="M 80 690 A 380 380 0 0 1 430 110"
              stroke="white"
              strokeWidth="0.5"
            />

            {/* Retícula Quadrada Posicionada com Precisão Astronômica */}
            <rect
              x="290"
              y="262"
              width="36"
              height="36"
              stroke="white"
              strokeWidth="0.8"
            />
          </svg>

          {/* Dados de Telemetria Técnica ao lado da retícula (Fiel à referência) */}
          <div className="absolute top-[262px] left-[336px] z-[3] pointer-events-none text-[9px] font-mono text-white/50 tracking-wider leading-relaxed hidden xl:block">
            <div>requiem: live engine</div>
            <div>status: 100%</div>
            <div>latência: 12ms</div>
            <div>modo: neural-lstm</div>
          </div>

          {/* ----------------------------------------------------
              PARTE SUPERIOR DO ARCO: O MESMO ANEL DO REQUIEM
              ---------------------------------------------------- */}
          <div className="relative z-10 w-full flex flex-col items-center pt-1">
            <div className="relative flex items-center justify-center transition-all duration-700 hover:scale-105">
              <DynamicRing
                isActive={true}
                currentFrequency={ambientFreq}
                intensity={0.42}
                trackingState="tracking"
              />
            </div>

            {/* Badge de status vivo */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] backdrop-blur-sm -mt-5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-mono tracking-widest text-white/70 uppercase">
                {currentPhrase.badge}
              </span>
            </div>
          </div>

          {/* ----------------------------------------------------
              PARTE INFERIOR DO ARCO: FRASES DE EFEITO DO REQUIEM
              ---------------------------------------------------- */}
          <div className="relative z-10 w-full flex flex-col items-center text-center pb-2 px-3">
            {/* Título de Destaque com transição refinada */}
            <div
              className={`min-h-[120px] flex flex-col items-center justify-center transition-all duration-300 ${
                isFading ? 'opacity-0 translate-y-1.5' : 'opacity-100 translate-y-0'
              }`}
            >
              <h2 className="text-2xl xl:text-3xl font-light text-white tracking-tight leading-[1.18]">
                {currentPhrase.title}{' '}
                <span className="font-normal text-white/95 block sm:inline">
                  {currentPhrase.highlight}
                </span>
              </h2>

              <p className="text-xs xl:text-sm text-white/55 font-light leading-relaxed max-w-sm mt-2">
                {currentPhrase.desc}
              </p>
            </div>

            {/* Indicadores de Paginação das Frases */}
            <div className="flex items-center gap-2 mt-3">
              {SHOWCASE_PHRASES.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => handlePhraseSelect(idx)}
                  className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                    activePhraseIdx === idx
                      ? 'w-6 bg-white'
                      : 'w-2 bg-white/20 hover:bg-white/40'
                  }`}
                  aria-label={`Ver destaque ${idx + 1}`}
                />
              ))}
            </div>

            {/* Rodapé técnico sutil */}
            <div className="mt-4 pt-3 border-t border-white/[0.06] w-full flex items-center justify-between text-[9px] font-mono tracking-[0.2em] text-white/25">
              <span>REQUIEM LABS · v1.0</span>
              <span>48kHz · ADAPTIVE</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}


