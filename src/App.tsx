import { useEffect, useMemo, useRef, useState } from 'react';
import { missingRates } from './dbOps';
import { DEMO_NAME, demoDb } from './demo';
import { calcAllProducts } from './engine/offers';
import type { Db } from './engine/types';
import { downloadAccount, loadAccounts, newAccount, parseAccountFile, saveAccounts, uniqueName, type Accounts } from './storage';
import { makeFmt, Note, Tip } from './ui/kit';
import { ProductsTab } from './tabs/ProductsTab';
import { KitsTab } from './tabs/KitsTab';
import { ChannelsTab } from './tabs/ChannelsTab';
import { StoreTab } from './tabs/StoreTab';
import { AnalyticsTab } from './tabs/AnalyticsTab';
import { SettingsTab } from './tabs/SettingsTab';

export type Mutate = (fn: (d: Db) => void) => void;
export interface TabProps { db: Db; mutate: Mutate; setDb: (d: Db) => void }

/** Действия с учётными записями — их вызывают верхняя панель и «Настройки». */
export interface AccountOps {
  accounts: Accounts;
  switchTo: (id: string) => void;
  create: () => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  exportOne: (id: string) => void;
  importFile: () => void;
  addDemo: () => void;
}

const TABS = [
  ['products', 'Товары'],
  ['kits', 'Наборы'],
  ['channels', 'Каналы продаж'],
  ['store', 'Магазин'],
  ['analytics', 'Аналитика'],
  ['settings', 'Настройки'],
] as const;
type TabId = (typeof TABS)[number][0];

const TAB_KEY = 'trade_unit_tab';
const readTab = (): TabId => {
  const h = location.hash.slice(1) === 'accounts' ? 'settings' : location.hash.slice(1);   // вкладка «Учётные записи» теперь внутри «Настроек»
  if (TABS.some(([id]) => id === h)) return h as TabId;
  try { const t = localStorage.getItem(TAB_KEY); if (TABS.some(([id]) => id === t)) return t as TabId; } catch { /* */ }
  return 'products';
};

