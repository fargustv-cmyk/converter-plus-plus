import express from 'express';
import { XMLParser } from 'fast-xml-parser';
import { Redis } from '@upstash/redis';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const STARS_PRICE = Number(process.env.STARS_PRICE) || 100;
// secret_token, который Telegram кладёт в заголовок X-Telegram-Bot-Api-Secret-Token
// на каждом webhook-апдейте. Без него любой, кто знает URL, мог бы слать поддельные
// обновления (фейковые successful_payment). Берётся из env, чтобы при rotate не
// переразворачивать. Если не задан — webhook без проверки (как было раньше).
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const APP_PHOTO_URL  = process.env.APP_PHOTO_URL || 'https://converter.technology/invoice-photo.png';
// Список Telegram user ID, которые всегда имеют Pro (без оплаты). Через запятую.
const PRO_USER_IDS = new Set(
  (process.env.PRO_USER_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean)
);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store, must-revalidate'); }
}));

// Redis для персистентности купивших Pro. Если env-переменные не заданы —
// работаем только в памяти (платежи теряются при рестарте; ОК для dev/тестов).
const redis = (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    })
  : null;
const PAID_KEY    = 'paid_users';
// Hash userId → telegram_payment_charge_id (последний платёж).
// Нужно для refundStarPayment — без charge_id рефанд физически невозможен.
const CHARGES_KEY = 'charges_by_user';

const paidUsers      = new Set();
const chargesByUser  = new Map();  // userId(Number) → charge_id(String)

async function loadPaidUsers() {
  if (!redis) return;
  try {
    const ids = await redis.smembers(PAID_KEY);
    for (const id of ids || []) {
      const n = Number(id);
      if (Number.isFinite(n)) paidUsers.add(n);
    }
    const charges = await redis.hgetall(CHARGES_KEY);
    for (const [uid, chargeId] of Object.entries(charges || {})) {
      const n = Number(uid);
      if (Number.isFinite(n) && chargeId) chargesByUser.set(n, String(chargeId));
    }
    console.log(`Loaded ${paidUsers.size} paid user(s), ${chargesByUser.size} charge(s) from Redis`);
  } catch (err) {
    console.error('Failed to load paid users from Redis:', err);
  }
}

async function markUserPaid(userId, chargeId) {
  paidUsers.add(userId);
  if (chargeId) chargesByUser.set(userId, chargeId);
  if (!redis) return;
  try {
    await redis.sadd(PAID_KEY, String(userId));
    if (chargeId) await redis.hset(CHARGES_KEY, { [String(userId)]: chargeId });
  } catch (err) {
    console.error('Failed to persist paid user to Redis:', err);
  }
}

async function unmarkUserPaid(userId) {
  paidUsers.delete(userId);
  chargesByUser.delete(userId);
  if (!redis) return;
  try {
    await redis.srem(PAID_KEY, String(userId));
    await redis.hdel(CHARGES_KEY, String(userId));
  } catch (err) {
    console.error('Failed to unpersist paid user from Redis:', err);
  }
}

function isUnlocked(userId) {
  return PRO_USER_IDS.has(userId) || paidUsers.has(userId);
}

const ratesCache = new Map();
const RATES_TTL_MS = 60 * 60 * 1000;

// Русские названия валют для популярных fiat-кодов. Для остального fallback на имя из API.
const RU_NAMES = {
  USD: 'Доллар США', EUR: 'Евро', GBP: 'Фунт стерлингов', JPY: 'Японская иена',
  CNY: 'Китайский юань', RUB: 'Российский рубль', KZT: 'Казахстанский тенге',
  UAH: 'Украинская гривна', BYN: 'Белорусский рубль', AMD: 'Армянский драм',
  AZN: 'Азербайджанский манат', GEL: 'Грузинский лари', KGS: 'Киргизский сом',
  TJS: 'Таджикский сомони', UZS: 'Узбекский сум', MDL: 'Молдавский лей',
  TMT: 'Туркменский манат', TRY: 'Турецкая лира', CHF: 'Швейцарский франк',
  CAD: 'Канадский доллар', AUD: 'Австралийский доллар', NZD: 'Новозеландский доллар',
  HKD: 'Гонконгский доллар', SGD: 'Сингапурский доллар', KRW: 'Южнокорейская вона',
  INR: 'Индийская рупия', PKR: 'Пакистанская рупия', AED: 'Дирхам ОАЭ',
  SAR: 'Саудовский риял', ILS: 'Израильский шекель', ZAR: 'Южноафриканский рэнд',
  BRL: 'Бразильский реал', MXN: 'Мексиканское песо', NOK: 'Норвежская крона',
  SEK: 'Шведская крона', DKK: 'Датская крона', CZK: 'Чешская крона',
  PLN: 'Польский злотый', HUF: 'Венгерский форинт', BGN: 'Болгарский лев',
  RON: 'Румынский лей', RSD: 'Сербский динар', THB: 'Тайский бат',
  VND: 'Вьетнамский донг', IDR: 'Индонезийская рупия', MYR: 'Малайзийский ринггит',
  PHP: 'Филиппинское песо', EGP: 'Египетский фунт', MAD: 'Марокканский дирхам',
  NGN: 'Нигерийская найра', BHD: 'Бахрейнский динар', KWD: 'Кувейтский динар',
  QAR: 'Катарский риал', OMR: 'Оманский риал', JOD: 'Иорданский динар',
  ISK: 'Исландская крона', HRK: 'Хорватская куна', TWD: 'Тайваньский доллар',
  MNT: 'Монгольский тугрик', BTC: 'Биткоин', ETH: 'Эфир'
};

