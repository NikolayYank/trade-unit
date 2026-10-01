import { Fragment, useEffect, useRef, useState } from 'react';
import type { TabProps } from '../App';
import { deleteProduct, duplicateProduct, productUsage } from '../dbOps';
import { newProduct } from '../demo';
import type { ProductCalcs } from '../engine/offers';
import type { ProductCalc } from '../engine/product';
import { activeStages, costBreakdown, PERCENT_BASES, priceMetrics, STAGE_LABELS, type BreakdownRow } from '../engine/product';
import { uid } from '../engine/taxPresets';
import type { Expense, ExpenseBasis, Product, StageKey } from '../engine/types';
import { MARGIN_TIP, MARKUP_TIP } from '../ui/tips';
import { Card, CurrencySelect, Del, Field, Group, Kpi, Note, Num, Pair, Segmented, Select, Text, Th, Tip, Unit, type Fmt } from '../ui/kit';

const BASIS: [ExpenseBasis, string][] = [
  ['fixed', 'сумма за всю партию'], ['per_unit', 'за 1 шт.'], ['per_kg', 'за 1 кг'], ['per_cbm', 'за 1 м³'],
  ['pct_purchase', '% от цены поставщика'], ['pct_stage', '% от суммы на этом шаге'],
];
const VAT_BASIS: [ExpenseBasis, string] = ['vat', 'НДС на ввоз, %'];

const STAGE_TIP: Record<StageKey, string> = {
  purchase: 'Это не сама закупка, а то, что платите сверх цены поставщика: комиссия посредника, проверка партии.\nЦена поставщика задаётся выше, в группе «Закупка».\nДля своего производства здесь работа, формы и оснастка.',
  local: 'Доставка от поставщика до склада, откуда товар уезжает к вам, и сбор груза в одну отправку.',
  intl: 'Основная доставка: перевозка из Китая в вашу страну и дальше логистика по стране до вашего склада. Сюда же страховка груза.\nСумма после этого шага нужна таможне, чтобы посчитать пошлину.',
  import: 'Пошлина, услуги брокера, сборы и НДС на ввоз.\nЕсли вы работаете с НДС, его потом возвращают, и в цену товара он не входит.',
  pack: 'Пакет, этикетка и другая упаковка каждой штуки. Считается только на целые штуки, без брака.\nКоробка для посылки вписывается накладными расходами во вкладке «Магазин».',
};

const BASIS_TIP = (
  <>
    <p><b>Сумма за всю партию.</b> Одна сумма на всю закупку, например услуги брокера. Калькулятор сам разделит её на все штуки.</p>
    <p><b>За 1 шт.</b> Умножается на количество штук. Так считают упаковку.</p>
    <p><b>За 1 кг.</b> Умножается на вес, за который платите перевозчику. Так считают доставку.</p>
    <p><b>За 1 м³.</b> Умножается на объём партии. Так считают морскую перевозку.</p>
    <p><b>% от цены поставщика.</b> Процент от суммы, которую заплатили поставщику за всю партию. Так считают комиссию посредника.</p>
    <p><b>% от суммы на этом шаге.</b> Процент от всего, что уже потрачено к этому шагу. Так считают пошлину и страховку.</p>
    <p><b>НДС на ввоз.</b> Есть только на шаге «Таможня»: процент от суммы вместе с пошлиной.</p>
  </>
);

type P = TabProps & { fmt: Fmt; pc: ProductCalcs };

export function ProductsTab({ db, mutate, fmt, pc }: P) {
  const [selId, setSelId] = useState<string | null>(db.products[0]?.id ?? null);
  const sel = db.products.find(p => p.id === selId) ?? db.products[0];

  const add = () => { const p = newProduct('Новый товар', db.settings.baseCurrency); mutate(d => { d.products.push(p); }); setSelId(p.id); };

  return (
    <div className="layout-prod">
      <div className="product-bar">
        <ProductPicker db={db} pc={pc} fmt={fmt} selId={sel?.id ?? null} onSelect={setSelId} />
        <button className="btn primary" onClick={add}>+ Товар</button>
      </div>

      {sel ? <ProductEditor key={sel.id} p={sel} db={db} mutate={mutate} fmt={fmt} pc={pc} onSelect={setSelId} /> :
        <div className="empty-state card"><p>Товаров пока нет.</p><button className="btn primary" onClick={add}>Добавить первый товар</button></div>}
    </div>
  );
}

