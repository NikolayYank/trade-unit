// Себестоимость партии товара: от завода до упакованной штуки на складе.
import { clamp, num, toBase } from './money';
import { STAGES, type Expense, type Product, type Settings, type StageKey } from './types';

export const STAGE_LABELS: Record<StageKey, string> = {
  purchase: 'Доп. расходы на закупку',
  local: 'Доставка по Китаю',
  intl: 'Доставка по стране',
  import: 'Таможня',
  pack: 'Упаковка товара',
};

/** Этапы, которые участвуют в расчёте для происхождения товара. */
export const activeStages = (p: Product): StageKey[] =>
  p.origin === 'local' ? ['purchase', 'pack'] : [...STAGES];

export const PERCENT_BASES = new Set(['pct_purchase', 'pct_stage', 'vat']);

export interface ExpenseResult { amount: number; inCost: boolean }

export interface ProductCalc {
  qty: number;
  sellable: number;
  defectQty: number;
  cartons: number;
  grossWeight: number;
  volume: number;
  chargeWeight: number;
  unitPurchase: number;  // заводская цена 1 шт. в основной валюте
  purchaseBase: number;  // заводская стоимость партии
  stages: { key: StageKey; added: number; total: number }[];
  expenses: Record<string, ExpenseResult>; // по id расхода
  batchCost: number;     // вся себестоимость партии
  unitCost: number;      // себестоимость 1 годной шт.
  importVat: number;     // импортный НДС (сумма, независимо от того, в себестоимости ли он)
  cashNeeded: number;    // деньги до первой продажи: себестоимость + НДС к возмещению
  available: number;     // будет в наличии: уже на складе + новая партия без брака
}

export function calcProduct(p: Product, s: Settings): ProductCalc {
  const vatPayer = s.tax.vatPayer;
  const qty = Math.max(0, num(p.batchQty));
  const defect = clamp(num(p.defectRate), 0, 100);
  const sellable = qty * (1 - defect / 100);
  const cartons = p.unitsPerCarton > 0 ? Math.ceil(qty / p.unitsPerCarton) : 0;
  const grossWeight = cartons && p.cartonWeight > 0 ? cartons * p.cartonWeight : qty * num(p.unitWeight);
  const volume = qty * num(p.unitVolume);
  const chargeWeight = Math.max(grossWeight, volume * Math.max(0, num(p.volCoef)));

  const unitPurchase = toBase(num(p.unitCost), p.unitCostCurrency, s);
  const purchaseBase = qty * unitPurchase;

  const expenses: Record<string, ExpenseResult> = {};
  const stages: ProductCalc['stages'] = [];
  let running = purchaseBase;
  let importVat = 0;

  for (const key of activeStages(p)) {
    const base = running;
    let added = 0;
    const amountOf = (e: Expense): number => {
      const v = num(e.value);
      const money = (x: number) => toBase(x, e.currency, s);
      switch (e.basis) {
        case 'fixed': return money(v);
        case 'per_unit': return money(v) * (key === 'pack' ? sellable : qty);
        case 'per_kg': return money(v) * chargeWeight;
        case 'per_cbm': return money(v) * volume;
        case 'pct_purchase': return purchaseBase * v / 100;
        case 'pct_stage': return base * v / 100;
        default: return 0;
      }
    };
    // сначала всё, кроме НДС; НДС — от суммы этапа плюс пошлины и сборы
    for (const e of p.expenses[key]) {
      if (e.basis === 'vat') continue;
      const amount = amountOf(e);
      expenses[e.id] = { amount, inCost: true };
      added += amount;
    }
    for (const e of p.expenses[key]) {
      if (e.basis !== 'vat') continue;
      const amount = (base + added) * num(e.value) / 100;
      importVat += amount;
      expenses[e.id] = { amount, inCost: !vatPayer };
      if (!vatPayer) added += amount;
    }
    running += added;
    stages.push({ key, added, total: running });
  }

  return {
    qty, sellable, defectQty: qty - sellable, cartons, grossWeight, volume, chargeWeight,
    unitPurchase, purchaseBase, stages, expenses,
    batchCost: running,
    unitCost: sellable > 0 ? running / sellable : 0,
    importVat,
    cashNeeded: running + (vatPayer ? importVat : 0),
    available: Math.max(0, num(p.stock)) + sellable,
  };
}

