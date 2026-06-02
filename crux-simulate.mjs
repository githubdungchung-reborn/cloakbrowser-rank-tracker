/**
 * CrUX Traffic Simulator — generates real-looking Chrome visits via CloakBrowser
 * to seed the Chrome User Experience Report with Core Web Vitals data.
 *
 * CloakBrowser uses real Chromium with humanized interactions, so Google
 * treats these as genuine Chrome user sessions (the "API endpoint" that CrUX
 * mentions in its docs). Each run visits a mix of main pages + AMP pages from
 * mobile viewports to maximize CrUX eligibility.
 *
 * Usage:
 *   node crux-simulate.mjs          # default: visit all URLs once
 *   CRUX_RUNS=3 node crux-simulate.mjs  # visit 3× (with randomized order)
 *
 * Environment:
 *   TARGET_DOMAIN  — e.g. hoatuoidanangnhanhi.com
 *   CRUX_RUNS      — number of full passes (default 1)
 *   CRUX_SHARD     — for parallel matrix runs
 *   CRUX_SHARDS    — total shard count
 */

import { launch } from 'cloakbrowser';
import { writeFileSync, mkdirSync } from 'fs';

const DOMAIN = process.env.TARGET_DOMAIN || 'hoatuoidanangnhanhi.com';
const RUNS = parseInt(process.env.CRUX_RUNS || '1', 10);
const SHARD = parseInt(process.env.CRUX_SHARD || '0', 10);
const TOTAL_SHARDS = parseInt(process.env.CRUX_SHARDS || '1', 10);

const BASE = `https://${DOMAIN}`;

// Pages to visit — mix of AMP + canonical for CrUX data collection.
// AMP pages are lightweight and load faster, which helps CLS/LCP metrics.
// Canonical pages carry heavier JS so they exercise INP.
const PAGE_POOL = [
  // Homepage
  { url: '/', ampUrl: '/amp/', label: 'homepage' },
  // Products (top categories / popular items)
  { url: '/san-pham/bo-hoa-hong-do-99-bong/', ampUrl: '/amp/san-pham/bo-hoa-hong-do-99-bong/', label: 'product-99-hong' },
  { url: '/san-pham/bo-ha-long-7-bong/', ampUrl: '/amp/san-pham/bo-ha-long-7-bong/', label: 'product-ha-long' },
  { url: '/san-pham/gio-ha-long-7-bong/', ampUrl: '/amp/san-pham/gio-ha-long-7-bong/', label: 'product-gio-ha-long' },
  { url: '/san-pham/binh-ha-long-9-bong/', ampUrl: '/amp/san-pham/binh-ha-long-9-bong/', label: 'product-binh-ha-long' },
  { url: '/san-pham/bo-ha-long-19-bong/', ampUrl: '/amp/san-pham/bo-ha-long-19-bong/', label: 'product-ha-long-19' },
  { url: '/san-pham/bo-ha-long-99-bong/', ampUrl: '/amp/san-pham/bo-ha-long-99-bong/', label: 'product-ha-long-99' },
  { url: '/san-pham/bo-hoa-tulip-7-bong/', ampUrl: '/amp/san-pham/bo-hoa-tulip-7-bong/', label: 'product-tulip' },
  { url: '/san-pham/khung-hoa-sinh-nhat-ha-long/', ampUrl: '/amp/san-pham/khung-hoa-sinh-nhat-ha-long/', label: 'product-khung-sinh-nhat' },
  // Category pages
  { url: '/cua-hang/', ampUrl: null, label: 'shop' },
  { url: '/danh-muc/hoa-sinh-nhat/', ampUrl: null, label: 'cat-sinh-nhat' },
  { url: '/danh-muc/hoa-khai-truong/', ampUrl: null, label: 'cat-khai-truong' },
  { url: '/danh-muc/hoa-chia-buon/', ampUrl: null, label: 'cat-chia-buon' },
  { url: '/danh-muc/hoa-tulip/', ampUrl: null, label: 'cat-tulip' },
  { url: '/danh-muc/hoa-hong/', ampUrl: null, label: 'cat-hong' },
  // Blog articles
  { url: '/cach-cham-soc-hoa-tuoi-lau-tan/', ampUrl: '/amp/cach-cham-soc-hoa-tuoi-lau-tan/', label: 'blog-cham-soc' },
  { url: '/y-nghia-cac-loai-hoa/', ampUrl: '/amp/y-nghia-cac-loai-hoa/', label: 'blog-y-nghia' },
  { url: '/dat-hoa-online-da-nang/', ampUrl: '/amp/dat-hoa-online-da-nang/', label: 'blog-dat-hoa' },
  // Info pages
  { url: '/gioi-thieu/', ampUrl: null, label: 'about' },
  { url: '/lien-he/', ampUrl: null, label: 'contact' },
  { url: '/chinh-sach-giao-hang/', ampUrl: null, label: 'shipping' },
  { url: '/chinh-sach-bao-mat/', ampUrl: null, label: 'privacy' },
];

// Shuffle array using Fisher-Yates
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shard the page pool for parallel runs
const pagesPerShard = Math.ceil(PAGE_POOL.length / TOTAL_SHARDS);
const myPages = PAGE_POOL.slice(SHARD * pagesPerShard, (SHARD + 1) * pagesPerShard);

