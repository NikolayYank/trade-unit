import type { Currency, Settings } from './types';

export const SYMBOLS: Record<Currency, string> = { EUR: '€', USD: '$', CNY: '¥', UAH: '₴', UZS: 'сўм ' };

/** Перевести сумму из валюты `from` в основную валюту. Курсы — единиц за 1 USD. */
export function toBase(value: number, from: Currency, s: Settings): number {
  const rFrom = s.fx[from] || 1;
  const rBase = s.fx[s.baseCurrency] || 1;
  return (value / rFrom) * rBase;
}

export const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Курсы с наценкой обменника. mid — курсы центробанков (единиц за 1 USD).
 * Каждая валюта, кроме основной, становится дороже в основной валюте на markup %:
 * закупка и расходы в чужой валюте считаются осторожно, как при покупке валюты в обменнике.
 * Возвращает только те курсы, которые удалось посчитать; null — нет курса основной валюты.
 */
export function applyMarkup(mid: Partial<Record<Currency, number>>, base: Currency, markup: number): Partial<Record<Currency, number>> | null {
  const k = 1 + Math.max(0, markup) / 100;
  const out: Partial<Record<Currency, number>> = {};
  if (base === 'USD') {
    for (const [c, v] of Object.entries(mid) as [Currency, number][]) if (c !== 'USD' && v > 0) out[c] = v / k;
    return out;
  }
  const b = mid[base];
  if (!(b && b > 0)) return null;
  for (const [c, v] of Object.entries(mid) as [Currency, number][]) if (c !== 'USD' && v > 0) out[c] = c === base ? v * k : v;
  return out;
}
