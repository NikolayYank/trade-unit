import { useState } from 'react';
import type { AccountOps, TabProps } from '../App';
import { AccountsCard } from './AccountsTab';
import { switchBaseCurrency } from '../dbOps';
import { applyMarkup } from '../engine/money';
import { TAX_PRESETS, taxFromPreset, uid } from '../engine/taxPresets';
import { fetchMarketRates } from '../fxFetch';
import { CURRENCIES, type Db } from '../engine/types';
import { TAX_BASES } from '../ui/tips';
import { Card, CurrencySelect, Del, Field, Num, Pair, Select, Text, Tip, Toggle, Unit } from '../ui/kit';

type P = TabProps & { ops: AccountOps };

const BASES_TIP = (
  <>
    <p><b>% с выручки.</b> Со всех денег от продаж, без НДС.</p>
    <p><b>% с прибыли.</b> С того, что осталось после всех расходов.</p>
    <p><b>% когда забираете прибыль.</b> Налог на дивиденды. Считается с того, что осталось после остальных налогов.</p>
    <p><b>Сумма в месяц.</b> Фиксированный платёж, сколько бы ни продали.</p>
  </>
);

export function SettingsTab({ db, mutate, ops }: P) {
  const s = db.settings, t = s.tax;
  const preset = TAX_PRESETS.find(x => x.id === t.presetId);
  const countries = [...new Set(TAX_PRESETS.map(p => p.country))];
  const custom = (d: Db) => { d.settings.tax.presetId = 'custom'; };
  const markup = s.fxMarkup ?? 2;
  const hasMarket = !!s.fxMarket && Object.values(s.fxMarket).some(v => v && v > 0);
  const [fxState, setFxState] = useState<{ busy: boolean; msg: string; bad: boolean }>({ busy: false, msg: '', bad: false });

  const refreshRates = async () => {
    setFxState({ busy: true, msg: 'Загружаю курсы…', bad: false });
    const m = await fetchMarketRates();
    const adjusted = applyMarkup(m.rates, s.baseCurrency, markup);
    if (!adjusted || !Object.keys(adjusted).length) {
      setFxState({ busy: false, bad: true, msg: `Не получилось загрузить курсы${m.errors.length ? `: не ответили ${m.errors.join(', ')}` : ''}. Проверьте интернет или впишите вручную.` });
      return;
    }
    const today = new Date().toLocaleDateString('ru-RU');
    mutate(d => {
      for (const [c, v] of Object.entries(adjusted)) d.settings.fx[c as keyof typeof d.settings.fx] = Number(v!.toFixed(v! >= 100 ? 2 : 4));
      d.settings.fxMarket = { ...d.settings.fxMarket, ...m.rates };
      d.settings.fxUpdated = `${today}, центробанки + ${markup}%`;
    });
    setFxState({ busy: false, bad: m.errors.length > 0, msg: m.errors.length
      ? `Обновлено частично: не ответили ${m.errors.join(', ')}. Эти курсы остались прежними.`
      : `Обновлено: курсы центробанков на ${today} плюс ${markup}% наценки.` });
  };

  return (
    <div className="content wide-content">
      <AccountsCard ops={ops} />
      <Card ckey="settings:main" title="Валюта, курсы и налоги">
        <div className="settings-groups">
          <div className="group">
            <div className="group-title"><Tip text={'Курсы задаются как «сколько единиц валюты стоит 1 доллар».\nДоллар служит общей точкой, поэтому его курс всегда 1.'}>Валюта и курсы</Tip></div>
            <div className="fx-grid">
              <Field label="Считаем в" tip={'В этой валюте вводятся цены, реклама и расходы, и в ней показываются результаты.\nЕсли сменить валюту, все суммы пересчитаются по курсу, а результат не изменится.'}>
                <CurrencySelect value={s.baseCurrency} onChange={v => {
                  if (v !== 'USD' && !(s.fx[v] > 0)) { alert(`Сначала задайте курс ${v}, иначе суммы не пересчитать.`); return; }
                  mutate(d => switchBaseCurrency(d, v));
                }} />
              </Field>
              <div className="span3">
                <Field label="Курсы на дату" tip={'Пометка для себя, чтобы помнить, когда обновляли курсы.\nПри обновлении кнопкой заполняется сама.'}>
                  <Text value={s.fxUpdated} placeholder="например, 01.10.2026" onChange={v => mutate(d => { d.settings.fxUpdated = v; })} />
                </Field>
              </div>

              {CURRENCIES.filter(c => c !== 'USD').map(c => (
                <Field key={c} label={`${c} за $1`}>
                  <Num value={s.fx[c]} placeholder="0" onChange={v => mutate(d => { d.settings.fx[c] = v !== null && v > 0 ? v : 0; })} />
                  {hasMarket && <span className="fx-market">{s.fxMarket?.[c] ? `банк ${fmtRate(s.fxMarket[c]!)}` : '\u00a0'}</span>}
                </Field>
              ))}

              <button className="btn fx-btn" disabled={fxState.busy} onClick={refreshRates}>{fxState.busy ? 'Загружаю…' : 'Обновить курсы'}</button>
              <Field label="Наценка" tip={'На сколько курс обменника или банка при покупке валюты хуже официального.\nКаждая валюта, кроме основной, становится дороже на этот процент, поэтому закупка и расходы в ней считаются с запасом.\nОбычно 1–3%.'}>
                <Num value={markup} step={0.5} onChange={v => mutate(d => { d.settings.fxMarkup = v ?? 0; })} suffix="%" />
              </Field>
              <div className="span2 fx-src-cell">
                <Tip text={<>
                  <p>Официальные курсы центробанков, каждая валюта у своего:</p>
                  <p><b>EUR, CNY.</b> Европейский центробанк.<br /><b>UAH.</b> Национальный банк Украины.<br /><b>UZS.</b> Центральный банк Узбекистана.</p>
                  <p>К ним добавляется наценка. Под каждым полем мелко виден чистый курс банка. После обновления любое поле можно поправить вручную.</p>
                  <p>Если сменили основную валюту, обновите курсы ещё раз.</p>
                </>}>
                  <span className="fx-src">Откуда курсы</span>
                </Tip>
              </div>
            </div>
            {fxState.msg && <div className={`preset-hint ${fxState.bad ? 'warn' : ''}`}>{fxState.msg}</div>}
          </div>

          <div className="group tax-group">
            <div className="group-title"><Tip text={'Выберите режим, и поля заполнятся сами. Любое поле потом можно поправить.\nНалоги считаются сами и входят в накладные расходы магазина: вкладка «Магазин», внизу накладных.\nЦифры 2026 года. Перед важным решением сверьтесь с бухгалтером.'}>Налоги</Tip></div>
          <div className="row">
      <Field size="xl" label="Режим">
        <select className="input" value={t.presetId} onChange={e => {
          if (e.target.value === 'custom') { mutate(custom); return; }
          mutate(d => { d.settings.tax = taxFromPreset(e.target.value); });
        }}>
          <option value="custom">Свой режим</option>
          {countries.map(c => <optgroup key={c} label={c}>{TAX_PRESETS.filter(p => p.country === c).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
        </select>
      </Field>
    </div>
    <div className="preset-hint">{preset ? preset.hint : 'Заполните налоги сами или выберите готовый режим своей страны.'}</div>
    
    <div className="row mt">
      <Toggle on={t.vatPayer} label="Работаю с НДС" onChange={v => mutate(d => { d.settings.tax.vatPayer = v; custom(d); })}
        tip={'С НДС: часть каждой продажи уходит государству, зато НДС на ввоз товара возвращают.\nБез НДС: вся цена ваша, но НДС на ввоз не вернут.'} />
      {t.vatPayer && <Field size="s" label="Ставка НДС"><Num value={t.vatRate} onChange={v => mutate(d => { d.settings.tax.vatRate = v ?? 0; custom(d); })} suffix="%" /></Field>}
    </div>
    
    <div className="tax-lines mt">
      {t.lines.length > 0 && <div className="tax-row head"><span>Налог</span><span><Tip text={BASES_TIP}>Как считать</Tip></span><span>Сколько</span><span /></div>}
      {t.lines.map((l, i) => (
        <div className="tax-row" key={l.id}>
          <input className="input" value={l.name} onChange={e => mutate(d => { d.settings.tax.lines[i].name = e.target.value; custom(d); })} />
          <Select value={l.base} options={TAX_BASES} onChange={v => mutate(d => { d.settings.tax.lines[i].base = v; custom(d); })} />
          {l.base === 'fixed' ? (
            <Pair>
              <Num value={l.amount} onChange={v => mutate(d => { d.settings.tax.lines[i].amount = v ?? 0; custom(d); })} />
              <CurrencySelect value={l.currency} onChange={v => mutate(d => { d.settings.tax.lines[i].currency = v; custom(d); })} />
            </Pair>
          ) : (
            <Pair>
              <Num value={l.rate} onChange={v => mutate(d => { d.settings.tax.lines[i].rate = v ?? 0; custom(d); })} />
              <Unit>%</Unit>
            </Pair>
          )}
          <Del onClick={() => mutate(d => { d.settings.tax.lines.splice(i, 1); custom(d); })} />
        </div>
      ))}
      <button className="btn sm add-btn" onClick={() => mutate(d => { d.settings.tax.lines.push({ id: uid(), name: 'Налог', base: 'revenue', rate: 0, amount: 0, currency: d.settings.baseCurrency }); custom(d); })}>+ Налог</button>
    </div>
    
          </div>
        </div>
      </Card>
    </div>
  );
}

const fmtRate = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: v >= 100 ? 0 : 4 });
