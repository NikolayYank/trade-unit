// Предложения: товар поштучно или набор. Себестоимость набора собирается из карточек товаров.
import { num } from './money';
import { calcProduct, type ProductCalc } from './product';
import type { Db, Kit, OfferRef } from './types';

export interface Offer {
  ref: OfferRef;
  kind: 'product' | 'kit';
  name: string;
  unitCost: number;                   // себестоимость одного предложения (шт. или набора)
  price: number;                      // цена клиента
  composition: Record<string, number>; // productId → штук в одном предложении
  maxFromStock: number;               // сколько можно продать из текущих остатков
  bottleneck: string | null;          // товар, который кончится первым
  missing: boolean;                   // в наборе есть удалённый товар
  singlesPrice?: number;              // только у набора: сколько стоят его товары по отдельности в рознице
  discountPct?: number | null;        // только у набора: скидка набора к этой сумме, %; отрицательная — набор дороже; null — цены не заданы
}

export type ProductCalcs = Record<string, ProductCalc>;

export function calcAllProducts(db: Db): ProductCalcs {
  return Object.fromEntries(db.products.map(p => [p.id, calcProduct(p, db.settings)]));
}

export function kitOffer(k: Kit, db: Db, pc: ProductCalcs): Offer {
  const composition: Record<string, number> = {};
  let unitCost = num(k.packCost), missing = false;
  for (const it of k.items) {
    const q = Math.max(0, num(it.qty));
    if (!pc[it.productId]) { missing = true; continue; }
    composition[it.productId] = (composition[it.productId] ?? 0) + q;
    unitCost += pc[it.productId].unitCost * q;
  }
  const singlesPrice = k.items.reduce((a, it) => a + num(db.products.find(p => p.id === it.productId)?.price) * Math.max(0, num(it.qty)), 0);
  const discountPct = singlesPrice > 0 && num(k.price) > 0 ? (1 - num(k.price) / singlesPrice) * 100 : null;
  let maxFromStock = Infinity, bottleneck: string | null = null;
  for (const [pid, q] of Object.entries(composition)) {
    if (q <= 0) continue;
    const p = db.products.find(x => x.id === pid)!;
    const can = Math.floor(pc[pid].available / q);
    if (can < maxFromStock) { maxFromStock = can; bottleneck = p.name; }
  }
  if (!isFinite(maxFromStock)) maxFromStock = 0;
  return { ref: `k:${k.id}`, kind: 'kit', name: k.name, unitCost, price: num(k.price), composition, maxFromStock, bottleneck, missing, singlesPrice, discountPct };
}

export function allOffers(db: Db, pc: ProductCalcs): Offer[] {
  const singles: Offer[] = db.products.map(p => ({
    ref: `p:${p.id}`, kind: 'product', name: p.name, unitCost: pc[p.id].unitCost, price: num(p.price),
    composition: { [p.id]: 1 }, maxFromStock: Math.floor(pc[p.id].available), bottleneck: p.name, missing: false,
  }));
  return [...singles, ...db.kits.map(k => kitOffer(k, db, pc))];
}
