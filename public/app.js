const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor?.('secondary_bg_color');
}

const haptic = (k = 'light') => { try { tg?.HapticFeedback?.impactOccurred?.(k); } catch {} };
const hapticNotif = (k) => { try { tg?.HapticFeedback?.notificationOccurred?.(k); } catch {} };

// Запущены ли мы внутри Telegram (mini app) или в обычном браузере (на сайте).
// В браузере initData пустая — Stars-платежи и Pro-функции работать не могут.
const BOT_LINK = 'https://t.me/personal_converter_bot';
function isInTelegram() {
  return !!(tg && tg.initData);
}

// Юзер на сайте кликнул что-то платное → отправляем в бот (там menu-button
// открывает Mini App, где есть Stars-инвойсы). reason — для будущей
// телеметрии или подмены текста toast'а.
function gotoTelegramMiniApp(reason) {
  const messages = {
    pro:    'Покупка Pro доступна в Telegram — открываю бота',
    save:   'Сохранение цепочек в Telegram — открываю бота',
    editor: 'Свой курс и комиссии в Telegram — открываю бота',
  };
  showToast(messages[reason] || 'Открой в Telegram, чтобы продолжить');
  // setTimeout даёт toast'у показаться до того как браузер открывает новую вкладку
  // (некоторые блокировщики позволяют new tab только в gesture handler — здесь юзер
  // только что кликнул, в окно gesture'а попадаем).
  try { window.open(BOT_LINK, '_blank', 'noopener,noreferrer'); } catch {}
}

const STORAGE_KEY = 'converter++:v4';
const THEME_KEY = 'converter++:theme';
const STACKS_KEY = 'converter++:stacks:v1';
const ROUND_KEY = 'converter++:round';
let roundMode = localStorage.getItem(ROUND_KEY) === 'off' ? 'off' : 'on';
const THEMES = ['system', 'light', 'dark'];
const THEME_ICONS = { system: '⚙', light: '☀', dark: '🌙' };
const THEME_LABELS = { system: 'Системная', light: 'Светлая', dark: 'Тёмная' };

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'system';
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.textContent = THEME_ICONS[theme];
    btn.title = `Тема: ${THEME_LABELS[theme]} · нажмите чтобы сменить`;
    btn.dataset.theme = theme;
  }
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  // Telegram header под тему
  if (tg?.setHeaderColor) {
    try { tg.setHeaderColor('secondary_bg_color'); } catch {}
  }
}

// Применяем до загрузки rates чтобы избежать вспышки светлой темой
applyTheme(localStorage.getItem(THEME_KEY) || 'system');

// ---------- icons / flags ----------

const SPECIAL_FLAGS = {
  EUR: '🇪🇺',
  XCD: '🏝️', XDR: '💱', XAG: '🥈', XAU: '🥇',
  XOF: '🌍', XAF: '🌍', XPF: '🌊'
};
const CRYPTO_ICONS = {
  BTC: '₿', ETH: 'Ξ', LTC: 'Ł', DOGE: 'Ð', XMR: 'ɱ', BCH: 'Ƀ',
  USDT: '₮', USDC: '$', DAI: '◆', BUSD: '$', TUSD: '$', PYUSD: '$', FDUSD: '$',
  BNB: '🟡', XRP: '✕', ADA: '₳', SOL: '◎', TRX: '◊',
  TON: '💎', NEAR: '🔷', AVAX: '🔺', LINK: '🔗', UNI: '🦄',
  ATOM: '⚛', XLM: '★', SHIB: '🐕', PEPE: '🐸', MATIC: '⬣', POL: '⬣',
  WBTC: '₿', WETH: 'Ξ', APT: '🅰', SUI: '💧',
  AAVE: '👻', COMP: '🌿', CRV: '🌀', MKR: '🦅', CAKE: '🥞',
  INJ: '🟦', RUNE: 'ᚱ', GRT: '◉', SAND: '🏖', MANA: '🌐',
  AXS: '🎮', SNX: '🅂', ARB: '🅰', OP: '🅾', ZEC: 'ⓩ', DASH: 'Đ',
  XTZ: 'ꜩ', ALGO: '△', FIL: '⌬', ICP: '∞', ETC: 'Ξ', EOS: 'Ǝ',
  KAVA: 'K', ZIL: 'Z', NEO: 'Ⓝ'
};
const CRYPTO_LIST = new Set(Object.keys(CRYPTO_ICONS).concat([
  'BCH', 'EOS', 'ALGO', 'FIL', 'ICP', 'ETC', 'XTZ', 'AAVE', 'CAKE', 'ARB', 'OP', 'INJ', 'RUNE', 'GRT', 'SAND', 'MANA', 'AXS', 'CRV', 'COMP', 'SNX', 'MKR', 'KAVA', 'ZIL', 'DASH', 'ZEC', 'NEO'
]));

function isCrypto(code) {
  return CRYPTO_ICONS[code] != null || CRYPTO_LIST.has(code);
}

function currencyIcon(code) {
  if (CRYPTO_ICONS[code]) return CRYPTO_ICONS[code];
  if (SPECIAL_FLAGS[code]) return SPECIAL_FLAGS[code];
  // Если это крипта без явной иконки — не строить флаг по буквам кода
  if (isCrypto(code)) return '◈';
  const cc = code.slice(0, 2).toUpperCase();
  if (/^[A-Z]{2}$/.test(cc)) {
    const a = 0x1F1E6 + cc.charCodeAt(0) - 65;
    const b = 0x1F1E6 + cc.charCodeAt(1) - 65;
    return String.fromCodePoint(a, b);
  }
  return '🪙';
}

// ---------- state ----------

const state = {
  source: 'cbr',
  base: 'RUB',
  rates: null,
  ratesDate: '',
  from: 'USD',
  // 3 валюты по умолчанию: USD → EUR → RUB
  // Сверху указываешь "сколько мне надо заплатить", внизу — "сколько с меня спишется в рублях"
  steps: [
    { to: 'EUR', fee: 0, customRate: null },
    { to: 'RUB', fee: 0, customRate: null }
  ],
  anchor: { index: 0, amount: 100 },
  unlocked: false,
  editing: null
};

