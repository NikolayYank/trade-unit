// Аналитика: итоги плана магазина в удобном виде и прогноз «что будет, если...».
// Прогноз не меняет настоящие данные: берёт копию с подменёнными значениями и считает магазин заново.
import { calcStore, margin, type OfferPatch, type StoreCalc, type Totals } from './store';
import type { ProductCalcs } from './offers';
import type { ChannelScenario, Db, Scenario } from './types';

/** Оставляет только заданные числа: пустое поле в прогнозе значит «как сейчас». */
const defined = <T extends object>(o: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Partial<T>;

/** Сколько значений подменено в прогнозе. */
export function scenarioCount(sc: Scenario | undefined): number {
  if (!sc) return 0;
  const n = (o: object | undefined) => Object.keys(defined(o)).length;
  return n({ sales: sc.sales })
    + Object.values(sc.channels ?? {}).reduce((a, c) => a + n(c), 0)
    + Object.values(sc.offers ?? {}).reduce((a, o) => a + n(o), 0);
}

/** База с подменёнными значениями прогноза и подмена цен и себестоимости позиций. Исходная база не меняется. */
export function applyScenario(db: Db, sc: Scenario | undefined): { db: Db; patch: OfferPatch } {
  const channels = db.channels.map(c => ({ ...c, ...defined<ChannelScenario>(sc?.channels?.[c.id]) }));
  const sales = sc?.sales;
  const store = typeof sales === 'number' && Number.isFinite(sales) ? { ...db.store, sales } : db.store;
  const patch: OfferPatch = {};
  for (const [ref, o] of Object.entries(sc?.offers ?? {})) patch[ref] = defined(o);
  return { db: { ...db, channels, store }, patch };
}

/** Магазин с учётом прогноза. Нет ни одной подмены — null: прогноза нет. */
export function calcForecast(db: Db, pc: ProductCalcs): StoreCalc | null {
  if (scenarioCount(db.scenario) === 0) return null;
  const { db: d, patch } = applyScenario(db, db.scenario);
  return calcStore(d, pc, patch);
}

export interface Summary {
  sold: number; revenue: number; cogs: number; ads: number; overhead: number;
  contribution: number;   // прибыль до накладных
  profit: number;         // чистая прибыль
  profitMargin: number;   // чистая прибыль, % от оборота
  profitPerOrder: number; // чистая прибыль с одного проданного заказа
}

export function summarize(r: StoreCalc): Summary {
  const { sold, revenue, cogs, ads, contribution } = r.totals;
  return {
    sold, revenue, cogs, ads, overhead: r.overhead, contribution, profit: r.profitAfterOverhead,
    profitMargin: revenue > 0 ? r.profitAfterOverhead / revenue * 100 : 0,
    profitPerOrder: sold > 0 ? r.profitAfterOverhead / sold : 0,
  };
}

/** Показатели одной строки разбивки (позиция или канал): деньги и качество (проценты от оборота и прибыль с заказа). */
export interface RowMetrics {
  revenue: number;
  margin: number; marginPct: number;     // оборот минус себестоимость; и его доля в обороте
  ads: number; adsPct: number;           // реклама и её доля в обороте
  profit: number; profitPct: number;     // прибыль до накладных расходов; и её доля в обороте (рентабельность)
  perOrder: number;                      // прибыль до накладных с одного проданного заказа
}

export function rowMetrics(t: Totals): RowMetrics {
  const pct = (v: number) => (t.revenue > 0 ? v / t.revenue * 100 : 0);
  const m = margin(t);
  return {
    revenue: t.revenue, margin: m, marginPct: pct(m), ads: t.ads, adsPct: pct(t.ads),
    profit: t.contribution, profitPct: pct(t.contribution), perOrder: t.sold > 0 ? t.contribution / t.sold : 0,
  };
}

/** На сколько процентов значение прогноза выше (плюс) или ниже (минус) настоящего. Настоящее 0 — null: процент не посчитать. */
export const changePct = (now: number, forecast: number): number | null => (now !== 0 ? (forecast - now) / Math.abs(now) * 100 : null);
