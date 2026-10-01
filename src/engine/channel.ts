// Канал продаж: стоимость рекламы на оформленный заказ и экономика одного заказа.
import { clamp, num } from './money';
import type { Channel, Db } from './types';

export interface Funnel {
  cpc: number;       // цена клика
  cpa: number;       // реклама на 1 оформленный заказ
  impressionsPerOrder: number;
  clicksPerOrder: number;
}

/** Реклама на один оформленный заказ. Для воронки: CPC = CPM / (1000 × CTR), CPA = CPC / CR. */
export function channelFunnel(c: Channel): Funnel {
  if (c.adMode === 'cpa') return { cpc: 0, cpa: Math.max(0, num(c.cpa)), impressionsPerOrder: 0, clicksPerOrder: 0 };
  const ctr = num(c.ctr) / 100, cr = num(c.cr) / 100;
  if (ctr <= 0 || cr <= 0) return { cpc: 0, cpa: 0, impressionsPerOrder: 0, clicksPerOrder: 0 };
  const cpc = num(c.cpm) / (1000 * ctr);
  const clicksPerOrder = 1 / cr;
  return { cpc, cpa: cpc * clicksPerOrder, impressionsPerOrder: clicksPerOrder / ctr, clicksPerOrder };
}

/** Готовая цена канала задана процентом от оборота (например, комиссия маркетплейса), а не суммой за заказ. */
export const isPercentAd = (c: Channel): boolean => c.adMode === 'cpa' && c.cpaType === 'percent';

/**
 * Апрув канала как доля 0…1. Нет поля (старые данные) — все заказы подтверждаются.
 * У канала с процентом от оборота апрува нет: заказы в плане сразу считаются проданными (сохранённое значение не используется).
 */
export const approveShare = (c: Channel): number => isPercentAd(c) ? 1 : clamp(c.approve === undefined ? 100 : num(c.approve), 0, 100) / 100;

/** Выкуп канала как доля 0…1. Нет поля (старые данные) — все посылки забирают. У канала с процентом от оборота выкупа нет, как и апрува. */
export const buyoutShare = (c: Channel): number => isPercentAd(c) ? 1 : clamp(c.buyout === undefined ? 100 : num(c.buyout), 0, 100) / 100;

/** Налоги, нужные для оборота: плательщик НДС и ставка. */
export interface OrderCtx { vatPayer: boolean; vatRate: number }

export function orderCtx(db: Db): OrderCtx {
  const t = db.settings.tax;
  return { vatPayer: t.vatPayer, vatRate: num(t.vatRate) };
}

export interface FunnelPer1000 {
  impressions: number; clicks: number; orders: number; approved: number; sold: number; // сколько штук на каждом шаге
  costPerSold: number | null;      // реклама на один проданный заказ; null — ни один заказ не дойдёт до покупки
}

/**
 * Что получается из 1000 показов: клики (CTR), оформленные заказы (конверсия сайта), подтверждённые (апрув),
 * забранные (выкуп). Для канала с известной ценой заказа (adMode = cpa) показы и клики не считаются.
 */
export function funnelPer1000(c: Channel): FunnelPer1000 {
  const clicks = 1000 * num(c.ctr) / 100;
  const orders = clicks * num(c.cr) / 100;
  const approved = orders * approveShare(c);
  const sold = approved * buyoutShare(c);
  const cpa = channelFunnel(c).cpa;
  const conv = approveShare(c) * buyoutShare(c); // доля оформленных заказов, которые дойдут до покупки
  return { impressions: 1000, clicks, orders, approved, sold, costPerSold: conv > 0 ? cpa / conv : null };
}

export interface FunnelStage {
  key: 'impressions' | 'clicks' | 'orders' | 'approved' | 'sold';
  /** Сколько штук этого шага нужно, чтобы получить заданное число проданных заказов (у самого проданного заказа это и есть заданное число). null — до покупки ничего не доходит. */
  count: number | null;
  /** Сколько рекламы ушло на одну такую штуку (один показ, клик, заказ, подтверждение); у проданного заказа это итоговая цена заказа. null — до шага ничего не дошло. */
  cost: number | null;
}

/**
 * Воронка по шагам, пересчитанная на `sold` проданных заказов (по умолчанию на один). У каждого шага: сколько штук нужно
 * и сколько рекламы стоит одна такая штука (цена одной штуки от `sold` не зависит). Количество × цена любого шага даёт
 * одну и ту же итоговую сумму рекламы на все `sold` заказов.
 * «По воронке рекламы»: шаги — показы, клики, заказы, подтверждённые, проданный. «По готовой цене»: показов и кликов нет,
 * шаги — заказы, подтверждённые, проданный.
 */
export function funnelView(c: Channel, sold = 1): { stages: FunnelStage[]; total: number | null } {
  const a = approveShare(c), b = buyoutShare(c);
  let budget: number, base: [FunnelStage['key'], number][];
  if (c.adMode === 'funnel') {
    // считаем от 1000 показов: реклама на них = CPM
    const f = funnelPer1000(c);
    budget = num(c.cpm);
    base = [['impressions', f.impressions], ['clicks', f.clicks], ['orders', f.orders], ['approved', f.approved], ['sold', f.sold]];
  } else {
    // считаем от 100 оформленных заказов: реклама на них = 100 × CPA
    budget = 100 * Math.max(0, num(c.cpa));
    base = [['orders', 100], ['approved', 100 * a], ['sold', 100 * a * b]];
  }
  const want = Math.max(0, num(sold));
  const soldBase = base[base.length - 1][1];
  return {
    stages: base.map(([key, n]) => ({
      key,
      count: soldBase > 0 ? (key === 'sold' ? want : (n / soldBase) * want) : null,
      cost: n > 0 ? budget / n : null,
    })),
    total: soldBase > 0 ? (budget / soldBase) * want : null, // реклама на все `want` проданных заказов
  };
}

export interface OrderEconomics {
  placed: number;    // оформлено заказов
  delivered: number; // продано (клиент забрал)
  gross: number;     // деньги клиентов с НДС
  revenue: number;   // выручка без НДС (для плательщика) или = gross
  cogs: number;      // себестоимость проданного товара
  ads: number;
  contribution: number; // оборот минус товар и реклама, до накладных расходов и налогов
}

/**
 * Экономика `placed` оформленных заказов одного предложения в одном канале.
 * Реклама платится за каждый оформленный заказ. Продаётся только подтверждённая (апрув) и забранная (выкуп) часть.
 * Доставка, упаковка, возвраты и комиссии здесь не считаются: они вписываются накладными расходами магазина.
 */
export function orderEconomics(
  placed: number, price: number, unitCost: number, c: Channel, ctx: OrderCtx,
): OrderEconomics {
  const delivered = placed * approveShare(c) * buyoutShare(c);
  const gross = delivered * price;
  const revenue = ctx.vatPayer ? gross / (1 + ctx.vatRate / 100) : gross;
  const cogs = delivered * unitCost;
  // процент берётся от суммы, которую заплатили клиенты за забранные заказы; сумма за заказ платится за каждый оформленный
  const ads = isPercentAd(c) ? gross * num(c.cpaPercent) / 100 : placed * channelFunnel(c).cpa;
  return { placed, delivered, gross, revenue, cogs, ads, contribution: revenue - cogs - ads };
}
