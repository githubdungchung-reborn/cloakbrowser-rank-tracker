import { launch } from 'cloakbrowser';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const TARGET_DOMAIN = process.env.TARGET_DOMAIN;
if (!TARGET_DOMAIN) { console.error('TARGET_DOMAIN env required'); process.exit(1); }

const ALL_KEYWORDS = [
  'hoa tươi đà nẵng',
  'shop hoa tươi đà nẵng',
  'điện hoa đà nẵng',
  'đặt hoa online đà nẵng',
  'mua hoa tươi đà nẵng',
  'hoa sinh nhật đà nẵng',
  'hoa khai trương đà nẵng',
  'hoa chia buồn đà nẵng',
  'hoa cưới đà nẵng',
  'giao hoa tươi tận nơi đà nẵng',
  'shop hoa tươi giá rẻ đà nẵng',
  'shop hoa tươi gần đây đà nẵng',
  'đặt hoa giao nhanh đà nẵng',
  'hoa tulip đà nẵng',
  'hoa hồng đà nẵng',
  'hoa valentine đà nẵng',
  'hoa 20/10 đà nẵng',
  'hoa 8/3 đà nẵng',
  'hoa cảm ơn đà nẵng',
  'hoa lan hồ điệp đà nẵng',
];

const shard = parseInt(process.env.MATRIX_INDEX || '0');
const total = parseInt(process.env.MATRIX_TOTAL || '1');
const chunkSize = Math.ceil(ALL_KEYWORDS.length / total);
const keywords = ALL_KEYWORDS.slice(shard * chunkSize, (shard + 1) * chunkSize);

console.log(`Shard ${shard}/${total} — ${keywords.length} keywords`);

const browser = await launch({ headless: true, humanize: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'vi-VN' });
const page = await context.newPage();
const results = [];
const timestamp = new Date().toISOString();

for (const keyword of keywords) {
  console.log(`Searching: "${keyword}"`);
  try {
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(keyword)}&hl=vi&gl=vn&num=20`, {
      waitUntil: 'domcontentloaded', timeout: 25000,
    });
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));

    const content = await page.content();
    if (content.includes('captcha') || content.includes('unusual traffic')) {
      console.log('  ⚠ CAPTCHA');
      results.push({ keyword, position: -1, status: 'captcha', timestamp });
      continue;
    }

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('div#search a[href]'))
        .map(a => a.href)
        .filter(h => h && !h.startsWith('https://www.google.com') && !h.includes('webcache'))
    );

    const position = links.findIndex(h => h.includes(TARGET_DOMAIN)) + 1;
    const topCompetitors = links.slice(0, 5).map(u => { try { return new URL(u).hostname.replace('www.',''); } catch { return u; } });

    console.log(`  → ${position > 0 ? 'Rank #' + position : 'NOT FOUND'}`);
    results.push({ keyword, position, topCompetitors, timestamp });

    await new Promise(r => setTimeout(r, 2500 + Math.random() * 3000));
  } catch (err) {
    console.log(`  → Error: ${err.message}`);
    results.push({ keyword, position: -1, status: 'error', timestamp });
  }
}

await browser.close();

if (!existsSync('results')) mkdirSync('results', { recursive: true });
writeFileSync(`results/shard-${shard}.json`, JSON.stringify(results, null, 2));
console.log(`Saved results/shard-${shard}.json`);