const POPULAR = ['RUB', 'USD', 'EUR', 'KZT', 'CNY', 'GBP', 'JPY', 'TRY', 'BYN', 'UAH', 'AMD', 'AZN', 'GEL', 'KGS', 'UZS'];
const MAJOR = ['CHF', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'KRW', 'INR', 'BRL', 'MXN', 'ZAR', 'AED', 'SAR', 'ILS', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'HUF', 'THB', 'IDR', 'MYR', 'PHP', 'VND', 'TWD', 'EGP', 'PKR'];

function categorize(code) {
  if (POPULAR.includes(code)) return 'popular';
  if (isCrypto(code)) return 'crypto';
  if (MAJOR.includes(code)) return 'major';
  return 'world';
}

const $ = (id) => document.getElementById(id);
const el = {
  chain: $('chain'),
  addStep: $('addStep'),
  reverseChain: $('reverseChain'),
  shareChain: $('shareChain'),
  summary: $('summary'),
  buyPro: $('buyPro'),
  proSection: $('proSection'),
  proStatus: $('proStatus'),
  brandPro: $('brandPro'),
  ratesDate: $('ratesDate'),
  sourceTabs: document.querySelectorAll('.source-tabs .tab[data-source]'),
  pickerSheet: $('pickerSheet'),
  pickerSearch: $('pickerSearch'),
  pickerClose: $('pickerClose'),
  pickerList: $('pickerList'),
  pickerTabs: $('pickerTabs'),
  themeToggle: $('themeToggle'),
  rateSheet: $('rateSheet'),
  rateClose: $('rateClose'),
  rateInput: $('rateInput'),
  rateFromCode: $('rateFromCode'),
  rateToCode: $('rateToCode'),
  rateMarket: $('rateMarket'),
  feeInput: $('feeInput'),
  rateReset: $('rateReset'),
  rateApply: $('rateApply'),
  proLockBanner: $('proLockBanner'),
  stacksBtn: $('stacksBtn'),
  stacksSheet: $('stacksSheet'),
  stacksClose: $('stacksClose'),
  stacksSave: $('stacksSave'),
  stacksList: $('stacksList'),
  roundToggle: $('roundToggle'),
  // Партнёрская программа
  partnerSection: $('partnerSection'),
  partnerCta:     $('partnerCta'),
  partnerTitle:   $('partnerTitle'),
  partnerText:    $('partnerText'),
  partnerSheet:   $('partnerSheet'),
  partnerClose:   $('partnerClose'),
  partnerCancel:  $('partnerCancel'),
  partnerSubmit:  $('partnerSubmit'),
  partnerSocial:  $('partnerSocial'),
  partnerAbout:   $('partnerAbout'),
};

// ---------- utilities ----------

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 1800);
}

function formatAmount(n) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  // roundMode=on: 2 знака для фиата, 8 для дробной крипты. off: 8/12 — почти без округления.
  const d = roundMode === 'on' ? (abs >= 1 ? 2 : 8) : (abs >= 1 ? 8 : 12);
  return n.toLocaleString('ru-RU', { maximumFractionDigits: d });
}

function formatRate(n) {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (roundMode === 'on') {
    if (abs >= 1) return n.toFixed(2);
    return n.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  }
  // Полная точность: 8 знаков, лишние нули обрезаем
  return n.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

function formatForInput(n) {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const d = roundMode === 'on' ? (abs >= 1 ? 2 : 8) : (abs >= 1 ? 8 : 12);
  return n.toFixed(d).replace(/\.?0+$/, '');
}

function escapeAttr(v) { return String(v).replace(/"/g, '&quot;'); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

// Telegram на мобилке нормализует Unicode и красит 3-буквенные коды по списку валют.
// Никакая текстовая обфускация (zero-width, Math Bold, pseudo-elements) не помогает.
// Рендерим код через canvas как PNG-картинку — парсер видит только пиксели.
const _tickerCache = new Map();
function tickerHtml(code) {
  const s = String(code);
  const theme = document.documentElement.dataset.theme || 'auto';
  const key = s + '|' + theme;
  const cached = _tickerCache.get(key);
  if (cached) return cached;
  const fontSize = 14;
  const fontStack = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const font = `700 ${fontSize}px ${fontStack}`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  const w = Math.max(1, Math.ceil(ctx.measureText(s).width));
  const h = Math.ceil(fontSize * 1.35);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = getComputedStyle(document.body).color || '#fff';
  ctx.fillText(s, 0, h / 2);
  const html = `<img class="tkr" src="${canvas.toDataURL()}" style="height:${h}px;width:${w}px;" alt="">`;
  _tickerCache.set(key, html);
  return html;
}
// Сбрасываем кэш при смене темы — цвет вшит в PNG.
function clearTickerCache() { _tickerCache.clear(); }

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      source: state.source, from: state.from, steps: state.steps, anchor: state.anchor
    }));
  } catch {}
}

// Share-link: web URL вида ?c=USD-EUR-BTC&a=100&s=cbr.
// Открытие через Telegram t.me link с startapp=USD-EUR-BTC__100__cbr — тоже
// поддерживается, парсится из tg.initDataUnsafe.start_param.
// Параметр forTelegram: если true — возвращаем t.me link, который у получателя
// откроет mini app сразу (внутри Telegram); если false — web URL для браузера.
function buildShareUrl(forTelegram = false) {
  const chain = [state.from, ...state.steps.map(s => s.to)].filter(Boolean).join('-');
  const amount = state?.anchor?.amount;
  if (forTelegram) {
    const amt = (Number.isFinite(amount) && amount > 0) ? String(amount) : '';
    // startapp param ограничен [A-Za-z0-9_-], максимум 64 chars — пакуем '__' как разделитель.
    const startApp = [chain, amt, state.source].join('__');
    return `${BOT_LINK}?startapp=${startApp}`;
  }
  const params = new URLSearchParams();
  params.set('c', chain);
  if (Number.isFinite(amount) && amount > 0) params.set('a', String(amount));
  params.set('s', state.source);
  return `${location.origin}/?${params.toString()}`;
}

