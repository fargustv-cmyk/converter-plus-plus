// Конвертирует SVG-логотипы в PNG разных размеров.
// Запуск: node brand/export-png.js
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function render(svgPath, outPath, width) {
  const svg = readFileSync(svgPath);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    background: 'rgba(0,0,0,0)',
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Arial',
      // На Windows Segoe UI Bold обычно лежит здесь; на других ОС
      // resvg сам найдёт что-то похожее.
      fontDirs: ['C:\\Windows\\Fonts']
    },
    shapeRendering: 2,    // geometricPrecision
    textRendering: 2,     // geometricPrecision
    imageRendering: 0     // optimizeQuality
  });
  const png = resvg.render().asPng();
  writeFileSync(outPath, png);
  console.log(`✓ ${path.relative(process.cwd(), outPath)} (${width}px)`);
}

const icon = path.join(__dirname, 'logo-icon-512.svg');
render(icon, path.join(__dirname, 'logo-icon-512.png'), 512);
render(icon, path.join(__dirname, 'logo-icon-1024.png'), 1024);

const avatar = path.join(__dirname, 'logo-avatar-512.svg');
render(avatar, path.join(__dirname, 'logo-avatar-512.png'), 512);
render(avatar, path.join(__dirname, 'logo-avatar-1024.png'), 1024);

const promo = path.join(__dirname, 'promo-640x360.svg');
render(promo, path.join(__dirname, 'promo-640x360.png'), 640);

console.log('\nГотово. Файлы в brand/:');
console.log('  • logo-icon-512.png    — иконка Mini App (закруглённый квадрат)');
console.log('  • logo-icon-1024.png   — крупная версия квадратной иконки');
console.log('  • logo-avatar-512.png  — аватар бота (круглая версия)');
console.log('  • logo-avatar-1024.png — крупная версия аватара');
console.log('  • promo-640x360.png    — горизонтальный баннер для меню бота');
