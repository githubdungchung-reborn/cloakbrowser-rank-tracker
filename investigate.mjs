import { launch } from 'cloakbrowser';
import { writeFileSync, mkdirSync } from 'fs';

const TARGET_DOMAIN = process.env.TARGET_DOMAIN || 'hoatuoidanangnhanhi.com';

const browser = await launch({ headless: true, humanize: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'vi-VN' });
const page = await context.newPage();
const findings = {};

// 1. Check Google index count
console.log('=== 1. Google Index Count ===');
await page.goto(`https://www.google.com/search?q=site:${encodeURIComponent(TARGET_DOMAIN)}&hl=vi&gl=vn`, {
  waitUntil: 'domcontentloaded', timeout: 25000,
});
await new Promise(r => setTimeout(r, 3000));
const indexStats = await page.evaluate(() => document.querySelector('#result-stats')?.innerText || 'N/A');
console.log('Index stats:', indexStats);
findings.indexStats = indexStats;

// 2. Check if site appears for exact URL search
console.log('\n=== 2. Exact URL Search ===');
await page.goto(`https://www.google.com/search?q=${encodeURIComponent(TARGET_DOMAIN)}&hl=vi&gl=vn`, {
  waitUntil: 'domcontentloaded', timeout: 25000,
});
await new Promise(r => setTimeout(r, 3000));
const urlLinks = await page.evaluate(() =>
  Array.from(document.querySelectorAll('div#search a[href]'))
    .map(a => a.href)
    .filter(h => !h.startsWith('https://www.google.com'))
    .slice(0, 10)
);
const urlPosition = urlLinks.findIndex(h => h.includes(TARGET_DOMAIN)) + 1;
console.log(`URL search rank: ${urlPosition > 0 ? '#' + urlPosition : 'NOT FOUND'}`);
console.log('Top results:', urlLinks.slice(0, 5));
findings.urlSearchRank = urlPosition;

// 3. Check robots.txt
console.log('\n=== 3. Robots.txt ===');
try {
  await page.goto(`https://${TARGET_DOMAIN}/robots.txt`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const robotsContent = await page.evaluate(() => document.body.innerText.substring(0, 1000));
  console.log(robotsContent.substring(0, 500));
  findings.robotsTxt = robotsContent.substring(0, 500);

  // Check if Disallow: / is blocking everything
  if (robotsContent.includes('Disallow: /')) {
    console.log('⚠ WARNING: robots.txt blocks all crawling!');
    findings.robotsBlocking = true;
  }
} catch (e) {
  console.log('Could not fetch robots.txt:', e.message);
}

// 4. Check for noindex meta tag
console.log('\n=== 4. Noindex Check ===');
try {
  await page.goto(`https://${TARGET_DOMAIN}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const metaRobots = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="robots"]');
    return meta ? meta.content : 'No robots meta tag found';
  });
  console.log('Meta robots:', metaRobots);
  findings.metaRobots = metaRobots;

  if (metaRobots.includes('noindex')) {
    console.log('⚠ WARNING: Homepage has noindex tag!');
    findings.noindex = true;
  }

  // Check canonical
  const canonical = await page.evaluate(() => {
    const link = document.querySelector('link[rel="canonical"]');
    return link ? link.href : 'No canonical tag';
  });
  console.log('Canonical:', canonical);
  findings.canonical = canonical;

  // Check if there's a sitemap reference
  const html = await page.content();
  const hasSitemapInHtml = html.includes('sitemap');
  console.log('Sitemap referenced in HTML:', hasSitemapInHtml);
} catch (e) {
  console.log('Could not fetch homepage:', e.message);
}

// 5. Check for Google penalty (manual actions notice)
console.log('\n=== 5. Google Search for site with penalty indicators ===');
await page.goto(`https://www.google.com/search?q=${encodeURIComponent('site:' + TARGET_DOMAIN + ' 关键词')}&hl=vi&gl=vn`, {
  waitUntil: 'domcontentloaded', timeout: 25000,
});
await new Promise(r => setTimeout(r, 2000));
const hasPenalty = await page.evaluate(() => {
  const body = document.body.innerText;
  return body.includes('manual action') || body.includes('penalty') || body.includes('removed');
});
console.log('Penalty indicators:', hasPenalty ? 'FOUND' : 'None');
findings.penaltyIndicators = hasPenalty;

// 6. Check competitor domain authority signals
console.log('\n=== 6. Competitor Comparison ===');
const competitors = ['canhdonghoatuoi.com', 'kimkieuflower.vn', 'flowercorner.vn'];
for (const comp of competitors) {
  await page.goto(`https://www.google.com/search?q=site:${encodeURIComponent(comp)}&hl=vi&gl=vn`, {
    waitUntil: 'domcontentloaded', timeout: 15000,
  });
  await new Promise(r => setTimeout(r, 2000));
  const stats = await page.evaluate(() => document.querySelector('#result-stats')?.innerText || 'N/A');
  console.log(`${comp}: ${stats}`);
  findings[`competitor_${comp}`] = stats;
}

// 7. Check page speed / Core Web Vitals hint
console.log('\n=== 7. Page Load Check ===');
try {
  const startTime = Date.now();
  await page.goto(`https://${TARGET_DOMAIN}/`, { waitUntil: 'load', timeout: 30000 });
  const loadTime = Date.now() - startTime;
  console.log(`Homepage load time: ${loadTime}ms`);
  findings.loadTimeMs = loadTime;

  // Check for JS errors
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await new Promise(r => setTimeout(r, 3000));
  console.log('JS errors:', errors.length > 0 ? errors.join('; ') : 'None');
  findings.jsErrors = errors;
} catch (e) {
  console.log('Load error:', e.message);
}

// 8. Check if Google has cached version
console.log('\n=== 8. Google Cache Check ===');
await page.goto(`https://www.google.com/search?q=${encodeURIComponent('cache:' + TARGET_DOMAIN)}&hl=vi&gl=vn`, {
  waitUntil: 'domcontentloaded', timeout: 15000,
});
await new Promise(r => setTimeout(r, 2000));
const cacheResults = await page.evaluate(() => {
  const links = Array.from(document.querySelectorAll('div#search a[href]'));
  return links.map(a => a.href).filter(h => h.includes(TARGET_DOMAIN)).slice(0, 3);
});
console.log('Cached pages found:', cacheResults.length);
findings.cachedPages = cacheResults.length;

await browser.close();

// Save findings
mkdirSync('results', { recursive: true });
writeFileSync('results/investigation.json', JSON.stringify(findings, null, 2));
console.log('\nSaved results/investigation.json');

// Summary
console.log('\n========== INVESTIGATION SUMMARY ==========');
console.log('Index stats:', findings.indexStats);
console.log('URL search rank:', findings.urlSearchRank || 'NOT FOUND');
console.log('Meta robots:', findings.metaRobots);
console.log('Robots blocking:', findings.robotsBlocking || false);
console.log('Noindex:', findings.noindex || false);
console.log('Canonical:', findings.canonical);
console.log('Load time:', findings.loadTimeMs + 'ms');
console.log('Competitors indexed:');
for (const comp of competitors) {
  console.log(`  ${comp}: ${findings[`competitor_${comp}`]}`);
}