// Возвращает true если из URL/start_param удалось разобрать цепочку
// (тогда loadState() из localStorage НЕ должен этот state перезаписать).
function hydrateFromShare() {
  let c = null, a = null, s = null;
  const params = new URLSearchParams(location.search);
  c = params.get('c'); a = params.get('a'); s = params.get('s');
  // start_param формат: chain__amount__source (амп/равно запрещены в Telegram startapp)
  if (!c && tg?.initDataUnsafe?.start_param) {
    const parts = String(tg.initDataUnsafe.start_param).split('__');
    c = parts[0] || null; a = parts[1] || null; s = parts[2] || null;
  }
  if (!c) return false;
  const codes = c.split('-').map(x => x.trim().toUpperCase()).filter(Boolean);
  if (codes.length < 2) return false;
  state.from = codes[0];
  state.steps = codes.slice(1).map(to => ({ to, fee: 0, customRate: null }));
  const amount = Number(a);
  if (Number.isFinite(amount) && amount > 0) state.anchor = { index: 0, amount };
  if (s === 'cbr' || s === 'open') state.source = s;
  return true;
}

async function shareChain() {
  // В Telegram отдаём t.me link — у получателя сразу откроется mini app.
  // В браузере отдаём web URL — открывается на converter.technology с автозаполнением.
  const url = buildShareUrl(isInTelegram());
  // 1. В Telegram — родной share-диалог через openTelegramLink.
  if (isInTelegram() && tg?.openTelegramLink) {
    try {
      const text = 'Цепочка конвертации в Converter++';
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
      return;
    } catch {}
  }
  // 2. Браузер — clipboard.
  try {
    await navigator.clipboard.writeText(url);
    showToast('Ссылка скопирована');
    hapticNotif('success');
    return;
  } catch { /* clipboard может быть запрещён в iOS WebView без HTTPS-gesture */ }
  // 3. Фолбэк — prompt(), пусть юзер скопирует руками.
  prompt('Скопируйте ссылку:', url);
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved) return;
    if (saved.source === 'cbr' || saved.source === 'open') state.source = saved.source;
    if (typeof saved.from === 'string') state.from = saved.from;
    if (Array.isArray(saved.steps) && saved.steps.length) {
      state.steps = saved.steps
        .filter(s => s && typeof s.to === 'string')
        .map(s => ({
          to: s.to,
          fee: Number.isFinite(s.fee) ? s.fee : 0,
          customRate: Number.isFinite(s.customRate) && s.customRate > 0 ? s.customRate : null
        }));
    }
    if (saved.anchor && Number.isFinite(saved.anchor.amount)) {
      state.anchor = {
        index: Number.isFinite(saved.anchor.index) ? saved.anchor.index : 0,
        amount: saved.anchor.amount
      };
    }
  } catch {}
}

// ---------- rates ----------

async function loadRates(source = state.source) {
  const r = await fetch(`/api/rates?source=${source}`);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || 'Не удалось загрузить курсы');
  }
  const data = await r.json();
  state.source = data.source;
  state.base = data.base;
  state.rates = data.rates;
  state.ratesDate = data.date;
  const label = data.source === 'cbr' ? 'ЦБ РФ' : 'Open rates';
  el.ratesDate.textContent = `${label}${data.date ? ' · ' + data.date : ''}`;
  for (const tab of el.sourceTabs) {
    tab.classList.toggle('active', tab.dataset.source === state.source);
  }
}

function marketRate(fromCode, toCode) {
  const f = state.rates?.[fromCode];
  const t = state.rates?.[toCode];
  if (!f || !t) return NaN;
  return f.value / t.value;
}

function pickFallback(preferred) {
  if (state.rates?.[preferred]) return preferred;
  for (const c of POPULAR) if (state.rates?.[c]) return c;
  return Object.keys(state.rates || {})[0];
}

// ---------- compute ----------

function computeFlow() {
  const codes = [state.from, ...state.steps.map(s => s.to)];
  const fees = [0, ...state.steps.map(s => s.fee)];
  const customRates = [null, ...state.steps.map(s => s.customRate)];

  const transitions = [];
  for (let k = 0; k < codes.length - 1; k++) {
    const cr = customRates[k + 1];
    const market = marketRate(codes[k], codes[k + 1]);
    const isCustom = Number.isFinite(cr) && cr > 0;
    transitions.push({ rate: isCustom ? cr : market, market, isCustom });
  }

  const aIdx = clamp(state.anchor.index, 0, codes.length - 1);
  const amounts = new Array(codes.length);
  amounts[aIdx] = state.anchor.amount;

  for (let i = aIdx; i < codes.length - 1; i++) {
    const t = transitions[i];
    amounts[i + 1] = amounts[i] * t.rate * (1 - fees[i + 1] / 100);
  }
  for (let i = aIdx; i > 0; i--) {
    const t = transitions[i - 1];
    const k = t.rate * (1 - fees[i] / 100);
    amounts[i - 1] = k !== 0 ? amounts[i] / k : NaN;
  }

  return codes.map((code, i) => ({
    code,
    amount: amounts[i],
    fee: fees[i],
    transition: i > 0 ? transitions[i - 1] : null,
    fromCode: i > 0 ? codes[i - 1] : null
  }));
}

// ---------- render ----------

