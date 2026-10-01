import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TabProps } from '../App';
import { calcForecast, changePct, profitEffect, rangeDays, rowMetrics, scenarioCount, summarize, UNIT_DAYS, type RangeUnit, type Summary } from '../engine/analytics';
import { isPercentAd } from '../engine/channel';
import { SYMBOLS } from '../engine/money';
import type { ProductCalcs } from '../engine/offers';
import { calcStore, forDays, type StoreCalc, type Totals } from '../engine/store';
import type { ChannelScenario, Scenario } from '../engine/types';
import { Card, GroupedInt, Note, Num, Segmented, Select, Th, Tip, type Fmt } from '../ui/kit';

type P = TabProps & { fmt: Fmt; pc: ProductCalcs };

const RANGES = [['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц']] as const;
type RangeId = (typeof RANGES)[number][0] | 'custom';
const UNITS: [RangeUnit, string][] = [['day', 'дней'], ['week', 'недель'], ['month', 'месяцев']];
const UNIT_SHORT: Record<RangeUnit, string> = { day: 'дн.', week: 'нед.', month: 'мес.' };
interface Custom { count: number | null; unit: RangeUnit }

/** Переключатель срока: день, неделя, месяц или свой. «Свой» открывает окно, где вписывается число и выбирается единица. */
function RangePicker({ range, setRange, custom, setCustom }: { range: RangeId; setRange: (r: RangeId) => void; custom: Custom; setCustom: (c: Custom) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const customLabel = range === 'custom' ? `${Math.max(1, custom.count ?? 1)} ${UNIT_SHORT[custom.unit]}` : 'Свой';
  return (
    <div className="range-wrap" ref={box}>
      <Segmented<RangeId> value={range} onChange={v => { setRange(v); if (v === 'custom') setOpen(true); else setOpen(false); }}
        options={[...RANGES.map(r => [r[0], r[1]] as [RangeId, string]), ['custom', customLabel]]} />
      {open && (
        <div className="range-pop" role="dialog" aria-label="Свой срок">
          <div className="range-pop-title">Свой срок</div>
          <div className="range-pop-row">
            <GroupedInt value={custom.count} placeholder="1" maxDigits={3} onChange={v => setCustom({ ...custom, count: v })} />
            <Select<RangeUnit> value={custom.unit} options={UNITS} onChange={u => setCustom({ ...custom, unit: u })} />
          </div>
          <div className="range-pop-hint">{`Это ${rangeDays(custom.count ?? 1, custom.unit)} дн. Месяц считается как 30 дней.`}</div>
          <button className="btn sm primary" onClick={() => setOpen(false)}>Готово</button>
        </div>
      )}
    </div>
  );
}

const CHANNEL_COLORS = ['var(--ch-1)', 'var(--ch-2)', 'var(--ch-3)', 'var(--ch-4)', 'var(--ch-5)', 'var(--ch-6)'];

const VIEWS = [['now', 'Сейчас'], ['forecast', 'Прогноз']] as const;
type ViewId = (typeof VIEWS)[number][0];

export function AnalyticsTab({ db, mutate, fmt, pc }: P) {
  const [range, setRange] = useState<RangeId>('month');
  const [custom, setCustom] = useState<Custom>({ count: 2, unit: 'week' });   // свой срок, пока не изменён: 2 недели
  const [view, setView] = useState<ViewId>('now');
  const days = range === 'custom' ? rangeDays(custom.count ?? 1, custom.unit) : UNIT_DAYS[range];
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
          <h2><Tip text={'Картина по плану магазина: что получится за день, неделю, месяц или свой срок, если всё пойдёт как задумано. Это расчёт, а не учёт фактических продаж.\nСуммы за выбранный срок получаются из плана и его периода (вкладка «Магазин»). Накладные расходы «в месяц» делятся и умножаются так же, как всё остальное.\n«Сейчас»: расчёт по вашим настоящим данным. «Прогноз»: что будет, если изменить цену, рекламу, апрув и другие показатели справа. Настоящие данные при этом не меняются.'}>Аналитика</Tip></h2>
          <div className="head-ctl">
            <Segmented<ViewId> value={view} onChange={setView} options={VIEWS.map(v => [v[0], v[1]] as [ViewId, string])} />
            <RangePicker range={range} setRange={setRange} custom={custom} setCustom={setCustom} />
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
        <Levers db={db} pc={pc} base={base} mutate={mutate} fmt={fmt} editable={forecast} />
      </aside>
    </div>
  );
}

