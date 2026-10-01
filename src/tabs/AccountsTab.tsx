import type { AccountOps } from '../App';
import { Card } from '../ui/kit';

/** Список учётных записей: открыть, переименовать, сохранить в файл, удалить, создать. Живёт во вкладке «Настройки». */
export function AccountsCard({ ops }: { ops: AccountOps }) {
  const { accounts } = ops;
  return (
    <Card ckey="accounts:list" title="Учётные записи"
      tip={'Учётная запись — это отдельный набор товаров, наборов, каналов, магазина и настроек. Например, у каждого человека своя.\nВсё хранится только в этом браузере, поэтому сохраняйте записи в файл.'}>
      <div className="acc-list">
        {accounts.list.map(a => {
          const isActive = a.id === accounts.activeId;
          const days = a.db.lastBackup ? Math.floor((Date.now() - Date.parse(a.db.lastBackup)) / 864e5) : null;
          return (
            <div className={`acc-row ${isActive ? 'active' : ''}`} key={a.id}>
              <div className="acc-name">
                <input className="input" value={a.name} onChange={e => ops.rename(a.id, e.target.value)} />
                <span className="acc-meta">
                  товаров {a.db.products.length} · {days === null ? 'в файл не сохраняли' : days === 0 ? 'сохранена в файл сегодня' : `в файл сохраняли ${days} дн. назад`}
                </span>
              </div>
              {isActive ? <span className="badge">открыта</span> : <button className="btn ghost sm" onClick={() => ops.switchTo(a.id)}>Открыть</button>}
              <button className="btn ghost sm" onClick={() => ops.exportOne(a.id)}>В файл</button>
              <button className="icon-btn" title={accounts.list.length < 2 ? 'Последнюю учётную запись удалить нельзя' : 'Удалить'}
                disabled={accounts.list.length < 2} onClick={() => ops.remove(a.id)}>×</button>
            </div>
          );
        })}
      </div>
      <div className="btn-row mt">
        <button className="btn primary sm" onClick={ops.create}>+ Новая</button>
        <button className="btn sm" onClick={ops.importFile}>Открыть из файла</button>
        <button className="btn ghost sm" onClick={ops.addDemo}>Добавить пример</button>
      </div>
    </Card>
  );
}
