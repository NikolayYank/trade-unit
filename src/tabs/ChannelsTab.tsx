import { Fragment, useState } from 'react';
import type { TabProps } from '../App';
import { deleteChannel } from '../dbOps';
import { newChannel } from '../factories';
import { funnelView, isPercentAd, usdToBase, type FunnelStage } from '../engine/channel';
import type { AdMode, Channel } from '../engine/types';
import { Card, Del, Field, GroupedInt, Num, Pair, Segmented, Tip, UnitToggle, type Fmt } from '../ui/kit';

type P = TabProps & { fmt: Fmt };

/** Количество на шаге воронки: целым, если много, и с десятыми или сотыми, если мало. */
const count = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2 });

export function ChannelsTab({ db, mutate, fmt }: P) {
  return (
    <div className="content full-content">
      <div className="page-head">
        <h2><Tip text={`Здесь фиксируем, во сколько обходится один проданный заказ из каждого источника.\nДоставка, упаковка, возвраты и комиссии вписываются накладными расходами во вкладке «Магазин». Все суммы в ${db.settings.baseCurrency}.`}>Каналы продаж</Tip></h2>
        <button className="btn primary" onClick={() => mutate(d => { d.channels.push(newChannel()); })}>+ Канал</button>
      </div>
      <div className="kits-list">
        {db.channels.map(c => <ChannelCard key={c.id} c={c} db={db} mutate={mutate} fmt={fmt} />)}
      </div>
    </div>
  );
}

function Plate({ label, tip, value, cost, unit, accent }: { label: string; tip?: string; value: string; cost: string; unit: string; accent?: boolean }) {
  return (
    <div className={`plate ${accent ? 'accent' : ''}`}>
      <span className="plate-l"><Tip text={tip}>{label}</Tip></span>
      <b>{value}</b>
      <span className="plate-c">{cost ? <><em>{cost}</em> {unit}</> : unit}</span>
    </div>
  );
}

/** Название, подсказка и подпись цены для каждого шага воронки. «Нужно» означает: на один проданный заказ. */
const STAGE_INFO: Record<FunnelStage['key'], { label: string; tip: string; unit: string }> = {
  impressions: { label: 'Показов', tip: 'Сколько раз надо показать рекламу, чтобы получить один проданный заказ. Под числом цена одного показа: цена за 1000 показов, делённая на 1000.', unit: 'за показ' },
  clicks: { label: 'Кликов', tip: 'Сколько человек должны нажать на рекламу, чтобы получить один проданный заказ. Под числом цена одного клика.', unit: 'за клик' },
  orders: { label: 'Заказов', tip: 'Сколько заказов надо оформить, чтобы один из них дошёл до покупки. Реклама оплачивается за каждый оформленный заказ, даже если его потом не подтвердят или не заберут.', unit: 'за заказ' },
  approved: { label: 'Подтверждений', tip: 'Сколько заказов должно пройти подтверждение (апрув), чтобы получить один проданный. Под числом цена одного подтверждённого заказа.', unit: 'за approve' },
  sold: { label: 'Проданный заказ', tip: 'Итог: сколько рекламы уходит на проданные заказы, то есть заказы, которые клиент забрал и оплатил.\nНа один заказ это цена оформленного заказа, делённая на долю подтверждённых (апрув) и долю забранных посылок (выкуп).', unit: 'реклама на 1 заказ' },
};

