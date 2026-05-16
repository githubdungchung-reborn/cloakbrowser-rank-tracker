import { launch } from 'cloakbrowser';
import { writeFileSync, mkdirSync } from 'fs';

const TARGET_DOMAIN = process.env.TARGET_DOMAIN;
if (!TARGET_DOMAIN) { console.error('TARGET_DOMAIN env required'); process.exit(1); }

const browser = await launch({ headless: true, humanize: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'vi-VN' });
const page = await context.newPage();

// 1. site: search
console.log(`=== site:${TARGET_DOMAIN} ===`);
await page.goto(`https://www.google.com/search?q=site:${encodeURIComponent(TARGET_DOMAIN)}&hl=vi&gl=vn`, {
  waitUntil: 'domcontentloaded', timeout: 25000,
});
await new Promise(r => setTimeout(r, 3000));

const indexStats = await page.evaluate(() => document.querySelector('#result-stats')?.innerText || 'N/A');
const indexedUrls = await page.evaluate(() =>
  Array.from(document.querySelectorAll('div#search a[href]'))
    .map(a => a.href)
    .filter(h => h.includes(location.hostname.replace('www.', '')))
    .slice(0, 15)
);
console.log('Index stats:', indexStats);
console.log('Indexed URLs:', indexedUrls.length);

// 2. Click first result and verify
let clickVerified = false;
let landedUrl = '';
let landedTitle = '';

if (indexedUrls.length > 0) {
  console.log(`\nClicking first result: ${indexedUrls[0]}`);
  try {
    // Find and click the first organic result link for our domain
    const firstLink = await page.$(`div#search a[href*="${TARGET_DOMAIN}"]`);
    if (firstLink) {
      await firstLink.click();
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      await new Promise(r => setTimeout(r, 2000));

      landedUrl = page.url();
      landedTitle = await page.title();
      clickVerified = landedUrl.includes(TARGET_DOMAIN);

      console.log(`Landed URL: ${landedUrl}`);
      console.log(`Landed title: ${landedTitle}`);
      console.log(`Click verified: ${clickVerified}`);
    }
  } catch (err) {
    console.log(`Click error: ${err.message}`);
  }
}

// 3. Go back and check brand search
console.log('\n=== Brand search: "hoa tươi đà nẵng nhà nhi" ===');
await page.goto(`https://www.google.com/search?q=${encodeURIComponent('hoa tươi đà nẵng nhà nhi')}&hl=vi&gl=vn`, {
  waitUntil: 'domcontentloaded', timeout: 25000,
});
await new Promise(r => setTimeout(r, 3000));

const brandLinks = await page.evaluate(() =>
  Array.from(document.querySelectorAll('div#search a[href]'))
    .map(a => a.href)
    .filter(h => !h.startsWith('https://www.google.com') && !h.includes('webcache'))
    .slice(0, 10)
);
const brandPosition = brandLinks.findIndex(h => h.includes(TARGET_DOMAIN)) + 1;
console.log(`Brand search rank: ${brandPosition > 0 ? '#' + brandPosition : 'NOT FOUND'}`);

await browser.close();

// Save results
mkdirSync('results', { recursive: true });
writeFileSync('results/index-check.json', JSON.stringify({
  domain: TARGET_DOMAIN,
  timestamp: new Date().toISOString(),
  indexStats,
  indexedCount: indexedUrls.length,
  indexedUrls,
  clickVerified,
  landedUrl,
  landedTitle,
  brandRank: brandPosition,
}, null, 2));
console.log('\nSaved results/index-check.json');