export function App() {
  const [accs, setAccs] = useState<Accounts>(loadAccounts);
  const [tab, setTab] = useState<TabId>(readTab);
  const [toast, setToast] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const savedAtRef = useRef<HTMLSpanElement>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const active = accs.list.find(a => a.id === accs.activeId) ?? accs.list[0];
  const db = active.db;

  const updateActive = (fn: (d: Db) => Db) =>
    setAccs(p => ({ ...p, list: p.list.map(a => (a.id === p.activeId ? { ...a, db: fn(a.db) } : a)) }));
  const setDb = (d: Db) => updateActive(() => d);
  const mutate: Mutate = fn => updateActive(prev => { const next = structuredClone(prev); fn(next); return next; });

  // Автосохранение: пишем в браузер при каждом изменении, без задержки, чтобы закрытие вкладки ничего не отрезало.
  // Размер базы мал (десятки товаров), запись занимает доли миллисекунды.
  useEffect(() => {
    const ok = saveAccounts(accs);
    setSaveFailed(prev => (prev === !ok ? prev : !ok));
    if (ok && savedAtRef.current) savedAtRef.current.textContent = new Date().toLocaleTimeString('ru-RU');
  }, [accs]);
  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* */ }
    history.replaceState(null, '', '#' + tab);
  }, [tab]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2200); return () => clearTimeout(t); }, [toast]);

  const ops: AccountOps = {
    accounts: accs,
    switchTo: id => setAccs(p => ({ ...p, activeId: id })),
    create: () => {
      const name = prompt('Название новой учётной записи', 'Новая учётная запись');
      if (name === null) return;
      const acc = newAccount(uniqueName(name, accs.list));
      setAccs(p => ({ activeId: acc.id, list: [...p.list, acc] }));
      setToast(`Создана «${acc.name}». Все поля пустые, заполните под себя.`);
    },
    rename: (id, name) => setAccs(p => ({ ...p, list: p.list.map(a => (a.id === id ? { ...a, name } : a)) })),
    remove: id => {
      const acc = accs.list.find(a => a.id === id);
      if (!acc || accs.list.length < 2) return;
      if (!confirm(`Удалить учётную запись «${acc.name}» со всеми товарами и расчётами? Если данные нужны, сначала сохраните её в файл.`)) return;
      setAccs(p => {
        const list = p.list.filter(a => a.id !== id);
        return { activeId: p.activeId === id ? list[0].id : p.activeId, list };
      });
    },
    exportOne: id => {
      const acc = accs.list.find(a => a.id === id);
      if (!acc) return;
      const stamped = { ...acc.db, lastBackup: new Date().toISOString() };
      downloadAccount(acc.name, stamped);
      setAccs(p => ({ ...p, list: p.list.map(a => (a.id === id ? { ...a, db: stamped } : a)) }));
      setToast(`«${acc.name}» сохранена в файл`);
    },
    importFile: () => fileRef.current?.click(),
    addDemo: () => {
      const acc = newAccount(uniqueName(DEMO_NAME, accs.list), demoDb());
      setAccs(p => ({ activeId: acc.id, list: [...p.list, acc] }));
      setToast(`Добавлена учётная запись «${DEMO_NAME}»`);
    },
  };

  const importAccount = async (f: File) => {
    try {
      const { name, db: d } = parseAccountFile(await f.text(), f.name.replace(/\.json$/i, ''));
      const acc = newAccount(uniqueName(name, accs.list), d);
      setAccs(p => ({ activeId: acc.id, list: [...p.list, acc] }));
      setToast(`Открыта «${acc.name}»: товаров ${d.products.length}`);
    } catch (e) { alert('Не получилось открыть файл. ' + (e as Error).message); }
  };

  const fmt = useMemo(() => makeFmt(db.settings), [db.settings]);
  const pc = useMemo(() => calcAllProducts(db), [db]);
  const missing = useMemo(() => missingRates(db), [db]);
  const daysSinceBackup = db.lastBackup ? Math.floor((Date.now() - Date.parse(db.lastBackup)) / 864e5) : null;
  const props: TabProps = { db, mutate, setDb };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">TU</div>
          <div><h1>Trade Unit</h1><a className="brand-by" href="https://portfolio.defo-tech.shop/" target="_blank" rel="noopener noreferrer" title="Портфолио автора">by Defo</a></div>
        </div>
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
        <div className="top-actions">
          <select className="input account-select" value={active.id} title="Учётная запись"
            onChange={e => { if (e.target.value === '__new') ops.create(); else ops.switchTo(e.target.value); }}>
            {accs.list.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value="__new">+ Новая учётная запись</option>
          </select>
          <button className="btn" onClick={ops.importFile}>Открыть файл</button>
          <button className="btn primary" onClick={() => ops.exportOne(active.id)}>Сохранить в файл</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) importAccount(f); e.target.value = ''; }} />
        </div>
      </header>

      <main className="shell" key={active.id}>
        <div className="status-line">
          <span className={`save-state ${saveFailed ? 'failed' : ''}`}>
            <Tip text={'Все правки сохраняются в этом браузере сразу, после каждого нажатия.\nЭто не резервная копия: если очистить историю браузера, данные пропадут. Для надёжности сохраняйте учётную запись в файл.'}>
              {saveFailed ? 'Не удаётся сохранить в браузере' : <>Сохранено в браузере в <span ref={savedAtRef}>…</span></>}
            </Tip>
          </span>
          <span className={`backup ${daysSinceBackup === null || daysSinceBackup > 14 ? 'stale' : ''}`}>
            <Tip text="Данные хранятся только в этом браузере. Сохраняйте учётную запись в файл, чтобы не потерять её и чтобы передать другому человеку.">
              «{active.name}»: {daysSinceBackup === null ? 'в файл ещё не сохраняли' : daysSinceBackup === 0 ? 'сохранена в файл сегодня' : `в файл сохраняли ${daysSinceBackup} дн. назад`}
            </Tip>
          </span>
        </div>
        {saveFailed && (
          <Note tone="warn">Браузер не даёт сохранять данные: нет места или закрыт режим для хранения. Правки пропадут при закрытии вкладки. Сохраните учётную запись в файл прямо сейчас кнопкой «Сохранить в файл».</Note>
        )}
        {missing.length > 0 && (
          <Note tone="warn">Не задан курс: {missing.join(', ')}. Пока его нет, суммы в этой валюте считаются как в долларах. Заполните курс в «Настройках».</Note>
        )}
        {tab === 'products' && <ProductsTab {...props} fmt={fmt} pc={pc} />}
        {tab === 'kits' && <KitsTab {...props} fmt={fmt} pc={pc} />}
        {tab === 'channels' && <ChannelsTab {...props} fmt={fmt} />}
        {tab === 'store' && <StoreTab {...props} fmt={fmt} pc={pc} />}
        {tab === 'analytics' && <AnalyticsTab {...props} fmt={fmt} pc={pc} />}
        {tab === 'settings' && <SettingsTab {...props} ops={ops} />}
      </main>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
