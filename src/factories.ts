// Фабрики: новый товар, новый канал, пустая учётная запись. Всё создаётся пустым: человек заполняет сам.
import { emptyTax, uid } from './engine/taxPresets';
import type { Channel, Currency, Db, Expense, Product, StageKey } from './engine/types';

export const emptyStages = (): Record<StageKey, Expense[]> => ({ purchase: [], local: [], intl: [], import: [], pack: [] });

/** Новый товар: все числа нулевые, расходов нет — человек заполняет сам. */
export function newProduct(name = 'Новый товар', currency: Currency = 'USD'): Product {
  return {
    id: uid(), name, sku: '', supplierUrl: '', origin: 'import', batchQty: 0, unitCost: 0, unitCostCurrency: currency,
    defectRate: 0, unitWeight: 0, unitVolume: 0, unitsPerCarton: 0, cartonWeight: 0, volCoef: 0,
    expenses: emptyStages(), stock: 0, price: 0, wholesalePrice: 0, notes: '',
  };
}

export function newChannel(): Channel {
  return { id: uid(), name: 'Новый канал', adMode: 'cpa', cpa: 0, cpaType: 'money', cpaPercent: 0, cpm: 0, ctr: 0, cr: 0, approve: 100, buyout: 100 };
}

/** Пустая учётная запись: без товаров, каналов, расходов, курсов и налогов. Основная валюта USD — единственная, которой не нужен курс. */
export function emptyDb(): Db {
  return {
    version: 1,
    settings: {
      baseCurrency: 'USD',
      fx: { USD: 1, EUR: 0, CNY: 0, UAH: 0, UZS: 0 },
      fxUpdated: '',
      cpmInUsd: true,
      tax: emptyTax(),
    },
    products: [], kits: [], channels: [],
    store: { sales: 0, period: 30, items: [], overhead: [] },
    lastBackup: null,
  };
}
