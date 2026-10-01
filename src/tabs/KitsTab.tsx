import type { TabProps } from '../App';
import { deleteKit } from '../dbOps';
import { kitOffer, type ProductCalcs } from '../engine/offers';
import { uid } from '../engine/taxPresets';
import { priceMetrics } from '../engine/product';
import type { Kit } from '../engine/types';
import { Card, Del, Field, Kpi, Note, Num, Select, Th, Tip, type Fmt } from '../ui/kit';
import { MARGIN_TIP, MARKUP_TIP } from '../ui/tips';

type P = TabProps & { fmt: Fmt; pc: ProductCalcs };

export function KitsTab({ db, mutate, fmt, pc }: P) {
  const add = () => mutate(d => {
    d.kits.push({ id: uid(), name: 'Новый набор', items: d.products[0] ? [{ productId: d.products[0].id, qty: 1 }] : [], packCost: 0, price: 0 });
  });

  return (
    <div className="content full-content">
      <div className="page-head">
        <h2><Tip text="Соберите набор из своих товаров. Во сколько обходится каждый товар, калькулятор берёт из его карточки.">Наборы</Tip></h2>
        <button className="btn primary" onClick={add} disabled={!db.products.length}>+ Набор</button>
      </div>
      {!db.products.length && <Note tone="info">Сначала добавьте товары во вкладке «Товары».</Note>}

      <div className="kits-list">
        {db.kits.map(k => <KitCard key={k.id} k={k} db={db} mutate={mutate} fmt={fmt} pc={pc} />)}
      </div>

    </div>
  );
}

function KitCard({ k, db, mutate, fmt, pc }: { k: Kit } & Omit<P, 'setDb'>) {
  const o = kitOffer(k, db, pc);
  const t = db.settings.tax;
  const set = (fn: (x: Kit) => void) => mutate(d => { fn(d.kits.find(x => x.id === k.id)!); });
  const m = priceMetrics(k.price, o.unitCost, t.vatPayer, t.vatRate);
  const vatNote = t.vatPayer && m ? `\nСчитается от цены без НДС: ${fmt.unit(m.net)}.` : '';
  const loss = m && m.margin < 0 ? 'neg' : undefined;
  const d = o.discountPct ?? null;

  return (
    <Card ckey={`kit:${k.id}`} title={<input className="title-input" value={k.name} onChange={e => set(x => { x.name = e.target.value; })} />}
      right={<Del title="Удалить набор" onClick={() => { if (confirm(`Удалить набор «${k.name}»? Он уберётся и из плана магазина.`)) mutate(d => deleteKit(d, k.id)); }} />}>
      <div className="kit-grid">
        <div className="kit-col">
          <div className="group-title">Состав набора</div>
          <table className="table compact kit-table">
            <thead><tr>
              <Th>Товар</Th><Th center>Штук</Th>
              <Th num tip="Во сколько обходится одна штука этого товара, из его карточки.">За шт.</Th><Th num>Сумма</Th><th />
            </tr></thead>
            <tbody>
              {k.items.map((it, i) => {
                const c = pc[it.productId];
                return (
                  <tr key={i}>
                    <td><Select value={it.productId} onChange={v => set(x => { x.items[i].productId = v; })}
                      options={[...(c ? [] : [[it.productId, 'товар удалён'] as [string, string]]), ...db.products.map(p => [p.id, p.name] as [string, string])]} /></td>
                    <td className="ctr w-qty"><Num align="center" value={it.qty} min={1} onChange={v => set(x => { x.items[i].qty = v ?? 0; })} /></td>
                    <td className="num">{c ? fmt.unit(c.unitCost) : '—'}</td>
                    <td className="num">{c ? fmt.unit(c.unitCost * it.qty) : '—'}</td>
                    <td className="w-del"><Del onClick={() => set(x => { x.items.splice(i, 1); })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button className="add-row" onClick={() => set(x => { x.items.push({ productId: db.products[0].id, qty: 1 }); })}>+ Товар в набор</button>
        </div>

        <div className="kit-col">
          <div className="group-title">Упаковка и цена</div>
          <div className="row">
            <Field size="m" label="Цена набора" tip={t.vatPayer ? 'Сколько платит покупатель, с НДС.' : 'Сколько платит покупатель.'}>
              <Num value={k.price} onChange={v => set(x => { x.price = v ?? 0; })} suffix={fmt.sym} />
            </Field>
            <Field size="m" label="Упаковка набора" tip="Коробка, лента, вкладыш: всё, что нужно на один набор сверх упаковки самих товаров.">
              <Num value={k.packCost} onChange={v => set(x => { x.packCost = v ?? 0; })} suffix={fmt.sym} />
            </Field>
          </div>
          <div className="kpi-grid compact mt">
            <Kpi label="Обходится" tip="Во сколько обходятся товары набора плюс упаковка набора." value={fmt.unit(o.unitCost)} />
            <Kpi label="Маржа" tip={MARGIN_TIP + vatNote + (m ? '' : '\nЗадайте цену набора.')}
              value={m ? `${fmt.pct(m.marginPct, 0)} (${fmt.unit(m.margin)})` : '—'} tone={loss} />
            <Kpi label="Наценка" tip={MARKUP_TIP} value={m && m.markupPct !== null ? fmt.pct(m.markupPct, 0) : '—'} tone={loss} />
            <Kpi label={d !== null && d < 0 ? 'Дороже товаров' : 'Скидка набора'}
              tip={`Насколько набор дешевле тех же товаров, купленных по отдельности по розничным ценам (сейчас они вместе стоят ${fmt.unit(o.singlesPrice ?? 0)}).\nЕсли значение красное, набор получается дороже, чем товары по отдельности.`}
              value={d === null ? '—' : fmt.pct(Math.abs(d), 0)} tone={d !== null && d < 0 ? 'neg' : undefined} />
            <Kpi label="Можно собрать" wide tip="Сколько наборов получится из того, что будет в наличии: уже на складе плюс новые партии без брака."
              value={`${fmt.int(o.maxFromStock)} шт.`} hint={o.bottleneck && k.items.length > 1 ? `первым закончится «${o.bottleneck}»` : undefined} />
          </div>
        </div>
      </div>
      {o.missing && <Note tone="warn">В наборе есть удалённый товар, он не считается.</Note>}
    </Card>
  );
}
