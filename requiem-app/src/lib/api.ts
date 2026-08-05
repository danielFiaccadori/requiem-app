// Central API client for backend communication
const BASE_URL: string = ((import.meta as any).env?.VITE_API_URL ?? '');

function getToken(): string | null {
  return localStorage.getItem('requiem_token');
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  // Lê o body como texto para evitar crash em respostas vazias ou não-JSON
  const text = await res.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Resposta não é JSON (ex: HTML de erro do Tomcat)
      if (!res.ok) throw new Error(`Erro ${res.status}: ${res.statusText}`);
    }
  }

  if (!res.ok) throw new Error(data?.error || data?.message || `Erro ${res.status}`);
  return data as T;
}

// ── Auth ──────────────────────────────────────────────────
export async function apiLogin(email: string, password: string) {
  return apiFetch<{ token: string; user: User }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function apiRegister(email: string, name: string, password: string) {
  return apiFetch<{ token: string; user: User }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, name, password }),
  });
}

export async function apiMe() {
  return apiFetch<{ user: User }>('/auth/me');
}

// ── Sessions ──────────────────────────────────────────────
export async function apiGetSessions() {
  return apiFetch<{ sessions: ChatSession[] }>('/sessions');
}

export async function apiCreateSession(title?: string) {
  return apiFetch<{ session: ChatSession }>('/sessions', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export async function apiGetSession(id: string) {
  return apiFetch<{ session: ChatSession & { messages: Message[] } }>(`/sessions/${id}`);
}

export async function apiRenameSession(id: string, title: string) {
  return apiFetch<{ success: boolean }>(`/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export async function apiSaveComposition(id: string, compositionData: SerializedBlock[]) {
  return apiFetch<{ success: boolean }>(`/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ compositionData }),
  });
}

export async function apiDeleteSession(id: string) {
  return apiFetch<{ success: boolean }>(`/sessions/${id}`, {
    method: 'DELETE',
  });
}

export async function apiAddMessage(sessionId: string, role: 'user' | 'assistant', content: string) {
  return apiFetch<{ message: Message }>(`/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role, content }),
  });
}

// ── Types ─────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  name: string;
}

/** Serializable version of a chord segment (no complex objects) */
export interface SerializedChordSegment {
  id: string;
  chord: string;
  durationBeats: number;
}

/** Serializable version of a detected note */
export interface SerializedNote {
  pitch: number;
  startTime: number;
  endTime: number;
  amplitude: number;
}

/** Serializable composition block stored in the DB */
export interface SerializedBlock {
  id: string;
  name: string;
  notes: SerializedNote[];
  progression: SerializedChordSegment[];
  key: string;
  bpm: number;
  timeSignature: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  compositionData?: SerializedBlock[] | null;
  messages?: { content: string; createdAt: string }[];
}

export interface Message {
  id: string;
  role: string;
  content: string;
  sessionId: string;
  createdAt: string;
}
