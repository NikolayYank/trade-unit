// Хранение: несколько учётных записей в localStorage. Учётная запись = отдельная база
// (товары, наборы, каналы, магазин, настройки). Файл JSON — одна учётная запись.
import { demoDb, emptyDb } from './demo';
import { uid } from './engine/taxPresets';
import { approveShare, buyoutShare, usdToBase } from './engine/channel';
import { num } from './engine/money';
import type { Channel, Db } from './engine/types';

export interface Account { id: string; name: string; db: Db }
export interface Accounts { activeId: string; list: Account[] }

const KEY = 'trade_unit_accounts_v1';
const OLD_KEY = 'trade_unit_db_v1'; // до учётных записей: одна база

export function loadAccounts(): Accounts {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const a = JSON.parse(raw) as Accounts;
      if (Array.isArray(a.list) && a.list.length) {
        if (!a.list.some(x => x.id === a.activeId)) a.activeId = a.list[0].id;
        a.list.forEach(x => { x.db = normalizeDb(x.db); });
        return a;
      }
    }
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const acc = { id: uid(), name: 'Основная', db: parseDb(old) };
      return { activeId: acc.id, list: [acc] };
    }
  } catch { /* битые данные или запрет хранилища — стартуем с примера */ }
  const acc = { id: uid(), name: 'Пример', db: demoDb() };
  return { activeId: acc.id, list: [acc] };
}

export function saveAccounts(a: Accounts): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(a)); return true; } catch { return false; }
}

export const newAccount = (name: string, db: Db = emptyDb()): Account => ({ id: uid(), name, db });

/** Имя, которого ещё нет в списке: «Магазин», «Магазин (2)», … */
export function uniqueName(name: string, list: Account[]): string {
  const base = name.trim() || 'Без названия';
  if (!list.some(a => a.name === base)) return base;
  let i = 2;
  while (list.some(a => a.name === `${base} (${i})`)) i++;
  return `${base} (${i})`;
}

/**
 * Приводит данные из старых сохранений и файлов к текущей форме. Безопасно вызывать повторно.
 * 1. Доставка, упаковка, возвраты и комиссия больше не считаются отдельно: их вписывают накладными расходами магазина.
 *    Старые поля (в магазине и в каналах) остаются в данных, но не используются.
 * 2. Режим «без рекламы» убран: такой канал становится «по готовой цене» с нулевой ценой.
 * 3. Апрув канала: нет поля — 100%.
 * 4. Выкуп канала: нет поля — берём 100% минус старый невыкуп. Предпочитаем невыкуп самого канала (старое поле noBuy),
 *    потом общий невыкуп магазина (store.noBuy, он был в промежуточной версии), иначе 0.
 * 5. Период плана в днях: нет поля — 30.
 * 6. CPM всегда в долларах. Нет метки `cpmInUsd` (старые данные): CPM канала и CPM в прогнозе были в основной валюте,
 *    переводим в доллары по текущему курсу и ставим метку. Повторный вызов ничего не меняет.
 * 7. План магазина: раньше строки «позиция × канал × оформлено заказов», теперь общий план продаж, доли позиций и доли каналов.
 *    Оформленные заказы пересчитываются в проданные (через апрув и выкуп канала); их сумма становится планом продаж,
 *    а доли считаются из пропорций. Старый список `plan` остаётся в данных и не используется.
 */
export function normalizeDb(d: Db): Db {
  const st = d.store as unknown as Record<string, unknown>;
  const channels = d.channels as unknown as Record<string, unknown>[];
  for (const c of channels) {
    if (c.adMode === 'none') c.adMode = 'cpa';
    if (c.approve === undefined) c.approve = 100;
    if (c.buyout === undefined) {
      const noBuy = typeof c.noBuy === 'number' ? c.noBuy : typeof st.noBuy === 'number' ? st.noBuy : 0;
      c.buyout = Math.min(100, Math.max(0, 100 - noBuy));
    }
  }
  if (st.period === undefined) st.period = 30;
  if (!d.settings.cpmInUsd) {
    const k = usdToBase(d) || 1;
    for (const c of d.channels) c.cpm = Math.round(num(c.cpm) / k * 100) / 100;
    for (const c of Object.values(d.scenario?.channels ?? {})) if (c.cpm !== undefined) c.cpm = Math.round(num(c.cpm) / k * 100) / 100;
    d.settings.cpmInUsd = true;
  }
  if (st.items === undefined) convertOldPlan(st, channels as unknown as Channel[]);
  return d;
}

/** Переносит старый план (строки позиция × канал × оформлено заказов) в общий план продаж с долями. */
function convertOldPlan(st: Record<string, unknown>, channels: Channel[]) {
  const rows = (Array.isArray(st.plan) ? st.plan : []) as { offer: string; channelId: string; orders: number }[];
  const byOffer = new Map<string, { sold: number; ch: Map<string, number> }>();
  let total = 0;
  for (const r of rows) {
    const ch = channels.find(c => c.id === r.channelId);
    if (!ch) continue;
    const sold = Math.max(0, num(r.orders)) * approveShare(ch) * buyoutShare(ch);
    if (sold <= 0) continue;
    const o = byOffer.get(r.offer) ?? { sold: 0, ch: new Map<string, number>() };
    o.sold += sold; o.ch.set(ch.id, (o.ch.get(ch.id) ?? 0) + sold);
    byOffer.set(r.offer, o); total += sold;
  }
  const pct = (part: number, whole: number) => Math.floor((part / whole) * 10000) / 100; // вниз, чтобы сумма долей не вышла за 100
  st.sales = Math.round(total);
  st.items = [...byOffer].map(([offer, o], i) => ({
    id: `m${i}${Date.now().toString(36)}`, offer, share: pct(o.sold, total),
    channels: [...o.ch].map(([channelId, sold]) => ({ channelId, share: pct(sold, o.sold) })),
  }));
}

/** Проверка формы базы. Бросает ошибку с понятным текстом. */
export function parseDb(text: string): Db {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('Файл не читается: это не JSON.'); }
  return checkDb(d);
}

function checkDb(d: unknown): Db {
  const x = d as Partial<Db> | null;
  if (!x || x.version !== 1) throw new Error('Это не файл калькулятора Trade Unit.');
  for (const k of ['products', 'kits', 'channels'] as const)
    if (!Array.isArray(x[k])) throw new Error('Файл повреждён: не хватает части данных.');
  if (!x.settings?.fx || !x.settings?.tax || !x.store) throw new Error('Файл повреждён: не хватает настроек.');
  return normalizeDb(x as Db);
}

/** Файл учётной записи: { kind, name, db }. Старые файлы (просто база) тоже открываются. */
export function parseAccountFile(text: string, fallbackName: string): { name: string; db: Db } {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('Файл не читается: это не JSON.'); }
  if (d?.kind === 'trade_unit_account') return { name: String(d.name || fallbackName), db: checkDb(d.db) };
  return { name: fallbackName, db: checkDb(d) };
}

export function downloadAccount(name: string, db: Db) {
  const body = { kind: 'trade_unit_account', name, db };
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = name.replace(/[^\wа-яёіїєґ-]+/gi, '_').slice(0, 40) || 'account';
  a.download = `trade-unit_${safe}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
