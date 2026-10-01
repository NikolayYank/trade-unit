import { describe, expect, it } from 'vitest';
import { demoDb } from '../demo';
import { channelFunnel, funnelView, orderCtx, orderEconomics } from './channel';
import { calcProduct } from './product';
import { calcAllProducts, kitOffer } from './offers';
import { applyScenario, calcForecast, changePct, rangeDays, rowMetrics, scenarioCount, summarize } from './analytics';
import { calcStore, forDays, margin, overheadAmount, perDay } from './store';
import { calcTaxes } from './taxes';
import { emptyTax, taxFromPreset } from './taxPresets';
import type { Db } from './types';

// Курсы исходного одностраничного калькулятора (v2), с чьими цифрами сверяются тесты: 1 USD = 0.92 EUR, 1 CNY = 0.12 EUR → CNY за USD = 0.92 / 0.12
const v2Settings = (vatPayer: boolean) => {
  const db = demoDb();
  db.settings.fx = { USD: 1, EUR: 0.92, CNY: 0.92 / 0.12, UAH: 41, UZS: 12000 };
  db.settings.tax = taxFromPreset(vatPayer ? 'bg_eood_vat' : 'bg_eood');
  return db;
};

const CTX = { vatPayer: false, vatRate: 20, usdToBase: 1 };   // доллар = основная валюте, CPM переводить не надо

describe('себестоимость товара', () => {
  it('совпадает с эталонными цифрами исходного калькулятора (v2) на демо-полотенце (плательщик НДС)', () => {
    const db = v2Settings(true);
    const c = calcProduct(db.products[0], db.settings);
    const stage = (k: string) => c.stages.find(s => s.key === k)!.total;
    // v2: «Стоимость с доставкой до границы» €1 309, «Полная импортная себестоимость» €1 474, импортный НДС €295
    expect(Math.round(stage('intl'))).toBe(1309);
    expect(Math.round(stage('import'))).toBe(1474);
    expect(Math.round(c.importVat)).toBe(295);
    expect(c.chargeWeight).toBe(220); // 10 коробок × 22 кг
  });

  it('без НДС импортный НДС входит в себестоимость', () => {
    const db = v2Settings(false);
    const c = calcProduct(db.products[0], db.settings);
    expect(Math.round(c.stages.find(s => s.key === 'import')!.total)).toBe(1474 + 295);
  });

  it('своё производство игнорирует фрахт и таможню', () => {
    const db = demoDb();
    const p = { ...db.products[2] };
    p.expenses = { ...p.expenses, intl: [{ id: 'x', name: 'фрахт', basis: 'fixed', value: 1000, currency: 'EUR' }] };
    const c = calcProduct(p, db.settings);
    // 300 × 0.6 + 300 × 0.3 + 40 + 291 годных × 0.15
    expect(c.batchCost).toBeCloseTo(300 * 0.6 + 300 * 0.3 + 40 + 291 * 0.15, 6);
  });
});

describe('канал', () => {
  it('воронка: CPM 3, CTR 2%, CR 3% → CPC 0.15, CPA 5', () => {
    const f = channelFunnel({ ...demoDb().channels[0], cpm: 3 }, 1);
    expect(f.cpc).toBeCloseTo(0.15, 9);
    expect(f.cpa).toBeCloseTo(5, 9);
  });

  it('CPM всегда в долларах: воронка пересчитывает его в основную валюту по курсу', () => {
    const ch = { ...demoDb().channels[0], cpm: 3 };
    const f = channelFunnel(ch, 0.86);                                  // 1 USD = 0,86 EUR
    expect(f.cpc).toBeCloseTo(0.15 * 0.86, 9);
    expect(f.cpa).toBeCloseTo(5 * 0.86, 9);
    const v = funnelView(ch, 0.86, 1);                                  // цена показа в основной валюте
    expect(v.stages[0].cost).toBeCloseTo(3 * 0.86 / 1000, 12);
    const db = demoDb();                                                // база в евро, курс 0,86
    const e = orderEconomics(100, 20, 5, { ...ch, approve: 100, buyout: 100 }, orderCtx(db));
    expect(e.ads).toBeCloseTo(100 * 5 * 0.86, 6);
  });

  it('смена основной валюты не меняет CPM и не меняет результат', async () => {
    const { switchBaseCurrency } = await import('../dbOps');
    const db = demoDb();
    const cpm = db.channels[0].cpm, before = calcStore(db).profitAfterOverhead / 0.86;   // в долларах
    switchBaseCurrency(db, 'USD');
    expect(db.channels[0].cpm).toBe(cpm);
    expect(calcStore(db).profitAfterOverhead).toBeCloseTo(before, 0);      // допуск: при смене валюты суммы округляются до копеек
  });

  it('старые данные: CPM был в основной валюте, переводится в доллары один раз', async () => {
    const { normalizeDb } = await import('../storage');
    const db = demoDb();
    delete db.settings.cpmInUsd;
    db.channels[0].cpm = 3;                                             // было 3 евро
    db.scenario = { channels: { [db.channels[0].id]: { cpm: 4.3 } } };  // 4,3 евро в прогнозе
    normalizeDb(db);
    expect(db.channels[0].cpm).toBeCloseTo(3 / 0.86, 2);                // 3,49 доллара
    expect(db.scenario.channels![db.channels[0].id].cpm).toBeCloseTo(5, 2);
    expect(db.settings.cpmInUsd).toBe(true);
    const once = JSON.stringify(db);
    normalizeDb(db);
    expect(JSON.stringify(db)).toBe(once);                              // повторный вызов ничего не меняет
  });

  it('невыкуп: товар и деньги только за выкупленные заказы', () => {
    const ch = { ...demoDb().channels[0], adMode: 'cpa' as const, cpa: 0, approve: 100, buyout: 90 };
    const e = orderEconomics(100, 20, 5, ch, CTX);
    expect(e.delivered).toBeCloseTo(90);
    expect(e.contribution).toBeCloseTo(90 * 20 - 90 * 5);
  });
});