function ChannelCard({ c, db, mutate, fmt }: { c: Channel } & Omit<P, 'setDb'>) {
  const set = (fn: (x: Channel) => void) => mutate(d => { fn(d.channels.find(x => x.id === c.id)!); });
  const sym = fmt.sym;
  const used = db.store.items.filter(i => i.channels.some(x => x.channelId === c.id)).length;
  // Для скольких проданных заказов считаем воронку. Пусто или ноль — для одного.
  const [want, setWant] = useState<number | null>(1);
  const sales = want !== null && want > 0 ? want : 1;
  const view = funnelView(c, usdToBase(db), sales);
  const percent = isPercentAd(c);
  const approve = c.approve ?? 100;
  const buyout = c.buyout ?? 100;

  return (
    <Card ckey={`channel:${c.id}`} headClass="ch-head" title={<input className="title-input" value={c.name} onChange={e => set(x => { x.name = e.target.value; })} />}
      right={<Del title="Удалить канал" onClick={() => {
        if (confirm(`Удалить канал «${c.name}»?${used ? ` Он уберётся из позиций плана магазина: ${used}.` : ''}`)) mutate(d => deleteChannel(d, c.id));
      }} />}>
      <div className="ch-grid">
        <div className="ch-col">
          <div className="group-title"><Tip text={'По готовой цене: вы знаете, сколько стоит заказ из этого источника. Это сумма за оформленный заказ (из рекламного кабинета или договора) или процент от оборота (например, комиссия маркетплейса). Подойдёт и для источника без рекламы: поставьте 0.\nПо воронке рекламы: калькулятор сам посчитает цену заказа из цены показов, кликов и конверсии.\nМагазин берёт итоговую цену именно отсюда.'}>Реклама</Tip></div>
          <Segmented<AdMode> stretch value={c.adMode} onChange={v => set(x => { x.adMode = v; })}
            options={[['cpa', 'По готовой цене'], ['funnel', 'По воронке рекламы']]} />
          <div className="ch-fields mt-s">
            {c.adMode === 'cpa' ? (
              <div className="span3">
                <Field size="fill" label={percent ? 'Процент от оборота' : 'Реклама на 1 заказ'}
                  tip={percent
                    ? 'Сколько процентов от суммы проданных заказов забирает источник, например маркетплейс.\nБерётся с того, что заплатили клиенты за забранные заказы.\nАпрув и выкуп для такого канала не нужны: в плане магазина считайте сразу проданные заказы.'
                    : 'Сколько уходит на рекламу, чтобы получить один заказ. В рекламных кабинетах это CPA.\nСчитаются все оформленные заказы, даже те, что потом не подтвердят или не заберут.'}>
                  <Pair>
                    {percent
                      ? <Num value={c.cpaPercent ?? 0} step={0.1} onChange={v => set(x => { x.cpaPercent = v ?? 0; })} />
                      : <Num value={c.cpa} onChange={v => set(x => { x.cpa = v ?? 0; })} />}
                    <UnitToggle value={percent ? 'percent' : 'money'} onChange={v => set(x => { x.cpaType = v; })} options={[['money', sym], ['percent', '%']]} />
                  </Pair>
                </Field>
              </div>
            ) : <>
              <Field size="fill" label="CPM" tip={'Сколько стоит, чтобы рекламу увидели 1000 раз: цена за 1000 показов.\nВсегда в долларах, какая бы ни была основная валюта. В воронке и расчётах пересчитывается в основную валюту сам.'}>
                <Num value={c.cpm} onChange={v => set(x => { x.cpm = v ?? 0; })} suffix="$" />
              </Field>
              <Field size="fill" label="CTR" tip={'Из 100 человек, которые увидели рекламу, сколько нажали на неё.\nНапример, 10%: из 1000 показов будет 100 кликов.'}>
                <Num value={c.ctr} step={0.1} onChange={v => set(x => { x.ctr = v ?? 0; })} suffix="%" />
              </Field>
              <Field size="fill" label="Конверсия" tip={'Из 100 человек, которые зашли на сайт, сколько оформили заказ.\nНапример, 5%: из 100 кликов будет 5 заказов.'}>
                <Num value={c.cr} step={0.1} onChange={v => set(x => { x.cr = v ?? 0; })} suffix="%" />
              </Field>
            </>}
            {!percent && <>
            <Field size="fill" label="Апрув" tip={'Какая часть оформленных заказов подтверждается: оператор дозвонился, клиент подтвердил заказ.\nПодтверждённые заказы уходят в отправку, остальные отпадают. Реклама за них уже оплачена.\nЕсли заказы не нужно подтверждать, оставьте 100%.'}>
              <Num value={approve} step={1} onChange={v => set(x => { x.approve = v ?? 0; })} suffix="%" />
            </Field>
            <Field size="fill" label="Выкуп" tip={'Какая часть отправленных посылок клиенты забирают и оплачивают.\nОстальные возвращаются на склад: на них потрачены реклама и отправка, а продажи нет. Расходы на доставку и возврат вписываются накладными расходами во вкладке «Магазин».\nЕсли оплата до отправки, оставьте 100%.'}>
              <Num value={buyout} step={1} onChange={v => set(x => { x.buyout = v ?? 0; })} suffix="%" />
            </Field>
            </>}
          </div>
        </div>

        {percent ? (
          <div className="ch-col">
            <div className="group-title"><Tip text={'Источник берёт процент от оборота, поэтому цена одной продажи зависит от цены товара и заранее не известна.\nСколько это в деньгах, видно во вкладках «Наборы» и «Магазин».'}>Как считается</Tip></div>
            <div className="funnel2">
              <Plate accent label="Процент от оборота" tip="Столько процентов от суммы проданных заказов забирает этот источник." value={fmt.pct(c.cpaPercent ?? 0, Number.isInteger(c.cpaPercent ?? 0) ? 0 : 1)} cost="" unit="от суммы проданных заказов" />
            </div>
          </div>
        ) : (
        <div className="ch-col">
          <div className="group-title with-qty">
            <Tip text={'Сколько показов, кликов, заказов и подтверждений нужно, чтобы получить столько проданных заказов, сколько вписано в поле. По умолчанию 1.\nПод каждым шагом цена одного такого действия. В конце итог: сколько рекламы уходит на все эти заказы.\nСчитается из цифр слева: CPM, CTR, конверсии, апрува и выкупа. Если умножить количество на цену любого шага, получится одна и та же итоговая сумма.'}>Что нужно для продажи</Tip>
            <span className="qty-field"><GroupedInt value={want} placeholder="1" onChange={setWant} suffix="шт." /></span>
          </div>
          <div className="funnel2">
            {view.stages.map((st, i) => {
              const info = STAGE_INFO[st.key];
              const last = st.key === 'sold';
              const noSale = st.count === null;
              // у итоговой плашки главное значение — сколько рекламы на все заказы; у остальных — сколько штук нужно
              const total = view.total;
              const value = last ? (total === null ? '—' : sales === 1 || total < 1000 ? fmt.unit(total) : fmt.money(total))
                : noSale ? '—' : count(st.key === 'impressions' || st.key === 'clicks' ? Math.round(st.count!) : st.count!);
              return (
                <Fragment key={st.key}>
                  {i > 0 && <i>→</i>}
                  <Plate accent={last} label={last && sales > 1 ? 'Проданные заказы' : info.label} tip={info.tip} value={value}
                    cost={last ? (sales > 1 && st.cost !== null ? fmt.unit(st.cost) : '') : st.cost === null ? '' : fmt.precise(st.cost)}
                    unit={last ? (noSale ? 'до покупки ничего не доходит' : sales > 1 ? 'за заказ' : info.unit) : info.unit} />
                </Fragment>
              );
            })}
          </div>
        </div>
        )}
      </div>
    </Card>
  );
}