function rowHtml(row, i, opts) {
  const { isOrigin, isFinal, isAnchor } = opts;
  const classes = ['row'];
  if (isOrigin) classes.push('origin');
  if (isFinal) classes.push('final');
  if (isAnchor) classes.push('anchor');
  const rateInfo = state.rates[row.code];
  const name = rateInfo?.name ? escapeHtml(rateInfo.name) : tickerHtml(row.code);
  return `
    <div class="${classes.join(' ')}" data-index="${i}">
      <button class="cur-pick" type="button" data-pick="${i}">
        <span class="cur-flag">${currencyIcon(row.code)}</span>
        <span class="cur-meta">
          <span class="cur-code">${tickerHtml(row.code)}</span>
          <span class="cur-name">${name}</span>
        </span>
        <span class="cur-chev">⌄</span>
      </button>
      <input
        type="number"
        class="row-amount"
        data-index="${i}"
        inputmode="decimal"
        step="any"
        min="0"
        value="${escapeAttr(formatForInput(row.amount))}"
        aria-label="Сумма"
      >
      ${isFinal ? '<span class="row-tag">Итого</span>' : ''}
      ${isOrigin ? '' : `<button class="row-remove" data-remove="${i}" title="Убрать" aria-label="Убрать">✕</button>`}
    </div>
  `;
}

function transitionHtml(t, i, fee, fromCode, toCode) {
  const rate = t.isCustom ? t.rate : t.market;
  const rateClass = 'rate-pill' + (t.isCustom ? ' custom' : '');
  const feeClass = 'fee-pill' + (fee > 0 ? ' active' : '');
  return `
    <div class="transition" data-transition="${i}">
      <button class="${rateClass}" type="button" data-edit-rate="${i}" title="Курс конвертации">
        <span class="pill-icon">${t.isCustom ? '🔒' : '↓'}</span>
        <span class="pill-text">1 ${tickerHtml(fromCode)} = ${formatRate(rate)} ${tickerHtml(toCode)}</span>
      </button>
      <button class="${feeClass}" type="button" data-edit-fee="${i}" title="Комиссия">
        <span class="pill-icon">💰</span>
        <span class="pill-text">${formatRate(fee || 0)}%</span>
      </button>
      <button class="trans-swap" type="button" data-swap="${i}" title="Поменять валюты" aria-label="Поменять">⇄</button>
    </div>
  `;
}

function render() {
  if (!state.rates) return;
  state.anchor.index = clamp(state.anchor.index, 0, state.steps.length);

  const flow = computeFlow();
  const html = [];
  flow.forEach((row, i) => {
    const isOrigin = i === 0;
    const isFinal = i === flow.length - 1 && !isOrigin;
    const isAnchor = i === state.anchor.index;
    html.push(rowHtml(row, i, { isOrigin, isFinal, isAnchor }));
    if (i < flow.length - 1) {
      const next = flow[i + 1];
      html.push(transitionHtml(next.transition, i, next.fee, row.code, next.code));
    }
  });
  el.chain.innerHTML = html.join('');

  attachHandlers();
  renderSummary(flow);
}

function renderSummary(flow) {
  if (flow.length < 2) { el.summary.innerHTML = ''; return; }
  const first = flow[0], last = flow[flow.length - 1];
  if (!Number.isFinite(first.amount) || !Number.isFinite(last.amount) || first.amount === 0) {
    el.summary.innerHTML = '';
    return;
  }
  const rate = last.amount / first.amount;
  const market = marketRate(first.code, last.code);
  const lossPct = market ? ((market - rate) / market) * 100 : 0;
  const lossText = Math.abs(lossPct) > 0.005
    ? `<span class="${lossPct > 0 ? 'loss' : 'gain'}">${lossPct > 0 ? '−' : '+'}${Math.abs(lossPct).toFixed(2)}%</span>`
    : '';

  // Сколько съела комиссия: считаем, какой был бы last.amount, если бы все fee = 0%.
  // multiplier = ∏(1 − fee_i/100). theoretical_last = actual_last / multiplier. eaten = theoretical − actual.
  const feeMul = flow.slice(1).reduce((acc, row) => acc * (1 - (row.fee || 0) / 100), 1);
  const eaten = feeMul > 0 ? last.amount * (1 / feeMul - 1) : 0;
  const feeRow = eaten > 0
    ? `<div class="sum-row">
         <span class="sum-label">Комиссия съела</span>
         <span class="sum-value">${formatAmount(eaten)} ${tickerHtml(last.code)}</span>
       </div>`
    : '';

  el.summary.innerHTML = `
    <div class="sum-row">
      <span class="sum-label">Эффективный курс</span>
      <span class="sum-value">1 ${tickerHtml(first.code)} = ${formatRate(rate)} ${tickerHtml(last.code)} ${lossText}</span>
    </div>
    ${feeRow}
  `;
}

// ---------- handlers ----------

function attachHandlers() {
  for (const btn of el.chain.querySelectorAll('button[data-pick]')) {
    btn.addEventListener('click', () => openPicker(Number(btn.dataset.pick)));
  }
  for (const input of el.chain.querySelectorAll('input.row-amount')) {
    input.addEventListener('input', e => {
      const i = Number(e.target.dataset.index);
      const v = parseFloat(e.target.value);
      state.anchor = { index: i, amount: Number.isFinite(v) ? v : 0 };
      saveState();
      partialRefresh(i);
      markAnchorRow(i);
    });
    input.addEventListener('focus', e => markAnchorRow(Number(e.target.dataset.index)));
  }
  for (const btn of el.chain.querySelectorAll('button[data-remove]')) {
    btn.addEventListener('click', e => {
      const i = Number(e.currentTarget.dataset.remove);
      if (i === 0) return;
      state.steps.splice(i - 1, 1);
      if (state.steps.length === 0) {
        state.steps.push({ to: defaultNextCurrency(), fee: 0, customRate: null });
      }
      if (state.anchor.index >= state.steps.length + 1) {
        state.anchor.index = Math.max(0, state.anchor.index - 1);
      }
      haptic('rigid');
      saveState();
      render();
    });
  }
  for (const btn of el.chain.querySelectorAll('button[data-edit-rate]')) {
    btn.addEventListener('click', e => openRateSheet(Number(e.currentTarget.dataset.editRate), 'rate'));
  }
  for (const btn of el.chain.querySelectorAll('button[data-edit-fee]')) {
    btn.addEventListener('click', e => openRateSheet(Number(e.currentTarget.dataset.editFee), 'fee'));
  }
  for (const btn of el.chain.querySelectorAll('button[data-swap]')) {
    btn.addEventListener('click', e => swapAt(Number(e.currentTarget.dataset.swap)));
  }
}