type SectionProps = { calc: StoreCalc; k: (v: number) => number; fmt: Fmt };

// ---------- главные показатели ----------

function Kpis({ calc, compare, k, fmt }: { calc: StoreCalc; compare: StoreCalc | null; k: (v: number) => number; fmt: Fmt }) {
  const cur = summarize(calc), was = compare && summarize(compare);   // was: текущие значения, с которыми сравнивается прогноз
  const dec = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  interface Tile { key: string; kind: 'money' | 'pct' | 'x' | 'num'; cls?: string; label: string; tip: string; get: (s: Summary) => number | null; show: (v: number) => string; lowerIsBetter?: boolean }
  // порядок: сначала продажи, затем затраты и эффективность, затем результат
  const tiles: Tile[] = [
    { key: 'revenue', kind: 'money', cls: 'c-revenue', label: 'Оборот', tip: 'Деньги за проданные заказы (без НДС, если вы с НДС).', get: s => k(s.revenue), show: fmt.money },
    { key: 'sold', kind: 'num', label: 'Продано заказов', tip: 'Заказы, которые клиент забрал и оплатил.', get: s => k(s.sold), show: dec },
    { key: 'check', kind: 'money', cls: 'c-revenue', label: 'Средний чек', tip: 'Оборот, делённый на число проданных заказов: сколько в среднем приносит один заказ.', get: s => s.avgCheck, show: fmt.unit },
    { key: 'margin', kind: 'pct', cls: 'c-margin', label: 'Маржинальность', tip: 'Какую часть оборота остаётся после себестоимости товара, до рекламы и накладных расходов.', get: s => s.marginPct, show: v => fmt.pct(v) },
    { key: 'adReturn', kind: 'x', cls: 'c-ads', label: 'Отдача рекламы', tip: 'Сколько прибыли до накладных (оборот минус себестоимость минус реклама) приносит каждая единица рекламы. «€2 на €1» значит: каждый €1 рекламы вернулся и принёс ещё €2. Ноль: реклама только окупилась. Меньше нуля: реклама убыточна.', get: s => s.adReturn, show: v => `${v < 0 ? '−' : ''}${fmt.sym}${dec(Math.abs(v))} на ${fmt.sym}1` },
    { key: 'overhead', kind: 'money', cls: 'c-overhead', label: 'Накладные расходы', tip: 'Все накладные расходы за срок, вместе с налогами.', get: s => k(s.overhead), show: fmt.money, lowerIsBetter: true },
    { key: 'profit', kind: 'money', cls: 'c-profit', label: 'Чистая прибыль', tip: 'Что остаётся после товара, рекламы и накладных расходов, включая налоги.', get: s => k(s.profit), show: fmt.money },
    { key: 'profitMargin', kind: 'pct', cls: 'c-profit', label: 'Рентабельность', tip: 'Какую часть оборота составляет чистая прибыль.', get: s => s.profitMargin, show: v => fmt.pct(v) },
    { key: 'perOrder', kind: 'money', cls: 'c-profit', label: 'Прибыль с заказа', tip: 'Чистая прибыль, делённая на число проданных заказов.', get: s => s.profitPerOrder, show: fmt.unit },
    { key: 'roi', kind: 'pct', cls: 'c-profit', label: 'Окупаемость затрат', tip: 'Сколько чистой прибыли приносит каждый вложенный рубль затрат (себестоимость, реклама, накладные). 50% значит: на каждые 100 затрат получается 50 чистой прибыли.', get: s => s.roi, show: v => fmt.pct(v) },
  ];
  /** Разница прогноза и текущего значения: у процентов просто плюс или минус столько-то процентов, у денег и чисел сама разница. */
  const diff = (t: Tile, d: number) => {
    const sign = d > 0 ? '+' : '−', a = Math.abs(d);
    return t.kind === 'money' ? `${sign}${t.show(a)}` : t.kind === 'pct' ? `${sign}${dec(a)}%` : t.kind === 'x' ? `${sign}${fmt.sym}${dec(a)}` : `${sign}${dec(a)}`;
  };
  return (
    <div className="an-kpis">
      {tiles.map(t => {
        const v = t.get(cur), w = was ? t.get(was) : null;
        const d = v !== null && w !== null ? v - w : 0;
        const good = t.lowerIsBetter ? d < -1e-9 : d > 1e-9, bad = t.lowerIsBetter ? d > 1e-9 : d < -1e-9;
        return (
          <div className={`an-kpi ${t.key === 'profit' ? 'main' : ''}`} key={t.key}>
            <div className="an-kpi-l"><Tip text={t.tip}>{t.label}</Tip></div>
            <div className={`an-kpi-v ${v !== null && v < 0 ? 'neg' : t.cls ?? ''}`}>{v === null ? '—' : t.show(v)}</div>
            {was && (
              <>
                <div className="an-kpi-was">сейчас {w === null ? '—' : t.show(w)}</div>
                <div className="an-kpi-d"><span className={`delta ${good ? 'up' : bad ? 'down' : ''}`}>{v === null || w === null ? '—' : Math.abs(d) < 1e-9 ? 'без изменений' : diff(t, d)}</span></div>
              </>
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
          <Th num tip="Деньги за проданные заказы. Мелко: доля в общем обороте."><span className="c-revenue">Оборот</span></Th>
          <Th num tip={'Оборот минус себестоимость, до рекламы.\nМелко: какую часть оборота это составляет (маржинальность).'}><span className="c-margin">Маржа</span></Th>
          <Th num tip={'Реклама и плата каналов.\nМелко: какую часть оборота она съедает.'}><span className="c-ads">Реклама</span></Th>
          <Th num tip={'Что остаётся после товара и рекламы, до накладных расходов: они не делятся по позициям и каналам.\nМелко: какую часть оборота это составляет (рентабельность).'}><span className="c-contrib">Прибыль</span></Th>
          <Th num tip="Прибыль до накладных, делённая на число проданных заказов."><span className="c-contrib">С заказа</span></Th>
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
  const rows: BarRow[] = [
    ...calc.overheadLines.map(l => ({ name: l.line.name, amount: l.amount })),
    ...calc.taxLines.map(t => ({ name: `${t.line.name} (налог)`, amount: t.amount })),
  ].map(l => ({ name: l.name, value: k(l.amount), sub: calc.overhead > 0 ? fmt.pct(l.amount / calc.overhead * 100, 0) : '' })).sort((a, b) => b.value - a.value);
  return (
    <Card ckey="analytics:overhead" title="Накладные расходы"
      tip="Из чего складываются накладные расходы за выбранный срок, вместе с налогами. Мелко под суммой: доля расхода в накладных."
      right={<span className="share-left">всего {fmt.money(k(calc.overhead))}</span>}>
      {rows.length ? <Bars rows={rows} fmt={fmt} /> : <div className="empty">Накладных расходов нет. Их можно добавить во вкладке «Магазин».</div>}
    </Card>
  );
}

// ---------- справа: что можно менять ----------

/** Что именно меняет рычаг: нужно, чтобы понять, выгодно ли это изменение. */
type LeverScope =
  | { k: 'sales' }
  | { k: 'channel'; id: string; key: keyof ChannelScenario }
  | { k: 'offer'; ref: string; key: 'price' | 'unitCost' }
  | { k: 'overhead'; id: string; key: 'amount' | 'percent' };

const scenarioOf = (s: LeverScope, v: number): Scenario =>
  s.k === 'sales' ? { sales: v }
    : s.k === 'channel' ? { channels: { [s.id]: { [s.key]: v } } }
      : s.k === 'offer' ? { offers: { [s.ref]: { [s.key]: v } } }
        : { overhead: { [s.id]: { [s.key]: v } } };

/** Считает, как изменится чистая прибыль, если поменять только этот показатель. Даёт Levers, читает Lever. */
const ImpactContext = createContext<(scope: LeverScope, value: number) => number>(() => 0);

function Lever({ label, tip, now, show, value, onChange, suffix, bounds, editable, scope }: {
  label: string; tip?: string; now: number; show: (v: number) => string; value: number | undefined; onChange: (v: number | null) => void; suffix?: string; bounds?: [number, number]; editable: boolean; scope: LeverScope;
}) {
  const impactOf = useContext(ImpactContext);
  const change = value === undefined ? null : changePct(now, value);
  // выгодно ли изменение: смотрим, что оно делает с чистой прибылью
  const effect = editable && value !== undefined ? impactOf(scope, value) : 0;
  const tone = effect > 0.005 ? 'good' : effect < -0.005 ? 'bad' : '';
  return (
    <div className={`lever ${editable ? '' : 'plain'} ${editable && value !== undefined ? 'set' : ''}`}>
      <span className="lever-l"><Tip text={tip}>{label}</Tip></span>
      <span className="lever-cur">{show(now)}</span>
      {editable && <><div className="lever-in"><Num value={value ?? null} placeholder="—" onChange={onChange} suffix={suffix} bounds={bounds} /></div>
      <span className={`lever-d ${tone}`}>
        {value === undefined ? '' : change === null ? '—' : Math.abs(change) < 0.05 ? '0%' : `${change > 0 ? '+' : '−'}${Math.abs(change).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`}
      </span></>}
    </div>
  );
}

function Levers({ db, pc, base, mutate, fmt, editable }: { db: P['db']; pc: ProductCalcs; base: StoreCalc; mutate: P['mutate']; fmt: Fmt; editable: boolean }) {
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
  const setOverhead = (id: string, key: 'amount' | 'percent', v: number | null) => mutate(d => {
    const o = (((d.scenario ??= {}).overhead ??= {})[id] ??= {});
    if (v === null) delete o[key]; else o[key] = v;
  });

  const usd = (v: number) => `$${v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;   // CPM всегда в долларах
  const items = base.items.filter(x => x.offer);
  const columns = (
    <div className={`lever head ${editable ? '' : 'plain'}`}><span>Показатель</span><span className="r">Сейчас</span>{editable && <><span className="r">Прогноз</span><span className="r">Изменение</span></>}</div>
  );
  const none = (text: string) => <div className="empty">{text}</div>;

  const impact = (scope: LeverScope, value: number) => profitEffect(db, pc, scenarioOf(scope, value), base.profitAfterOverhead);

  return (
    <ImpactContext.Provider value={impact}>
      <Card ckey="analytics:levers" title={editable ? 'Что можно менять' : 'Показатели'}
        tip={editable
          ? 'Главные показатели, на которые вы влияете. В колонке «Сейчас» настоящее значение из ваших данных, оно не меняется.\nВ колонке «Прогноз» впишите, каким оно может стать: вся аналитика слева пересчитается. Пустое поле значит «как сейчас».\nКнопка «Сбросить» очищает прогноз целиком.'
          : 'Главные показатели, на которые вы влияете, с их настоящими значениями. Чтобы прикинуть, что будет при других значениях, переключитесь на «Прогноз» вверху страницы.'}
        right={editable && count > 0 ? <button className="btn" onClick={() => mutate(d => { delete d.scenario; })}>Сбросить · {count}</button> : undefined}>
        {columns}
        <div className="lever-box">
          <div className="lever-group">План</div>
          <Lever editable={editable} label="Продаж за период" tip="Сколько заказов продаётся за период плана." now={db.store.sales} show={fmt.int} value={sc?.sales}
            onChange={setSales} scope={{ k: 'sales' }} suffix="шт." />
        </div>
      </Card>

      <Card ckey="analytics:levers-items" title="Товары и наборы"
        tip="Цена продажи и себестоимость каждой позиции из плана магазина. Так видно, что даст скидка, подорожание или более дешёвая закупка.">
        {items.length === 0 ? none('Позиций в плане нет. Добавьте их во вкладке «Магазин».') : <>
          {columns}
          {items.map(x => {
            const ref = x.item.offer, v = sc?.offers?.[ref] ?? {};
            return (
              <div className="lever-box" key={x.item.id}>
                <div className="lever-group">{x.offer!.name}</div>
                <Lever editable={editable} label="Цена" tip="Цена продажи за штуку." now={x.offer!.price} show={fmt.unit} value={v.price} onChange={n => setOffer(ref, 'price', n)} scope={{ k: 'offer', ref, key: 'price' }} suffix={fmt.sym} />
                <Lever editable={editable} label="Себестоимость" tip="Во сколько обходится одна штука." now={x.offer!.unitCost} show={fmt.unit} value={v.unitCost} onChange={n => setOffer(ref, 'unitCost', n)} scope={{ k: 'offer', ref, key: 'unitCost' }} suffix={fmt.sym} />
              </div>
            );
          })}
        </>}
      </Card>

      <Card ckey="analytics:levers-channels" title="Каналы продаж"
        tip="Реклама и воронка каждого канала: цена показов, клики, заказы, апрув и выкуп. Так видно, что даст более дешёвая реклама или лучший апрув.">
        {db.channels.length === 0 ? none('Каналов нет. Добавьте их во вкладке «Каналы продаж».') : <>
          {columns}
          {db.channels.map(c => {
            const v = sc?.channels?.[c.id] ?? {};
            const percent = isPercentAd(c);
            const set = (key: keyof ChannelScenario) => (x: number | null) => setChannel(c.id, key, x);
            return (
              <div className="lever-box" key={c.id}>
                <div className="lever-group">{c.name}</div>
                {c.adMode === 'funnel' ? <>
                  <Lever editable={editable} label="CPM" tip="Цена за 1000 показов рекламы, всегда в долларах." now={c.cpm} show={usd} value={v.cpm} onChange={set('cpm')} scope={{ k: 'channel', id: c.id, key: 'cpm' }} suffix="$" />
                  <Lever editable={editable} label="CTR" tip="Сколько процентов увидевших рекламу нажимают на неё." now={c.ctr} show={fmt.pct} value={v.ctr} onChange={set('ctr')} scope={{ k: 'channel', id: c.id, key: 'ctr' }} suffix="%" bounds={pct} />
                  <Lever editable={editable} label="Конверсия" tip="Сколько процентов зашедших на сайт оформляют заказ." now={c.cr} show={fmt.pct} value={v.cr} onChange={set('cr')} scope={{ k: 'channel', id: c.id, key: 'cr' }} suffix="%" bounds={pct} />
                </> : percent ? (
                  <Lever editable={editable} label="Процент" tip="Процент от оборота, который забирает канал." now={c.cpaPercent ?? 0} show={fmt.pct} value={v.cpaPercent} onChange={set('cpaPercent')} scope={{ k: 'channel', id: c.id, key: 'cpaPercent' }} suffix="%" bounds={pct} />
                ) : (
                  <Lever editable={editable} label="Реклама за заказ" tip="Сколько стоит один оформленный заказ." now={c.cpa} show={fmt.unit} value={v.cpa} onChange={set('cpa')} scope={{ k: 'channel', id: c.id, key: 'cpa' }} suffix={fmt.sym} />
                )}
                {!percent && <>
                  <Lever editable={editable} label="Апрув" tip="Какая часть заказов подтверждается." now={c.approve ?? 100} show={fmt.pct} value={v.approve} onChange={set('approve')} scope={{ k: 'channel', id: c.id, key: 'approve' }} suffix="%" bounds={pct} />
                  <Lever editable={editable} label="Выкуп" tip="Какая часть посылок забирается клиентами." now={c.buyout ?? 100} show={fmt.pct} value={v.buyout} onChange={set('buyout')} scope={{ k: 'channel', id: c.id, key: 'buyout' }} suffix="%" bounds={pct} />
                </>}
              </div>
            );
          })}
        </>}
      </Card>

      <Card ckey="analytics:levers-overhead" title="Накладные расходы"
        tip={'Каждый накладной расход из вкладки «Магазин»: сумма в месяц, процент от оборота или сумма за штуку, как он там задан. Так видно, что даст более дешёвый склад, курьер или эквайринг.\nСуммы указываются в валюте самого расхода.'}>
        {db.store.overhead.length === 0 ? none('Накладных расходов нет. Добавьте их во вкладке «Магазин».') : <>
          {columns}
          <div className="lever-box">
            {db.store.overhead.map(o => {
              const kind = o.kind ?? 'fixed', v = sc?.overhead?.[o.id] ?? {};
              const sym = SYMBOLS[o.currency].trim();
              if (kind === 'percent' || kind === 'percentAds') {
                return <Lever editable={editable} key={o.id} label={o.name} tip={kind === 'percent' ? 'Процент от оборота.' : 'Процент от рекламного бюджета.'} now={o.percent ?? 0} show={fmt.pct} value={v.percent} onChange={n => setOverhead(o.id, 'percent', n)} scope={{ k: 'overhead', id: o.id, key: 'percent' }} suffix="%" bounds={pct} />;
              }
              const money = (x: number) => `${x.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${sym}`;
              return <Lever editable={editable} key={o.id} label={o.name} tip={kind === 'perUnit' ? 'Сумма за каждую проданную штуку.' : 'Сумма в месяц.'} now={o.amount} show={money} value={v.amount} onChange={n => setOverhead(o.id, 'amount', n)} scope={{ k: 'overhead', id: o.id, key: 'amount' }} suffix={sym} />;
            })}
          </div>
        </>}
      </Card>
    </ImpactContext.Provider>
  );
}
