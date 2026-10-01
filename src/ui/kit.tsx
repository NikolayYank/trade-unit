// Базовые элементы интерфейса: поля ввода, подсказки, карточки, форматирование.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SYMBOLS } from '../engine/money';
import { CURRENCIES, type Currency, type Settings } from '../engine/types';

// ---------- форматирование ----------

export function makeFmt(s: Settings) {
  const sym = SYMBOLS[s.baseCurrency];
  const money = (v: number, digits = 0) => {
    if (!Number.isFinite(v)) return '—';
    const d = s.baseCurrency === 'UZS' ? 0 : digits;
    const abs = Math.abs(v).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
    return `${v < -1e-9 && abs !== '0' ? '−' : ''}${sym}${abs}`;
  };
  return {
    sym,
    money,
    unit: (v: number) => money(v, 2),
    /** Малые суммы: цена одного показа или клика. До 4 знаков, чтобы €0,003 не превращалось в €0,00. */
    precise: (v: number) => {
      if (!Number.isFinite(v)) return '—';
      const abs = Math.abs(v), uzs = s.baseCurrency === 'UZS';
      const out = abs.toLocaleString('ru-RU', { minimumFractionDigits: uzs ? 0 : 2, maximumFractionDigits: uzs ? (abs < 10 ? 2 : 0) : abs >= 1 ? 2 : 4 });
      return `${v < -1e-9 ? '−' : ''}${sym}${out}`;
    },
    pct: (v: number, d = 1) => (Number.isFinite(v) ? `${v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })}%` : '—'),
    int: (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('ru-RU') : '—'),
  };
}
export type Fmt = ReturnType<typeof makeFmt>;

// ---------- подсказка ----------

const POP_W = 280;

/** Текст с подсказкой: значок «?» рядом, при наведении или фокусе — всплывающее окно. */
export function Tip({ text, children }: { text?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null);
  useEffect(() => {
    if (!anchor) return;
    const hide = () => setAnchor(null);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [anchor]);
  // окно ставим по его реальной высоте: под подписью, а если не влезает, то над ней
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!anchor || !el) return;
    const h = el.offsetHeight, vh = window.innerHeight;
    const below = anchor.bottom + 8, above = anchor.top - 8 - h;
    const top = below + h <= vh - 8 ? below : above >= 8 ? above : Math.max(8, vh - 8 - h);
    el.style.top = `${top}px`;
    el.style.left = `${Math.min(Math.max(8, anchor.left - 8), window.innerWidth - POP_W - 8)}px`;
    el.style.visibility = 'visible';
  }, [anchor]);
  if (!text) return <>{children}</>;
  const show = () => {
    const r = ref.current!.getBoundingClientRect();
    setAnchor({ left: r.left, top: r.top, bottom: r.bottom });
  };
  return (
    <span ref={ref} className="tip" tabIndex={0} onMouseEnter={show} onMouseLeave={() => setAnchor(null)} onFocus={show} onBlur={() => setAnchor(null)}>
      {children}<span className="tip-icon" aria-hidden>?</span>
      {anchor && createPortal(
        <div ref={popRef} className="tip-pop" style={{ width: POP_W, visibility: 'hidden' }} role="tooltip">
          {typeof text === 'string' ? text.split('\n').map((t, i) => <p key={i}>{t}</p>) : text}
        </div>,
        document.body,
      )}
    </span>
  );
}

// ---------- поля ----------