function partialRefresh(skipIndex = -1) {
  const flow = computeFlow();
  for (const input of el.chain.querySelectorAll('input.row-amount')) {
    const i = Number(input.dataset.index);
    if (i === skipIndex) continue;
    const next = formatForInput(flow[i]?.amount);
    if (input.value !== next) input.value = next;
  }
  renderSummary(flow);
}

function markAnchorRow(i) {
  state.anchor.index = i;
  for (const row of el.chain.querySelectorAll('.row')) {
    row.classList.toggle('anchor', Number(row.dataset.index) === i);
  }
}

function swapAt(i) {
  const codeA = i === 0 ? state.from : state.steps[i - 1].to;
  const codeB = state.steps[i].to;
  if (i === 0) state.from = codeB;
  else state.steps[i - 1].to = codeB;
  state.steps[i].to = codeA;
  state.steps[i].customRate = null;
  if (i > 0) state.steps[i - 1].customRate = null;
  haptic('light');
  saveState();
  render();
}

function defaultNextCurrency() {
  if (!state.rates) return 'USD';
  const used = new Set([state.from, ...state.steps.map(s => s.to)]);
  for (const c of POPULAR) if (state.rates[c] && !used.has(c)) return c;
  for (const c of Object.keys(state.rates)) if (!used.has(c)) return c;
  return 'USD';
}

// ---------- currency picker sheet ----------

let pickerTargetIndex = -1;
let pickerTab = 'popular';

function openPicker(index) {
  pickerTargetIndex = index;
  el.pickerSearch.value = '';
  updatePickerTabCounts();
  // Если в текущем табе 0 валют — переключиться на первый непустой
  const counts = computePickerCounts();
  if (counts[pickerTab] === 0) {
    pickerTab = ['popular', 'major', 'world', 'crypto'].find(t => counts[t] > 0) || 'popular';
  }
  applyActiveTab();
  renderPickerList();
  openSheet(el.pickerSheet);
  setTimeout(() => el.pickerSearch.focus(), 50);
}

function computePickerCounts() {
  const counts = { popular: 0, major: 0, world: 0, crypto: 0 };
  for (const code of Object.keys(state.rates)) counts[categorize(code)]++;
  return counts;
}

function updatePickerTabCounts() {
  const counts = computePickerCounts();
  for (const tab of el.pickerTabs.querySelectorAll('.picker-tab')) {
    const key = tab.dataset.tab;
    const countEl = tab.querySelector('[data-count]');
    if (countEl) countEl.textContent = counts[key] || '';
    tab.disabled = counts[key] === 0 && !el.pickerSearch.value.trim();
    tab.classList.toggle('empty', counts[key] === 0);
  }
}

function applyActiveTab() {
  for (const tab of el.pickerTabs.querySelectorAll('.picker-tab')) {
    tab.classList.toggle('active', tab.dataset.tab === pickerTab);
  }
}

