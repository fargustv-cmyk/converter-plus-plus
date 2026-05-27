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
const PAID_KEY = 'paid_users';

const paidUsers = new Set();

async function loadPaidUsers() {
  if (!redis) return;
  try {
    const ids = await redis.smembers(PAID_KEY);
    for (const id of ids || []) {
      const n = Number(id);
      if (Number.isFinite(n)) paidUsers.add(n);
    }
    console.log(`Loaded ${paidUsers.size} paid user(s) from Redis`);
  } catch (err) {
    console.error('Failed to load paid users from Redis:', err);
  }
}

async function markUserPaid(userId) {
  paidUsers.add(userId);
  if (!redis) return;
  try {
    await redis.sadd(PAID_KEY, String(userId));
  } catch (err) {
    console.error('Failed to persist paid user to Redis:', err);
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
        title: 'ConverterPro++ — полная версия',
        description: 'Свой курс и комиссия на каждой ступени конвертации. Разовая покупка — без подписки, навсегда.',
        payload: `unlock:${user.id}:${Date.now()}`,
        provider_token: '',
        currency: 'XTR',
        prices: [{ label: 'Pro', amount: STARS_PRICE }]
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

const webhookPath = BOT_TOKEN ? `/webhook/${BOT_TOKEN.split(':')[1] || 'tg'}` : '/webhook/disabled';
app.post(webhookPath, async (req, res) => {
  const update = req.body || {};

  if (update.pre_checkout_query) {
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pre_checkout_query_id: update.pre_checkout_query.id, ok: true })
      });
    } catch (err) {
      console.error('answerPreCheckoutQuery failed:', err);
    }
  }

  const text = update.message?.text?.trim();
  const chatId = update.message?.chat?.id;
  if (chatId && text && (text === '/start' || text.startsWith('/start '))) {
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text:
            'привет!\n\n' +
            'Converter++ — конвертер валют и крипты с цепочками.\n' +
            'Базовое — бесплатно. Свой курс и комиссия на каждой ступени — в Pro (100 ⭐, разово).\n\n' +
            'жми кнопку ниже.',
          reply_markup: {
            inline_keyboard: [[{ text: 'открыть конвертер', web_app: { url: 'https://converter.technology' } }]]
          }
        })
      });
    } catch (err) {
      console.error('/start sendMessage failed:', err);
    }
  }

  if (chatId && text === '/pro') {
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text:
            'Pro за 100 ⭐ — разово, навсегда:\n' +
            '• свой курс на каждой ступени\n' +
            '• комиссии (%, абсолют)\n' +
            '• сохранение цепочек\n\n' +
            'открой приложение и нажми «разблокировать Pro».',
          reply_markup: {
            inline_keyboard: [[{ text: 'открыть', web_app: { url: 'https://converter.technology' } }]]
          }
        })
      });
    } catch (err) {
      console.error('/pro sendMessage failed:', err);
    }
  }

  const payment = update.message?.successful_payment;
  if (payment && payment.invoice_payload?.startsWith('unlock:')) {
    const userId = update.message.from?.id;
    // Сверяем userId из payload (мы его туда положили при createInvoiceLink)
    // с from.id сообщения — защита от подменённых webhook-запросов.
    const [, payloadUserId] = payment.invoice_payload.split(':');
    if (userId && Number(payloadUserId) === userId) {
      await markUserPaid(userId);
      console.log(`Unlocked Pro for user ${userId} (${payment.total_amount} stars)`);
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