function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function displayName(code, fallback) {
  return RU_NAMES[code] || titleCase(fallback) || code;
}

async function fetchCbrRates() {
  const response = await fetch('https://www.cbr.ru/scripts/XML_daily.asp');
  if (!response.ok) throw new Error(`CBR returned ${response.status}`);
  const buffer = await response.arrayBuffer();
  const xml = new TextDecoder('windows-1251').decode(buffer);

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const data = parser.parse(xml);

  const date = data.ValCurs?.Date || '';
  const raw = data.ValCurs?.Valute;
  const valutes = Array.isArray(raw) ? raw : raw ? [raw] : [];

  // base = RUB, value = сколько RUB за 1 единицу валюты
  const rates = {
    RUB: { code: 'RUB', name: RU_NAMES.RUB, value: 1 }
  };

  for (const v of valutes) {
    const code = v.CharCode;
    if (!code) continue;
    const vunit = String(v.VunitRate ?? v.Value).replace(',', '.');
    const value = Number.parseFloat(vunit);
    if (!Number.isFinite(value)) continue;
    rates[code] = { code, name: displayName(code, v.Name), value };
  }

  return { source: 'cbr', base: 'RUB', date, rates };
}

async function fetchJsonWithFallback(paths) {
  let lastErr;
  for (const url of paths) {
    try {
      const r = await fetch(url);
      if (!r.ok) {
        lastErr = new Error(`${url} → ${r.status}`);
        continue;
      }
      return await r.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('All endpoints failed');
}

async function fetchOpenRates() {
  // fawazahmed0/currency-api — бесплатный, без ключа. USD-база, имена в lower-case.
  const data = await fetchJsonWithFallback([
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    'https://latest.currency-api.pages.dev/v1/currencies/usd.json'
  ]);
  const names = await fetchJsonWithFallback([
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies.json',
    'https://latest.currency-api.pages.dev/v1/currencies.json'
  ]).catch(() => ({}));

  const rateMap = data.usd || {};
  // base = USD, value = сколько USD за 1 единицу валюты = 1 / (codePerUsd)
  const rates = {
    USD: { code: 'USD', name: RU_NAMES.USD, value: 1 }
  };

  for (const [lower, perUsd] of Object.entries(rateMap)) {
    if (lower === 'usd') continue;
    if (!Number.isFinite(perUsd) || perUsd <= 0) continue;
    const code = lower.toUpperCase();
    rates[code] = {
      code,
      name: displayName(code, names[lower]),
      value: 1 / perUsd
    };
  }

  return { source: 'open', base: 'USD', date: data.date || '', rates };
}

app.get('/api/rates', async (req, res) => {
  const source = req.query.source === 'open' ? 'open' : 'cbr';
  try {
    const cached = ratesCache.get(source);
    if (cached && Date.now() - cached.at < RATES_TTL_MS) {
      return res.json(cached.data);
    }
    const data = source === 'open' ? await fetchOpenRates() : await fetchCbrRates();
    ratesCache.set(source, { data, at: Date.now() });
    res.json(data);
  } catch (err) {
    console.error(`Rates fetch failed (${source}):`, err);
    res.status(502).json({ error: `Не удалось загрузить курсы (${source})` });
  }
});

function verifyInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computedHash !== hash) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;
  try {
    return JSON.parse(userRaw);
  } catch {
    return null;
  }
}