describe('наборы', () => {
  it('себестоимость набора = сумма товаров + упаковка, лимит по остаткам', () => {
    const db = demoDb();
    const pc = calcAllProducts(db);
    const k = kitOffer(db.kits[0], db, pc); // 2 полотенца + спрей
    expect(k.unitCost).toBeCloseTo(pc[db.products[0].id].unitCost * 2 + pc[db.products[1].id].unitCost + 0.6, 9);
    // в наличии = уже на складе + новая партия без брака
    const towel = db.products[0].stock + pc[db.products[0].id].sellable;
    const spray = db.products[1].stock + pc[db.products[1].id].sellable;
    expect(pc[db.products[0].id].available).toBeCloseTo(towel, 9);
    expect(k.maxFromStock).toBe(Math.floor(Math.min(towel / 2, spray)));
    expect(k.bottleneck).toBe(towel / 2 < spray ? db.products[0].name : db.products[1].name);
  });
});

describe('свой налоговый режим', () => {
  it('начинается с нуля: ни налогов, ни НДС, ничего от прежнего режима', () => {
    const preset = taxFromPreset('ua_fop3');
    expect(preset.lines.length).toBeGreaterThan(0);
    const mine = emptyTax();
    expect(mine).toEqual({ presetId: 'custom', vatPayer: false, vatRate: 0, lines: [] });
    expect(emptyTax()).not.toBe(mine);                                  // каждый раз новый объект
    expect(calcStore({ ...storeDb(), settings: { ...demoDb().settings, tax: mine } }).taxes).toBe(0);
  });
});

describe('налоги', () => {
  const withPreset = (id: string): Db => { const db = demoDb(); db.settings.tax = taxFromPreset(id); return db; };

  it('ФОП 3 группа: 6% с выручки + ЕСВ фиксированно', () => {
    const r = calcTaxes(withPreset('ua_fop3'), { revenue: 10000, profitBeforeTax: 3000 });
    const esv = 1902.34 / 41.5 * 0.86;
    expect(r.total).toBeCloseTo(10000 * 0.06 + esv, 6);
  });

  it('ЕООД: 10% с прибыли, затем 5% дивиденд с остатка', () => {
    const r = calcTaxes(withPreset('bg_eood'), { revenue: 10000, profitBeforeTax: 2000 });
    expect(r.taxes.map(x => x.amount)).toEqual([200, 90]);        // 10% от 2000, затем 5% от 1800
    expect(2000 - r.total).toBeCloseTo(2000 * 0.9 * 0.95, 9);
  });

  it('убыток не облагается налогом на прибыль и дивидендом', () => {
    const r = calcTaxes(withPreset('bg_eood'), { revenue: 10000, profitBeforeTax: -500 });
    expect(r.total).toBe(0);
  });

  it('с НДС выручка = цена клиента / 1.2', () => {
    const ch = { ...demoDb().channels[0], adMode: 'cpa' as const, cpa: 0, approve: 100, buyout: 100 };
    const e = orderEconomics(10, 12, 1, ch, { ...CTX, vatPayer: true, vatRate: 20 });
    expect(e.revenue).toBeCloseTo(e.gross / 1.2, 9);
  });
});

describe('данные', () => {
  it('смена основной валюты не меняет экономику', async () => {
    const { switchBaseCurrency } = await import('../dbOps');
    const db = demoDb();
    const eur = calcStore(db).profitAfterOverhead;
    switchBaseCurrency(db, 'UAH');
    const uahInEur = calcStore(db).profitAfterOverhead / 41.5 * 0.86;
    expect(Math.abs(uahInEur - eur) / Math.abs(eur)).toBeLessThan(0.01); // расхождение — только округление цен до копеек
  });

  it('экспорт → импорт возвращает ту же базу', async () => {
    const { parseDb } = await import('../storage');
    const db = demoDb();
    const back = parseDb(JSON.stringify(db));
    expect(calcStore(back).profitAfterOverhead).toBeCloseTo(calcStore(db).profitAfterOverhead, 9);
    expect(() => parseDb('{"foo":1}')).toThrow();
  });
});

describe('учётные записи', () => {
  it('пустая учётная запись: всё по нулям, расчёт не падает', async () => {
    const { emptyDb } = await import('../demo');
    const db = emptyDb();
    expect(db.products.length + db.channels.length + db.store.overhead.length + db.settings.tax.lines.length).toBe(0);
    const r = calcStore(db);
    expect(r.profitAfterOverhead).toBe(0);
    expect(r.totals.revenue).toBe(0);
  });

  it('файл учётной записи открывается с именем и данными; старый формат тоже', async () => {
    const { parseAccountFile } = await import('../storage');
    const db = demoDb();
    const wrapped = parseAccountFile(JSON.stringify({ kind: 'trade_unit_account', name: 'Иван', db }), 'файл');
    expect(wrapped.name).toBe('Иван');
    expect(calcStore(wrapped.db).profitAfterOverhead).toBeCloseTo(calcStore(db).profitAfterOverhead, 9);
    expect(parseAccountFile(JSON.stringify(db), 'старый').name).toBe('старый');
  });

  it('находит валюту без курса', async () => {
    const { missingRates } = await import('../dbOps');
    const db = demoDb();
    expect(missingRates(db)).toEqual([]);
    db.settings.fx.CNY = 0;
    expect(missingRates(db)).toEqual(['CNY']);
  });
});

describe('курсы с наценкой', () => {
  it('каждая чужая валюта дорожает в основной на наценку', async () => {
    const { applyMarkup } = await import('./money');
    const mid = { EUR: 0.88, CNY: 6.7, UAH: 44.8, UZS: 11800 };
    // основная EUR: доллар и юань должны стоить в евро на 2% дороже, чем по банку
    const eur = applyMarkup(mid, 'EUR', 2)!;
    expect(eur.EUR! / 1).toBeCloseTo(0.88 * 1.02, 9);           // евро за доллар
    expect(eur.EUR! / eur.CNY!).toBeCloseTo(0.88 / 6.7 * 1.02, 9); // евро за юань
    // основная USD: юань дорожает в долларах на 2%
    const usd = applyMarkup(mid, 'USD', 2)!;
    expect(1 / usd.CNY!).toBeCloseTo(1 / 6.7 * 1.02, 9);
    // нет курса основной валюты — ничего не подставляем
    expect(applyMarkup({ CNY: 6.7 }, 'EUR', 2)).toBeNull();
  });
});

