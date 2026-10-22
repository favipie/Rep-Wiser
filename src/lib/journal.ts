import { supabase } from './supabase';
import { readLocal, writeLocal } from './storage';
import { blankData, type Data } from './model';

/** Same owner rules as the training page: signed-in Supabase user, otherwise the device journal if chosen. */
export async function resolveOwner(): Promise<string | null> {
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  }
  return sessionStorage.getItem('repwise-device-mode') === 'yes' ? 'guest' : null;
}

export type LoadedJournal = { data: Data; revision: number; dirty: boolean; notice: string };

/**
 * Read-only load of the journal for pages outside /train. Follows the training page's rule: unsynced device
 * edits win; otherwise the account copy is used and cached. This never writes user edits or syncs.
 */
export async function loadJournal(owner: string): Promise<LoadedJournal> {
  const local = readLocal(owner);
  let notice = '';
  if (owner !== 'guest' && supabase) {
    const { data: remote, error } = await supabase.rpc('read_journal');
    if (error) throw error;
    if (remote && !local?.dirty) {
      writeLocal(owner, { data: remote.data, revision: remote.revision, dirty: false });
      return { data: remote.data, revision: remote.revision, dirty: false, notice };
    }
    if (local?.dirty) notice = 'Showing unsynced changes from this device.';
  }
  return { data: local?.data ?? blankData(), revision: local?.revision ?? 0, dirty: local?.dirty ?? false, notice };
}
