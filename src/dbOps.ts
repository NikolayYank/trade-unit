// Операции над базой, которые затрагивают несколько разделов сразу.
import { toBase } from './engine/money';
import { uid } from './engine/taxPresets';
import type { Currency, Db, Product } from './engine/types';

/**
 * Смена основной валюты. Суммы, которые хранятся в основной валюте (цены, CPA, доставка,
 * упаковка набора и отправки), пересчитываются по курсу — экономика не меняется.
 */
export function switchBaseCurrency(db: Db, to: Currency) {
  const k = toBase(1, db.settings.baseCurrency, { ...db.settings, baseCurrency: to });
  const r = (v: number) => Math.round(v * k * 100) / 100;
  db.products.forEach(p => { p.price = r(p.price); });
  db.kits.forEach(kit => { kit.price = r(kit.price); kit.packCost = r(kit.packCost); });
  db.channels.forEach(c => {
    c.cpa = r(c.cpa);   // CPM в долларах, от основной валюты не зависит
  });
  const sc = db.scenario;
  if (sc) {
    Object.values(sc.channels ?? {}).forEach(c => {
      if (c.cpa !== undefined) c.cpa = r(c.cpa);
    });
    Object.values(sc.offers ?? {}).forEach(o => {
      if (o.price !== undefined) o.price = r(o.price);
      if (o.unitCost !== undefined) o.unitCost = r(o.unitCost);
    });
  }
  db.settings.baseCurrency = to;
}

export function duplicateProduct(p: Product): Product {
  const c: Product = structuredClone(p);
  c.id = uid();
  c.name = p.name + ' (копия)';
  for (const list of Object.values(c.expenses)) list.forEach(e => { e.id = uid(); });
  return c;
}

/** Что сломается при удалении товара: наборы и позиции плана, где он участвует. */
export function productUsage(db: Db, id: string) {
  return {
    kits: db.kits.filter(k => k.items.some(i => i.productId === id)),
    planItems: db.store.items.filter(i => i.offer === `p:${id}`),
  };
}

export function deleteProduct(db: Db, id: string) {
  db.products = db.products.filter(p => p.id !== id);
  db.kits.forEach(k => { k.items = k.items.filter(i => i.productId !== id); });
  db.store.items = db.store.items.filter(i => i.offer !== `p:${id}`);
}

export function deleteKit(db: Db, id: string) {
  db.kits = db.kits.filter(k => k.id !== id);
  db.store.items = db.store.items.filter(i => i.offer !== `k:${id}`);
}

export function deleteChannel(db: Db, id: string) {
  db.channels = db.channels.filter(c => c.id !== id);
  db.store.items.forEach(i => { i.channels = i.channels.filter(c => c.channelId !== id); });
}

/** Валюты, которые используются в расчётах, но курс для них не задан (0). */
export function missingRates(db: Db): Currency[] {
  const used = new Set<Currency>([db.settings.baseCurrency]);
  db.products.forEach(p => {
    used.add(p.unitCostCurrency);
    Object.values(p.expenses).flat().forEach(e => { if (!['pct_purchase', 'pct_stage', 'vat'].includes(e.basis)) used.add(e.currency); });
  });
  db.store.overhead.forEach(o => used.add(o.currency));
  db.settings.tax.lines.forEach(l => { if (l.base === 'fixed') used.add(l.currency); });
  return [...used].filter(c => c !== 'USD' && !(db.settings.fx[c] > 0));
}
