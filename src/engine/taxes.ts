// Налоги выбранного режима. Считает по готовым итогам месяца; в экран магазина пока не подключён.
import { num, toBase } from './money';
import type { Db, TaxLine } from './types';

export interface TaxResult { line: TaxLine; amount: number }

/**
 * Налоги считаются в таком порядке (порядок важен):
 * 1. «% с выручки» (от выручки за вычетом возвратов) и «сумма в месяц»;
 * 2. «% с прибыли» от прибыли до налогов минус налоги пункта 1, только если результат положительный;
 * 3. «% когда забираете прибыль» от остатка после пунктов 1 и 2, только если он положительный.
 * Убыток налогом на прибыль и дивидендом не облагается.
 */
export function calcTaxes(db: Db, base: { revenue: number; refunds: number; profitBeforeTax: number }): { taxes: TaxResult[]; total: number } {
  const s = db.settings, lines = s.tax.lines;
  const taxes: TaxResult[] = [];
  let total = 0;
  const add = (line: TaxLine, amount: number) => { taxes.push({ line, amount }); total += amount; };
  for (const l of lines) {
    if (l.base === 'revenue') add(l, Math.max(0, base.revenue - base.refunds) * num(l.rate) / 100);
    if (l.base === 'fixed') add(l, toBase(num(l.amount), l.currency, s));
  }
  const afterSimple = base.profitBeforeTax - total;
  for (const l of lines) if (l.base === 'profit') add(l, Math.max(0, afterSimple) * num(l.rate) / 100);
  const beforeDividend = base.profitBeforeTax - total;
  for (const l of lines) if (l.base === 'dividend') add(l, Math.max(0, beforeDividend) * num(l.rate) / 100);
  taxes.sort((a, b) => lines.indexOf(a.line) - lines.indexOf(b.line)); // порядок строк как в настройках
  return { taxes, total };
}
