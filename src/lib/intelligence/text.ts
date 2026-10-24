export const round2 = (v: number) => Math.round(v * 100) / 100;
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items.at(-1);
}
export function makeFormatter(units: 'kg' | 'lb') {
  const factor = units === 'lb' ? 2.2046226218 : 1;
  const w = (kg: number) => `${round2(kg * factor)} ${units}`;
  return { units, factor, w };
}
export type Formatter = ReturnType<typeof makeFormatter>;
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
/** Small, stable, dependency-free hash (FNV-1a) used to detect when stored records changed. */
export function fingerprint(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