describe('разбивка себестоимости по областям', () => {
  it('доли дают 100%, последняя цена после равна себестоимости штуки', async () => {
    const { costBreakdown } = await import('./product');
    const db = demoDb();
    const c = calcProduct(db.products[0], db.settings);
    const rows = costBreakdown(db.products[0], c);
    expect(rows.map(r => r.key)).toEqual(['supplier', 'purchase', 'local', 'intl', 'import', 'pack']);
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(100, 9);
    expect(rows.reduce((a, r) => a + r.addedPerUnit, 0)).toBeCloseTo(c.unitCost, 9);
    expect(rows[rows.length - 1].totalPerUnit).toBeCloseTo(c.unitCost, 9);
    expect(rows[0].addedPerUnit).toBeCloseTo(c.purchaseBase / c.sellable, 9);
    // деньги на партию: области в сумме дают всю партию, нарастающий итог заканчивается ею же
    expect(rows.reduce((a, r) => a + r.added, 0)).toBeCloseTo(c.batchCost, 9);
    expect(rows[rows.length - 1].total).toBeCloseTo(c.batchCost, 9);
    expect(rows[2].total).toBeCloseTo(rows[0].added + rows[1].added + rows[2].added, 9);
  });

  it('товар без штук не даёт деления на ноль', async () => {
    const { costBreakdown } = await import('./product');
    const db = demoDb();
    db.products[0].batchQty = 0;
    const rows = costBreakdown(db.products[0], calcProduct(db.products[0], db.settings));
    expect(rows.every(r => Number.isFinite(r.share) && Number.isFinite(r.addedPerUnit))).toBe(true);
  });
});

describe('маржа и наценка', () => {
  it('маржа от цены, наценка от себестоимости', async () => {
    const { priceMetrics } = await import('./product');
    const m = priceMetrics(150, 100, false, 20)!;
    expect(m.margin).toBeCloseTo(50, 9);
    expect(m.marginPct).toBeCloseTo(33.3333333, 5);
    expect(m.markupPct).toBeCloseTo(50, 9);
  });

  it('у плательщика НДС считается от цены без НДС', async () => {
    const { priceMetrics } = await import('./product');
    const m = priceMetrics(12, 5, true, 20)!; // 12 с НДС = 10 без НДС
    expect(m.net).toBeCloseTo(10, 9);
    expect(m.margin).toBeCloseTo(5, 9);
    expect(m.marginPct).toBeCloseTo(50, 9);
    expect(m.markupPct).toBeCloseTo(100, 9);
  });

  it('цена не задана или себестоимость ноль', async () => {
    const { priceMetrics } = await import('./product');
    expect(priceMetrics(0, 5, false, 0)).toBeNull();
    expect(priceMetrics(10, 0, false, 0)!.markupPct).toBeNull();
  });
});

describe('скидка набора', () => {
  it('набор против розничных цен товаров по отдельности', async () => {
    const db = demoDb();
    const pc = calcAllProducts(db);
    const k = kitOffer(db.kits[0], db, pc); // 2 полотенца по 10 + спрей 9, цена набора 26
    expect(k.singlesPrice).toBeCloseTo(29, 9);
    expect(k.discountPct).toBeCloseTo((1 - 26 / 29) * 100, 9);
    db.kits[0].price = 0;
    expect(kitOffer(db.kits[0], db, pc).discountPct).toBeNull();
  });
});

describe('расходы внутри областей', () => {
  it('сумма расходов равна области, последний нарастающий итог равен итогу области', async () => {
    const { costBreakdown } = await import('./product');
    const db = demoDb();
    const p = db.products[0];
    const rows = costBreakdown(p, calcProduct(p, db.settings));
    for (const r of rows) {
      expect(r.items.reduce((a, x) => a + x.added, 0)).toBeCloseTo(r.added - (r.key === 'supplier' ? r.added : 0), 9);
      if (r.items.length) expect(r.items[r.items.length - 1].total).toBeCloseTo(r.total, 9);
    }
    expect(rows[0].items).toEqual([]); // у закупки у поставщика отдельных расходов нет
    const customs = rows.find(r => r.key === 'import')!;
    expect(customs.items.map(i => i.expense.name)).toEqual(['Пошлина', 'Таможенный брокер', 'Импортный НДС']);
    // нарастающий итог первого расхода = итог предыдущей области + он сам
    const prev = rows[rows.findIndex(r => r.key === 'import') - 1];
    expect(customs.items[0].total).toBeCloseTo(prev.total + customs.items[0].added, 9);
  });

  it('НДС на ввоз у плательщика НДС показан, но в цену и нарастающий итог не входит', async () => {
    const { costBreakdown } = await import('./product');
    const db = v2Settings(true);
    const p = db.products[0];
    const rows = costBreakdown(p, calcProduct(p, db.settings));
    const vat = rows.find(r => r.key === 'import')!.items.find(i => i.expense.basis === 'vat')!;
    expect(vat.inCost).toBe(false);
    expect(Math.round(vat.amount)).toBe(295);
    expect(vat.added).toBe(0);
    const customs = rows.find(r => r.key === 'import')!;
    expect(vat.total).toBeCloseTo(customs.total, 9);
  });
});

describe('апрув и воронка на 1000 показов', () => {
  it('пример: 10% кликают, 5% оформляют → из 1000 показов 100 кликов и 5 заказов', async () => {
    const { funnelPer1000 } = await import('./channel');
    const ch = { ...demoDb().channels[0], adMode: 'funnel' as const, cpm: 10, ctr: 10, cr: 5, approve: 100, buyout: 100 };
    const f = funnelPer1000(ch, 1);
    expect(f.clicks).toBeCloseTo(100, 9);
    expect(f.orders).toBeCloseTo(5, 9);
    expect(f.costPerSold!).toBeCloseTo(10 / 5, 9); // 1000 показов стоят 10, заказов 5 → заказ 2

  });

  it('апрув и невыкуп удорожают проданный заказ', async () => {
    const { funnelPer1000 } = await import('./channel');
    const ch = { ...demoDb().channels[0], adMode: 'funnel' as const, cpm: 10, ctr: 10, cr: 5, approve: 80, buyout: 80 };
    const f = funnelPer1000(ch, 1); // подтверждают 80%, забирают 80%
    expect(f.approved).toBeCloseTo(4, 9);
    expect(f.sold).toBeCloseTo(3.2, 9);
    expect(f.costPerSold!).toBeCloseTo(10 / 3.2, 9);
  });

  it('продаётся только подтверждённая и забранная часть, реклама платится за все оформленные', () => {
    const ch = { ...demoDb().channels[0], adMode: 'cpa' as const, cpa: 2, approve: 80, buyout: 90 };
    const e = orderEconomics(100, 20, 5, ch, CTX);
    expect(e.delivered).toBeCloseTo(72);
    expect(e.ads).toBeCloseTo(200);                       // за все 100 оформленных
  });

  it('нулевой апрув не ломает расчёт', async () => {
    const { funnelPer1000 } = await import('./channel');
    const ch = { ...demoDb().channels[0], adMode: 'funnel' as const, cpm: 10, ctr: 10, cr: 5, approve: 0, buyout: 100 };
    expect(funnelPer1000(ch, 1).costPerSold).toBeNull();
    expect(orderEconomics(100, 20, 5, ch, CTX).delivered).toBe(0);
  });
});

