// Демо-данные: стартовая база при первом открытии и по кнопке «Загрузить демо».
import { taxFromPreset, uid, emptyTax } from './engine/taxPresets';
import type { Channel, Db, Expense, ExpenseBasis, Product, StageKey, Currency } from './engine/types';

const ex = (name: string, basis: ExpenseBasis, value: number, currency: Currency = 'EUR'): Expense =>
  ({ id: uid(), name, basis, value, currency });

const emptyStages = (): Record<StageKey, Expense[]> => ({ purchase: [], local: [], intl: [], import: [], pack: [] });

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
      tax: emptyTax(),
    },
    products: [], kits: [], channels: [],
    store: { sales: 0, period: 30, items: [], overhead: [] },
    lastBackup: null,
  };
}

export function demoDb(): Db {
  const towel: Product = {
    ...newProduct('Автомобильное полотенце'), sku: 'TOWEL-6090', batchQty: 1000, unitCost: 3.2, unitCostCurrency: 'CNY',
    defectRate: 2, unitWeight: 0.21, unitVolume: 0.0012, unitsPerCarton: 100, cartonWeight: 22, volCoef: 167, stock: 200, price: 10, wholesalePrice: 5.5,
    expenses: {
      purchase: [ex('Комиссия за выкуп', 'pct_purchase', 7), ex('Инспекция партии', 'fixed', 120, 'USD')],
      local: [ex('Доставка по Китаю', 'per_kg', 0.5, 'USD'), ex('Консолидация', 'fixed', 35, 'USD')],
      intl: [ex('Китай → Болгария', 'per_kg', 3.2, 'USD'), ex('Страхование', 'pct_stage', 1)],
      import: [ex('Пошлина', 'pct_stage', 5), ex('Таможенный брокер', 'fixed', 100), ex('Импортный НДС', 'vat', 20)],
      pack: [ex('Индивидуальный пакет', 'per_unit', 0.2), ex('Наклейка', 'per_unit', 0.05)],
    },
  };
  const spray: Product = {
    ...newProduct('Спрей-полироль 500 мл'), sku: 'SPRAY-500', batchQty: 500, unitCost: 6.5, unitCostCurrency: 'CNY',
    defectRate: 1, unitWeight: 0.55, unitVolume: 0.0009, unitsPerCarton: 24, cartonWeight: 14, volCoef: 167, stock: 0, price: 9, wholesalePrice: 6.5,
    expenses: {
      purchase: [ex('Комиссия за выкуп', 'pct_purchase', 7)],
      local: [ex('Доставка по Китаю', 'per_kg', 0.5, 'USD')],
      intl: [ex('Китай → Болгария', 'per_kg', 3.2, 'USD')],
      import: [ex('Пошлина', 'pct_stage', 6.5), ex('Таможенный брокер', 'fixed', 100), ex('Импортный НДС', 'vat', 20)],
      pack: [ex('Этикетка', 'per_unit', 0.05)],
    },
  };
  const scent: Product = {
    ...newProduct('Ароматизатор (своё производство)'), sku: 'SCENT-01', origin: 'local', batchQty: 300, unitCost: 0.6, unitCostCurrency: 'EUR',
    defectRate: 3, unitWeight: 0.05, unitVolume: 0.0002, stock: 50, price: 7, wholesalePrice: 4,
    expenses: { ...emptyStages(), purchase: [ex('Работа', 'per_unit', 0.3), ex('Формы и оснастка', 'fixed', 40)], pack: [ex('Коробочка', 'per_unit', 0.15)] },
  };
  const products = [towel, spray, scent];

  const kitWash = { id: uid(), name: 'Набор для мойки: 2 полотенца + спрей', items: [{ productId: towel.id, qty: 2 }, { productId: spray.id, qty: 1 }], packCost: 0.6, price: 26 };
  const kitGift = { id: uid(), name: 'Подарочный: полотенце + спрей + аромат', items: [{ productId: towel.id, qty: 1 }, { productId: spray.id, qty: 1 }, { productId: scent.id, qty: 1 }], packCost: 1.5, price: 29 };
  const kitB2b = { id: uid(), name: 'Опт: 10 полотенец', items: [{ productId: towel.id, qty: 10 }], packCost: 0, price: 55 };

  const fb: Channel = { ...newChannel(), name: 'Facebook / Instagram', adMode: 'funnel', cpm: 3, ctr: 2, cr: 3, approve: 85, buyout: 88 };
  const google: Channel = { ...newChannel(), name: 'Google Ads', adMode: 'cpa', cpa: 7, approve: 90, buyout: 95 };
  const market: Channel = { ...newChannel(), name: 'Маркетплейс', adMode: 'cpa', cpaType: 'percent', cpaPercent: 12, approve: 100, buyout: 100 };
  const b2b: Channel = { ...newChannel(), name: 'B2B / опт', adMode: 'cpa', cpa: 0, approve: 100, buyout: 100 };

  return {
    version: 1,
    settings: {
      baseCurrency: 'EUR',
      fx: { USD: 1, EUR: 0.86, CNY: 7.15, UAH: 41.5, UZS: 12100 },
      fxUpdated: 'пример, обновите перед расчётом',
      tax: taxFromPreset('bg_eood'),
    },
    products,
    kits: [kitWash, kitGift, kitB2b],
    channels: [fb, google, market, b2b],
    store: {
      sales: 200,
      period: 30,
      items: [
        { id: uid(), offer: `k:${kitWash.id}`, share: 40, channels: [{ channelId: fb.id, share: 60 }, { channelId: market.id, share: 40 }] },
        { id: uid(), offer: `p:${towel.id}`, share: 20, channels: [{ channelId: fb.id, share: 100 }] },
        { id: uid(), offer: `k:${kitGift.id}`, share: 30, channels: [{ channelId: google.id, share: 100 }] },
        { id: uid(), offer: `k:${kitB2b.id}`, share: 10, channels: [{ channelId: b2b.id, share: 100 }] },
      ],
      overhead: [
        { id: uid(), name: 'Склад', kind: 'fixed', amount: 200, currency: 'EUR' },
        { id: uid(), name: 'Курьер', kind: 'perUnit', amount: 4, currency: 'EUR' },
        { id: uid(), name: 'Упаковка посылки', kind: 'perUnit', amount: 0.4, currency: 'EUR' },
        { id: uid(), name: 'Комплектовщик (полставки)', kind: 'fixed', amount: 400, currency: 'EUR' },
        { id: uid(), name: 'Сайт и сервисы', kind: 'fixed', amount: 60, currency: 'EUR' },
        { id: uid(), name: 'Бухгалтер', kind: 'fixed', amount: 80, currency: 'EUR' },
        { id: uid(), name: 'Эквайринг и платёжные сервисы', kind: 'percent', amount: 0, currency: 'EUR', percent: 1 },
      ],
    },
    lastBackup: null,
  };
}
