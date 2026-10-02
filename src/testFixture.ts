// Данные для тестов расчётов (не для пользователя): небольшая учётная запись в евро с цифрами, на которые опираются проверки.
// Образец для пользователя лежит в src/samples/test-sample.json.
import { emptyStages, newChannel, newProduct } from './factories';
import { taxFromPreset, uid } from './engine/taxPresets';
import type { Channel, Currency, Db, Expense, ExpenseBasis, Product } from './engine/types';

const ex = (name: string, basis: ExpenseBasis, value: number, currency: Currency = 'EUR'): Expense =>
  ({ id: uid(), name, basis, value, currency });

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

  const fb: Channel = { ...newChannel(), name: 'Facebook / Instagram', adMode: 'funnel', cpm: 3.5, ctr: 2, cr: 3, approve: 85, buyout: 88 };
  const google: Channel = { ...newChannel(), name: 'Google Ads', adMode: 'cpa', cpa: 7, approve: 90, buyout: 95 };
  const market: Channel = { ...newChannel(), name: 'Маркетплейс', adMode: 'cpa', cpaType: 'percent', cpaPercent: 12, approve: 100, buyout: 100 };
  const b2b: Channel = { ...newChannel(), name: 'B2B / опт', adMode: 'cpa', cpa: 0, approve: 100, buyout: 100 };

  return {
    version: 1,
    settings: {
      baseCurrency: 'EUR',
      fx: { USD: 1, EUR: 0.86, CNY: 7.15, UAH: 41.5, UZS: 12100 },
      fxUpdated: 'пример, обновите перед расчётом',
      cpmInUsd: true,
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
