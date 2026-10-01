import { useMemo, useState, type ReactNode } from 'react';
import type { TabProps } from '../App';
import { calcForecast, changePct, rowMetrics, scenarioCount, summarize, type Summary } from '../engine/analytics';
import { isPercentAd } from '../engine/channel';
import type { ProductCalcs } from '../engine/offers';
import { calcStore, forDays, type StoreCalc, type Totals } from '../engine/store';
import type { ChannelScenario } from '../engine/types';
import { Card, Note, Num, Segmented, Th, Tip, type Fmt } from '../ui/kit';

type P = TabProps & { fmt: Fmt; pc: ProductCalcs };

const RANGES = [['day', 'День', 1], ['week', 'Неделя', 7], ['month', 'Месяц', 30]] as const;
type RangeId = (typeof RANGES)[number][0];

const CHANNEL_COLORS = ['var(--ch-1)', 'var(--ch-2)', 'var(--ch-3)', 'var(--ch-4)', 'var(--ch-5)', 'var(--ch-6)'];
const signed = (v: number, text: string) => (v > 1e-9 ? `+${text}` : text);

const VIEWS = [['now', 'Сейчас'], ['forecast', 'Прогноз']] as const;
type ViewId = (typeof VIEWS)[number][0];

export function AnalyticsTab({ db, mutate, fmt, pc }: P) {
  const [range, setRange] = useState<RangeId>('month');
  const [view, setView] = useState<ViewId>('now');
  const days = RANGES.find(r => r[0] === range)![2];
  const base = useMemo(() => calcStore(db, pc), [db, pc]);
  const fc = useMemo(() => calcForecast(db, pc), [db, pc]);
  const forecast = view === 'forecast';
  const calc = forecast && fc ? fc : base;                  // что показываем на экране
  const k = (v: number) => forDays(v, base.period, days);   // сумма за выбранный срок
  const empty = calc.totals.sold <= 0;

  return (
    <div className="layout-2">
      <div className="content">
        <div className="page-head">
          <h2><Tip text={'Картина по плану магазина: что получится за день, неделю или месяц, если всё пойдёт как задумано. Это расчёт, а не учёт фактических продаж.\nСуммы за выбранный срок получаются из плана и его периода (вкладка «Магазин»). Накладные расходы «в месяц» делятся и умножаются так же, как всё остальное.\n«Сейчас»: расчёт по вашим настоящим данным. «Прогноз»: что будет, если изменить цену, рекламу, апрув и другие показатели справа. Настоящие данные при этом не меняются.'}>Аналитика</Tip></h2>
          <div className="head-ctl">
            <Segmented<ViewId> value={view} onChange={setView} options={VIEWS.map(v => [v[0], v[1]] as [ViewId, string])} />
            <Segmented<RangeId> value={range} onChange={setRange} options={RANGES.map(r => [r[0], r[1]] as [RangeId, string])} />
          </div>
        </div>

        {forecast && !fc && <Note tone="info">Прогноз пока пустой, показаны текущие значения. Впишите новые значения справа в колонке «Прогноз», и вся аналитика пересчитается.</Note>}
        {empty && <div className="empty">Продаж в плане пока нет. Впишите план продаж и распределите его по позициям и каналам во вкладке «Магазин».</div>}

        {!empty && <>
          <Kpis calc={calc} compare={forecast && fc ? base : null} k={k} fmt={fmt} />
          <Structure calc={calc} k={k} fmt={fmt} />
          <ByItems calc={calc} k={k} fmt={fmt} />
          <ByChannels calc={calc} k={k} fmt={fmt} />
          <Overhead calc={calc} k={k} fmt={fmt} />
        </>}
      </div>

      <aside className="sidebar an-sidebar">
        <Levers db={db} base={base} mutate={mutate} fmt={fmt} editable={forecast} />
      </aside>
    </div>
  );
}

type SectionProps = { calc: StoreCalc; k: (v: number) => number; fmt: Fmt };

// ---------- главные показатели ----------