console.log(`=== CrUX Simulator — Shard ${SHARD}/${TOTAL_SHARDS} ===`);
console.log(`Domain: ${DOMAIN}`);
console.log(`Runs: ${RUNS} | Pages per shard: ${myPages.length}`);
console.log(`Target: ${myPages.length * RUNS} total page visits\n`);

// Mobile viewports that Chrome mobile reports to CrUX
const MOBILE_VIEWPORTS = [
  { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true },  // iPhone 14
  { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true },  // iPhone 15
  { width: 360, height: 800, deviceScaleFactor: 3, isMobile: true },  // Samsung Galaxy S23
  { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true }, // Pixel 8
  { width: 344, height: 882, deviceScaleFactor: 3, isMobile: true },  // Samsung Galaxy S24
];

const results = [];
const browser = await launch({ headless: true, humanize: true });

for (let run = 0; run < RUNS; run++) {
  const shuffled = shuffle(myPages);
  console.log(`\n--- Run ${run + 1}/${RUNS} (${shuffled.length} pages) ---`);

  for (const page of shuffled) {
    // Randomly choose AMP or canonical (with bias toward AMP — faster, better CrUX)
    const useAmp = page.ampUrl && Math.random() > 0.35;
    const path = useAmp ? page.ampUrl : page.url;
    const fullUrl = `${BASE}${path}`;
    const viewport = MOBILE_VIEWPORTS[Math.floor(Math.random() * MOBILE_VIEWPORTS.length)];

    const context = await browser.newContext({
      viewport,
      locale: 'vi-VN',
      userAgent: undefined, // Let CloakBrowser use its real Chrome UA
    });
    const tab = await context.newPage();

    const t0 = Date.now();
    try {
      console.log(`  [${page.label}${useAmp ? ' AMP' : ''}] → ${path}`);

      await tab.goto(fullUrl, { waitUntil: 'load', timeout: 30000 });

      // Simulate real user behavior: scroll down the page
      const scrollSteps = 3 + Math.floor(Math.random() * 5);
      for (let s = 0; s < scrollSteps; s++) {
        const scrollAmount = 200 + Math.floor(Math.random() * 400);
        await tab.evaluate((px) => window.scrollBy(0, px), scrollAmount);
        await new Promise(r => setTimeout(r, 500 + Math.random() * 1500));
      }

      // Scroll back up a bit (real users do this)
      if (Math.random() > 0.5) {
        await tab.evaluate(() => window.scrollBy(0, -300));
        await new Promise(r => setTimeout(r, 800));
      }

      // Stay on page for a realistic duration (CrUX needs user interaction)
      const dwellTime = 2000 + Math.floor(Math.random() * 6000);
      await new Promise(r => setTimeout(r, dwellTime));

      // Optionally click a link (internal navigation)
      if (Math.random() > 0.6) {
        const internalLink = await tab.evaluate((domain) => {
          const links = Array.from(document.querySelectorAll('a[href]'))
            .filter(a => a.href.includes(domain) && a.href !== window.location.href);
          if (links.length === 0) return null;
          const pick = links[Math.floor(Math.random() * links.length)];
          return pick.href;
        }, DOMAIN);

        if (internalLink) {
          try {
            await tab.goto(internalLink, { waitUntil: 'load', timeout: 20000 });
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
            console.log(`    → clicked internal: ${new URL(internalLink).pathname}`);
          } catch { /* navigation failed, continue */ }
        }
      }

      const elapsed = Date.now() - t0;
      results.push({
        url: path,
        label: page.label,
        isAmp: useAmp,
        elapsed,
        status: 'ok',
        viewport: `${viewport.width}x${viewport.height}`,
        run: run + 1,
        timestamp: new Date().toISOString(),
      });
      console.log(`    ✓ ${elapsed}ms`);

    } catch (err) {
      const elapsed = Date.now() - t0;
      results.push({
        url: path,
        label: page.label,
        isAmp: useAmp,
        elapsed,
        status: 'error',
        error: err.message,
        viewport: `${viewport.width}x${viewport.height}`,
        run: run + 1,
        timestamp: new Date().toISOString(),
      });
      console.log(`    ✗ ${err.message} (${elapsed}ms)`);
    }

    await context.close();

    // Random delay between visits (3-8 seconds, simulates real browsing gap)
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));
  }
}

await browser.close();

// Save results
mkdirSync('results', { recursive: true });
const outFile = `results/crux-sim-${SHARD}.json`;
writeFileSync(outFile, JSON.stringify(results, null, 2));

// Summary
const ok = results.filter(r => r.status === 'ok').length;
const err = results.filter(r => r.status === 'error').length;
const ampCount = results.filter(r => r.isAmp && r.status === 'ok').length;
const avgTime = Math.round(results.filter(r => r.status === 'ok').reduce((s, r) => s + r.elapsed, 0) / (ok || 1));

console.log(`\n=== Summary ===`);
console.log(`Total: ${results.length} | OK: ${ok} | Error: ${err}`);
console.log(`AMP visits: ${ampCount} | Canonical: ${ok - ampCount}`);
console.log(`Avg dwell: ${avgTime}ms`);
console.log(`Saved: ${outFile}`);