app.post('/api/me', (req, res) => {
  const user = verifyInitData(req.body?.initData);
  if (!user) return res.json({ unlocked: false });
  res.json({
    unlocked: isUnlocked(user.id),
    user: { id: user.id, first_name: user.first_name }
  });
});

app.post('/api/create-invoice', async (req, res) => {
  if (!BOT_TOKEN) {
    return res.status(400).json({ error: 'BOT_TOKEN не настроен — Stars-платежи недоступны' });
  }
  const user = verifyInitData(req.body?.initData);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:          'ConverterPro++ — полная версия',
        description:    'Свой курс и комиссия на каждой ступени конвертации. Разовая покупка — без подписки, навсегда. Возврат — командой /refund в боте, в течение 21 дня.',
        payload:        `unlock:${user.id}:${Date.now()}`,
        provider_token: '',
        currency:       'XTR',
        prices:         [{ label: 'Pro', amount: STARS_PRICE }],
        photo_url:      APP_PHOTO_URL,
        photo_width:    640,
        photo_height:   360,
      })
    });
    const json = await response.json();
    if (!json.ok) throw new Error(JSON.stringify(json));
    res.json({ link: json.result });
  } catch (err) {
    console.error('Invoice creation failed:', err);
    res.status(500).json({ error: 'Не удалось создать счёт' });
  }
});

// Универсальный sendMessage с inline-кнопкой «открыть» (web_app).
// Используется во всех текстовых ответах на команды.
async function sendChat(chatId, text, withOpenButton = true) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (withOpenButton) {
    body.reply_markup = {
      inline_keyboard: [[{ text: 'открыть', web_app: { url: 'https://converter.technology' } }]]
    };
  }
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error('sendMessage failed:', err);
  }
}

