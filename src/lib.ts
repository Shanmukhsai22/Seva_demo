import { createClient } from '@supabase/supabase-js';
import { demoApi, demoAuth } from './demo-store';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const demoMode = import.meta.env.VITE_DEMO_MODE === 'true' || new URLSearchParams(location.search).get('demo') === '1' || (!url || !key);
export const supabase = !demoMode && url && key ? createClient(url, key) : null;
export const authClient = demoMode ? demoAuth : supabase?.auth;
export const apiUrl = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';
export async function api(path: string, options: RequestInit = {}) {
  if (demoMode) return demoApi(path, options);
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const headers = new Headers(options.headers);
  if (session) headers.set('Authorization', `Bearer ${session.access_token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${apiUrl}${path}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : 'requestFailed');
  }
  return response.status === 204 ? null : response.json();
}
export type Event = { id: string; title: Record<string, string>; description: Record<string, string>; starts_at: string; venue: Record<string, string>; fee_paise: number; capacity: number; available?: number; published: boolean };
export type Profile = { id: string; name: string; phone: string; role: 'admin' | 'ayyagaru' | 'user'; language: string; whatsapp_opt_in: boolean; available: boolean };
export type Consultation = { id: string; user_id: string; notes: string; status: string; response: string | null; assigned_to: string | null; created_at: string; image_path: string; fee_paise: number };
export type Booking = { id: string; event_id: string; status: string; created_at: string; events: Event };
