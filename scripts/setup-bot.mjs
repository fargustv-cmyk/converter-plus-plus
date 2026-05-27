// Apply bot meta + menu button via Telegram Bot API.
// Run: BOT_TOKEN=... node scripts/setup-bot.mjs

const TOKEN = process.env.BOT_TOKEN;
const URL = process.env.APP_URL || 'https://converter.technology';
if (!TOKEN) { console.error('BOT_TOKEN env required'); process.exit(1); }

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
    { command: 'start', description: 'открыть конвертер' },
    { command: 'pro', description: 'разблокировать Pro за 100 ⭐' }
  ]
});

await call('setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'открыть', web_app: { url: URL } }
});
