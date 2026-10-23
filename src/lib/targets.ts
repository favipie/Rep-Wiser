import { z } from 'zod';
import { type Data, type Session, type Performed, uid, emptySet } from './model';
import { ENGINE_VERSION } from './intelligence/config';
import { supabase } from './supabase';
import { readLocal } from './storage';

export const prescriptionSchema = z.object({ weight: z.number().min(0).max(1500), min: z.number().int().min(1).max(200), max: z.number().int().min(1).max(200), sets: z.number().int().min(1).max(20) }).refine(p => p.max >= p.min, 'Maximum reps must be at least minimum reps.');
export type Prescription = z.infer<typeof prescriptionSchema>;
export type Target = { id: string; exercise_id: string; source_session_id: string; source_performed_id: string; analysis_fingerprint: string; engine_version: string; status: 'accepted' | 'modified' | 'rejected' | 'applied' | 'superseded'; suggested: Record<string, unknown>; weight_kg: number | null; rep_min: number | null; rep_max: number | null; sets: number | null; decided_at: string; applied_session_id?: string };
export const isActive = (t: Target) => t.status === 'accepted' || t.status === 'modified';
const key = (owner: string) => `repwise:targets:v1:${owner}`;
// Canonical JSON avoids object insertion order differences after a cloud round-trip.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
/** Exact canonical context rather than a collision-prone short hash. Stored only with decisions. */
export function localContext(data: Data, sourceId: string, performedId: string): string {
  const source = data.sessions.find(s => s.id === sourceId && s.status === 'complete');
  const exercise = source?.exercises.find(e => e.id === performedId);
  if (!source || !exercise) throw new Error('Source workout was removed or is incomplete.');
  return canonical({ engine: ENGINE_VERSION, preferences: data.preferences, custom: data.custom.find(e => e.id === exercise.exerciseId) ?? null,
    history: data.sessions.filter(s => s.status === 'complete' && s.date <= source.date).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map(s => ({ id: s.id, date: new Date(s.date).toISOString(), exercises: s.exercises.filter(e => e.exerciseId === exercise.exerciseId) })).filter(s => s.exercises.length) });
}
export function staleReason(t: Target, data: Data, destinationId?: string): string | null {
  try {
    if (t.engine_version !== ENGINE_VERSION || t.suggested._localContext !== localContext(data, t.source_session_id, t.source_performed_id)) return 'Source data or analysis settings changed. Review the analysis again.';
    const source = data.sessions.find(s => s.id === t.source_session_id)!;
    if (data.sessions.some(s => s.id !== destinationId && s.status === 'complete' && s.date > source.date && s.exercises.some(e => e.exerciseId === t.exercise_id))) return 'A newer workout exists. Review its analysis.';
    return null;
  } catch { return 'The source workout was deleted or reopened.'; }
}
export function applyToExercise(e: Performed, t: Target): Performed {
  if (!isActive(t) || e.exerciseId !== t.exercise_id || e.sets.some(s => s.done)) throw new Error('Apply a saved target before logging sets for this exercise.');
  const p = prescriptionSchema.parse({ weight: t.weight_kg, min: t.rep_min, max: t.rep_max, sets: t.sets });
  return { ...e, min: p.min, max: p.max, required: p.sets, targetId: t.id, targetWeight: p.weight, override: null,
    sets: [...e.sets.filter(s => s.warmup), ...Array.from({ length: p.sets }, () => ({ ...emptySet(), weight: p.weight }))] };
}
export async function listTargets(owner: string): Promise<Target[]> {
  if (owner === 'guest') return JSON.parse(localStorage.getItem(key(owner)) ?? '[]');
  if (!supabase) throw new Error('Cloud targets are unavailable. Your journal is preserved.');
  const { data, error } = await supabase.from('next_workout_targets').select('*').order('decided_at', { ascending: false });
  if (error) throw new Error('Saved targets could not be loaded. The target migration may not be installed. ' + error.message);
  return data as Target[];
}
export type Context = { fingerprint: string; revision: number; exerciseId: string };
export async function contextFor(owner: string, source: Session, performedId: string): Promise<Context> {
  if (owner === 'guest') return { fingerprint: 'device', revision: 0, exerciseId: source.exercises.find(e => e.id === performedId)!.exerciseId };
  const local = readLocal(owner);
  if (!supabase || !local || local.dirty) throw new Error('Sync your journal, then reopen this analysis to save cloud targets.');
  const { data, error } = await supabase.rpc('target_context', { p_session_id: source.id, p_performed_id: performedId });
  if (error) throw new Error(error.message);
  if (data.revision !== local.revision) throw new Error('Your cloud journal changed. Reload it before deciding.');
  return data;
}
export function appendDecision(existing: Target[], target: Target, expected: string | null): Target[] {
  const active = existing.find(t => t.exercise_id === target.exercise_id && isActive(t));
  if ((active?.id ?? null) !== expected) throw new Error('Another decision changed this target. Reload before replacing it.');
  if (existing.some(t => t.id === target.id)) throw new Error('Decision already saved.');
  return [target, ...existing.map(t => t.id === active?.id ? { ...t, status: 'superseded' as const } : t)];
}
export async function decideTarget(owner: string, data: Data, source: Session, performedId: string, ctx: Context, status: 'accepted' | 'modified' | 'rejected', suggested: Record<string, unknown>, prescription: Prescription, expected: string | null): Promise<Target> {
  if (status !== 'rejected') prescriptionSchema.parse(prescription);
  const t: Target = { id: uid(), exercise_id: ctx.exerciseId, source_session_id: source.id, source_performed_id: performedId, analysis_fingerprint: ctx.fingerprint, engine_version: ENGINE_VERSION, status,
    suggested: { ...suggested, _localContext: localContext(data, source.id, performedId), _revision: ctx.revision, _expectedActive: expected },
    weight_kg: status === 'rejected' ? null : prescription.weight, rep_min: status === 'rejected' ? null : prescription.min, rep_max: status === 'rejected' ? null : prescription.max, sets: status === 'rejected' ? null : prescription.sets, decided_at: new Date().toISOString() };
  const stale = staleReason(t, data); if (stale) throw new Error(stale);
  if (owner === 'guest') {
    await navigator.locks.request(key(owner), async () => {
      localStorage.setItem(key(owner), JSON.stringify(appendDecision(await listTargets(owner), t, expected)));
    });
    return t;
  }
  if (!supabase || readLocal(owner)?.dirty) throw new Error('Sync your journal and reopen the analysis first.');
  const result = await supabase.rpc('decide_target', { p_id: t.id, p_exercise_id: t.exercise_id, p_source_session_id: source.id, p_source_performed_id: performedId, p_fingerprint: ctx.fingerprint, p_engine_version: ENGINE_VERSION, p_status: status, p_suggested: t.suggested, p_weight_kg: t.weight_kg, p_rep_min: t.rep_min, p_rep_max: t.rep_max, p_sets: t.sets });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
/** Called after journal persistence. Failures leave the decision active for explicit retry. */
export async function completeTargets(owner: string, data: Data): Promise<void> {
  const complete = async () => {
    let targets = await listTargets(owner);
    for (const session of data.sessions.filter(s => s.status === 'complete')) for (const e of session.exercises.filter(e => e.targetId)) {
      const t = targets.find(t => t.id === e.targetId);
      if (!t) throw new Error('A selected target is missing. Remove its link from the workout or reload your saved targets.');
      if (t.status === 'applied') {
        if (t.applied_session_id !== session.id) throw new Error('This target was used by another workout. Remove its link before syncing.');
        continue;
      }
      const source = data.sessions.find(s => s.id === t.source_session_id);
      if (!source || new Date(session.date).getTime() <= new Date(source.date).getTime() || e.exerciseId !== t.exercise_id) throw new Error('Targets belong to a subsequent workout of the same exercise.');
      const reason = staleReason(t, data, session.id);
      if (reason) throw new Error(reason);
      if (!isActive(t) || e.min !== t.rep_min || e.max !== t.rep_max || e.required !== t.sets || e.targetWeight !== t.weight_kg) throw new Error('A used target was changed. Review the workout before retrying.');
      if (owner === 'guest') targets = targets.map(x => x.id === t.id ? { ...x, status: 'applied', applied_session_id: session.id } : x);
      else {
        const result = await supabase!.rpc('apply_target', { p_id: t.id, p_session_id: session.id });
        if (result.error) throw new Error(result.error.message);
      }
    }
    if (owner === 'guest') localStorage.setItem(key(owner), JSON.stringify(targets));
  };
  // Do not require the target migration for journals that have never used targets.
  if (!data.sessions.some(s => s.status === 'complete' && s.exercises.some(e => e.targetId))) return;
  if (owner === 'guest') await navigator.locks.request(key(owner), complete); else await complete();
}
