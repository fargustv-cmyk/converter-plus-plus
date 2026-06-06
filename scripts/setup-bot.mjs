// Apply bot meta + menu button + webhook via Telegram Bot API.
// Run: BOT_TOKEN=... node scripts/setup-bot.mjs
//
// Опционально:
//   APP_URL=https://converter.technology  — куда смотрит menu_button и web_app
//   WEBHOOK_SECRET=...                    — secret_token для setWebhook (если задан,
//                                            наш server.js проверяет его на каждом update)

const TOKEN          = process.env.BOT_TOKEN;
const URL            = process.env.APP_URL || 'https://converter.technology';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
if (!TOKEN) { console.error('BOT_TOKEN env required'); process.exit(1); }
// webhookPath ДОЛЖЕН совпадать с server.js — там тот же формат.
const WEBHOOK_PATH = `/webhook/${TOKEN.split(':')[1] || 'tg'}`;
const WEBHOOK_URL  = `${URL.replace(/\/+$/, '')}${WEBHOOK_PATH}`;

async function call(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if (j.ok) console.log('ok', method);
  else console.error('FAIL', method, j);
  return j;
}

await call('setMyName', { name: 'Converter++' });

await call('setMyShortDescription', {
  short_description: 'Многоступенчатая конвертация валют и крипты. Свой курс и комиссия на каждой ступени — в Pro.'
});

await call('setMyDescription', {
  description:
    'Converter++ — конвертер валют и крипты с цепочками.\n\n' +
    'Курсы тянем с ЦБ РФ и fawazahmed0/currency-api: фиат, стейблы, BTC/ETH и десятки других.\n\n' +
    'Бесплатно: любые цепочки на свежих рыночных курсах.\n\n' +
    'Pro (разово, 100 ⭐): свой курс на каждой ступени, комиссии (%, абсолют), сохранение цепочек. Без подписки — навсегда.'
});

await call('setMyCommands', {
  commands: [
    { command: 'start',   description: 'открыть конвертер' },
    { command: 'rates',   description: 'топ курсов в чат' },
    { command: 'sources', description: 'откуда берём курсы' },
    { command: 'status',  description: 'статус Pro у тебя' },
    { command: 'me',      description: 'твой Telegram ID' },
    { command: 'pro',     description: 'разблокировать Pro за 100 ⭐' },
    { command: 'refund',  description: 'вернуть Stars за Pro' },
    { command: 'help',    description: 'список команд' }
  ]
});

// Admin-команды (/grant /revoke /partners) НЕ кладём в setMyCommands —
// они должны существовать, но не дразнить обычных юзеров в меню.
// Админ видит их в /help (с автоматическим append'ом ADMIN_HELP_TEXT)
// и просто печатает руками.

await call('setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'открыть', web_app: { url: URL } }
});

// setWebhook: задаём URL + secret_token. Без secret_token любой, знающий URL,
// мог бы слать поддельные successful_payment. allowed_updates ограничивает,
// что Telegram присылает (message + pre_checkout + payments).
await call('setWebhook', {
  url:             WEBHOOK_URL,
  allowed_updates: ['message', 'pre_checkout_query'],
  ...(WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : {}),
  drop_pending_updates: false,
});
console.log('webhook →', WEBHOOK_URL, WEBHOOK_SECRET ? '(with secret)' : '(no secret)');