function Kpis({ calc, compare, k, fmt }: { calc: StoreCalc; compare: StoreCalc | null; k: (v: number) => number; fmt: Fmt }) {
  const cur = summarize(calc), was = compare && summarize(compare);   // was: текущие значения, с которыми сравнивается прогноз
  const tiles: { key: string; cls?: string; label: string; tip: string; get: (s: Summary) => number; show: (v: number) => string; delta: (v: number) => string }[] = [
    { key: 'revenue', cls: 'c-revenue', label: 'Оборот', tip: 'Деньги за проданные заказы (без НДС, если вы с НДС).', get: s => k(s.revenue), show: fmt.money, delta: fmt.money },
    { key: 'profit', cls: 'c-profit', label: 'Чистая прибыль', tip: 'Что остаётся после товара, рекламы и накладных расходов. Налоги пока не учтены.', get: s => k(s.profit), show: fmt.money, delta: fmt.money },
    { key: 'margin', cls: 'c-profit', label: 'Рентабельность', tip: 'Какую часть оборота составляет чистая прибыль.', get: s => s.profitMargin, show: v => fmt.pct(v), delta: v => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} п.п.` },
    { key: 'sold', label: 'Продано заказов', tip: 'Заказы, которые клиент забрал и оплатил.', get: s => k(s.sold), show: v => v.toLocaleString('ru-RU', { maximumFractionDigits: 1 }), delta: v => v.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) },
    { key: 'perOrder', cls: 'c-profit', label: 'Прибыль с заказа', tip: 'Чистая прибыль, делённая на число проданных заказов.', get: s => s.profitPerOrder, show: fmt.unit, delta: fmt.unit },
  ];
  return (
    <div className="an-kpis">
      {tiles.map(t => {
        const v = t.get(cur), w = was ? t.get(was) : null;
        const d = w === null ? 0 : v - w;
        return (
          <div className={`an-kpi ${t.key === 'profit' ? 'main' : ''}`} key={t.key}>
            <div className="an-kpi-l"><Tip text={t.tip}>{t.label}</Tip></div>
            <div className={`an-kpi-v ${v < 0 ? 'neg' : t.cls ?? ''}`}>{t.show(v)}</div>
            {w !== null && (
              <div className="an-kpi-f">
                <span>сейчас {t.show(w)}</span>
                <span className={`delta ${d > 1e-9 ? 'up' : d < -1e-9 ? 'down' : ''}`}>{Math.abs(d) < 1e-9 ? '=' : signed(d, t.delta(d))}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- куда уходит оборот ----------

const PARTS = [
  { key: 'cogs', label: 'Себестоимость', color: 'var(--c-cogs)', cls: 'c-cogs' },
  { key: 'ads', label: 'Реклама', color: 'var(--c-ads)', cls: 'c-ads' },
  { key: 'overhead', label: 'Накладные', color: 'var(--c-overhead)', cls: 'c-overhead' },
  { key: 'profit', label: 'Чистая прибыль', color: 'var(--c-profit)', cls: 'c-profit' },
] as const;

/** Куда идёт каждая часть оборота: где в полосе начинается и какую долю занимает (в % ширины полосы). */
function stackParts(s: Summary) {
  const costs = s.cogs + s.ads + s.overhead;
  const whole = Math.max(s.revenue, costs, 1e-9);
  const vals: Record<(typeof PARTS)[number]['key'], number> = { cogs: s.cogs, ads: s.ads, overhead: s.overhead, profit: Math.max(0, s.profit) };
  let start = 0;
  return PARTS.map(p => {
    const width = vals[p.key] / whole * 100;
    const part = { ...p, start, width };
    start += width;
    return part;
  });
}

function StackBar({ s }: { s: Summary }) {
  return (
    <div className="stack">
      {stackParts(s).map(p => p.width > 0 && <div key={p.key} className="stack-seg" style={{ width: `${p.width}%`, background: p.color }} title={p.label} />)}
    </div>
  );
}

const LEGEND_GAP = 15;   // минимальное расстояние между подписями в одном ряду, % ширины полосы
const LEGEND_EDGE = 86;  // подпись правее этой точки прижимается к правому краю, чтобы не выйти за карточку

function Structure({ calc, k, fmt }: SectionProps) {
  const s = summarize(calc);
  const vals = { cogs: s.cogs, ads: s.ads, overhead: s.overhead, profit: s.profit };
  // подпись начинается там, где начинается её часть полосы; близкие подписи уходят в следующий ряд
  const lastX: number[] = [];
  const legend = stackParts(s).map(p => {
    const x = Math.min(p.start, LEGEND_EDGE);
    let row = lastX.findIndex(prev => x - prev >= LEGEND_GAP);
    if (row < 0) row = lastX.length < 3 ? lastX.length : 2;
    lastX[row] = x;
    return { ...p, row };
  });
  return (
    <Card ckey="analytics:structure" title="Куда уходит оборот"
      tip={'Оборот разложен на себестоимость, рекламу, накладные расходы и чистую прибыль.\nЕсли расходы больше оборота, чистой прибыли в полосе нет, а в списке она отрицательная.'}
      right={s.profit < 0 ? <span className="tag neg-tag">убыток</span> : undefined}>
      <StackBar s={s} />
      <div className="legend-track" style={{ height: `${(Math.max(...legend.map(l => l.row)) + 1) * 68}px` }}>
        {legend.map(l => (
          <div className="legend-item" key={l.key} style={{ top: `${l.row * 68}px`, ...(l.start > LEGEND_EDGE ? { right: 0 } : { left: `${l.start}%` }) }}>
            <span className="dot" style={{ background: l.color }} />
            <span className="legend-name">{l.label}</span>
            <b className={l.key === 'profit' && vals.profit < 0 ? 'neg' : l.cls}>{fmt.money(k(vals[l.key]))}</b>
            <span className="legend-pct">{s.revenue > 0 ? fmt.pct(vals[l.key] / s.revenue * 100) : ''}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- полосы (накладные расходы) ----------

interface BarRow { name: string; value: number; sub: string }

/** Горизонтальные полосы. Длина считается от самого большого по модулю значения во всех строках. */
function Bars({ rows, fmt }: { rows: BarRow[]; fmt: Fmt }) {
  const max = Math.max(1e-9, ...rows.map(r => Math.abs(r.value)));
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div className="bar-row" key={i}>
          <div className="bar-name" title={r.name}>{r.name}</div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.abs(r.value) / max * 100}%` }} /></div>
          <div className="bar-val">
            <b>{fmt.money(r.value)}</b>
            <span className="cell-sub">{r.sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- разбивка: деньги и качество ----------

interface MRow { key: string; name: ReactNode; t: Totals }

/**
 * Таблица разбивки по позициям или каналам. Деньги (оборот, маржа, реклама, прибыль, прибыль с заказа) и качество:
 * мелко под деньгами их доля в обороте строки.
 * Прибыль здесь до накладных расходов: они не делятся по позициям и каналам.
 */
function MetricsTable({ rows, first, total, k, fmt }: { rows: MRow[]; first: string; total: Totals; k: (v: number) => number; fmt: Fmt }) {
  const ms = rows.map(r => ({ ...r, m: rowMetrics(r.t) }));
  const money = (v: number) => fmt.money(k(v));
  return (
    <div className="table-wrap">
      <table className="table metrics-table">
        <thead><tr>
          <Th>{first}</Th>
          <Th num tip="Деньги за проданные заказы. Мелко: доля в общем обороте.">Оборот</Th>
          <Th num tip={'Оборот минус себестоимость, до рекламы.\nМелко: какую часть оборота это составляет (маржинальность).'}>Маржа</Th>
          <Th num tip={'Реклама и плата каналов.\nМелко: какую часть оборота она съедает.'}>Реклама</Th>
          <Th num tip={'Что остаётся после товара и рекламы, до накладных расходов: они не делятся по позициям и каналам.\nМелко: какую часть оборота это составляет (рентабельность).'}>Прибыль</Th>
          <Th num tip="Прибыль до накладных, делённая на число проданных заказов.">С заказа</Th>
        </tr></thead>
        <tbody>
          {ms.map(r => (
            <tr key={r.key}>
              <td>{r.name}</td>
              <td className="num mcell"><b className="c-revenue">{money(r.m.revenue)}</b><span className="cell-sub">{total.revenue > 0 ? fmt.pct(r.m.revenue / total.revenue * 100) : ''}</span></td>
              <td className="num mcell"><b className="c-margin">{money(r.m.margin)}</b><span className="cell-sub">{r.m.revenue > 0 ? fmt.pct(r.m.marginPct) : ''}</span></td>
              <td className="num mcell"><b className="c-ads">{money(r.m.ads)}</b><span className="cell-sub">{r.m.revenue > 0 ? fmt.pct(r.m.adsPct) : ''}</span></td>
              <td className="num mcell"><b className={r.m.profit < 0 ? 'neg' : 'c-contrib'}>{money(r.m.profit)}</b><span className={`cell-sub ${r.m.profit < 0 ? 'neg' : ''}`}>{r.m.revenue > 0 ? fmt.pct(r.m.profitPct) : ''}</span></td>
              <td className="num mcell"><b className={r.m.perOrder < 0 ? 'neg' : 'c-contrib'}>{fmt.unit(r.m.perOrder)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ByItems({ calc, k, fmt }: SectionProps) {
  const rows: MRow[] = calc.items.map(x => ({ key: x.item.id, name: x.offer?.name ?? 'удалено', t: x.totals }))
    .sort((a, b) => b.t.contribution - a.t.contribution);
  return (
    <Card ckey="analytics:items" title="Прибыльность по позициям"
      tip={'Каждая позиция в деньгах и в процентах от её оборота: маржинальность, доля рекламы, рентабельность. Так видно не только, сколько позиция приносит, но и насколько она выгодна.'}>
      {rows.length ? <MetricsTable rows={rows} first="Позиция" total={calc.totals} k={k} fmt={fmt} /> : <div className="empty">Позиций в плане нет.</div>}
    </Card>
  );
}

function Donut({ parts, total, label }: { parts: { value: number; color: string }[]; total: string; label: string }) {
  const R = 52, C = 2 * Math.PI * R, sum = parts.reduce((a, p) => a + p.value, 0);
  let offset = 0;
  return (
    <svg className="donut" viewBox="0 0 140 140" role="img" aria-label={label}>
      <circle cx="70" cy="70" r={R} fill="none" stroke="var(--line-soft)" strokeWidth="16" />
      {sum > 0 && parts.map((p, i) => {
        const len = p.value / sum * C;
        const el = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={p.color} strokeWidth="16"
          strokeDasharray={`${Math.max(0, len - 1.5)} ${C - Math.max(0, len - 1.5)}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />;
        offset += len;
        return el;
      })}
      <text x="70" y="66" textAnchor="middle" className="donut-v">{total}</text>
      <text x="70" y="84" textAnchor="middle" className="donut-l">{label}</text>
    </svg>
  );
}

function ByChannels({ calc, k, fmt }: SectionProps) {
  const list = calc.channels.map((c, i) => ({ c, color: CHANNEL_COLORS[i % CHANNEL_COLORS.length] })).filter(r => r.c.totals.placed > 0);
  const rows: MRow[] = list.map(r => ({
    key: r.c.channel.id, t: r.c.totals,
    name: <><span className="dot" style={{ background: r.color }} />{r.c.channel.name}{isPercentAd(r.c.channel) && <span className="th-sub inline"> процент</span>}</>,
  }));
  return (
    <Card ckey="analytics:channels" title="Каналы продаж"
      tip={'Откуда приходят деньги и сколько стоит привлечение. Кольцо показывает долю канала в обороте.\nВ таблице деньги и проценты от оборота канала: сколько съедает реклама, какая маржинальность и рентабельность. Прибыль до накладных расходов, потому что они не делятся по каналам.'}>
      {list.length === 0 ? <div className="empty">Ни один канал в плане не продаёт.</div> : (
        <div className="channels-grid">
          <Donut parts={list.map(r => ({ value: r.c.totals.revenue, color: r.color }))} total={fmt.money(k(calc.totals.revenue))} label="оборот" />
          <MetricsTable rows={rows} first="Канал" total={calc.totals} k={k} fmt={fmt} />
        </div>
      )}
    </Card>
  );
}

// ---------- накладные расходы ----------

function Overhead({ calc, k, fmt }: SectionProps) {
  const rows: BarRow[] = calc.overheadLines.map(l => ({
    name: l.line.name, value: k(l.amount), sub: calc.overhead > 0 ? fmt.pct(l.amount / calc.overhead * 100, 0) : '',
  })).sort((a, b) => b.value - a.value);
  return (
    <Card ckey="analytics:overhead" title="Накладные расходы"
      tip="Из чего складываются накладные расходы за выбранный срок. Мелко под суммой: доля расхода в накладных."
      right={<span className="share-left">всего {fmt.money(k(calc.overhead))}</span>}>
      {rows.length ? <Bars rows={rows} fmt={fmt} /> : <div className="empty">Накладных расходов нет. Их можно добавить во вкладке «Магазин».</div>}
    </Card>
  );
}

// ---------- справа: что можно менять ----------

function Lever({ label, tip, now, show, value, onChange, suffix, bounds, editable }: {
  label: string; tip?: string; now: number; show: (v: number) => string; value: number | undefined; onChange: (v: number | null) => void; suffix?: string; bounds?: [number, number]; editable: boolean;
}) {
  const change = value === undefined ? null : changePct(now, value);
  return (
    <div className={`lever ${editable ? '' : 'plain'} ${editable && value !== undefined ? 'set' : ''}`}>
      <span className="lever-l"><Tip text={tip}>{label}</Tip></span>
      <span className="lever-cur">{show(now)}</span>
      {editable && <><div className="lever-in"><Num value={value ?? null} placeholder="—" onChange={onChange} suffix={suffix} bounds={bounds} /></div>
      <span className="lever-d">
        {value === undefined ? '' : change === null ? '—' : Math.abs(change) < 0.05 ? '0%' : `${change > 0 ? '+' : '−'}${Math.abs(change).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`}
      </span></>}
    </div>
  );
}

function Levers({ db, base, mutate, fmt, editable }: { db: P['db']; base: StoreCalc; mutate: P['mutate']; fmt: Fmt; editable: boolean }) {
  const sc = db.scenario;
  const count = scenarioCount(sc);
  const pct: [number, number] = [0, 100];

  const setSales = (v: number | null) => mutate(d => {
    const s = (d.scenario ??= {});
    if (v === null) delete s.sales; else s.sales = v;
  });
  const setChannel = (id: string, key: keyof ChannelScenario, v: number | null) => mutate(d => {
    const o = (((d.scenario ??= {}).channels ??= {})[id] ??= {});
    if (v === null) delete o[key]; else o[key] = v;
  });
  const setOffer = (ref: string, key: 'price' | 'unitCost', v: number | null) => mutate(d => {
    const o = (((d.scenario ??= {}).offers ??= {})[ref] ??= {});
    if (v === null) delete o[key]; else o[key] = v;
  });

  const items = base.items.filter(x => x.offer);
  return (
    <Card ckey="analytics:levers" title={editable ? 'Что можно менять' : 'Показатели'}
      tip={editable
        ? 'Главные показатели, на которые вы влияете. В колонке «Сейчас» настоящее значение из ваших данных, оно не меняется.\nВ колонке «Прогноз» впишите, каким оно может стать: вся аналитика слева пересчитается. Пустое поле значит «как сейчас».\nКнопка «Сбросить» очищает прогноз целиком.'
        : 'Главные показатели, на которые вы влияете, с их настоящими значениями. Чтобы прикинуть, что будет при других значениях, переключитесь на «Прогноз» вверху страницы.'}
      right={editable && count > 0 ? <button className="btn ghost" onClick={() => mutate(d => { delete d.scenario; })}>Сбросить · {count}</button> : undefined}>
      <div className={`lever head ${editable ? '' : 'plain'}`}><span>Показатель</span><span className="r">Сейчас</span>{editable && <><span className="r">Прогноз</span><span className="r">Изменение</span></>}</div>
      <div className="lever-scroll">
        <div className="lever-box">
          <div className="lever-group">План</div>
          <Lever editable={editable} label="Продаж за период" tip="Сколько заказов продаётся за период плана." now={db.store.sales} show={fmt.int} value={sc?.sales}
            onChange={setSales} suffix="шт." />
        </div>

        {db.channels.map(c => {
          const v = sc?.channels?.[c.id] ?? {};
          const percent = isPercentAd(c);
          const set = (key: keyof ChannelScenario) => (x: number | null) => setChannel(c.id, key, x);
          return (
            <div className="lever-box" key={c.id}>
              <div className="lever-group">{c.name}</div>
              {c.adMode === 'funnel' ? <>
                <Lever editable={editable} label="CPM" tip="Цена за 1000 показов рекламы." now={c.cpm} show={fmt.precise} value={v.cpm} onChange={set('cpm')} suffix={fmt.sym} />
                <Lever editable={editable} label="CTR" tip="Сколько процентов увидевших рекламу нажимают на неё." now={c.ctr} show={fmt.pct} value={v.ctr} onChange={set('ctr')} suffix="%" bounds={pct} />
                <Lever editable={editable} label="Конверсия" tip="Сколько процентов зашедших на сайт оформляют заказ." now={c.cr} show={fmt.pct} value={v.cr} onChange={set('cr')} suffix="%" bounds={pct} />
              </> : percent ? (
                <Lever editable={editable} label="Процент" tip="Процент от оборота, который забирает канал." now={c.cpaPercent ?? 0} show={fmt.pct} value={v.cpaPercent} onChange={set('cpaPercent')} suffix="%" bounds={pct} />
              ) : (
                <Lever editable={editable} label="Реклама за заказ" tip="Сколько стоит один оформленный заказ." now={c.cpa} show={fmt.unit} value={v.cpa} onChange={set('cpa')} suffix={fmt.sym} />
              )}
              {!percent && <>
                <Lever editable={editable} label="Апрув" tip="Какая часть заказов подтверждается." now={c.approve ?? 100} show={fmt.pct} value={v.approve} onChange={set('approve')} suffix="%" bounds={pct} />
                <Lever editable={editable} label="Выкуп" tip="Какая часть посылок забирается клиентами." now={c.buyout ?? 100} show={fmt.pct} value={v.buyout} onChange={set('buyout')} suffix="%" bounds={pct} />
              </>}
            </div>
          );
        })}

        {items.map(x => {
          const ref = x.item.offer, v = db.scenario?.offers?.[ref] ?? {};
          return (
            <div className="lever-box" key={x.item.id}>
              <div className="lever-group">{x.offer!.name}</div>
              <Lever editable={editable} label="Цена" tip="Цена продажи за штуку." now={x.offer!.price} show={fmt.unit} value={v.price} onChange={n => setOffer(ref, 'price', n)} suffix={fmt.sym} />
              <Lever editable={editable} label="Себестоимость" tip="Во сколько обходится одна штука." now={x.offer!.unitCost} show={fmt.unit} value={v.unitCost} onChange={n => setOffer(ref, 'unitCost', n)} suffix={fmt.sym} />
            </div>
          );
        })}
        {!db.channels.length && !items.length && <div className="empty">Добавьте каналы и позиции, и здесь появятся показатели.</div>}
      </div>
    </Card>
  );
}