describe('перенос старых данных каналов', () => {
  it('«без рекламы» становится ценой заказа, апрув и выкуп берутся из старого невыкупа', async () => {
    const { normalizeDb } = await import('../storage');
    const db = demoDb() as unknown as { store: Record<string, unknown>; channels: Record<string, unknown>[] };
    delete db.store.noBuy;
    for (const c of db.channels) { delete c.approve; delete c.buyout; }
    db.channels[0].adMode = 'none';   // первый канал без рекламы пропускается
    Object.assign(db.channels[0], { shipping: 99, noBuy: 99 });
    Object.assign(db.channels[1], { adMode: 'cpa', noBuy: 15 });
    const out = normalizeDb(db as never) as unknown as typeof db;
    expect(out.channels[1].buyout).toBe(85);   // 100% минус невыкуп этого канала (15%)
    expect(out.channels[0].buyout).toBe(1);    // у первого канала невыкуп был 99%
    expect(out.channels[0].adMode).toBe('cpa');
    expect(out.channels[0].approve).toBe(100);
  });

  it('повторный запуск ничего не меняет', async () => {
    const { normalizeDb } = await import('../storage');
    const db = demoDb();
    const before = JSON.stringify(db);
    expect(JSON.stringify(normalizeDb(db))).toBe(before);
  });
});

describe('выкуп канала', () => {
  it('промежуточная версия: нет невыкупа у канала, есть общий невыкуп магазина', async () => {
    const { normalizeDb } = await import('../storage');
    const db = demoDb() as unknown as { store: Record<string, unknown>; channels: Record<string, unknown>[] };
    for (const c of db.channels) delete c.buyout;
    db.store.noBuy = 12;
    const out = normalizeDb(db as never) as unknown as typeof db;
    expect(out.channels.every(c => c.buyout === 88)).toBe(true);
  });

  it('выкуп у каждого канала свой: цена проданного заказа считается по нему', async () => {
    const { funnelPer1000 } = await import('./channel');
    const a = { ...demoDb().channels[0], adMode: 'cpa' as const, cpa: 4, approve: 100, buyout: 100 };
    const b = { ...a, buyout: 50 };
    expect(funnelPer1000(a, 1).costPerSold).toBeCloseTo(4, 9);
    expect(funnelPer1000(b, 1).costPerSold).toBeCloseTo(8, 9);
  });
});

describe('воронка на одну продажу', () => {
  it('сколько нужно каждого шага на один проданный заказ и сколько стоит одна штука', async () => {
    const { funnelView } = await import('./channel');
    // CPM 10, CTR 10%, конверсия 5%, апрув 80%, выкуп 80%: из 1000 показов 100 кликов, 5 заказов, 4 подтверждено, 3,2 проданных
    const ch = { ...demoDb().channels[0], adMode: 'funnel' as const, cpm: 10, ctr: 10, cr: 5, approve: 80, buyout: 80 };
    const v = funnelView(ch, 1);
    expect(v.stages.map(s => s.key)).toEqual(['impressions', 'clicks', 'orders', 'approved', 'sold']);
    const get = (k: string) => v.stages.find(s => s.key === k)!;
    // на один проданный заказ
    expect(get('impressions').count!).toBeCloseTo(1000 / 3.2, 9);
    expect(get('clicks').count!).toBeCloseTo(100 / 3.2, 9);
    expect(get('orders').count!).toBeCloseTo(5 / 3.2, 9);
    expect(get('approved').count!).toBeCloseTo(4 / 3.2, 9);
    expect(get('sold').count).toBe(1);
    // цена одной штуки
    expect(get('impressions').cost!).toBeCloseTo(0.01, 9);
    expect(get('clicks').cost!).toBeCloseTo(0.1, 9);
    expect(get('orders').cost!).toBeCloseTo(2, 9);
    expect(get('approved').cost!).toBeCloseTo(2.5, 9);
    expect(get('sold').cost!).toBeCloseTo(10 / 3.2, 9);
  });

  it('количество × цена любого шага даёт цену проданного заказа', async () => {
    const { funnelView, funnelPer1000 } = await import('./channel');
    const ch = { ...demoDb().channels[0], adMode: 'funnel' as const, cpm: 3, ctr: 2, cr: 3, approve: 85, buyout: 88 };
    const v = funnelView(ch, 1);
    const total = funnelPer1000(ch, 1).costPerSold!;
    for (const s of v.stages) expect(s.count! * s.cost!).toBeCloseTo(total, 9);
  });

  it('известна цена заказа: показов и кликов нет, шаги заказы → подтверждённые → проданный', async () => {
    const { funnelView } = await import('./channel');
    const ch = { ...demoDb().channels[0], adMode: 'cpa' as const, cpa: 7, approve: 90, buyout: 80 };
    const v = funnelView(ch, 1);
    expect(v.stages.map(s => s.key)).toEqual(['orders', 'approved', 'sold']);
    expect(v.stages[0].count!).toBeCloseTo(100 / 72, 9);
    expect(v.stages[1].count!).toBeCloseTo(90 / 72, 9);
    expect(v.stages[0].cost!).toBeCloseTo(7, 9);
    expect(v.stages[2].cost!).toBeCloseTo(700 / 72, 9);
  });

  it('нулевой апрув: до покупки ничего не доходит', async () => {
    const { funnelView } = await import('./channel');
    const ch = { ...demoDb().channels[0], adMode: 'cpa' as const, cpa: 7, approve: 0, buyout: 100 };
    const v = funnelView(ch, 1);
    expect(v.stages.every(s => s.count === null)).toBe(true);
    expect(v.stages[2].cost).toBeNull();
  });
});