/** Числовое поле: держит строку, пока человек печатает («0.», «-»), наружу отдаёт число. */
export function Num({ value, onChange, step, min, suffix, placeholder, align, bounds }: {
  value: number | null; onChange: (v: number | null) => void; step?: number; min?: number;
  suffix?: string; placeholder?: string; align?: 'center';
  bounds?: [number, number]; // жёсткие границы: введённое число прижимается к ним сразу, в поле остаётся допустимое значение
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    if (value === null ? text !== '' : Number(text) !== value) setText(value === null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const input = (
    <input
      className={`input ${align === 'center' ? 'ctr' : ''}`} type="number" inputMode="decimal" step={step ?? 'any'} min={min}
      value={text} placeholder={placeholder}
      onChange={e => {
        const raw = e.target.value;
        if (raw === '') { setText(raw); onChange(placeholder !== undefined ? null : 0); return; }
        let n = Number(raw);
        if (!Number.isFinite(n)) { setText(raw); return; }
        if (bounds && (n < bounds[0] || n > bounds[1])) { n = Math.min(bounds[1], Math.max(bounds[0], n)); setText(String(n)); }
        else setText(raw);
        onChange(n);
      }}
    />
  );
  return suffix ? <div className="input-wrap">{input}<span className="input-right">{suffix}</span></div> : input;
}

const groupDigits = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * Целое число с пробелами между тысячами прямо во время ввода: 100000 → «100 000».
 * Пустое поле даёт null. Курсор остаётся на месте, даже когда пробелы добавляются или пропадают.
 */
export function GroupedInt({ value, onChange, suffix, placeholder, maxDigits = 9 }: {
  value: number | null; onChange: (v: number | null) => void; suffix?: string; placeholder?: string; maxDigits?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const fromValue = (v: number | null) => (v === null ? '' : groupDigits(String(Math.max(0, Math.floor(v)))));
  const [text, setText] = useState(fromValue(value));
  // значение изменили снаружи (например, загрузили другую запись) — подтягиваем в поле
  useEffect(() => {
    const own = text.replace(/\D/g, '');
    if ((own === '' ? null : Number(own)) !== value) setText(fromValue(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useLayoutEffect(() => {
    if (caret.current !== null && ref.current) { ref.current.setSelectionRange(caret.current, caret.current); caret.current = null; }
  });
  const input = (
    <input
      ref={ref} className="input" type="text" inputMode="numeric" autoComplete="off" value={text} placeholder={placeholder}
      onChange={e => {
        const raw = e.target.value;
        const digitsBefore = raw.slice(0, e.target.selectionStart ?? raw.length).replace(/\D/g, '').length;
        const digits = raw.replace(/\D/g, '').slice(0, maxDigits).replace(/^0+(?=\d)/, '');
        const formatted = groupDigits(digits);
        let idx = 0, seen = 0;
        while (idx < formatted.length && seen < digitsBefore) { if (/\d/.test(formatted[idx])) seen++; idx++; }
        caret.current = idx;
        setText(formatted);
        onChange(digits === '' ? null : Number(digits));
      }}
    />
  );
  return suffix ? <div className="input-wrap">{input}<span className="input-right">{suffix}</span></div> : input;
}

export function Text({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className="input" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />;
}

export function Select<T extends string>({ value, onChange, options, disabled }: {
  value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[]; disabled?: boolean;
}) {
  return (
    <select className="input" value={value} disabled={disabled} onChange={e => onChange(e.target.value as T)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

/** Два поля одной суммы: число и единица (валюта или %). Склеены в одну рамку, чтобы читались как одно целое. */
export const Pair = ({ children }: { children: ReactNode }) => <div className="pair">{children}</div>;
/** Переключатель единицы внутри Pair: например, «€ | %». */
export function UnitToggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="unit-toggle" role="group">
      {options.map(([v, l]) => <button type="button" key={v} className={v === value ? 'active' : ''} onClick={() => onChange(v)} aria-pressed={v === value}>{l}</button>)}
    </div>
  );
}
export const Unit = ({ children }: { children: ReactNode }) => <span className="unit">{children}</span>;

export const CurrencySelect = ({ value, onChange, disabled }: { value: Currency; onChange: (v: Currency) => void; disabled?: boolean }) =>
  <Select value={value} onChange={onChange} options={CURRENCIES.map(c => [c, c] as const)} disabled={disabled} />;

/** Поле формы. size задаёт ширину: s — число, m — сумма, l — сумма с валютой или текст. */
export function Field({ label, tip, children, size }: { label: string; tip?: ReactNode; children: ReactNode; size?: 'xs' | 's' | 'm' | 'l' | 'xl' | 'fill' }) {
  return (
    <div className={`field ${size ?? ''}`}>
      <span className="label"><Tip text={tip}>{label}</Tip></span>
      {children}
    </div>
  );
}

/** Группа полей под общим заголовком, поля идут в строку. */
export const Group = ({ title, children }: { title?: string; children: ReactNode }) => (
  <div className="group">
    {title && <div className="group-title">{title}</div>}
    <div className="row">{children}</div>
  </div>
);

export function Toggle({ on, onChange, label, tip }: { on: boolean; onChange: (v: boolean) => void; label: string; tip?: ReactNode }) {
  return (
    <div className="toggle-row">
      <button type="button" className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} />
      <span className="toggle-label"><Tip text={tip}>{label}</Tip></span>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, stretch }: { value: T; onChange: (v: T) => void; options: [T, string][]; stretch?: boolean }) {
  return (
    <div className={`segmented ${stretch ? 'stretch' : ''}`}>
      {options.map(([v, l]) => <button type="button" key={v} className={v === value ? 'active' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

// ---------- карточки ----------

// ---------- свёрнутые области: запоминаются в браузере ----------

const COLLAPSE_KEY = 'trade_unit_collapsed';
let collapsed: Record<string, true> = (() => {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch { return {}; }
})();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function toggleCollapsed(key: string) {
  collapsed = { ...collapsed };
  if (collapsed[key]) delete collapsed[key]; else collapsed[key] = true;
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed)); } catch { /* только на эту сессию */ }
  listeners.forEach(fn => fn());
}
const useCollapsed = (key?: string) => useSyncExternalStore(subscribe, () => (key ? !!collapsed[key] : false));

// ---------- карточки ----------

/** Карточка-область. С ckey появляется кнопка «свернуть», состояние запоминается по этому ключу. */
export function Card({ step, title, tip, sub, right, children, className, ckey, headClass }: {
  step?: string; title: ReactNode; tip?: ReactNode; sub?: ReactNode; right?: ReactNode; children?: ReactNode; className?: string; ckey?: string; headClass?: string;
}) {
  const isCollapsed = useCollapsed(ckey);
  return (
    <section className={`card ${className ?? ''} ${isCollapsed ? 'collapsed' : ''}`}>
      <header className={`card-head ${headClass ?? ''}`}>
        <div className="card-title">
          {step && <div className="step">{step}</div>}
          <div className="card-title-text"><h3><Tip text={tip}>{title}</Tip></h3>{sub && !isCollapsed && <p>{sub}</p>}</div>
        </div>
        <div className="card-actions">
          {right}
          {ckey && (
            <button type="button" className="collapse-btn" onClick={() => toggleCollapsed(ckey)}
              title={isCollapsed ? 'Развернуть' : 'Свернуть'} aria-expanded={!isCollapsed}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
        </div>
      </header>
      {children !== undefined && !isCollapsed && <div className="card-body">{children}</div>}
    </section>
  );
}

export const Kpi = ({ label, tip, value, hint, tone, wide }: { label: string; tip?: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'neg' | 'pos'; wide?: boolean }) => (
  <div className={`kpi ${wide ? 'wide' : ''}`}>
    <div className="label"><Tip text={tip}>{label}</Tip></div>
    <div className={`value ${tone ?? ''}`}>{value}</div>
    {hint && <div className="hint">{hint}</div>}
  </div>
);

/** Заголовок колонки таблицы с подсказкой. */
export const Th = ({ children, tip, num, center }: { children: ReactNode; tip?: ReactNode; num?: boolean; center?: boolean }) =>
  <th className={num ? 'num' : center ? 'ctr' : undefined}><Tip text={tip}>{children}</Tip></th>;

export const Del = ({ onClick, title }: { onClick: () => void; title?: string }) =>
  <button type="button" className="icon-btn" title={title ?? 'Удалить'} onClick={onClick}>×</button>;

export const Note = ({ tone, children }: { tone: 'warn' | 'good' | 'info'; children: ReactNode }) =>
  <div className={`note ${tone}`}>{children}</div>;