/** Выбор товара: кнопка с названием текущего, по нажатию открывается список с поиском, после выбора закрывается. */
function ProductPicker({ db, pc, fmt, selId, onSelect }: { db: P['db']; pc: ProductCalcs; fmt: Fmt; selId: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const cur = db.products.find(p => p.id === selId);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const list = db.products.filter(p => (p.name + ' ' + p.sku).toLowerCase().includes(q.trim().toLowerCase()));
  const pick = (id: string) => { onSelect(id); setOpen(false); setQ(''); };

  return (
    <div className="picker" ref={box}>
      <button type="button" className="btn picker-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} disabled={!db.products.length}>
        <span className="picker-cur">
          <span className="picker-name">{cur ? cur.name || 'Без названия' : 'Нет товаров'}</span>
          {cur && <span className="picker-meta">{fmt.unit(pc[cur.id].unitCost)} за шт.</span>}
        </span>
        <span className="picker-count">{db.products.length > 1 ? `Все товары: ${db.products.length}` : ''}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="picker-pop">
          <div className="picker-search"><input className="input" autoFocus placeholder="Найти товар или артикул" value={q} onChange={e => setQ(e.target.value)} /></div>
          <div className="list">
            {list.map(p => (
              <button key={p.id} type="button" className={`list-item ${p.id === selId ? 'active' : ''}`} onClick={() => pick(p.id)}>
                <span className="name">{p.name || 'Без названия'}</span>
                <span className="meta">{p.sku ? `${p.sku} · ` : ''}{fmt.unit(pc[p.id].unitCost)} за шт. · в наличии {fmt.int(pc[p.id].available)}</span>
              </button>
            ))}
            {!list.length && <div className="empty">Ничего не нашлось</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const SUPPLIER_TIP = {
  import: 'Сколько штук берёте, по какой цене у поставщика и какая часть придёт бракованной.\nРасходы на доставку и таможню делятся на это количество.',
  local: 'Сколько штук производите и сколько стоят материалы на одну штуку.\nРаботу и формы добавьте расходами ниже.',
};

function ProductEditor({ p, db, mutate, fmt, pc, onSelect }: { p: Product; onSelect: (id: string | null) => void } & Omit<P, 'setDb'>) {
  const c = pc[p.id];
  const s = db.settings;
  const vat = s.tax.vatPayer;
  const set = (fn: (x: Product) => void) => mutate(d => { fn(d.products.find(x => x.id === p.id)!); });
  const sym = fmt.sym;

  const breakdown = costBreakdown(p, c);
  const bd = Object.fromEntries(breakdown.map(r => [r.key, r])) as Record<BreakdownRow['key'], BreakdownRow>;
  const needsCash = Math.abs(c.cashNeeded - c.batchCost) > 0.005; // отличается только у плательщика НДС с импортом
  const retail = priceMetrics(p.price, c.unitCost, vat, s.tax.vatRate);
  const wholesale = priceMetrics(p.wholesalePrice ?? 0, c.unitCost, vat, s.tax.vatRate);
  const vatNote = (m: ReturnType<typeof priceMetrics>) => (vat && m ? `\nСчитается от цены без НДС: ${fmt.unit(m.net)}.` : '');
  const marginText = (m: ReturnType<typeof priceMetrics>) => (m ? `${fmt.pct(m.marginPct, 0)} (${fmt.unit(m.margin)})` : '—');
  const markupText = (m: ReturnType<typeof priceMetrics>) => (m && m.markupPct !== null ? fmt.pct(m.markupPct, 0) : '—');

  const remove = () => {
    const u = productUsage(db, p.id);
    const parts = [u.kits.length && `наборов: ${u.kits.length}`, u.planItems.length && `позиций плана: ${u.planItems.length}`].filter(Boolean);
    if (!confirm(`Удалить «${p.name}»?${parts.length ? `\nТовар уберётся из ${parts.join(', ')}.` : ''}`)) return;
    mutate(d => deleteProduct(d, p.id));
    onSelect(db.products.find(x => x.id !== p.id)?.id ?? null);
  };
  const duplicate = () => { const cp = duplicateProduct(p); mutate(d => { d.products.push(cp); }); onSelect(cp.id); };

  return (
    <>
      <div className="content">
        <Card ckey="product:main" title={<input className="title-input" value={p.name} onChange={e => set(x => { x.name = e.target.value; })} />}
          right={<div className="row-actions"><button className="btn" onClick={duplicate}>Копия</button><button className="btn danger" onClick={remove}>Удалить</button></div>}>
          <div className="prod-grid">
            <Group title="О товаре">
              <Field size="m" label="Артикул" tip="Ваш код товара. Нужен только для поиска."><Text value={p.sku} onChange={v => set(x => { x.sku = v; })} /></Field>
              <Field label="Откуда товар" tip="У своего производства нет доставки из-за границы и таможни, эти шаги скрываются.">
                <Segmented value={p.origin} onChange={v => set(x => { x.origin = v; })} options={[['import', 'Закупка'], ['local', 'Своё производство']]} />
              </Field>
              <Field size="fill" label="Ссылка на поставщика" tip={'Страница товара на 1688, Alibaba, сайте фабрики или контакт поставщика.\nКнопка справа открывает ссылку в новой вкладке.'}>
                <div className="link-field">
                  <Text value={p.supplierUrl ?? ''} placeholder="https://" onChange={v => set(x => { x.supplierUrl = v.trim(); })} />
                  <a className={`icon-btn link-open ${linkHref(p.supplierUrl) ? '' : 'off'}`} href={linkHref(p.supplierUrl) ?? undefined}
                    target="_blank" rel="noopener noreferrer" title="Открыть ссылку" aria-disabled={!linkHref(p.supplierUrl)}>↗</a>
                </div>
              </Field>
            </Group>
            <Group title="Продажа и склад">
              <Field size="m" label="Цена розницы" tip={vat ? 'Сколько платит обычный покупатель за 1 шт.\nВводите цену с НДС: калькулятор сам вычтет налог.' : 'Сколько платит обычный покупатель за 1 шт.'}>
                <Num value={p.price} onChange={v => set(x => { x.price = v ?? 0; })} suffix={sym} />
              </Field>
              <Field size="m" label="Цена опта" tip={'По какой цене за 1 шт. продаёте оптом. Если опта нет, оставьте 0.\nВводите так же, как розницу: с НДС, если вы работаете с НДС.\nВ расчётах магазина пока не участвует: там берётся цена розницы. Для оптовой продажи создайте набор со своей ценой.'}>
                <Num value={p.wholesalePrice ?? 0} onChange={v => set(x => { x.wholesalePrice = v ?? 0; })} suffix={sym} />
              </Field>
              <Field size="m" label="Уже на складе" tip={'Сколько штук этого товара у вас уже есть, не считая партии из области 1.\nК ним прибавится новая партия без брака: из этой суммы считаются наборы и то, на сколько месяцев хватит товара.\nСебестоимость этих штук считается такой же, как у новой партии.'}>
                <Num value={p.stock} onChange={v => set(x => { x.stock = v ?? 0; })} suffix="шт." />
              </Field>
              <div className="stock-sum">
                <span className="label">Будет в наличии</span>
                <span className="val">{fmt.int(c.available)} шт.</span>
                <span className="how">{fmt.int(p.stock)} + {fmt.int(c.sellable)} из партии без брака</span>
              </div>
            </Group>
          </div>
          <textarea className="input notes" rows={1} placeholder="Заметки" value={p.notes} onChange={e => set(x => { x.notes = e.target.value; })} />
        </Card>

        <Card ckey="product:supplier" step="1" title={areaTitle(p, 'supplier')} tip={SUPPLIER_TIP[p.origin]} right={<AreaBadges row={bd.supplier} fmt={fmt} />}>
          <div className="row">
            <Field size="s" label="Берём за раз" tip="Сколько штук в одной закупке. Расходы на доставку и таможню делятся на это количество.">
              <Num value={p.batchQty} onChange={v => set(x => { x.batchQty = v ?? 0; })} suffix="шт." />
            </Field>
            <Field size="l" label={p.origin === 'local' ? 'Сырьё на 1 шт.' : 'Цена поставщика за 1 шт.'}
              tip={p.origin === 'local' ? 'Сколько стоят материалы на одну штуку.\nРаботу и формы добавьте расходами ниже.' : 'Сколько платите поставщику за одну штуку, в его валюте.'}>
              <Pair><Num value={p.unitCost} onChange={v => set(x => { x.unitCost = v ?? 0; })} /><CurrencySelect value={p.unitCostCurrency} onChange={v => set(x => { x.unitCostCurrency = v; })} /></Pair>
            </Field>
            <Field size="s" label="Брак" tip={'Какая часть товара приходит испорченной или теряется.\nВсе расходы делятся только на целые штуки, поэтому брак делает дороже каждую хорошую.'}>
              <Num value={p.defectRate} onChange={v => set(x => { x.defectRate = v ?? 0; })} suffix="%" />
            </Field>
          </div>

          {p.origin === 'import' && (
            <details className="sub-block">
              <summary>Вес и размер · платим за {c.chargeWeight.toFixed(1)} кг{c.chargeWeight > c.grossWeight + 0.01 ? ', по объёму' : ''}</summary>
              <div className="row">
                <Field size="s" label="Вес 1 шт." tip="Вместе с упаковкой."><Num value={p.unitWeight} onChange={v => set(x => { x.unitWeight = v ?? 0; })} suffix="кг" /></Field>
                <Field size="s" label="Объём 1 шт." tip="В упаковке. Например, коробка 10×10×10 см это 0,001 м³."><Num value={p.unitVolume} step={0.0001} onChange={v => set(x => { x.unitVolume = v ?? 0; })} suffix="м³" /></Field>
                <Field size="s" label="Штук в коробке" tip={'Сколько штук в одной заводской коробке.\nЕсли не знаете, поставьте 0, и вес посчитается по штукам.'}><Num value={p.unitsPerCarton} onChange={v => set(x => { x.unitsPerCarton = v ?? 0; })} /></Field>
                <Field size="s" label="Вес коробки" tip="Полной коробки, с товаром."><Num value={p.cartonWeight} onChange={v => set(x => { x.cartonWeight = v ?? 0; })} suffix="кг" /></Field>
                <Field size="l" label="Вес 1 м³ для перевозчика" tip={'Перевозчик берёт деньги за вес. Но если груз лёгкий и громоздкий, например подушки, он считает не по весам, а по месту, которое груз занимает.\nЭто число показывает, сколько килограммов перевозчик засчитывает за 1 кубометр (м³) груза. Для самолёта обычно 167, для экспресс-доставки 200. Точное число есть в тарифе перевозчика.\nПример: ваша партия весит 100 кг и занимает 1 м³. При числе 167 по месту выходит 167 кг. Это больше реальных 100 кг, поэтому платите за 167 кг.\nПоставьте 0, если перевозчик считает только реальный вес.'}>
                  <Num value={p.volCoef} onChange={v => set(x => { x.volCoef = v ?? 0; })} suffix="кг" />
                </Field>
              </div>
              <div className="metrics">
                <span>Весит <b>{c.grossWeight.toFixed(1)} кг</b>{c.cartons ? ` · ${c.cartons} кор.` : ''}</span>
                <span>Объём <b>{c.volume.toFixed(2)} м³</b></span>
                <span>Платим за <b>{c.chargeWeight.toFixed(1)} кг</b></span>
              </div>
            </details>
          )}
        </Card>

        {activeStages(p).map((key, i) => (
          <Card key={key} ckey={`product:stage:${key}`} step={String(i + 2)} title={areaTitle(p, key)} tip={STAGE_TIP[key]} right={<AreaBadges row={bd[key]} fmt={fmt} />}>
            <ExpenseList p={p} stage={key} set={set} fmt={fmt} c={c} />
          </Card>
        ))}
      </div>

      <aside className="sidebar">
        <Card ckey="product:summary" title="Во сколько обходится" className="summary-card">
          <div className="hero-row">
            <div className="hero"><div className="label">Одна штука</div><div className="value">{fmt.unit(c.unitCost)}</div></div>
            <div className="hero-side">
              <div className="label"><Tip text={`Все расходы на ${fmt.int(c.qty)} шт., из них целых ${fmt.int(c.sellable)}.`}>Вся партия</Tip></div>
              <div className="value">{fmt.money(c.batchCost)}</div>
              {needsCash && (
                <div className="aux"><Tip text={`Сколько вложить, пока товар не начал продаваться.\nК цене партии добавляется НДС на ввоз ${fmt.money(c.importVat)}: его вернут, но позже.`}>Нужно денег</Tip> <b>{fmt.money(c.cashNeeded)}</b></div>
              )}
            </div>
          </div>
          <div className="kpi-grid compact">
            <Kpi label="Маржа для розницы" tip={MARGIN_TIP + vatNote(retail) + (retail ? '' : '\nЗадайте цену розницы.')} value={marginText(retail)} tone={retail && retail.margin < 0 ? 'neg' : undefined} />
            <Kpi label="Наценка для розницы" tip={MARKUP_TIP} value={markupText(retail)} tone={retail && retail.margin < 0 ? 'neg' : undefined} />
            <Kpi label="Маржа для опта" tip={MARGIN_TIP + vatNote(wholesale) + (wholesale ? '' : '\nЗадайте цену опта.')} value={marginText(wholesale)} tone={wholesale && wholesale.margin < 0 ? 'neg' : undefined} />
            <Kpi label="Наценка для опта" tip={MARKUP_TIP} value={markupText(wholesale)} tone={wholesale && wholesale.margin < 0 ? 'neg' : undefined} />
          </div>
        </Card>
        <Card ckey="product:ladder" title="Из чего складывается" tip={'Сколько каждая область добавляет к цене одной штуки, какую долю итога занимает и сколько денег нужно на партию.\nНажмите на область, чтобы увидеть расходы внутри неё. Они берутся из карточек слева и обновляются сразу, как вы что-то меняете.\nНомера областей совпадают с карточками слева.'}>
          <BreakdownTable p={p} c={c} breakdown={breakdown} fmt={fmt} />
        </Card>
        {c.importVat > 0 && <Note tone="info">{vat
          ? `НДС на ввоз ${fmt.money(c.importVat)} вернут, поэтому в цену товара он не входит. Но платить его нужно сразу на таможне.`
          : `Вы без НДС, поэтому НДС на ввоз ${fmt.money(c.importVat)} не вернут. Он входит в цену товара.`}</Note>}
      </aside>
    </>
  );
}

/** Как посчитан расход, мелким шрифтом: «3,2 USD за 1 кг», «5% от суммы на этом шаге». */
function expenseHint(e: Expense): string {
  const v = String(e.value).replace('.', ',');
  const basis = BASIS.find(b => b[0] === e.basis)?.[1];
  switch (e.basis) {
    case 'vat': return `НДС на ввоз ${v}%`;
    case 'pct_purchase': case 'pct_stage': return `${v}% ${basis!.replace(/^% /, '')}`;
    default: return `${v} ${e.currency} ${basis ?? ''}`.trim();
  }
}

/** Таблица «Из чего складывается». Область раскрывается по нажатию и показывает свои расходы в тех же колонках. */
function BreakdownTable({ p, c, breakdown, fmt }: { p: Product; c: ProductCalc; breakdown: BreakdownRow[]; fmt: Fmt }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOpen(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  return (
    <table className="breakdown">
      <thead><tr>
        <Th>Область</Th>
        <Th num tip="Сколько эта область добавляет к цене одной годной штуки.">На 1 шт.</Th>
        <Th num tip="Какую часть итоговой себестоимости занимает область.">Доля</Th>
        <Th num tip="Сколько денег нужно на эту область для всей партии.">На партию</Th>
        <Th num tip={'Сколько денег набежало на всю партию после этой области.\nВ сумму входят и все области до неё.'}>Всего</Th>
      </tr></thead>
      <tbody>
        {breakdown.map((r, i) => {
          const expandable = r.items.length > 0;
          const isOpen = expandable && open.has(r.key);
          return (
            <Fragment key={r.key}>
              <tr className={`bd-row ${expandable ? 'expandable' : ''} ${isOpen ? 'open' : ''} ${r.addedPerUnit === 0 ? 'zero' : ''}`}
                onClick={expandable ? () => toggle(r.key) : undefined}
                onKeyDown={expandable ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(r.key); } } : undefined}
                tabIndex={expandable ? 0 : undefined} aria-expanded={expandable ? isOpen : undefined}
                title={expandable ? (isOpen ? 'Свернуть расходы области' : 'Показать расходы внутри области') : undefined}>
                <td>
                  <span className="bd-name">
                    <span className="bd-chev">{expandable && <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden><path d="M2 1l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
                    <span className="bd-num">{i + 1}</span>{areaTitle(p, r.key)}
                  </span>
                  <span className="bd-bar"><span style={{ width: `${Math.min(100, r.share)}%` }} /></span>
                </td>
                <td className="num">{fmt.unit(r.addedPerUnit)}</td>
                <td className="num">{fmt.pct(r.share, 0)}</td>
                <td className="num">{fmt.money(r.added)}</td>
                <td className="num">{fmt.money(r.total)}</td>
              </tr>
              {isOpen && r.items.map(it => (
                <tr key={it.expense.id} className={`bd-sub ${it.inCost ? '' : 'excluded'}`}>
                  <td>
                    <span className="bd-sub-name">{it.expense.name || 'Без названия'}{!it.inCost && ' (вернут)'}</span>
                    <span className="bd-sub-hint">{expenseHint(it.expense)}</span>
                  </td>
                  {it.inCost ? <>
                    <td className="num">{fmt.unit(it.addedPerUnit)}</td>
                    <td className="num">{fmt.pct(it.share, 0)}</td>
                    <td className="num">{fmt.money(it.added)}</td>
                    <td className="num">{fmt.money(it.total)}</td>
                  </> : <>
                    <td className="num">—</td><td className="num">—</td>
                    <td className="num struck" title="Этот НДС вернут, в цену товара он не входит">{fmt.money(it.amount)}</td>
                    <td className="num">—</td>
                  </>}
                </tr>
              ))}
              {isOpen && <tr className="bd-gap" aria-hidden><td colSpan={5} /></tr>}
            </Fragment>
          );
        })}
      </tbody>
      <tfoot><tr><td>Итого</td><td className="num">{fmt.unit(c.unitCost)}</td><td className="num">100%</td><td className="num">{fmt.money(c.batchCost)}</td><td /></tr></tfoot>
    </table>
  );
}

/** Два бейджа в шапке области: сколько добавляет к одной штуке и сколько денег нужно на всю партию. Видны и в свёрнутой области. */
function AreaBadges({ row, fmt }: { row: BreakdownRow; fmt: Fmt }) {
  return (
    <span className="area-badges">
      <span className="badge-unit" title="В пересчёте на одну годную штуку">{fmt.unit(row.addedPerUnit)} за шт.</span>
      <span className="badge-sum" title="На всю партию">{fmt.money(row.added)} на партию</span>
    </span>
  );
}

/** Ссылку открываем, только если это веб-адрес; «1688.com/…» без протокола дополняем https://. */
function linkHref(url?: string): string | null {
  const u = (url ?? '').trim();
  if (!u || /\s/.test(u)) return null;
  const full = /^https?:\/\//i.test(u) ? u : /^[\w-]+(\.[\w-]+)+/.test(u) ? `https://${u}` : null;
  try { return full && new URL(full) ? full : null; } catch { return null; }
}

/** Название области. Одно и то же в карточке слева и в таблице «Из чего складывается». */
const areaTitle = (p: Product, key: 'supplier' | StageKey) => {
  if (key === 'supplier') return p.origin === 'local' ? 'Сырьё' : 'Закупка у поставщика';
  return key === 'purchase' && p.origin === 'local' ? 'Расходы на производство' : STAGE_LABELS[key];
};

function ExpenseList({ p, stage, set, fmt, c }: { p: Product; stage: StageKey; set: (fn: (x: Product) => void) => void; fmt: Fmt; c: P['pc'][string] }) {
  const opts = stage === 'import' ? [...BASIS, VAT_BASIS] : BASIS;
  const upd = (i: number, fn: (e: Product['expenses'][StageKey][number]) => void) => set(x => fn(x.expenses[stage][i]));
  const list = p.expenses[stage];
  return (
    <div className="expense-list">
      {list.length > 0 && (
        <div className="expense-row head">
          <span>Расход</span><span><Tip text={BASIS_TIP}>Как считать</Tip></span><span>Сколько</span><span className="r">Итого</span><span />
        </div>
      )}
      {list.map((e, i) => {
        const r = c.expenses[e.id];
        const pct = PERCENT_BASES.has(e.basis);
        return (
          <div className="expense-row" key={e.id}>
            <input className="input" value={e.name} onChange={ev => upd(i, x => { x.name = ev.target.value; })} />
            <Select value={e.basis} onChange={v => upd(i, x => { x.basis = v; })} options={opts} />
            <Pair>
              <Num value={e.value} onChange={v => upd(i, x => { x.value = v ?? 0; })} />
              {pct ? <Unit>%</Unit> : <CurrencySelect value={e.currency} onChange={v => upd(i, x => { x.currency = v; })} />}
            </Pair>
            <span className={`exp-sum ${r && !r.inCost ? 'struck' : ''}`} title={r && !r.inCost ? 'Этот НДС вернут, в цену товара он не входит' : undefined}>
              {fmt.money(r?.amount ?? 0)}
            </span>
            <Del onClick={() => set(x => { x.expenses[stage].splice(i, 1); })} />
          </div>
        );
      })}
      <button className="btn sm add-btn" onClick={() => set(x => { x.expenses[stage].push({ id: uid(), name: 'Новый расход', basis: 'fixed', value: 0, currency: x.unitCostCurrency }); })}>+ Расход</button>
    </div>
  );
}
