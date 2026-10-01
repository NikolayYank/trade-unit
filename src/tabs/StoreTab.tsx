import { useMemo } from 'react';
import type { TabProps } from '../App';
import { allOffers, type ProductCalcs } from '../engine/offers';
import { calcStore, margin, perDay, type Totals } from '../engine/store';
import { uid } from '../engine/taxPresets';
import type { OverheadKind, PlanItem } from '../engine/types';
import { Card, CurrencySelect, Del, GroupedInt, Note, Num, Pair, Select, Th, Tip, Unit, type Fmt } from '../ui/kit';

type P = TabProps & { fmt: Fmt; pc: ProductCalcs };
type MetricColor = 'revenue' | 'cogs' | 'ads' | 'overhead' | 'margin' | 'profit';

const OVERHEAD_KINDS: [OverheadKind, string][] = [['fixed', 'сумма в месяц'], ['percent', '% от оборота'], ['perUnit', 'за штуку']];
const sumOther = <T,>(list: T[], i: number, get: (x: T) => number) => list.reduce((a, x, k) => a + (k === i ? 0 : get(x)), 0);

export function StoreTab({ db, mutate, fmt, pc }: P) {
  const r = useMemo(() => calcStore(db, pc), [db, pc]);
  const offers = useMemo(() => allOffers(db, pc), [db, pc]);
  const st = db.store;
  const vat = db.settings.tax.vatPayer;
  const items = st.items;
  const remaining = Math.max(0, 100 - r.itemsShare);

  // позиции, которые ещё не в плане, плюс текущая
  const optionsFor = (item: PlanItem): [string, string][] => offers
    .filter(o => o.ref === item.offer || !items.some(i => i.offer === o.ref))
    .map(o => [o.ref, o.kind === 'kit' ? `${o.name} · набор` : o.name]);
  const free = offers.filter(o => !items.some(i => i.offer === o.ref));

  const addItem = () => mutate(d => {
    if (!free[0]) return;
    d.store.items.push({ id: uid(), offer: free[0].ref, share: 0, channels: [] });
  });
  const setItem = (i: number, fn: (x: PlanItem) => void) => mutate(d => fn(d.store.items[i]));
  const setChannelShare = (i: number, channelId: string, v: number) => setItem(i, it => {
    const ex = it.channels.find(c => c.channelId === channelId);
    if (ex) ex.share = v; else it.channels.push({ channelId, share: v });
  });
  const channelShare = (it: PlanItem, channelId: string) => it.channels.find(c => c.channelId === channelId)?.share ?? 0;

  const T = r.totals;
  const pctOfRevenue = (v: number) => (T.revenue > 0 ? fmt.pct(v / T.revenue * 100) : '');
  const day = (v: number) => perDay(v, r.period);
  const line = (label: React.ReactNode, v: number, cls = '', color: MetricColor = 'revenue') => {
    const c = `c-${color}${color === 'profit' && v < 0 ? ' neg' : ''}`;
    return <tr className={cls}><td>{label}</td><td className={`num ${c}`}>{fmt.money(v)}</td><td className={`num day ${c}`}>{fmt.money(day(v))}</td><td className="num muted">{pctOfRevenue(v)}</td></tr>;
  };

  // деньги и под ними мелко процент: у оборота от общего оборота, у остальных от оборота своей строки
  const sub = (v: number, base: number) => <span className="cell-sub">{base > 0 ? fmt.pct(v / base * 100) : ''}</span>;
  const resultCells = (t: Totals, total: number) => (
    <>
      <td className="num"><span className="c-revenue">{fmt.money(t.revenue)}</span>{sub(t.revenue, total)}</td>
      <td className="num"><span className="c-cogs">{fmt.money(t.cogs)}</span>{sub(t.cogs, t.revenue)}</td>
      <td className="num"><span className="c-ads">{fmt.money(t.ads)}</span>{sub(t.ads, t.revenue)}</td>
      <td className="num"><span className="c-margin">{fmt.money(margin(t))}</span>{sub(margin(t), t.revenue)}</td>
      <td className="num"><b className={t.contribution < 0 ? 'neg' : 'c-profit'}>{fmt.money(t.contribution)}</b>{sub(t.contribution, t.revenue)}</td>
    </>
  );

  const notes: ['warn' | 'info', string][] = [];
  if (!r.sales) notes.push(['info', 'Впишите план продаж: сколько заказов вы хотите продать за месяц.']);
  if (!db.channels.length) notes.push(['info', 'Нет каналов продаж. Добавьте их во вкладке «Каналы продаж».']);
  if (!offers.length) notes.push(['info', 'Нет товаров. Добавьте их во вкладке «Товары».']);
  if (items.length && r.itemsShare < 100) notes.push(['info', `Распределено ${fmt.pct(r.itemsShare, 0)} плана. Остальное ${fmt.pct(remaining, 0)} не продаётся и в расчёт не входит.`]);
  r.items.forEach(x => {
    const name = x.offer?.name ?? 'удалённая позиция';
    if (!x.offer) notes.push(['warn', `Товар или набор удалён, позиция «${name}» не считается. Уберите её из плана.`]);
    if (x.blocked.length) notes.push(['warn', `«${name}»: через ${x.blocked.map(id => `«${db.channels.find(c => c.id === id)?.name}»`).join(', ')} ничего не продать: апрув или выкуп равен нулю.`]);
    if (x.offer && x.item.share > 0 && x.channelsShare < 100) notes.push(['info', `«${name}»: по каналам распределено ${fmt.pct(x.channelsShare, 0)}, остальное не продаётся.`]);
  });

  return (
    <div className="layout-2">
      <div className="content">
        <Card ckey="store:items" step="1" title="Что продаём и где"
          tip={'Каждая строка — товар или набор. Впишите, какая доля всех продаж приходится на него, и как эта доля делится между каналами.\nСумма долей позиций не может быть больше 100%, сумма долей каналов в строке тоже. Больше вписать не получится.'}
          right={items.length > 0 ? <span className={`share-left ${remaining === 0 ? 'done' : ''}`}>{remaining === 0 ? 'Распределено 100%' : `Осталось ${fmt.pct(remaining, 0)}`}</span> : undefined}>
          <div className="table-wrap">
            <table className="table store-items">
              <thead><tr>
                <Th>Позиция</Th>
                <Th num tip="Какая часть всех продаж плана приходится на эту позицию.">Доля, %</Th>
                <Th num tip="Цена продажи за штуку. Не редактируется: это цена розницы из карточки товара или цена набора. Чтобы изменить, поменяйте её во вкладке «Товары» или «Наборы».">Цена</Th>
                {db.channels.map(c => <th key={c.id} className="num ch-head-cell" title={c.name}>{c.name}<span className="th-sub">%</span></th>)}
                <Th num tip="Сколько процентов продаж позиции распределено по каналам. Должно быть 100%, иначе остаток не продаётся.">Каналов</Th>
                <th />
              </tr></thead>
              <tbody>
                {items.map((it, i) => {
                  const res = r.items[i];
                  return (
                    <tr key={it.id}>
                      <td className="w-offer"><Select value={it.offer} onChange={v => setItem(i, x => { x.offer = v as PlanItem['offer']; })}
                        options={res.offer ? optionsFor(it) : [[it.offer, 'удалено'], ...optionsFor(it)]} /></td>
                      <td className="num w-pct"><Num bounds={[0, 100 - sumOther(items, i, x => x.share)]} value={it.share} step={1} onChange={v => setItem(i, x => { x.share = v ?? 0; })} /></td>
                      <td className="num w-price">{res.offer ? fmt.unit(res.price) : ''}</td>
                      {db.channels.map(c => (
                        <td key={c.id} className="num w-pct">
                          <Num bounds={[0, 100 - it.channels.filter(x => x.channelId !== c.id).reduce((a, x) => a + x.share, 0)]} value={channelShare(it, c.id)} step={1} onChange={v => setChannelShare(i, c.id, v ?? 0)} />
                        </td>
                      ))}
                      <td className={`num ch-sum ${it.share > 0 && res.channelsShare < 100 ? 'warn' : ''}`}>{fmt.pct(res.channelsShare, 0)}</td>
                      <td className="w-del"><Del onClick={() => mutate(d => { d.store.items.splice(i, 1); })} /></td>
                    </tr>
                  );
                })}
              </tbody>
              {items.length > 0 && <tfoot><tr>
                <td>Итого</td><td className="num">{fmt.pct(r.itemsShare, 0)}</td><td colSpan={db.channels.length + 3} />
              </tr></tfoot>}
            </table>
          </div>
          {!items.length && <div className="empty">Позиций пока нет. Добавьте первую: товар или набор, которые вы продаёте.</div>}
          <button className="add-row" onClick={addItem} disabled={!free.length || !db.channels.length}>+ Позиция</button>
        </Card>

        <Card ckey="store:results" step="2" title="Что получается по позициям"
          tip="Для каждой позиции: сколько заказов продано, оборот, во сколько обошёлся товар, сколько ушло на рекламу и сколько осталось до накладных расходов.">
          <div className="table-wrap">
            <table className="table results">
              <thead><tr>
                <Th>Позиция</Th><Th num>Продано</Th><Th num tip={vat ? 'Выручка без НДС. Под суммой доля позиции в общем обороте.' : 'Под суммой доля позиции в общем обороте.'}>Оборот</Th>
                <Th num tip="Во сколько обошёлся проданный товар. Под суммой процент от оборота позиции.">Себестоимость</Th>
                <Th num tip="Реклама и плата каналов, например процент маркетплейса. Под суммой процент от оборота позиции.">Реклама</Th>
                <Th num tip={'Оборот минус себестоимость: сколько остаётся с продажи до рекламы.\nПод суммой процент от оборота позиции.'}>Маржа</Th>
                <Th num tip={'Сколько остаётся после товара и рекламы.\nНакладные расходы ещё не вычтены. Под суммой процент от оборота позиции.'}>Прибыль</Th>
              </tr></thead>
              <tbody>
                {r.items.map(x => (
                  <tr key={x.item.id}>
                    <td>{x.offer ? x.offer.name : <span className="muted">удалено</span>}</td>
                    <td className="num">{fmt.int(x.totals.sold)}</td>
                    {resultCells(x.totals, T.revenue)}
                  </tr>
                ))}
              </tbody>
              {items.length > 0 && <tfoot><tr>
                <td>Итого</td><td className="num">{fmt.int(T.sold)}</td>
                {resultCells(T, T.revenue)}
              </tr></tfoot>}
            </table>
          </div>
        </Card>

        <Card ckey="store:overhead" step="3" title="Накладные расходы"
          tip={'Всё, что вы тратите кроме товара и рекламы: доставка, упаковка, хранение, зарплаты, сервисы, бухгалтер, комиссии, возвраты.\nКак считать каждый расход:\nСумма в месяц: одна сумма за весь месяц, например аренда склада.\n% от оборота: процент от оборота (выручка без НДС, если вы с НДС), например эквайринг.\nЗа штуку: сумма за каждую проданную штуку, например курьер или хранение одной единицы. Умножается на число проданных заказов.'}>
          <div className="expense-list">
            {st.overhead.length > 0 && (
              <div className="expense-row ovh head">
                <span>Расход</span><span>Как считать</span><span>Сколько</span><span className="r">За месяц</span><span className="r">На заказ</span><span />
              </div>
            )}
            {st.overhead.map((o, i) => {
              const kind = o.kind ?? 'fixed';
              return (
                <div className="expense-row ovh" key={o.id}>
                  <input className="input" value={o.name} onChange={e => mutate(d => { d.store.overhead[i].name = e.target.value; })} />
                  <Select value={kind} options={OVERHEAD_KINDS} onChange={v => mutate(d => { d.store.overhead[i].kind = v; })} />
                  <Pair>
                    {kind === 'percent'
                      ? <Num value={o.percent ?? 0} step={0.1} onChange={v => mutate(d => { d.store.overhead[i].percent = v ?? 0; })} />
                      : <Num value={o.amount} onChange={v => mutate(d => { d.store.overhead[i].amount = v ?? 0; })} />}
                    {kind === 'percent' ? <Unit>%</Unit> : <CurrencySelect value={o.currency} onChange={v => mutate(d => { d.store.overhead[i].currency = v; })} />}
                  </Pair>
                  <span className="exp-sum">{fmt.money(r.overheadLines[i]?.amount ?? 0)}</span>
                  <span className="exp-sum">{fmt.unit(r.overheadLines[i]?.perOrder ?? 0)}</span>
                  <Del onClick={() => mutate(d => { d.store.overhead.splice(i, 1); })} />
                </div>
              );
            })}
            <button className="add-row" onClick={() => mutate(d => { d.store.overhead.push({ id: uid(), name: 'Новый расход', kind: 'fixed', amount: 0, currency: d.settings.baseCurrency }); })}>+ Расход</button>
          </div>
        </Card>
      </div>

      <aside className="sidebar">
        <Card ckey="store:summary" title="Итог месяца" className="summary-card">
          <div className="plan-line">
            <div className="plan-cell">
              <span className="label"><Tip text={'Сколько заказов вы хотите продать за период. Считаются проданные заказы, то есть те, что клиент забрал и оплатил.\nДальше эти продажи делятся по позициям и каналам.'}>План продаж</Tip></span>
              <GroupedInt value={st.sales} placeholder="0" onChange={v => mutate(d => { d.store.sales = v ?? 0; })} suffix="шт." />
            </div>
            <div className="plan-cell">
              <span className="label"><Tip text={'За сколько дней рассчитан план. По умолчанию 30.\nПока только запоминается: понадобится, чтобы показать расходы и прибыль в пересчёте на один день.'}>Период</Tip></span>
              <GroupedInt value={st.period} placeholder="30" onChange={v => mutate(d => { d.store.period = v ?? 0; })} suffix="дн." />
            </div>
          </div>
          <div className="hero">
            <div className="label"><Tip text="Что остаётся после товара, рекламы и накладных расходов. Налоги пока не учтены.">Чистая прибыль</Tip></div>
            <div className={`value ${r.profitAfterOverhead < 0 ? 'neg' : ''}`}>{fmt.money(r.profitAfterOverhead)}</div>
            <div className="hero-badges">
              <span className={`hero-badge ${r.profitAfterOverhead < 0 ? 'neg' : ''}`}>{fmt.money(day(r.profitAfterOverhead))} в день</span>
              {T.revenue > 0 && <span className={`hero-badge soft ${r.profitAfterOverhead < 0 ? 'neg' : ''}`}>{fmt.pct(r.profitAfterOverhead / T.revenue * 100)} от оборота</span>}
            </div>
          </div>
          <table className="table pnl">
            <thead><tr><th /><th className="num">Всего</th><th className="num">В день</th><th className="num">%</th></tr></thead>
            <tbody>
              <tr className="muted"><td>Продано заказов</td><td className="num">{fmt.int(T.sold)}</td><td className="num day">{day(T.sold).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}</td><td /></tr>
              {line(vat ? 'Оборот без НДС' : 'Оборот', T.revenue, 'strong')}
              {line('Себестоимость', -T.cogs, '', 'cogs')}
              {line('Реклама', -T.ads, '', 'ads')}
              {line(<Tip text="Сколько остаётся после товара и рекламы. Накладные расходы ещё не вычтены.">Прибыль до накладных</Tip>, T.contribution, 'strong', 'profit')}
              {line('Накладные расходы', -r.overhead, '', 'overhead')}
              {line('Чистая прибыль', r.profitAfterOverhead, 'total', 'profit')}
            </tbody>
          </table>
        </Card>

        {notes.length > 0 && (
          <Card ckey="store:checks" title="На что обратить внимание">
            <div className="notes">{notes.map(([tone, text], i) => <Note key={i} tone={tone}>{text}</Note>)}</div>
          </Card>
        )}
      </aside>
    </div>
  );
}
