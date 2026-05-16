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

const MAX_PAGES = parseInt(process.env.MAX_PAGES || '5');  // search up to 5 pages (100 results)
const RESULTS_PER_PAGE = 20;

const shard = parseInt(process.env.MATRIX_INDEX || '0');
const total = parseInt(process.env.MATRIX_TOTAL || '1');
const chunkSize = Math.ceil(ALL_KEYWORDS.length / total);
const keywords = ALL_KEYWORDS.slice(shard * chunkSize, (shard + 1) * chunkSize);

console.log(`Shard ${shard}/${total} — ${keywords.length} keywords, up to ${MAX_PAGES} pages each`);

const browser = await launch({ headless: true, humanize: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'vi-VN' });
const page = await context.newPage();
const results = [];
const timestamp = new Date().toISOString();

for (const keyword of keywords) {
  console.log(`\nSearching: "${keyword}"`);
  let found = false;

  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    const start = pageNum * RESULTS_PER_PAGE;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&hl=vi&gl=vn&num=${RESULTS_PER_PAGE}&start=${start}`;

    try {
      console.log(`  Page ${pageNum + 1} (results ${start + 1}-${start + RESULTS_PER_PAGE})...`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));

      const content = await page.content();
      if (content.includes('captcha') || content.includes('unusual traffic')) {
        console.log('  ⚠ CAPTCHA detected, stopping pagination');
        results.push({ keyword, position: -1, status: 'captcha', pagesSearched: pageNum + 1, timestamp });
        break;
      }

      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('div#search a[href]'))
          .map(a => a.href)
          .filter(h => h && !h.startsWith('https://www.google.com') && !h.includes('webcache'))
      );

      // Check if any results on this page
      if (links.length === 0) {
        console.log(`  No more results at page ${pageNum + 1}`);
        break;
      }

      const positionOnPage = links.findIndex(h => h.includes(TARGET_DOMAIN));
      if (positionOnPage >= 0) {
        const absolutePosition = start + positionOnPage + 1;
        const topCompetitors = links.slice(0, 3).map(u => {
          try { return new URL(u).hostname.replace('www.', ''); } catch { return u; }
        });
        console.log(`  → FOUND at position #${absolutePosition} (page ${pageNum + 1})`);
        results.push({
          keyword,
          position: absolutePosition,
          page: pageNum + 1,
          topCompetitors,
          pagesSearched: pageNum + 1,
          timestamp,
        });
        found = true;
        break;
      }

      // Collect top competitors from first page only
      if (pageNum === 0) {
        var firstPageCompetitors = links.slice(0, 3).map(u => {
          try { return new URL(u).hostname.replace('www.', ''); } catch { return u; }
        });
      }

      await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
    } catch (err) {
      console.log(`  → Error on page ${pageNum + 1}: ${err.message}`);
      results.push({ keyword, position: -1, status: 'error', pagesSearched: pageNum + 1, timestamp });
      found = true; // stop pagination
      break;
    }
  }

  if (!found) {
    console.log(`  → NOT FOUND in ${MAX_PAGES} pages (${MAX_PAGES * RESULTS_PER_PAGE} results)`);
    results.push({
      keyword,
      position: -1,
      topCompetitors: firstPageCompetitors || [],
      pagesSearched: MAX_PAGES,
      timestamp,
    });
  }

  await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
}

await browser.close();

if (!existsSync('results')) mkdirSync('results', { recursive: true });
writeFileSync(`results/shard-${shard}.json`, JSON.stringify(results, null, 2));
console.log(`\nSaved results/shard-${shard}.json`);

// Summary
const found_count = results.filter(r => r.position > 0).length;
console.log(`\nSummary: ${found_count}/${results.length} keywords found`);
for (const r of results) {
  const rank = r.position > 0 ? `#${r.position} (page ${r.page})` : `NOT FOUND (${r.pagesSearched} pages)`;
  console.log(`  ${r.keyword.padEnd(45)} | ${rank}`);
}