function renderPickerList() {
  const q = el.pickerSearch.value.trim().toLowerCase();
  const all = Object.keys(state.rates);

  let codes;
  if (q) {
    codes = all.filter(code =>
      code.toLowerCase().includes(q) ||
      (state.rates[code].name || '').toLowerCase().includes(q)
    );
    el.pickerTabs.classList.add('searching');
  } else {
    codes = all.filter(code => categorize(code) === pickerTab);
    el.pickerTabs.classList.remove('searching');
  }

  // Sort: фиксированный порядок для POPULAR/MAJOR, алфавит для остальных
  if (!q && pickerTab === 'popular') {
    codes.sort((a, b) => POPULAR.indexOf(a) - POPULAR.indexOf(b));
  } else if (!q && pickerTab === 'major') {
    codes.sort((a, b) => {
      const ia = MAJOR.indexOf(a), ib = MAJOR.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  } else {
    codes.sort();
  }

  if (!codes.length) {
    el.pickerList.innerHTML = `<div class="picker-empty">${q ? 'Ничего не найдено' : 'В этой категории пусто'}</div>`;
    return;
  }

  el.pickerList.innerHTML = codes.map(code => `
    <button class="picker-item" type="button" data-pick-code="${code}">
      <span class="picker-flag">${currencyIcon(code)}</span>
      <span class="picker-text">
        <span class="picker-code">${tickerHtml(code)}</span>
        <span class="picker-name">${state.rates[code].name ? escapeHtml(state.rates[code].name) : tickerHtml(code)}</span>
      </span>
    </button>
  `).join('');

  for (const btn of el.pickerList.querySelectorAll('button[data-pick-code]')) {
    btn.addEventListener('click', () => onPicked(btn.dataset.pickCode));
  }
  el.pickerList.scrollTop = 0;
}

function onPicked(code) {
  const i = pickerTargetIndex;
  if (i === 0) state.from = code;
  else if (state.steps[i - 1]) {
    state.steps[i - 1].to = code;
    state.steps[i - 1].customRate = null; // rate привязан к паре — сбрасываем
  }
  closeSheet(el.pickerSheet);
  haptic('light');
  saveState();
  render();
}

el.pickerClose.addEventListener('click', () => closeSheet(el.pickerSheet));
el.pickerSearch.addEventListener('input', () => renderPickerList());
el.pickerSheet.addEventListener('click', e => {
  if (e.target === el.pickerSheet) closeSheet(el.pickerSheet);
});

for (const tab of el.pickerTabs.querySelectorAll('.picker-tab')) {
  tab.addEventListener('click', () => {
    if (tab.disabled) return;
    pickerTab = tab.dataset.tab;
    el.pickerSearch.value = '';
    applyActiveTab();
    renderPickerList();
    haptic('light');
  });
}

// ---------- rate / fee editor ----------

function openRateSheet(stepIndex, mode = 'rate') {
  // Браузер-юзер без Pro кликнул свой курс / комиссию → редирект в бот,
  // где есть Mini App с возможностью купить Pro (Stars в браузере недоступны).
  if (!state.unlocked && !isInTelegram()) { gotoTelegramMiniApp('editor'); return; }
  state.editing = stepIndex;
  state.editingMode = mode;
  const step = state.steps[stepIndex];
  const codes = [state.from, ...state.steps.map(s => s.to)];
  const fromCode = codes[stepIndex];
  const toCode = codes[stepIndex + 1];
  const market = marketRate(fromCode, toCode);

  el.rateFromCode.innerHTML = tickerHtml(fromCode);
  el.rateToCode.innerHTML = tickerHtml(toCode);
  el.rateInput.value = Number.isFinite(step.customRate) ? step.customRate : '';
  el.rateInput.placeholder = formatRate(market);
  el.rateMarket.innerHTML = `Рыночный курс: 1 ${tickerHtml(fromCode)} = <strong>${formatRate(market)}</strong> ${tickerHtml(toCode)}`;
  el.feeInput.value = step.fee || '';

  // Show only the section that corresponds to the tapped pill
  document.getElementById('rateSheetTitle').textContent =
    mode === 'fee' ? 'Комиссия' : 'Свой курс';
  for (const section of el.rateSheet.querySelectorAll('.editor-section')) {
    section.classList.toggle('hidden', section.dataset.section !== mode);
  }

  el.proLockBanner.classList.toggle('hidden', state.unlocked);
  el.rateInput.disabled = !state.unlocked;
  el.feeInput.disabled = !state.unlocked;
  el.rateApply.disabled = !state.unlocked;
  el.rateReset.disabled = !state.unlocked;
  openSheet(el.rateSheet);
  setTimeout(() => {
    if (!state.unlocked) return;
    (mode === 'fee' ? el.feeInput : el.rateInput).focus();
  }, 50);
}

el.rateClose.addEventListener('click', () => closeSheet(el.rateSheet));
el.rateSheet.addEventListener('click', e => {
  if (e.target === el.rateSheet) closeSheet(el.rateSheet);
});

el.rateApply.addEventListener('click', () => {
  if (state.editing == null) return closeSheet(el.rateSheet);
  const step = state.steps[state.editing];
  if (!step) return closeSheet(el.rateSheet);
  if (state.editingMode === 'fee') {
    const f = parseFloat(el.feeInput.value);
    step.fee = Number.isFinite(f) ? clamp(f, 0, 100) : 0;
  } else {
    const r = parseFloat(el.rateInput.value);
    step.customRate = Number.isFinite(r) && r > 0 ? r : null;
  }
  haptic('light');
  saveState();
  closeSheet(el.rateSheet);
  render();
});

el.rateReset.addEventListener('click', () => {
  if (state.editing == null) return;
  const step = state.steps[state.editing];
  if (!step) return;
  if (state.editingMode === 'fee') {
    step.fee = 0;
    el.feeInput.value = '';
  } else {
    step.customRate = null;
    el.rateInput.value = '';
  }
  haptic('light');
});

// ---------- sheet helpers ----------

function openSheet(sheet) {
  sheet.classList.remove('hidden');
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => sheet.classList.add('visible'));
  haptic('light');
}

function closeSheet(sheet) {
  sheet.classList.remove('visible');
  setTimeout(() => {
    sheet.classList.add('hidden');
    document.body.classList.remove('sheet-open');
  }, 220);
}

// ---------- saved stacks ----------

function loadStacks() {
  try {
    const raw = localStorage.getItem(STACKS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveStacks(stacks) {
  try { localStorage.setItem(STACKS_KEY, JSON.stringify(stacks)); } catch {}
}

function renderStacks() {
  if (!state.unlocked) {
    el.stacksSave.classList.add('hidden');
    el.stacksList.innerHTML = `
      <div class="stacks-lock">
        <div class="stacks-lock-icon">⭐</div>
        <div class="stacks-lock-title">Сохранение цепочек — в Pro</div>
        <div class="stacks-lock-text">Сохраняйте готовые конфигурации обмена со всеми кастомными курсами и комиссиями. Возвращайтесь к любимым одним тапом.</div>
        <button type="button" class="stacks-lock-cta" id="stacksLockCta">Купить полную версию · <strong>100 ⭐</strong></button>
      </div>
    `;
    const cta = document.getElementById('stacksLockCta');
    if (cta) cta.addEventListener('click', () => triggerBuyPro(cta));
    return;
  }
  el.stacksSave.classList.remove('hidden');
  const stacks = loadStacks();
  if (!stacks.length) {
    el.stacksList.innerHTML = '<div class="stacks-empty">Пока ничего не сохранено.<br>Соберите цепочку — и сохраните её сюда, чтобы возвращаться одним тапом.</div>';
    return;
  }
  el.stacksList.innerHTML = stacks.map((s, i) => {
    const codes = [s.from, ...s.steps.map(st => st.to)];
    const preview = codes.map(c => tickerHtml(c)).join(' <span class="muted">→</span> ');
    return `
      <div class="stack-item" data-load="${i}">
        <div class="stack-body">
          <div class="stack-name">${escapeHtml(s.name)}</div>
          <div class="stack-preview">${preview}</div>
        </div>
        <button type="button" class="stack-delete" data-delete="${i}" aria-label="Удалить">✕</button>
      </div>
    `;
  }).join('');
  for (const item of el.stacksList.querySelectorAll('[data-load]')) {
    item.addEventListener('click', e => {
      if (e.target.closest('[data-delete]')) return;
      applyStack(Number(item.dataset.load));
    });
  }
  for (const btn of el.stacksList.querySelectorAll('[data-delete]')) {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteStack(Number(btn.dataset.delete));
    });
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function saveCurrentStack() {
  if (!state.unlocked) {
    if (!isInTelegram()) { gotoTelegramMiniApp('save'); return; }
    showToast('Доступно в полной версии');
    return;
  }
  const defaultName = [state.from, ...state.steps.map(s => s.to)].join('→');
  const name = (prompt('Назовите цепочку:', defaultName) || '').trim();
  if (!name) return;
  const stacks = loadStacks();
  stacks.unshift({
    name,
    from: state.from,
    steps: state.steps.map(s => ({ to: s.to, fee: s.fee, customRate: s.customRate })),
    createdAt: Date.now()
  });
  saveStacks(stacks);
  renderStacks();
  showToast('Сохранено: ' + name);
  hapticNotif('success');
}

function applyStack(i) {
  const stacks = loadStacks();
  const s = stacks[i];
  if (!s) return;
  state.from = s.from;
  state.steps = s.steps.map(st => ({ to: st.to, fee: st.fee || 0, customRate: st.customRate || null }));
  state.anchor = { index: 0, amount: state.anchor.amount || 100 };
  saveState();
  render();
  closeSheet(el.stacksSheet);
  showToast('Загружено: ' + s.name);
  haptic('light');
}

function deleteStack(i) {
  const stacks = loadStacks();
  const s = stacks[i];
  if (!s) return;
  stacks.splice(i, 1);
  saveStacks(stacks);
  renderStacks();
  haptic('light');
}

function applyRoundUi() {
  if (!el.roundToggle) return;
  el.roundToggle.classList.toggle('off', roundMode === 'off');
  el.roundToggle.title = roundMode === 'on' ? 'Округление: вкл (2 знака)' : 'Округление: выкл (полная точность)';
}

// ---------- pro ----------

async function checkUnlock() {
  try {
    const r = await fetch('/api/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg?.initData || '' })
    });
    const data = await r.json();
    state.unlocked = !!data.unlocked;
    applyUnlockUi();
    // Если шит со стопками открыт — обновим его (paywall → unlocked-view после оплаты)
    if (!el.stacksSheet.classList.contains('hidden')) renderStacks();
  } catch (err) { console.error('checkUnlock', err); }
}

async function triggerBuyPro(btnEl) {
  if (!isInTelegram()) { gotoTelegramMiniApp('pro'); return; }
  if (btnEl) btnEl.disabled = true;
  try {
    const r = await fetch('/api/create-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData })
    });
    const data = await r.json();
    if (!data.link) throw new Error(data.error || 'Не удалось создать счёт');
    tg.openInvoice(data.link, status => {
      if (status === 'paid') {
        showToast('Pro активирован'); hapticNotif('success');
        setTimeout(checkUnlock, 1500);
      } else if (status === 'failed') {
        showToast('Платёж не прошёл'); hapticNotif('error');
      } else if (status === 'cancelled') {
        showToast('Платёж отменён');
      }
    });
  } catch (err) {
    showToast(err.message || 'Ошибка'); hapticNotif('error');
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

function applyUnlockUi() {
  el.proStatus.textContent = state.unlocked ? '✓ Pro' : '🔒';
  el.proStatus.classList.toggle('locked', !state.unlocked);
  el.proStatus.classList.toggle('unlocked', state.unlocked);
  if (el.brandPro) el.brandPro.classList.toggle('shown', state.unlocked);
  el.proSection.classList.toggle('unlocked', state.unlocked);
  applyPartnerUi();  // unlocked мог поменяться (после accept admin'ом) — скрываем баннер
  render();
}

// ---------- partner program ----------

const partnerState = { open: false, applied: null, is_partner: false };

async function fetchPartnerStatus() {
  // В браузере нет initData → нет смысла дёргать (всё равно ничего не покажем).
  if (!isInTelegram()) { applyPartnerUi(); return; }
  try {
    const r = await fetch('/api/partner/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData })
    });
    const data = await r.json();
    partnerState.open       = !!data.open;
    partnerState.applied    = data.applied || null;
    partnerState.is_partner = !!data.is_partner;
  } catch (err) {
    console.error('fetchPartnerStatus', err);
  }
  applyPartnerUi();
}

function applyPartnerUi() {
  // Видимость: только в Telegram, юзер ещё без Pro (paid тоже скрываем — он
  // уже заплатил, нет смысла предлагать партнёрку), и (приём открыт ИЛИ есть
  // pending/rejected статус — чтобы юзер видел итог свой заявки).
  const inTg = isInTelegram();
  const hasApplication = !!partnerState.applied;
  const visible = inTg && !state.unlocked && (partnerState.open || hasApplication);
  el.partnerSection.classList.toggle('hidden', !visible);
  if (!visible) return;

  // Состояния:
  //  pending  — «Заявка на рассмотрении» (disable CTA)
  //  rejected — «Отклонена · подать снова через N дн / Подать» если истёк cooldown
  //  null + open — «Стать партнёром» / «Подать»
  if (partnerState.applied?.status === 'pending') {
    el.partnerTitle.textContent = 'Заявка на рассмотрении';
    el.partnerText.textContent  = 'Мы посмотрим её в ближайшие дни и ответим в DM от бота.';
    el.partnerCta.textContent   = '⏳';
    el.partnerCta.disabled      = true;
    el.partnerSection.classList.add('partner--waiting');
    el.partnerSection.classList.remove('partner--rejected');
  } else if (partnerState.applied?.status === 'rejected') {
    el.partnerTitle.textContent = 'Заявка не подошла';
    const reason = partnerState.applied.reason ? ` (${partnerState.applied.reason})` : '';
    const days = Math.ceil(((30 * 24 * 60 * 60 * 1000) - (Date.now() - (partnerState.applied.applied_at || 0))) / (24 * 60 * 60 * 1000));
    el.partnerText.textContent  = `Можно подать снова через ${Math.max(0, days)} дн${reason}.`;
    el.partnerCta.textContent   = days <= 0 && partnerState.open ? 'Подать' : '—';
    el.partnerCta.disabled      = !(days <= 0 && partnerState.open);
    el.partnerSection.classList.add('partner--rejected');
    el.partnerSection.classList.remove('partner--waiting');
  } else {
    el.partnerTitle.textContent = 'Стать партнёром';
    el.partnerText.textContent  = 'Бесплатный Pro в обмен на упоминание у себя в соцсетях. Подай заявку — рассмотрим.';
    el.partnerCta.textContent   = 'Подать';
    el.partnerCta.disabled      = false;
    el.partnerSection.classList.remove('partner--waiting', 'partner--rejected');
  }
}

function openPartnerSheet() {
  el.partnerSocial.value = '';
  el.partnerAbout.value  = '';
  openSheet(el.partnerSheet);
}

async function submitPartnerApplication() {
  const social = el.partnerSocial.value.trim();
  const about  = el.partnerAbout.value.trim();
  if (social.length < 3)  { showToast('Укажи ссылки на соцсети'); return; }
  if (about.length  < 20) { showToast('Расскажи о себе хотя бы парой предложений'); return; }

  el.partnerSubmit.disabled = true;
  const orig = el.partnerSubmit.textContent;
  el.partnerSubmit.textContent = '…';
  try {
    const r = await fetch('/api/partner/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData, social, about })
    });
    const data = await r.json();
    if (r.ok && data.ok) {
      closeSheet(el.partnerSheet);
      showToast('Заявка отправлена');
      hapticNotif('success');
      await fetchPartnerStatus();
    } else {
      showToast(data.error || 'Не удалось отправить');
      hapticNotif('error');
    }
  } catch (err) {
    showToast(err.message || 'Ошибка'); hapticNotif('error');
  } finally {
    el.partnerSubmit.disabled = false;
    el.partnerSubmit.textContent = orig;
  }
}

// ---------- top-level listeners ----------

if (el.themeToggle) {
  el.themeToggle.addEventListener('click', () => {
    const current = el.themeToggle.dataset.theme || 'system';
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    applyTheme(next);
    clearTickerCache();
    render();
    showToast(`Тема: ${THEME_LABELS[next]}`);
    haptic('light');
  });
}

if (el.roundToggle) {
  el.roundToggle.addEventListener('click', () => {
    roundMode = roundMode === 'on' ? 'off' : 'on';
    try { localStorage.setItem(ROUND_KEY, roundMode); } catch {}
    applyRoundUi();
    render();
    showToast(roundMode === 'on' ? 'Округление: 2 знака' : 'Полная точность');
    haptic('light');
  });
}

el.addStep.addEventListener('click', () => {
  state.steps.push({ to: defaultNextCurrency(), fee: 0, customRate: null });
  haptic('light');
  saveState();
  render();
});

el.reverseChain.addEventListener('click', () => {
  const codes = [state.from, ...state.steps.map(s => s.to)];
  const fees = [0, ...state.steps.map(s => s.fee)];
  codes.reverse();
  fees.reverse();
  state.from = codes[0];
  state.steps = codes.slice(1).map((to, i) => ({ to, fee: fees[i + 1], customRate: null }));
  haptic('medium');
  saveState();
  render();
});

el.shareChain.addEventListener('click', () => { haptic('light'); shareChain(); });

for (const tab of el.sourceTabs) {
  tab.addEventListener('click', async () => {
    if (tab.dataset.source === state.source) return;
    for (const t of el.sourceTabs) t.disabled = true;
    try {
      const prevFrom = state.from;
      const prevSteps = state.steps.map(s => ({ ...s }));
      await loadRates(tab.dataset.source);
      state.from = pickFallback(prevFrom);
      state.steps = prevSteps.map(s => ({ to: pickFallback(s.to), fee: s.fee, customRate: s.customRate }));
      saveState();
      render();
      haptic('light');
    } catch (err) {
      showToast(err.message || 'Ошибка');
    } finally {
      for (const t of el.sourceTabs) t.disabled = false;
    }
  });
}

el.stacksBtn.addEventListener('click', () => {
  renderStacks();
  openSheet(el.stacksSheet);
});
el.stacksClose.addEventListener('click', () => closeSheet(el.stacksSheet));
el.stacksSheet.addEventListener('click', e => {
  if (e.target === el.stacksSheet) closeSheet(el.stacksSheet);
});
el.stacksSave.addEventListener('click', saveCurrentStack);

el.buyPro.addEventListener('click', async () => {
  const orig = el.buyPro.textContent;
  el.buyPro.textContent = '…';
  try { await triggerBuyPro(el.buyPro); }
  finally { el.buyPro.textContent = orig; }
});

// Партнёрская программа
if (el.partnerCta) {
  el.partnerCta.addEventListener('click', () => {
    if (el.partnerCta.disabled) return;
    haptic('light');
    openPartnerSheet();
  });
}
if (el.partnerClose)  el.partnerClose.addEventListener('click', () => closeSheet(el.partnerSheet));
if (el.partnerCancel) el.partnerCancel.addEventListener('click', () => closeSheet(el.partnerSheet));
if (el.partnerSheet)  el.partnerSheet.addEventListener('click', e => {
  if (e.target === el.partnerSheet) closeSheet(el.partnerSheet);
});
if (el.partnerSubmit) el.partnerSubmit.addEventListener('click', submitPartnerApplication);

// ---------- init ----------

(async () => {
  loadState();
  // Share-link / startapp param «выигрывает» у localStorage: юзер открыл
  // именно эту ссылку — значит ему интересна цепочка из ссылки, не его старая.
  hydrateFromShare();
  applyRoundUi();
  try {
    await loadRates(state.source);
    state.from = pickFallback(state.from);
    state.steps = state.steps.map(s => ({ ...s, to: pickFallback(s.to) }));
    await checkUnlock();
    fetchPartnerStatus();  // fire-and-forget — UI отрисуется когда придёт ответ
    render();
  } catch (err) {
    console.error(err);
    document.querySelector('main').innerHTML = `<div class="error">${escapeHtml(err.message || 'Ошибка')}</div>`;
  }
})();