describe('воронка на заданное число продаж', () => {
  it('количества растут пропорционально, цены одной штуки не меняются, итог умножается', async () => {
    const { funnelView } = await import('./channel');
    const ch = { ...demoDb().channels[0], adMode: 'funnel' as const, cpm: 10, ctr: 10, cr: 5, approve: 80, buyout: 80 };
    const one = funnelView(ch, 1, 1), many = funnelView(ch, 1, 100);
    for (let i = 0; i < one.stages.length; i++) {
      expect(many.stages[i].count!).toBeCloseTo(one.stages[i].count! * 100, 7);
      expect(many.stages[i].cost!).toBeCloseTo(one.stages[i].cost!, 9);
      expect(many.stages[i].count! * many.stages[i].cost!).toBeCloseTo(many.total!, 7); // любой шаг даёт один и тот же итог
    }
    expect(many.total!).toBeCloseTo(one.total! * 100, 7);
    expect(many.stages[many.stages.length - 1].count).toBe(100);
  });

  it('по умолчанию на одну продажу', async () => {
    const { funnelView } = await import('./channel');
    const ch = { ...demoDb().channels[0], adMode: 'cpa' as const, cpa: 7, approve: 90, buyout: 80 };
    expect(funnelView(ch, 1).stages[2].count).toBe(1);
    expect(funnelView(ch, 1).total!).toBeCloseTo(700 / 72, 9);
  });
});

describe('готовая цена канала в процентах', () => {
  const base = () => ({ ...demoDb().channels[0], adMode: 'cpa' as const, cpa: 5, cpaType: 'percent' as const, cpaPercent: 12, approve: 100, buyout: 100 });

  it('процент берётся от суммы забранных заказов, а не от количества заказов', () => {
    const e = orderEconomics(100, 20, 5, base(), { ...CTX });
    expect(e.gross).toBeCloseTo(2000, 9);
    expect(e.ads).toBeCloseTo(240, 9);                       // 12% от 2000
    expect(orderEconomics(100, 40, 5, base(), CTX).ads).toBeCloseTo(480, 9); // цена вдвое выше → плата вдвое выше
  });

  it('апрув и выкуп в процентном режиме не используются: все заказы плана считаются проданными', () => {
    const e = orderEconomics(100, 20, 5, { ...base(), approve: 50, buyout: 50 }, CTX);
    expect(e.delivered).toBeCloseTo(100, 9);
    expect(e.ads).toBeCloseTo(240, 9);
  });

  it('после переключения обратно на сумму сохранённые апрув и выкуп снова работают', () => {
    const e = orderEconomics(100, 20, 5, { ...base(), cpaType: 'money' as const, approve: 50, buyout: 50 }, CTX);
    expect(e.delivered).toBeCloseTo(25, 9);
  });

  it('сумма за заказ при том же канале в режиме money не меняется', () => {
    const e = orderEconomics(100, 20, 5, { ...base(), cpaType: 'money' as const }, CTX);
    expect(e.ads).toBeCloseTo(500, 9);                       // 100 заказов × 5
  });

  it('старые каналы без cpaType считаются как сумма за заказ', () => {
    const { cpaType, cpaPercent, ...old } = base(); void cpaType; void cpaPercent;
    expect(orderEconomics(100, 20, 5, old, CTX).ads).toBeCloseTo(500, 9);
  });
});

// ---------- магазин: план продаж → доли позиций → доли каналов ----------

/** Чистая база для проверки арифметики: без НДС и накладных. */
function storeDb(): Db {
  const db = demoDb();
  db.store.overhead = [];
  db.settings.tax = taxFromPreset('bg_eood'); db.settings.tax.vatPayer = false;
  db.settings.tax.lines = [];                                  // налогов нет: проверяем чистую арифметику
  const [a, b] = db.channels;
  Object.assign(a, { name: 'A', adMode: 'cpa', cpa: 2, cpaType: 'money', approve: 100, buyout: 100 });
  Object.assign(b, { name: 'B', adMode: 'cpa', cpa: 4, cpaType: 'money', approve: 100, buyout: 100 });
  db.store.sales = 1000;
  db.products[0].price = 10;
  db.store.items = [{ id: 'i1', offer: `p:${db.products[0].id}`, share: 50, channels: [{ channelId: a.id, share: 60 }, { channelId: b.id, share: 40 }] }];
  return db;
}

describe('план магазина', () => {
  it('1000 продаж, позиция 50%, каналы 60/40: сколько продано, оборот, себестоимость, реклама, прибыль', () => {
    const db = storeDb();
    const r = calcStore(db);
    const unit = calcAllProducts(db)[db.products[0].id].unitCost;
    expect(r.totals.sold).toBeCloseTo(500, 9);
    expect(r.totals.revenue).toBeCloseTo(5000, 9);          // 500 × 10
    expect(r.totals.cogs).toBeCloseTo(500 * unit, 9);
    expect(r.totals.ads).toBeCloseTo(300 * 2 + 200 * 4, 9);  // канал A 300 заказов по 2, канал B 200 по 4
    expect(r.totals.contribution).toBeCloseTo(5000 - 500 * unit - 1400, 9);
    expect(r.profitAfterOverhead).toBeCloseTo(r.totals.contribution, 9);
  });

  it('апрув и выкуп: оформляем больше, чтобы получить нужное число проданных', () => {
    const db = storeDb();
    Object.assign(db.channels[0], { approve: 80, buyout: 50 });   // доходит 40% оформленных
    db.store.items[0].channels = [{ channelId: db.channels[0].id, share: 100 }];
    const r = calcStore(db);
    expect(r.totals.sold).toBeCloseTo(500, 9);
    expect(r.totals.placed).toBeCloseTo(500 / 0.4, 9);
    expect(r.totals.ads).toBeCloseTo((500 / 0.4) * 2, 9);       // реклама за все оформленные
  });

  it('что не распределено (сумма меньше 100%), не продаётся', () => {
    const db = storeDb();
    db.store.items[0].share = 30;
    db.store.items[0].channels[1].share = 10;                      // каналы 60 + 10 = 70%
    const r = calcStore(db);
    expect(r.itemsShare).toBe(30);
    expect(r.items[0].channelsShare).toBe(70);
    expect(r.totals.sold).toBeCloseTo(1000 * 0.3 * 0.7, 9);
  });

  it('канал с нулевым апрувом не продаёт и помечается', () => {
    const db = storeDb();
    db.channels[0].approve = 0;
    const r = calcStore(db);
    expect(r.items[0].blocked).toEqual([db.channels[0].id]);
    expect(r.totals.sold).toBeCloseTo(200, 9);                     // остался только канал B: 1000 × 50% × 40%
  });

  it('удалённый товар или канал не ломают расчёт', () => {
    const db = storeDb();
    db.store.items.push({ id: 'i2', offer: 'p:нет-такого', share: 20, channels: [{ channelId: db.channels[0].id, share: 100 }] });
    db.store.items[0].channels.push({ channelId: 'нет-канала', share: 0 });
    const r = calcStore(db);
    expect(r.items[1].offer).toBeNull();
    expect(r.totals.sold).toBeCloseTo(500, 9);
  });

  it('цена позиции берётся из карточки товара, свою вписать нельзя', () => {
    const db = storeDb();
    const retail = db.products[0].price;
    expect(calcStore(db).totals.revenue).toBeCloseTo(500 * retail, 9);
  });

  it('процентный канал: плата считается от оборота по этому каналу', () => {
    const db = storeDb();
    Object.assign(db.channels[0], { cpaType: 'percent', cpaPercent: 10 });
    db.store.items[0].channels = [{ channelId: db.channels[0].id, share: 100 }];
    const r = calcStore(db);
    expect(r.totals.ads).toBeCloseTo(5000 * 0.1, 9);
  });
});