// Сводка топ-курсов для команды /rates. Берёт CBR (фиат, RUB-база) + open
// (USD-база, есть крипта). Цены округляем для читабельности.
async function buildRatesSummary() {
  const lines = [];
  try {
    const cached = ratesCache.get('cbr');
    let cbr = cached && Date.now() - cached.at < RATES_TTL_MS ? cached.data : null;
    if (!cbr) {
      cbr = await fetchCbrRates();
      ratesCache.set('cbr', { data: cbr, at: Date.now() });
    }
    const fiat = ['USD', 'EUR', 'CNY', 'GBP', 'JPY'];
    lines.push('<b>ЦБ РФ</b> · ' + (cbr.date || ''));
    for (const code of fiat) {
      const r = cbr.rates[code];
      if (!r) continue;
      lines.push(`  ${code}  ${r.value.toFixed(2)} ₽`);
    }
  } catch (err) {
    console.error('/rates CBR fail:', err);
    lines.push('ЦБ РФ — не получилось загрузить.');
  }
  try {
    const cached = ratesCache.get('open');
    let open = cached && Date.now() - cached.at < RATES_TTL_MS ? cached.data : null;
    if (!open) {
      open = await fetchOpenRates();
      ratesCache.set('open', { data: open, at: Date.now() });
    }
    // В fetchOpenRates value = «сколько USD за 1 единицу». Перевернём для читабельности:
    // BTC показываем «$ за 1 BTC» (т.е. value напрямую).
    const crypto = ['BTC', 'ETH'];
    lines.push('');
    lines.push('<b>Крипта</b> · ' + (open.date || ''));
    for (const code of crypto) {
      const r = open.rates[code];
      if (!r) continue;
      lines.push(`  ${code}  $${r.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
    }
  } catch (err) {
    console.error('/rates open fail:', err);
  }
  lines.push('');
  lines.push('<i>Курсы кешируются час. Полная таблица и цепочки — в приложении.</i>');
  return lines.join('\n');
}

const HELP_TEXT =
  '<b>Converter++</b> — конвертер валют и крипты с цепочками.\n\n' +
  'Команды:\n' +
  '/start — открыть приложение\n' +
  '/rates — топ курсов прямо в чат\n' +
  '/sources — откуда берутся курсы\n' +
  '/status — статус Pro у тебя\n' +
  '/pro — что даёт Pro и как купить\n' +
  '/refund — вернуть Stars за Pro\n' +
  '/help — это меню\n\n' +
  '<i>Базовое бесплатно. Свой курс и комиссии на каждой ступени — Pro (100 ⭐, разово).</i>';

const REFUND_OK_TEXT =
  '✓ <b>Возврат выполнен.</b> Stars вернутся на твой баланс в Telegram. ' +
  'Pro-доступ деактивирован — спасибо, что пробовал(а)! Если что-то не понравилось, ' +
  'напиши обратной связью — постараемся учесть.';

const REFUND_NO_PAYMENT_TEXT =
  'У тебя нет активной Pro-покупки, которую можно вернуть. Если считаешь это ошибкой — ' +
  'напиши в @BotSupport через Telegram (правила Stars: возврат возможен в течение 21 дня).';

const REFUND_FAILED_TEXT =
  '⚠️ Не получилось вернуть платёж автоматически. Возможно, прошло больше 21 дня ' +
  'или charge_id уже использован. Напиши в Telegram Support — они инициируют рефанд ' +
  'из своей стороны.';

const SOURCES_TEXT =
  '<b>Откуда курсы</b>\n\n' +
  '• <b>ЦБ РФ</b> — фиатные валюты (USD, EUR, CNY, GBP, JPY и др.), официальный XML cbr.ru. База — RUB.\n' +
  '• <b>fawazahmed0/currency-api</b> — открытый источник для крипты (BTC, ETH и десятки других) и глобального фиата. База — USD.\n\n' +
  'Кеш — 1 час. В приложении можно выбрать какой источник использовать.';

const PRO_TEXT =
  '<b>Pro</b> — 100 ⭐, разово, навсегда:\n' +
  '• свой курс на каждой ступени\n' +
  '• комиссии (%, абсолют)\n' +
  '• сохранение цепочек\n\n' +
  'Открой приложение и нажми «разблокировать Pro».\n\n' +
  '<i>Передумаешь — /refund вернёт Stars в течение 21 дня.</i>';

const START_TEXT =
  'привет!\n\n' +
  'Converter++ — цепочки конвертации валют и крипты. ' +
  'Сколько USD → EUR → BTC у тебя получится — в один экран.\n\n' +
  'Базовое бесплатно. Pro (100 ⭐, разово) даёт свой курс и комиссии на каждой ступени.\n\n' +
  '/help — полный список команд';

// Помогалка для refundStarPayment. Возвращает {ok, error?} — error мягкий,
// чтобы шейдить юзеру понятный текст вместо raw Telegram-error'ов.
async function refundStarPayment(userId, chargeId) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/refundStarPayment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, telegram_payment_charge_id: chargeId })
    });
    const j = await r.json();
    if (j.ok) return { ok: true };
    console.warn('refundStarPayment fail:', j);
    return { ok: false, error: j.description || 'unknown' };
  } catch (err) {
    console.error('refundStarPayment error:', err);
    return { ok: false, error: err.message };
  }
}

const webhookPath = BOT_TOKEN ? `/webhook/${BOT_TOKEN.split(':')[1] || 'tg'}` : '/webhook/disabled';
app.post(webhookPath, async (req, res) => {
  // Webhook-secret check: Telegram кладёт secret_token в этот заголовок при каждом
  // апдейте. Если WEBHOOK_SECRET задан в env — должен совпасть, иначе обрываем
  // (защита от подмены: иначе любой, кто знает webhook URL, мог бы слать поддельные
  // successful_payment и активировать Pro бесплатно).
  if (WEBHOOK_SECRET) {
    const got = req.header('X-Telegram-Bot-Api-Secret-Token');
    if (got !== WEBHOOK_SECRET) {
      console.warn('Webhook secret mismatch — rejecting');
      return res.status(401).json({ ok: false });
    }
  }
  const update = req.body || {};

  // pre_checkout_query: Telegram спрашивает «можно ли провести платёж?» за 10 секунд
  // до фактического списания Stars. Должны ответить ok:true иначе ok:false с
  // error_message — это твой последний шанс отказать (нет наличия, мошенничество).
  if (update.pre_checkout_query) {
    const q = update.pre_checkout_query;
    let allow = false;
    let reason = '';
    // Валидация: payload должен быть нашим (unlock:<userId>:<ts>), userId
    // совпадает с from.id (нельзя оплатить чужой unlock).
    if (typeof q.invoice_payload === 'string' && q.invoice_payload.startsWith('unlock:')) {
      const [, payloadUserId] = q.invoice_payload.split(':');
      if (q.from?.id && Number(payloadUserId) === q.from.id) {
        allow = true;
      } else {
        reason = 'Этот счёт выписан другому пользователю.';
      }
    } else {
      reason = 'Платёж не относится к Converter++ Pro.';
    }
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pre_checkout_query_id: q.id,
          ok: allow,
          ...(allow ? {} : { error_message: reason || 'Платёж отклонён.' })
        })
      });
    } catch (err) {
      console.error('answerPreCheckoutQuery failed:', err);
    }
  }

  const text   = update.message?.text?.trim();
  const chatId = update.message?.chat?.id;
  const fromId = update.message?.from?.id;

  if (chatId && text) {
    // Сравниваем основу команды (отбрасываем @bot_name suffix и аргументы).
    const cmd = text.split(/\s+|@/, 1)[0];
    if (cmd === '/start') {
      await sendChat(chatId, START_TEXT);
    } else if (cmd === '/help') {
      await sendChat(chatId, HELP_TEXT, false);
    } else if (cmd === '/pro') {
      await sendChat(chatId, PRO_TEXT);
    } else if (cmd === '/sources') {
      await sendChat(chatId, SOURCES_TEXT, false);
    } else if (cmd === '/rates') {
      const summary = await buildRatesSummary();
      await sendChat(chatId, summary, false);
    } else if (cmd === '/status') {
      const unlocked = fromId ? isUnlocked(fromId) : false;
      const msg = unlocked
        ? '✓ <b>Pro активна.</b> Свой курс, комиссии и сохранение цепочек — доступны.'
        : 'Сейчас активна <b>бесплатная версия</b>. /pro чтобы разблокировать всё за 100 ⭐.';
      await sendChat(chatId, msg);
    } else if (cmd === '/refund') {
      // Self-service refund. Stars Terms требуют поддерживать возврат для
      // digital goods в течение 21 дня; без этого Telegram может пожаловаться.
      // Юзеры в PRO_USER_IDS (admin override) не возвращают — у них не было
      // платежа, нечего возвращать.
      if (!fromId) { await sendChat(chatId, REFUND_NO_PAYMENT_TEXT, false); }
      else if (PRO_USER_IDS.has(fromId)) {
        await sendChat(chatId, 'У тебя admin-доступ, не платный — рефанд не применяется.', false);
      } else {
        const chargeId = chargesByUser.get(fromId);
        if (!chargeId || !paidUsers.has(fromId)) {
          await sendChat(chatId, REFUND_NO_PAYMENT_TEXT, false);
        } else {
          const r = await refundStarPayment(fromId, chargeId);
          if (r.ok) {
            await unmarkUserPaid(fromId);
            await sendChat(chatId, REFUND_OK_TEXT, false);
          } else {
            await sendChat(chatId, REFUND_FAILED_TEXT, false);
          }
        }
      }
    }
  }

  const payment = update.message?.successful_payment;
  if (payment && payment.invoice_payload?.startsWith('unlock:')) {
    const userId = update.message.from?.id;
    // Сверяем userId из payload (мы его туда положили при createInvoiceLink)
    // с from.id сообщения — защита от подменённых webhook-запросов.
    const [, payloadUserId] = payment.invoice_payload.split(':');
    if (userId && Number(payloadUserId) === userId) {
      // Сохраняем charge_id для будущего рефанда — без него refundStarPayment
      // не сможем вызвать.
      await markUserPaid(userId, payment.telegram_payment_charge_id);
      console.log(`Unlocked Pro for user ${userId} (${payment.total_amount} stars, charge=${payment.telegram_payment_charge_id})`);
      await sendChat(userId, '🎉 <b>Pro разблокирована, навсегда.</b> Открывай приложение и пользуйся.\n\n<i>Если что-то пойдёт не так — /refund вернёт Stars в течение 21 дня.</i>');
    } else {
      console.warn('Payment payload mismatch — ignoring', { payloadUserId, userId });
    }
  }

  res.json({ ok: true });
});

await loadPaidUsers();

app.listen(PORT, () => {
  console.log(`Converter++ running on http://localhost:${PORT}`);
  if (!BOT_TOKEN) {
    console.log('⚠️  BOT_TOKEN не задан — Stars-платежи отключены. Создайте бота в @BotFather и положите токен в .env.');
  } else {
    console.log(`Webhook path: ${webhookPath}`);
  }
  if (!redis) {
    console.log('⚠️  UPSTASH_REDIS_* не задан — платежи в памяти (теряются при рестарте). Только для dev.');
  } else {
    console.log(`Redis persistence active. ${PRO_USER_IDS.size} admin(s), ${paidUsers.size} paid user(s) loaded.`);
  }
});
