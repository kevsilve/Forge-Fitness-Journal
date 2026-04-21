import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export function isSupabaseEnabled() {
  return !!supabase;
}

// Send magic link to email
export async function signInWithEmail(email) {
  if(!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if(error) throw error;
}

export async function signOut() {
  if(!supabase) return;
  await supabase.auth.signOut();
}

export async function getSession() {
  if(!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getUser() {
  if(!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Pull all user data from Supabase — returns { cfg, groups, machines, theme, gamification, sessions, stats }
// Returns null if user has no data yet (first login)
export async function dbPull() {
  if(!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if(!user) throw new Error('Not authenticated');

  const [{ data: config }, { data: sessionRows }, { data: statsRow }] = await Promise.all([
    supabase.from('user_config').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('sessions').select('*').eq('user_id', user.id).order('date', { ascending: false }),
    supabase.from('user_stats').select('*').eq('user_id', user.id).maybeSingle(),
  ]);

  if(!config && !sessionRows?.length) return null; // brand-new user

  const sessions = (sessionRows||[]).map(row => ({
    id: row.id,
    date: row.date,
    startedAt: row.started_at,
    savedAt: row.saved_at,
    effort: row.effort,
    duration: row.duration,
    calories: row.calories,
    caloriesEst: row.calories_est,
    notes: row.notes,
    cardio: row.cardio,
    exercises: row.exercises || [],
  }));

  return {
    cfg: config?.cfg,
    groups: config?.groups,
    machines: config?.machines,
    theme: config?.theme,
    gamification: config?.gamification,
    sessions,
    stats: statsRow?.data,
  };
}

// Push full payload to Supabase (used for initial sync and manual push)
export async function dbPush(payload) {
  if(!supabase) throw new Error('Supabase not configured');
  const user = await getUser();
  if(!user) throw new Error('Not authenticated');

  const ops = [
    supabase.from('user_config').upsert({
      user_id: user.id,
      cfg: payload.cfg || {},
      groups: payload.groups || [],
      machines: payload.machines || [],
      theme: payload.theme || 'dark',
      gamification: payload.gamification || {},
      updated_at: new Date().toISOString(),
    }),
    supabase.from('user_stats').upsert({
      user_id: user.id,
      data: payload.stats || {},
      updated_at: new Date().toISOString(),
    }),
  ];

  if(payload.sessions?.length) {
    const rows = payload.sessions.map(s => _sessionToRow(s, user.id));
    ops.push(supabase.from('sessions').upsert(rows));
  }

  const results = await Promise.all(ops);
  for(const { error } of results) { if(error) throw error; }
}

// Incremental upsert for a single just-saved session
export async function dbPushSession(session) {
  if(!supabase) return;
  const user = await getUser();
  if(!user) return;
  const { error } = await supabase.from('sessions').upsert(_sessionToRow(session, user.id));
  if(error) console.warn('dbPushSession failed:', error.message);
}

export async function dbDeleteSession(id) {
  if(!supabase) return;
  const user = await getUser();
  if(!user) return;
  const { error } = await supabase.from('sessions').delete().eq('id', id).eq('user_id', user.id);
  if(error) console.warn('dbDeleteSession failed:', error.message);
}

// Push just the config (after settings change)
export async function dbPushConfig(cfg, groups, machines, theme, gamification) {
  if(!supabase) return;
  const user = await getUser();
  if(!user) return;
  const { error } = await supabase.from('user_config').upsert({
    user_id: user.id,
    cfg: cfg || {},
    groups: groups || [],
    machines: machines || [],
    theme: theme || 'dark',
    gamification: gamification || {},
    updated_at: new Date().toISOString(),
  });
  if(error) console.warn('dbPushConfig failed:', error.message);
}

// Push just stats (after a session save)
export async function dbPushStats(stats) {
  if(!supabase) return;
  const user = await getUser();
  if(!user) return;
  const { error } = await supabase.from('user_stats').upsert({
    user_id: user.id,
    data: stats || {},
    updated_at: new Date().toISOString(),
  });
  if(error) console.warn('dbPushStats failed:', error.message);
}

function _sessionToRow(s, userId) {
  return {
    id: s.id,
    user_id: userId,
    date: s.date,
    started_at: s.startedAt || null,
    saved_at: s.savedAt || new Date().toISOString(),
    effort: s.effort || null,
    duration: s.duration || null,
    calories: s.calories ? parseFloat(s.calories) : null,
    calories_est: s.caloriesEst || false,
    notes: s.notes || null,
    cardio: s.cardio || null,
    exercises: s.exercises || [],
  };
}
