// Central API client for Requiem backend communication (Auth, Sessions & Preset Store)
const BASE_URL: string = ((import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '');

function getToken(): string | null {
  return localStorage.getItem('requiem_token');
}

async function apiFetch<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const { skipAuth, ...fetchOptions } = options;
  const token = skipAuth ? null : getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...fetchOptions, headers });

  // Read body as text to avoid crash on empty or non-JSON responses
  const text = await res.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!res.ok) throw new Error(`Erro ${res.status}: ${res.statusText}`);
    }
  }

  if (!res.ok) throw new Error(data?.error || data?.message || `Erro ${res.status}`);
  return data as T;
}

// ── Health ────────────────────────────────────────────────
export async function apiHealth() {
  return apiFetch<{ status: string }>('/health', { skipAuth: true });
}

// ── Auth ──────────────────────────────────────────────────
export async function apiLogin(email: string, password: string) {
  return apiFetch<{ token: string; user: User }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    skipAuth: true,
  });
}

export async function apiRegister(email: string, name: string, password: string) {
  return apiFetch<{ token: string; user: User }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, name, password }),
    skipAuth: true,
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
    body: JSON.stringify(title ? { title } : {}),
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

export async function apiSaveComposition(
  id: string,
  compositionData: SerializedBlock[],
  title?: string
) {
  const payload: { compositionData: SerializedBlock[]; title?: string } = { compositionData };
  if (title !== undefined) payload.title = title;
  return apiFetch<{ success: boolean }>(`/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function apiExportSession(id: string) {
  return apiFetch<{ export: SessionExportPayload }>(`/sessions/${id}/export`);
}

export async function apiExportSessionToStore(id: string, payload: ExportSessionToStorePayload) {
  return apiFetch<{ preset: StorePreset }>(`/sessions/${id}/export-to-store`, {
    method: 'POST',
    body: JSON.stringify(payload),
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

// ── Preset Store (/store/presets) ─────────────────────────
export async function apiGetStorePresets(params?: {
  search?: string;
  genre?: string;
  sortBy?: 'recent' | 'popular';
}) {
  const qs = new URLSearchParams();
  if (params?.search?.trim()) qs.set('search', params.search.trim());
  if (params?.genre?.trim() && params.genre !== 'Todos') qs.set('genre', params.genre.trim());
  if (params?.sortBy) qs.set('sortBy', params.sortBy);
  const query = qs.toString();
  return apiFetch<{ presets: StorePreset[] }>(`/store/presets${query ? `?${query}` : ''}`, {
    skipAuth: true,
  });
}

export async function apiGetStorePreset(id: string) {
  return apiFetch<{ preset: StorePreset }>(`/store/presets/${id}`, {
    skipAuth: true,
  });
}

export async function apiUseStorePreset(id: string, createSession = true) {
  return apiFetch<{ preset: StorePreset; createdSession?: ChatSession }>(
    `/store/presets/${id}/use?createSession=${createSession ? 'true' : 'false'}`,
    {
      method: 'POST',
      skipAuth: !createSession,
    }
  );
}

export async function apiPublishStorePreset(payload: PublishStorePresetPayload) {
  return apiFetch<{ preset: StorePreset }>('/store/presets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiGetMyStorePresets() {
  return apiFetch<{ presets: StorePreset[] }>('/store/presets/my');
}

export async function apiUpdateStorePreset(id: string, payload: UpdateStorePresetPayload) {
  return apiFetch<{ preset: StorePreset }>(`/store/presets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function apiDeleteStorePreset(id: string) {
  return apiFetch<{ success: boolean }>(`/store/presets/${id}`, {
    method: 'DELETE',
  });
}

// ── Types ─────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt?: string;
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
  messages?: Message[];
}

export interface Message {
  id: string;
  role: string;
  content: string;
  sessionId?: string;
  createdAt: string;
}

export interface SessionExportPayload {
  sessionId: string;
  title: string;
  exportedAt: string;
  configurationData: SerializedBlock[];
}

export interface StorePreset {
  id: string;
  title: string;
  description?: string;
  genre?: string;
  tags?: string;
  bpm?: number;
  tonality?: string;
  timeSignature?: string;
  configurationData?: SerializedBlock[];
  downloadsCount: number;
  likesCount: number;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExportSessionToStorePayload {
  title: string;
  description?: string;
  genre?: string;
  tags?: string;
  bpm?: number;
  tonality?: string;
  timeSignature?: string;
}

export interface PublishStorePresetPayload extends ExportSessionToStorePayload {
  sessionId?: string;
  configurationData?: SerializedBlock[];
}

export interface UpdateStorePresetPayload {
  title?: string;
  description?: string;
  genre?: string;
  tags?: string;
  bpm?: number;
  tonality?: string;
  timeSignature?: string;
  configurationData?: SerializedBlock[];
}
