// Курсы центробанков: каждая валюта у своего банка. Все источники открытые, без ключей,
// и разрешают запросы прямо из браузера (CORS).
//   EUR, CNY — Европейский центробанк, через api.frankfurter.dev
//   UAH      — Национальный банк Украины, bank.gov.ua
//   UZS      — Центральный банк Узбекистана, cbu.uz
import type { Currency } from './engine/types';

export interface MarketRates {
  rates: Partial<Record<Currency, number>>; // единиц за 1 USD
  date: string;                             // дата курса ЕЦБ, если он ответил
  errors: string[];                         // какие источники не ответили
}

async function getJson(url: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally { clearTimeout(t); }
}

export async function fetchMarketRates(): Promise<MarketRates> {
  const rates: MarketRates['rates'] = {};
  const errors: string[] = [];
  let date = '';
  const [ecb, nbu, cbu] = await Promise.allSettled([
    getJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,CNY'),
    getJson('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json'),
    getJson('https://cbu.uz/ru/arkhiv-kursov-valyut/json/USD/'),
  ]);
  if (ecb.status === 'fulfilled' && ecb.value?.rates?.EUR) {
    rates.EUR = Number(ecb.value.rates.EUR);
    rates.CNY = Number(ecb.value.rates.CNY);
    date = String(ecb.value.date ?? '');
  } else errors.push('ЕЦБ (EUR, CNY)');
  const nbuUsd = nbu.status === 'fulfilled' && Array.isArray(nbu.value) ? nbu.value.find((x: { cc: string }) => x.cc === 'USD') : null;
  if (nbuUsd?.rate > 0) rates.UAH = Number(nbuUsd.rate); else errors.push('НБУ (UAH)');
  const cbuUsd = cbu.status === 'fulfilled' && Array.isArray(cbu.value) ? cbu.value.find((x: { Ccy: string }) => x.Ccy === 'USD') : null;
  if (cbuUsd && Number(cbuUsd.Rate) > 0) rates.UZS = Number(cbuUsd.Rate) / (Number(cbuUsd.Nominal) || 1); else errors.push('ЦБ Узбекистана (UZS)');
  return { rates, date, errors };
}
