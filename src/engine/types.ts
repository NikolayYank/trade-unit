// Модель данных. Всё, что хранится в базе (localStorage / JSON), описано здесь.

export const CURRENCIES = ['EUR', 'USD', 'CNY', 'UAH', 'UZS'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Курсы: сколько единиц валюты за 1 USD. */
export type FxTable = Record<Currency, number>;

// ---------- Товар ----------

export const STAGES = ['purchase', 'local', 'intl', 'import', 'pack'] as const;
export type StageKey = (typeof STAGES)[number];

export type ExpenseBasis =
  | 'fixed'          // фикс. сумма на партию
  | 'per_unit'       // за 1 шт. (в упаковке — только годные)
  | 'per_kg'         // за кг платного веса
  | 'per_cbm'        // за м³
  | 'pct_purchase'   // % от заводской стоимости партии
  | 'pct_stage'      // % от накопленной суммы на начало этапа
  | 'vat';           // импортный НДС: % от (суммы этапа + остальные расходы этапа)

export interface Expense {
  id: string;
  name: string;
  basis: ExpenseBasis;
  value: number;
  currency: Currency; // игнорируется для процентных баз
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  supplierUrl?: string;   // ссылка на поставщика (страница товара, магазин, контакт)
  origin: 'import' | 'local'; // local — без международной доставки и таможни
  batchQty: number;
  unitCost: number;
  unitCostCurrency: Currency;
  defectRate: number;     // %
  unitWeight: number;     // кг
  unitVolume: number;     // м³
  unitsPerCarton: number; // 0 — считать вес по штукам
  cartonWeight: number;   // кг брутто
  volCoef: number;        // кг/м³, 0 — не учитывать объёмный вес
  expenses: Record<StageKey, Expense[]>;
  stock: number;          // уже лежит на складе, шт. (без новой партии; партия без брака добавляется при расчёте)
  price: number;          // цена розницы за 1 шт., основная валюта, как видит клиент
  wholesalePrice?: number; // цена опта за 1 шт., там же; нет поля или 0 — опта нет
  notes: string;
}

// ---------- Набор ----------

export interface KitItem { productId: string; qty: number }

export interface Kit {
  id: string;
  name: string;
  items: KitItem[];
  packCost: number; // упаковка набора, основная валюта
  price: number;    // цена набора, основная валюта, как видит клиент
}

// ---------- Канал ----------

export type AdMode = 'cpa' | 'funnel';

export interface Channel {
  id: string;
  name: string;
  adMode: AdMode;
  cpa: number;   // готовая цена: реклама на один оформленный заказ, в основной валюте
  cpaType?: 'money' | 'percent'; // готовая цена задана суммой за заказ (по умолчанию) или процентом от оборота (маркетплейс)
  cpaPercent?: number; // процент от суммы проданных заказов, когда cpaType = 'percent'
  cpm: number;   // цена 1000 показов
  ctr: number;   // % кликов от показов
  cr: number;    // % оформленных заказов от кликов
  approve: number; // % апрува: какая часть оформленных заказов подтверждается и уходит в отправку; нет поля — 100
  buyout: number;  // % выкупа: какая часть отправленных посылок клиенты забирают и оплачивают; нет поля — 100
  // В старых данных у канала могут остаться поля shipping, noBuy и т.п.: они не используются (noBuy служит только для переноса в buyout).
}

// ---------- Магазин (модель месяца) ----------

/** Ссылка на предложение: товар поштучно или набор. */
export type OfferRef = `p:${string}` | `k:${string}`;

/** Какая часть продаж позиции идёт через канал. */
export interface ChannelShare { channelId: string; share: number } // %

/** Позиция плана: товар или набор, его доля во всех продажах и как эти продажи делятся по каналам. */
export interface PlanItem {
  id: string;
  offer: OfferRef;
  share: number;           // % от всех продаж плана; сумма долей позиций не больше 100
  channels: ChannelShare[]; // доли каналов в продажах этой позиции; сумма не больше 100
}

export type OverheadKind = 'fixed' | 'percent' | 'perUnit';

/** Накладной расход: сумма в месяц, процент от оборота или сумма за каждую проданную штуку. */
export interface Overhead {
  id: string; name: string;
  kind?: OverheadKind;     // нет поля — сумма в месяц
  amount: number; currency: Currency; // для суммы в месяц и суммы за штуку
  percent?: number;        // для процента от оборота (выручки без НДС)
}

export interface Store {
  sales: number;           // план: сколько заказов продаём за период (проданных, то есть забранных клиентом)
  period: number;          // период плана в днях; по умолчанию 30. Нет поля (старые данные) — 30
  items: PlanItem[];
  overhead: Overhead[];
}

// ---------- Налоги ----------

export type TaxBase = 'revenue' | 'profit' | 'dividend' | 'fixed';

export interface TaxLine {
  id: string;
  name: string;
  base: TaxBase;
  rate: number;       // % для revenue/profit/dividend
  amount: number;     // для fixed — сумма в месяц
  currency: Currency; // для fixed
}

export interface TaxConfig {
  presetId: string;  // 'custom' — свой
  vatPayer: boolean;
  vatRate: number;   // % НДС с продаж
  lines: TaxLine[];
}

// ---------- База ----------

export interface Settings {
  baseCurrency: Currency;
  fx: FxTable;
  fxUpdated: string;
  fxMarkup?: number;              // % наценки к курсу центробанка при обновлении; нет поля — 2
  fxMarket?: Partial<FxTable>;    // курсы центробанков на момент последнего обновления, для сравнения
  tax: TaxConfig;
}

/** Значения канала, которые можно подменить в прогнозе. Ключ есть — подмена, нет — берётся настоящее значение. */
export interface ChannelScenario { cpm?: number; ctr?: number; cr?: number; cpa?: number; cpaPercent?: number; approve?: number; buyout?: number }
/** Цена и себестоимость позиции в прогнозе (основная валюта). */
export interface OfferScenario { price?: number; unitCost?: number }
/** Накладный расход в прогнозе: сумма (в его валюте; для «сумма в месяц» и «за штуку») или процент от оборота. */
export interface OverheadScenario { amount?: number; percent?: number }
/** Прогноз: что будет, если эти значения станут другими. Настоящие данные не меняются. */
export interface Scenario {
  sales?: number;
  channels?: Record<string, ChannelScenario>;   // по id канала
  offers?: Record<string, OfferScenario>;        // по ссылке позиции: p:id или k:id
  overhead?: Record<string, OverheadScenario>;   // по id накладного расхода
}

export interface Db {
  version: 1;
  settings: Settings;
  products: Product[];
  kits: Kit[];
  channels: Channel[];
  store: Store;
  scenario?: Scenario;     // прогноз для вкладки «Аналитика»; нет поля — прогноза нет
  lastBackup: string | null;
}