describe('накладные расходы магазина', () => {
  it('сумма в месяц и процент от оборота', () => {
    const db = storeDb();
    db.store.overhead = [
      { id: 'a', name: 'Аренда', kind: 'fixed', amount: 300, currency: 'EUR' },
      { id: 'b', name: 'Эквайринг', kind: 'percent', amount: 0, currency: 'EUR', percent: 2 },
      { id: 'c', name: 'Старая запись без вида', amount: 50, currency: 'EUR' },   // нет поля kind — сумма в месяц
    ];
    const r = calcStore(db);
    expect(r.overheadLines.map(x => x.amount)).toEqual([300, 100, 50]);           // 2% от оборота 5000
    expect(r.overhead).toBeCloseTo(450, 9);
    expect(r.profitAfterOverhead).toBeCloseTo(r.totals.contribution - 450, 9);
  });

  it('процент следует за оборотом, а сумма нет', () => {
    const db = storeDb();
    db.store.overhead = [{ id: 'b', name: 'Эквайринг', kind: 'percent', amount: 0, currency: 'EUR', percent: 2 }];
    const half = calcStore({ ...db, store: { ...db.store, sales: 500 } }).overhead;
    expect(half).toBeCloseTo(calcStore(db).overhead / 2, 9);
    expect(overheadAmount({ id: 'x', name: 'x', kind: 'fixed', amount: 100, currency: 'EUR' }, 0, 0, db)).toBe(100);
  });

  it('за штуку: сумма умножается на число проданных, в другой валюте переводится по курсу', () => {
    const db = storeDb();
    db.store.overhead = [
      { id: 'a', name: 'Курьер', kind: 'perUnit', amount: 3, currency: 'EUR' },
      { id: 'b', name: 'Хранение', kind: 'perUnit', amount: 41.5, currency: 'UAH' },
    ];
    const r = calcStore(db);
    const sold = r.totals.sold;
    expect(sold).toBeCloseTo(500, 9);
    expect(r.overheadLines[0].amount).toBeCloseTo(3 * sold, 9);
    expect(r.overheadLines[1].amount).toBeCloseTo(sold * 0.86, 9);   // 41,5 грн = 0,86 евро
    const half = calcStore({ ...db, store: { ...db.store, sales: db.store.sales / 2 } });
    expect(half.overheadLines[0].amount).toBeCloseTo(1.5 * sold, 9);   // следует за числом проданных
  });

  it('сумма в другой валюте переводится по курсу', () => {
    const db = storeDb();
    const o = { id: 'x', name: 'Аренда', kind: 'fixed' as const, amount: 4150, currency: 'UAH' as const };
    expect(overheadAmount(o, 0, 0, db)).toBeCloseTo(4150 / 41.5 * 0.86, 9);
  });
});

describe('перенос старого плана магазина', () => {
  it('строки позиция × канал × оформлено превращаются в план продаж с долями', async () => {
    const { normalizeDb } = await import('../storage');
    const db = storeDb() as unknown as { store: Record<string, unknown>; channels: Record<string, unknown>[]; products: { id: string }[] };
    delete db.store.items; delete db.store.sales;
    const [a, b] = db.channels;
    Object.assign(a, { approve: 50, buyout: 100 }); Object.assign(b, { approve: 100, buyout: 100 });
    const p0 = `p:${db.products[0].id}`, p1 = `p:${db.products[1].id}`;
    db.store.plan = [
      { id: 'r1', offer: p0, channelId: a.id, orders: 200 },   // продано 100
      { id: 'r2', offer: p0, channelId: b.id, orders: 100 },  // продано 100
      { id: 'r3', offer: p1, channelId: b.id, orders: 200 },  // продано 200
    ];
    const out = normalizeDb(db as never) as unknown as typeof db;
    expect(out.store.sales).toBe(400);
    const items = out.store.items as { offer: string; share: number; channels: { channelId: string; share: number }[] }[];
    expect(items.find(i => i.offer === p0)).toMatchObject({ share: 50, channels: [{ channelId: a.id, share: 50 }, { channelId: b.id, share: 50 }] });
    expect(items.find(i => i.offer === p1)).toMatchObject({ share: 50, channels: [{ channelId: b.id, share: 100 }] });
    expect(items.reduce((s, i) => s + i.share, 0)).toBeLessThanOrEqual(100);
  });

  it('период плана: нет поля в старых данных — 30 дней', async () => {
    const { normalizeDb } = await import('../storage');
    const db = storeDb() as unknown as { store: Record<string, unknown> };
    delete db.store.period;
    expect((normalizeDb(db as never) as unknown as typeof db).store.period).toBe(30);
    db.store.period = 14;
    expect((normalizeDb(db as never) as unknown as typeof db).store.period).toBe(14);
  });

  it('чистая прибыль в день: прибыль делится на дни периода, нулевой период не ломает', () => {
    const db = storeDb();
    db.store.period = 30;
    const r = calcStore(db);
    expect(perDay(r.profitAfterOverhead, r.period)).toBeCloseTo(r.profitAfterOverhead / 30, 9);
    db.store.period = 0;
    const zero = calcStore(db);
    expect(perDay(zero.profitAfterOverhead, zero.period)).toBe(0);
  });

  it('повторный запуск ничего не меняет, пустой план даёт нулевой', async () => {
    const { normalizeDb } = await import('../storage');
    const db = storeDb();
    const before = JSON.stringify(db);
    expect(JSON.stringify(normalizeDb(db))).toBe(before);
    const old = demoDb() as unknown as { store: Record<string, unknown> };
    delete old.store.items; delete old.store.sales; old.store.plan = [];
    const out = normalizeDb(old as never) as unknown as typeof old;
    expect(out.store.sales).toBe(0);
    expect(out.store.items).toEqual([]);
  });
});

