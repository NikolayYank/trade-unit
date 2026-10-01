// Базовые налоговые режимы BG / UA / UZ. Цифры 2026 года и источники — TAXES.md.
import type { Currency, TaxBase, TaxConfig } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10);

type L = [name: string, base: TaxBase, rateOrAmount: number, currency?: Currency];

interface Preset {
  id: string;
  country: 'Болгария' | 'Украина' | 'Узбекистан';
  name: string;
  hint: string;
  vatPayer: boolean;
  vatRate: number;
  lines: L[];
}

// Украина: МЗП на 01.01.2026 = 8 647 грн
const UA_ESV: L = ['ЕСВ (соцвзнос)', 'fixed', 1902.34, 'UAH'];

export const TAX_PRESETS: Preset[] = [
  {
    id: 'bg_eood', country: 'Болгария', name: 'ЕООД без ДДС',
    hint: 'Налог 10% с прибыли и 5%, когда забираете прибыль себе. НДС на ввоз товара не возвращается и входит в его цену.',
    vatPayer: false, vatRate: 20,
    lines: [['Налог на прибыль', 'profit', 10], ['Налог на дивиденды', 'dividend', 5]],
  },
  {
    id: 'bg_eood_vat', country: 'Болгария', name: 'ЕООД с ДДС 20%',
    hint: 'Из каждой продажи 20% уходит государству как НДС, зато НДС на ввоз товара возвращается. Налог 10% с прибыли и 5%, когда забираете прибыль себе.',
    vatPayer: true, vatRate: 20,
    lines: [['Налог на прибыль', 'profit', 10], ['Налог на дивиденды', 'dividend', 5]],
  },
  {
    id: 'ua_fop2', country: 'Украина', name: 'ФОП 2 группа',
    hint: 'Три платежа фиксированной суммой каждый месяц, сколько бы вы ни продали. Продавать можно только обычным людям и другим ФОП на едином налоге.',
    vatPayer: false, vatRate: 20,
    lines: [['Единый налог', 'fixed', 1729.40, 'UAH'], ['Военный сбор', 'fixed', 864.70, 'UAH'], UA_ESV],
  },
  {
    id: 'ua_fop3', country: 'Украина', name: 'ФОП 3 группа 5%',
    hint: '6% с выручки (5% единый налог и 1% военный сбор) плюс ЕСВ фиксированной суммой.',
    vatPayer: false, vatRate: 20,
    lines: [['Единый налог', 'revenue', 5], ['Военный сбор', 'revenue', 1], UA_ESV],
  },
  {
    id: 'ua_fop3_vat', country: 'Украина', name: 'ФОП 3 группа 3% + ПДВ',
    hint: 'Из каждой продажи 20% уходит государству как ПДВ. С остального 4% (3% единый налог и 1% военный сбор) плюс ЕСВ фиксированной суммой.',
    vatPayer: true, vatRate: 20,
    lines: [['Единый налог', 'revenue', 3], ['Военный сбор', 'revenue', 1], UA_ESV],
  },
  {
    id: 'uz_ip', country: 'Узбекистан', name: 'ИП, налог с оборота 1%',
    hint: '1% с выручки. Ставка действует, пока выручка за год не больше лимита; источники называют разный, уточните у бухгалтера.',
    vatPayer: false, vatRate: 12,
    lines: [['Налог с оборота', 'revenue', 1]],
  },
  {
    id: 'uz_llc_turnover', country: 'Узбекистан', name: 'ООО, налог с оборота 4%',
    hint: '4% с выручки и 5%, когда забираете прибыль себе. Работает, пока выручка за год не больше 12 000 БРВ.',
    vatPayer: false, vatRate: 12,
    lines: [['Налог с оборота', 'revenue', 4], ['Налог на дивиденды', 'dividend', 5]],
  },
  {
    id: 'uz_general', country: 'Узбекистан', name: 'С НДС 12% и налогом на прибыль 15%',
    hint: 'Из каждой продажи 12% уходит государству как НДС. Налог 15% с прибыли и 5%, когда забираете прибыль себе.',
    vatPayer: true, vatRate: 12,
    lines: [['Налог на прибыль', 'profit', 15], ['Налог на дивиденды', 'dividend', 5]],
  },
];

/** «Свой режим» с нуля: ни налогов, ни НДС. Всё добавляется вручную. */
export const emptyTax = (): TaxConfig => ({ presetId: 'custom', vatPayer: false, vatRate: 0, lines: [] });

export function taxFromPreset(id: string): TaxConfig {
  const p = TAX_PRESETS.find(x => x.id === id) ?? TAX_PRESETS[0];
  return {
    presetId: p.id, vatPayer: p.vatPayer, vatRate: p.vatRate,
    lines: p.lines.map(([name, base, v, currency]) => ({
      id: uid(), name, base,
      rate: base === 'fixed' ? 0 : v,
      amount: base === 'fixed' ? v : 0,
      currency: currency ?? 'EUR',
    })),
  };
}
