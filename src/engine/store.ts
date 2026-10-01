// Магазин: план продаж → доли позиций → доли каналов → оборот, себестоимость, реклама и прибыль до накладных.
import { approveShare, buyoutShare, orderCtx, orderEconomics, type OrderEconomics } from './channel';
import { clamp, num, toBase } from './money';
import { allOffers, calcAllProducts, type Offer, type ProductCalcs } from './offers';
import type { Channel, Db, Overhead, PlanItem } from './types';

/** Суммы по заказам: сколько продано и во что это обошлось. */
export interface Totals {
  sold: number;        // проданных заказов (забранных клиентом)
  placed: number;      // оформлено заказов, чтобы столько продать
  gross: number;       // деньги клиентов с НДС
  revenue: number;     // оборот: выручка без НДС для плательщика НДС, иначе то же, что gross
  cogs: number;        // себестоимость проданного товара
  ads: number;         // реклама и плата каналов
  contribution: number; // прибыль до накладных расходов
}

const ZERO: Totals = { sold: 0, placed: 0, gross: 0, revenue: 0, cogs: 0, ads: 0, contribution: 0 };

/** Сумма в пересчёте на `days` дней при плане на `period` дней. Период 0 — 0. */
export const forDays = (v: number, period: number, days: number): number => (period > 0 ? v * days / period : 0);

/** Сумма в пересчёте на один день периода плана. */
export const perDay = (v: number, period: number): number => forDays(v, period, 1);

/** Маржа: что остаётся от оборота после себестоимости товара, до рекламы. */
export const margin = (t: Totals): number => t.revenue - t.cogs;

function add(t: Totals, e: OrderEconomics) {
  t.sold += e.delivered; t.placed += e.placed; t.gross += e.gross; t.revenue += e.revenue;
  t.cogs += e.cogs; t.ads += e.ads; t.contribution += e.contribution;
}

export interface ItemResult {
  item: PlanItem;
  offer: Offer | null;   // null — товар или набор удалён
  price: number;
  channelsShare: number; // сумма долей каналов, %
  blocked: string[];     // каналы, через которые ничего не продать: апрув или выкуп равен нулю
  totals: Totals;
}

/** Подмена цены и себестоимости позиций (для прогноза): ссылка позиции → значения. */
export type OfferPatch = Record<string, { price?: number; unitCost?: number }>;

export interface StoreCalc {
  sales: number;
  itemsShare: number;    // сумма долей позиций, %
  items: ItemResult[];
  channels: { channel: Channel; totals: Totals }[]; // итоги по каналам, до накладных расходов
  totals: Totals;
  overheadLines: { line: Overhead; amount: number; perOrder: number }[]; // за месяц и в среднем на один проданный заказ
  overhead: number;
  profitAfterOverhead: number;
  period: number;        // дней в периоде плана
}

/** Накладной расход за месяц в основной валюте. Процент считается от оборота, сумма за штуку умножается на число проданных. */
export function overheadAmount(o: Overhead, revenue: number, sold: number, db: Db): number {
  if (o.kind === 'percent') return revenue * num(o.percent) / 100;
  const amount = toBase(num(o.amount), o.currency, db.settings);
  return o.kind === 'perUnit' ? amount * sold : amount;
}

/**
 * Месяц магазина. Всего продаётся `sales` заказов; позиция берёт свою долю, внутри позиции доли делятся по каналам.
 * Для канала считаем, сколько заказов надо оформить, чтобы получить нужное число проданных (с учётом апрува и выкупа),
 * и дальше обычная экономика заказа: оборот, себестоимость, реклама.
 * Что не распределено (сумма долей меньше 100%), не продаётся и в расчёт не попадает.
 */
export function calcStore(db: Db, pc: ProductCalcs = calcAllProducts(db), patch?: OfferPatch): StoreCalc {
  const ctx = orderCtx(db);
  const offers = new Map(allOffers(db, pc).map(o => {
    const p = patch?.[o.ref];
    return [o.ref, p ? { ...o, price: p.price ?? o.price, unitCost: p.unitCost ?? o.unitCost } : o] as const;
  }));
  const channels = new Map(db.channels.map(c => [c.id, c]));
  const sales = Math.max(0, num(db.store.sales));
  const totals: Totals = { ...ZERO };
  const byChannel = new Map<string, Totals>(db.channels.map(c => [c.id, { ...ZERO }]));

  const items: ItemResult[] = db.store.items.map(item => {
    const offer = offers.get(item.offer) ?? null;
    const price = offer?.price ?? 0;   // цена розницы товара или цена набора
    const t: Totals = { ...ZERO };
    const blocked: string[] = [];
    let channelsShare = 0;
    for (const cs of item.channels) {
      const ch = channels.get(cs.channelId);
      if (!ch) continue;
      const share = clamp(num(cs.share), 0, 100);
      channelsShare += share;
      if (!offer) continue;
      const sold = sales * (clamp(num(item.share), 0, 100) / 100) * (share / 100);
      if (sold <= 0) continue;
      const conv = approveShare(ch) * buyoutShare(ch); // доля оформленных заказов, которые дойдут до покупки
      if (conv <= 0) { blocked.push(ch.id); continue; }
      const e = orderEconomics(sold / conv, price, offer.unitCost, ch, ctx);
      add(t, e); add(byChannel.get(ch.id)!, e);
    }
    for (const k of Object.keys(t) as (keyof Totals)[]) totals[k] += t[k];
    return { item, offer, price, channelsShare, blocked, totals: t };
  });

  const overheadLines = db.store.overhead.map(line => {
    const amount = overheadAmount(line, totals.revenue, totals.sold, db);
    return { line, amount, perOrder: totals.sold > 0 ? amount / totals.sold : 0 };
  });
  const overhead = overheadLines.reduce((a, x) => a + x.amount, 0);
  return {
    sales,
    itemsShare: db.store.items.reduce((a, i) => a + clamp(num(i.share), 0, 100), 0),
    items, channels: db.channels.map(c => ({ channel: c, totals: byChannel.get(c.id)! })), totals, overheadLines, overhead,
    profitAfterOverhead: totals.contribution - overhead,
    period: Math.max(0, num(db.store.period)),
  };
}