describe('налоги в накладных расходах', () => {
  const withTax = (id: string) => { const db = storeDb(); db.settings.tax = { ...taxFromPreset(id), vatPayer: false }; return db; };

  it('ЕООД: 10% с прибыли после своих накладных, затем 5% дивиденд с остатка; всё входит в накладные', () => {
    const db = withTax('bg_eood');
    db.store.overhead = [{ id: 'a', name: 'Аренда', kind: 'fixed', amount: 300, currency: 'EUR' }];
    const r = calcStore(db);
    const before = r.totals.contribution - 300;                       // прибыль до налогов
    expect(r.overheadOwn).toBeCloseTo(300, 9);
    expect(r.taxLines[0].amount).toBeCloseTo(before * 0.1, 9);
    expect(r.taxLines[1].amount).toBeCloseTo(before * 0.9 * 0.05, 9);
    expect(r.taxes).toBeCloseTo(before * 0.145, 9);
    expect(r.overhead).toBeCloseTo(300 + before * 0.145, 9);          // налоги внутри накладных
    expect(r.profitAfterOverhead).toBeCloseTo(before * (1 - 0.145), 9);
    expect(r.taxLines[0].perOrder).toBeCloseTo(r.taxLines[0].amount / r.totals.sold, 9);
  });

  it('ФОП 3 группа: 6% с оборота и ЕСВ фиксированно, не зависят от прибыли', () => {
    const db = withTax('ua_fop3');
    const r = calcStore(db);
    const esv = 1902.34 / 41.5 * 0.86;
    expect(r.taxes).toBeCloseTo(r.totals.revenue * 0.06 + esv, 6);
    expect(r.profitAfterOverhead).toBeCloseTo(r.totals.contribution - r.overheadOwn - r.taxes, 9);
  });

  it('убыток налогом на прибыль и дивидендом не облагается', () => {
    const db = withTax('bg_eood');
    db.store.overhead = [{ id: 'a', name: 'Огромный расход', kind: 'fixed', amount: 1e6, currency: 'EUR' }];
    const r = calcStore(db);
    expect(r.taxes).toBe(0);
    expect(r.profitAfterOverhead).toBeLessThan(0);
  });

  it('без налоговых строк налогов нет, прогноз считает налоги тоже', () => {
    const db = withTax('bg_eood');
    const pc = calcAllProducts(db);
    const base = calcStore(db, pc);
    db.scenario = { sales: db.store.sales * 2 };
    const fc = calcForecast(db, pc)!;
    expect(fc.taxes).toBeGreaterThan(base.taxes);
    db.settings.tax.lines = [];
    expect(calcStore(db, pc).taxes).toBe(0);
  });
});

describe('маржа', () => {
  it('оборот минус себестоимость, до рекламы и доставки', () => {
    const r = calcStore(demoDb());
    const T = r.totals;
    expect(margin(T)).toBeCloseTo(T.revenue - T.cogs, 9);
    expect(margin(T)).toBeGreaterThan(T.contribution);
  });
});