/** Один расход внутри области: что он добавляет к цене и чему равен нарастающий итог после него. */
export interface BreakdownItem {
  expense: Expense;
  inCost: boolean;        // false — НДС на ввоз, который вернут: в цену не входит
  amount: number;         // сумма расхода на всю партию, даже если она не входит в цену
  added: number;          // сколько денег расход добавляет к цене партии (0, если не входит)
  addedPerUnit: number;
  share: number;          // доля в итоговой себестоимости, %
  total: number;          // сколько денег набежало на всю партию после этого расхода (с учётом всех областей до него)
}

export interface BreakdownRow {
  key: 'supplier' | StageKey;
  added: number;         // сколько денег эта область добавляет на всю партию
  total: number;         // сколько денег набежало на всю партию после этой области
  addedPerUnit: number;  // сколько эта область добавляет к цене одной годной штуки
  totalPerUnit: number;  // цена одной штуки после этой области
  share: number;         // доля области в итоговой себестоимости, %
  items: BreakdownItem[]; // расходы внутри области в том порядке, как они записаны в карточке
}

/**
 * Разбивка себестоимости по областям: цена поставщика и каждый шаг расходов, а внутри каждого шага
 * отдельные расходы. Для каждой строки: сколько добавляет к одной штуке и на партию, какая доля итога,
 * сколько набежало после неё. Доли областей дают 100%, суммы областей дают всю партию, а сумма расходов
 * внутри области равна самой области.
 */
export function costBreakdown(p: Product, c: ProductCalc): BreakdownRow[] {
  const per = (v: number) => (c.sellable > 0 ? v / c.sellable : 0);
  const share = (v: number) => (c.batchCost > 0 ? (v / c.batchCost) * 100 : 0);
  const rows: { key: BreakdownRow['key']; added: number; total: number }[] = [
    { key: 'supplier', added: c.purchaseBase, total: c.purchaseBase },
    ...c.stages,
  ];
  return rows.map(r => {
    let running = r.total - r.added;
    const list = r.key === 'supplier' ? [] : p.expenses[r.key];
    const items: BreakdownItem[] = list.map(expense => {
      const res = c.expenses[expense.id];
      const amount = res?.amount ?? 0;
      const inCost = res ? res.inCost : true;
      const added = inCost ? amount : 0;
      running += added;
      return { expense, inCost, amount, added, addedPerUnit: per(added), share: share(added), total: running };
    });
    return { key: r.key, added: r.added, total: r.total, addedPerUnit: per(r.added), totalPerUnit: per(r.total), share: share(r.added), items };
  });
}

export interface PriceMetrics {
  net: number;               // цена без НДС (если вы с НДС), иначе сама цена
  margin: number;            // сколько остаётся с одной штуки после оплаты самого товара
  marginPct: number;         // маржа в % от цены продажи
  markupPct: number | null;  // наценка в % от того, во сколько обходится штука; null, если себестоимость ноль
}

/**
 * Маржа и наценка для одной цены продажи. Маржа считается от цены продажи, наценка от себестоимости:
 * обходится 100, продаём за 150 → маржа 33%, наценка 50%. null, если цена не задана.
 */
export function priceMetrics(price: number, unitCost: number, vatPayer: boolean, vatRate: number): PriceMetrics | null {
  const p = num(price);
  if (!(p > 0)) return null;
  const net = vatPayer ? p / (1 + num(vatRate) / 100) : p;
  const margin = net - unitCost;
  return {
    net, margin,
    marginPct: net > 0 ? (margin / net) * 100 : 0,
    markupPct: unitCost > 0 ? (margin / unitCost) * 100 : null,
  };
}