describe('аналитика и прогноз', () => {
  it('итоги по каналам складываются в итог магазина', () => {
    const r = calcStore(demoDb());
    const sum = (k: 'revenue' | 'ads' | 'contribution' | 'sold') => r.channels.reduce((a, c) => a + c.totals[k], 0);
    for (const k of ['revenue', 'ads', 'contribution', 'sold'] as const) expect(sum(k)).toBeCloseTo(r.totals[k], 9);
    expect(r.channels).toHaveLength(demoDb().channels.length);
  });

  it('пересчёт на дни: неделя из месячного плана, нулевой период даёт 0', () => {
    expect(forDays(300, 30, 7)).toBeCloseTo(70, 9);
    expect(forDays(300, 30, 30)).toBe(300);
    expect(forDays(300, 0, 7)).toBe(0);
  });

  it('без подмен прогноза нет, пустые и нечисловые значения не считаются подменой', () => {
    const db = storeDb();
    const pc = calcAllProducts(db);
    expect(calcForecast(db, pc)).toBeNull();
    db.scenario = { channels: { [db.channels[0].id]: { cpa: undefined } }, offers: {} };
    expect(scenarioCount(db.scenario)).toBe(0);
    expect(calcForecast(db, pc)).toBeNull();
  });

  it('прогноз по каналу пересчитывает рекламу, настоящие данные не меняются', () => {
    const db = storeDb();
    const pc = calcAllProducts(db);
    const before = JSON.stringify(db);
    const base = calcStore(db, pc);
    db.scenario = { channels: { [db.channels[0].id]: { cpa: 4 } } };   // было 2
    const fc = calcForecast(db, pc)!;
    expect(fc.totals.ads).toBeGreaterThan(base.totals.ads);
    expect(fc.totals.revenue).toBeCloseTo(base.totals.revenue, 9);    // оборот не меняется
    expect(db.channels[0].cpa).toBe(2);
    const { scenario: _drop, ...rest } = db;
    expect(JSON.stringify(rest)).toBe(before);                         // всё остальное не тронуто
    expect(scenarioCount(db.scenario)).toBe(1);
  });

  it('прогноз цены и себестоимости позиции, плана продаж, апрува', () => {
    const db = storeDb();
    const pc = calcAllProducts(db);
    const base = calcStore(db, pc);
    const ref = `p:${db.products[0].id}`;
    db.scenario = { offers: { [ref]: { price: 20 } } };               // розница 10 → 20
    expect(calcForecast(db, pc)!.totals.revenue).toBeCloseTo(base.totals.revenue * 2, 9);
    db.scenario = { offers: { [ref]: { unitCost: 0 } } };
    expect(calcForecast(db, pc)!.totals.cogs).toBeLessThan(base.totals.cogs);
    db.scenario = { sales: db.store.sales * 2 };
    expect(calcForecast(db, pc)!.totals.sold).toBeCloseTo(base.totals.sold * 2, 9);
    db.scenario = { channels: { [db.channels[0].id]: { approve: 50 } } };
    expect(calcForecast(db, pc)!.totals.ads).toBeGreaterThan(base.totals.ads);   // больше оформленных на те же продажи
  });

  it('прогноз накладных расходов: сумма, процент и сумма за штуку, в валюте самого расхода', () => {
    const db = storeDb();
    db.store.overhead = [
      { id: 'a', name: 'Аренда', kind: 'fixed', amount: 300, currency: 'EUR' },
      { id: 'b', name: 'Эквайринг', kind: 'percent', amount: 0, currency: 'EUR', percent: 2 },
      { id: 'c', name: 'Курьер', kind: 'perUnit', amount: 3, currency: 'EUR' },
    ];
    const pc = calcAllProducts(db);
    const base = calcStore(db, pc);
    db.scenario = { overhead: { a: { amount: 100 }, b: { percent: 4 }, c: { amount: 2 } } };
    expect(scenarioCount(db.scenario)).toBe(3);
    const fc = calcForecast(db, pc)!;
    expect(fc.overheadLines.map(l => l.amount)).toEqual([100, base.totals.revenue * 0.04, 2 * base.totals.sold]);
    expect(fc.totals.revenue).toBeCloseTo(base.totals.revenue, 9);      // на оборот не влияет
    expect(db.store.overhead[0].amount).toBe(300);                       // настоящие данные целы
  });

  it('сброс прогноза возвращает базовый расчёт', () => {
    const db = storeDb();
    const pc = calcAllProducts(db);
    db.scenario = { sales: 1, offers: { x: { price: 1 } } };
    delete db.scenario;
    const { db: d, patch } = applyScenario(db, db.scenario);
    expect(patch).toEqual({});
    expect(calcStore(d, pc).profitAfterOverhead).toBeCloseTo(calcStore(db, pc).profitAfterOverhead, 9);
  });

  it('итоги: чистая прибыль, рентабельность и прибыль с заказа', () => {
    const r = calcStore(demoDb());
    const s = summarize(r);
    expect(s.profit).toBeCloseTo(r.profitAfterOverhead, 9);
    expect(s.profitMargin).toBeCloseTo(r.profitAfterOverhead / r.totals.revenue * 100, 9);
    expect(s.profitPerOrder).toBeCloseTo(r.profitAfterOverhead / r.totals.sold, 9);
  });

  it('свой срок: дни, недели и месяцы в днях, меньше одной единицы не бывает', () => {
    expect(rangeDays(10, 'day')).toBe(10);
    expect(rangeDays(3, 'week')).toBe(21);
    expect(rangeDays(2, 'month')).toBe(60);
    expect(rangeDays(0, 'week')).toBe(7);
    expect(rangeDays(2.9, 'day')).toBe(2);
    expect(forDays(300, 30, rangeDays(3, 'week'))).toBeCloseTo(210, 9);
  });

  it('изменение прогноза в процентах: выше плюс, ниже минус, от нуля не считается', () => {
    expect(changePct(10, 12)).toBeCloseTo(20, 9);
    expect(changePct(10, 7.5)).toBeCloseTo(-25, 9);
    expect(changePct(10, 10)).toBe(0);
    expect(changePct(0, 5)).toBeNull();
  });

  it('новые итоги: средний чек, маржинальность, отдача рекламы (от маржи), окупаемость', () => {
    const r = calcStore(demoDb());
    const s = summarize(r);
    expect(s.avgCheck).toBeCloseTo(r.totals.revenue / r.totals.sold, 9);
    expect(s.marginPct).toBeCloseTo((r.totals.revenue - r.totals.cogs) / r.totals.revenue * 100, 9);
    expect(s.poas).toBeCloseTo((r.totals.revenue - r.totals.cogs) / r.totals.ads, 9);   // от маржи, не от оборота
    const costs = r.totals.cogs + r.totals.ads + r.overhead;
    expect(s.roi).toBeCloseTo(r.profitAfterOverhead / costs * 100, 9);
    const none = summarize(calcStore({ ...demoDb(), store: { ...demoDb().store, sales: 0 } }));
    expect(none).toMatchObject({ avgCheck: 0, marginPct: 0, poas: null });   // без продаж и рекламы не делим на ноль
  });

  it('показатели строки: деньги и проценты от оборота строки, прибыль с заказа', () => {
    const r = calcStore(demoDb());
    for (const x of [...r.items.map(i => i.totals), ...r.channels.map(c => c.totals)]) {
      const m = rowMetrics(x);
      expect(m.margin).toBeCloseTo(x.revenue - x.cogs, 9);
      if (x.revenue > 0) {
        expect(m.marginPct).toBeCloseTo((x.revenue - x.cogs) / x.revenue * 100, 9);
        expect(m.adsPct).toBeCloseTo(x.ads / x.revenue * 100, 9);
        expect(m.profitPct).toBeCloseTo(x.contribution / x.revenue * 100, 9);
      }
      if (x.sold > 0) expect(m.perOrder).toBeCloseTo(x.contribution / x.sold, 9);
    }
    expect(rowMetrics(calcStore(demoDb()).channels[0].totals).revenue).toBeGreaterThan(0);
    const zero = rowMetrics({ sold: 0, placed: 0, gross: 0, revenue: 0, cogs: 0, ads: 0, contribution: 0 });
    expect(zero).toMatchObject({ marginPct: 0, adsPct: 0, profitPct: 0, perOrder: 0 });
  });

  it('смена основной валюты пересчитывает денежные значения прогноза, проценты и CPM (он в долларах) не трогает', async () => {
    const { switchBaseCurrency } = await import('../dbOps');
    const db = demoDb();
    const id = db.channels[0].id, ref = `p:${db.products[0].id}`;
    db.scenario = { channels: { [id]: { cpm: 8.6, cpa: 8.6, ctr: 2 } }, offers: { [ref]: { price: 8.6 } } };
    switchBaseCurrency(db, 'USD');                                     // 1 USD = 0,86 EUR
    expect(db.scenario.channels![id].cpa).toBeCloseTo(10, 1);
    expect(db.scenario.channels![id].cpm).toBe(8.6);
    expect(db.scenario.channels![id].ctr).toBe(2);
    expect(db.scenario.offers![ref].price).toBeCloseTo(10, 1);
  });
});
