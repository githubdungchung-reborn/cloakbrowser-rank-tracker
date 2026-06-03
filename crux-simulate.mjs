/**
 * CrUX Traffic Simulator — generates realistic Chrome-like visits via CloakBrowser
 * to exercise CWV metrics and generate analytics traffic.
 *
 * IMPORTANT — CrUX Methodology Note:
 * CrUX data is collected exclusively from REAL Chrome browsers via browser telemetry
 * (users must have "Usage statistics and crash reports" + sync enabled, no passphrase).
 * Other Chromium browsers (Edge, CloakBrowser, etc.) are explicitly excluded.
 * See: https://developer.chrome.com/docs/crux/methodology
 *
 * This simulator CANNOT directly populate CrUX data. Its value is:
 * 1. Exercising CWV metrics under realistic conditions (scroll, click, INP triggers)
 * 2. Generating analytics traffic patterns visible in GA/Search Console
 * 3. Seeding Googlebot crawl signals (not CrUX, but general SEO)
 * 4. Testing page performance under various viewports and interaction patterns
 *
 * For CrUX improvements to appear, real Chrome users must visit the site.
 * Our CWV optimizations (LCP, CLS, INP) will benefit all users regardless.
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
// All slugs verified against live sitemap 2026-03-22.
const PAGE_POOL = [
  // Homepage
  { url: '/', ampUrl: '/amp/', label: 'homepage' },
  // Products (verified live slugs, AMP works via middleware)
  { url: '/san-pham/bo-hoa-hong-do-dai/', ampUrl: '/amp/san-pham/bo-hoa-hong-do-dai/', label: 'product-hong-do' },
  { url: '/san-pham/bo-hoa-baby-hong/', ampUrl: '/amp/san-pham/bo-hoa-baby-hong/', label: 'product-baby-hong' },
  { url: '/san-pham/bo-hoa-cam-chuong-hong/', ampUrl: '/amp/san-pham/bo-hoa-cam-chuong-hong/', label: 'product-cam-chuong' },
  { url: '/san-pham/bo-hoa-cat-tuong-mix-baby/', ampUrl: '/amp/san-pham/bo-hoa-cat-tuong-mix-baby/', label: 'product-cat-tuong' },
  { url: '/san-pham/bo-hoa-hong-chum-sofia/', ampUrl: '/amp/san-pham/bo-hoa-hong-chum-sofia/', label: 'product-sofia' },
  { url: '/san-pham/bo-hoa-hong-mix-007/', ampUrl: '/amp/san-pham/bo-hoa-hong-mix-007/', label: 'product-mix-007' },
  { url: '/san-pham/bo-hoa-huong-duong-vintage/', ampUrl: '/amp/san-pham/bo-hoa-huong-duong-vintage/', label: 'product-huong-duong' },
  { url: '/san-pham/ke-hoa-hong-do-giay-coi/', ampUrl: '/amp/san-pham/ke-hoa-hong-do-giay-coi/', label: 'product-ke-hong-do' },
  // Category pages (no AMP)
  { url: '/cua-hang/', ampUrl: null, label: 'shop' },
  { url: '/danh-muc/hoa-sinh-nhat/', ampUrl: null, label: 'cat-sinh-nhat' },
  { url: '/danh-muc/hoa-su-kien/hoa-khai-truong/', ampUrl: null, label: 'cat-khai-truong' },
  { url: '/danh-muc/hoa-chia-buon/', ampUrl: null, label: 'cat-chia-buon' },
  { url: '/danh-muc/hoa-tuoi/hoa-hong/', ampUrl: null, label: 'cat-hong' },
  { url: '/danh-muc/hoa-tuoi/', ampUrl: null, label: 'cat-hoa-tuoi' },
  // Blog articles (verified from sitemap-articles.xml)
  { url: '/hoa-da-nang-honeymoon-tuan-trang-mat-bai-bien-resort-2026-decor/', ampUrl: '/amp/hoa-da-nang-honeymoon-tuan-trang-mat-bai-bien-resort-2026-decor/', label: 'blog-honeymoon' },
  { url: '/hoa-da-nang-quy-trinh-kiem-soat-chat-luong-tu-vuon-toi-khach-2026/', ampUrl: '/amp/hoa-da-nang-quy-trinh-kiem-soat-chat-luong-tu-vuon-toi-khach-2026/', label: 'blog-chat-luong' },
  { url: '/nghe-florist-tai-da-nang-2026-luong-thuong-thu-nhap-thuc-te-co-hoi-vieclam/', ampUrl: '/amp/nghe-florist-tai-da-nang-2026-luong-thuong-thu-nhap-thuc-te-co-hoi-vieclam/', label: 'blog-florist' },
  // Info pages (verified from sitemap-pages.xml)
  { url: '/gioi-thieu/', ampUrl: null, label: 'about' },
  { url: '/lien-he/', ampUrl: null, label: 'contact' },
  { url: '/chinh-sach-van-chuyen/', ampUrl: null, label: 'shipping' },
  { url: '/chinh-sach-bao-mat-thong-tin/', ampUrl: null, label: 'privacy' },
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

// Desktop viewports — CrUX tracks both mobile and desktop
const DESKTOP_VIEWPORTS = [
  { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false }, // Full HD
  { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },  // MacBook Air
  { width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false },  // Common laptop
  { width: 1536, height: 864, deviceScaleFactor: 1.25, isMobile: false }, // Surface
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
    // 70% mobile, 30% desktop — CrUX tracks both device types
    const isMobileVisit = Math.random() > 0.3;
    const viewports = isMobileVisit ? MOBILE_VIEWPORTS : DESKTOP_VIEWPORTS;
    const viewport = viewports[Math.floor(Math.random() * viewports.length)];

    const context = await browser.newContext({
      viewport,
      locale: 'vi-VN',
      userAgent: undefined, // Let CloakBrowser use its real Chrome UA
    });
    const tab = await context.newPage();

    // Inject Client Hints to match real Chrome behavior
    // CrUX requires Chrome with sync+telemetry; this makes the browser look
    // more authentic to any server-side detection, even though CrUX itself
    // collects data via Chrome browser telemetry (not website JS).
    await tab.addInitScript(() => {
      if (!navigator.userAgentData) {
        Object.defineProperty(navigator, 'userAgentData', {
          get: () => ({
            brands: [
              { brand: 'Google Chrome', version: '146' },
              { brand: 'Chromium', version: '146' },
              { brand: 'Not_A Brand', version: '24' },
            ],
            mobile: false,
            platform: 'Windows',
            getHighEntropyValues: async () => ({
              brands: [
                { brand: 'Google Chrome', version: '146' },
                { brand: 'Chromium', version: '146' },
              ],
              mobile: false,
              platform: 'Windows',
              platformVersion: '15.0.0',
              architecture: 'x86',
              bitness: '64',
              model: '',
              uaFullVersion: '146.0.0.0',
            }),
          }),
        });
      }
    });

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

      // Hover over interactive elements (exercises INP — hover triggers event handlers)
      if (Math.random() > 0.4) {
        const hoverTarget = await tab.evaluate(() => {
          const targets = Array.from(document.querySelectorAll('a, button, [role="button"], article'));
          if (targets.length === 0) return null;
          const pick = targets[Math.floor(Math.random() * targets.length)];
          const rect = pick.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });
        if (hoverTarget) {
          await tab.mouse.move(hoverTarget.x, hoverTarget.y);
          await new Promise(r => setTimeout(r, 300 + Math.random() * 700));
        }
      }

      // Click on a non-navigation element (exercises INP — click triggers event handlers)
      // Uses buttons and [role="button"] to avoid navigating away from the page
      if (Math.random() > 0.5) {
        const clickTarget = await tab.evaluate(() => {
          const targets = Array.from(document.querySelectorAll(
            'button:not([type="submit"]), [role="button"], [data-wishlist-toggle], [data-gallery-thumb], summary'
          ));
          if (targets.length === 0) return null;
          const pick = targets[Math.floor(Math.random() * targets.length)];
          const rect = pick.getBoundingClientRect();
          // Only click if visible in viewport
          if (rect.width === 0 || rect.height === 0) return null;
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        });
        if (clickTarget) {
          await tab.mouse.click(clickTarget.x, clickTarget.y);
          await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
        }
      }

      // Type in a search input (exercises INP — keypress triggers event handlers)
      if (Math.random() > 0.7) {
        const searchInput = await tab.evaluate(() => {
          const input = document.querySelector('input[type="search"], input[name="s"], input[placeholder*="tìm"]');
          if (!input) return null;
          input.focus();
          return true;
        });
        if (searchInput) {
          const query = ['hoa', 'sinh nhật', 'khai trương', 'hồng', 'tulip'][Math.floor(Math.random() * 5)];
          for (const char of query) {
            await tab.keyboard.type(char);
            await new Promise(r => setTimeout(r, 80 + Math.random() * 120));
          }
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // Focus on a form input if present (exercises INP — focus triggers handlers)
      if (Math.random() > 0.7) {
        const input = await tab.evaluate(() => {
          const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea, select');
          if (inputs.length === 0) return null;
          const pick = inputs[Math.floor(Math.random() * inputs.length)];
          pick.focus();
          return true;
        });
        if (input) {
          await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
        }
      }

      // Scroll back up a bit (real users do this)
      if (Math.random() > 0.5) {
        await tab.evaluate(() => window.scrollBy(0, -300));
        await new Promise(r => setTimeout(r, 800));
      }

      // Stay on page for a realistic duration (CrUX needs user interaction)
      const dwellTime = 3000 + Math.floor(Math.random() * 8000);
      await new Promise(r => setTimeout(r, dwellTime));

      // Multi-page session: click 1-2 internal links (simulates browsing session)
      const navCount = Math.random() > 0.5 ? 2 : 1;
      for (let nav = 0; nav < navCount; nav++) {
        const internalLink = await tab.evaluate((domain) => {
          const links = Array.from(document.querySelectorAll('a[href]'))
            .filter(a => a.href.includes(domain) && a.href !== window.location.href
              && !a.href.includes('#') && !a.href.includes('tel:') && !a.href.includes('zalo.me'));
          if (links.length === 0) return null;
          const pick = links[Math.floor(Math.random() * links.length)];
          return pick.href;
        }, DOMAIN);

        if (internalLink) {
          try {
            await tab.goto(internalLink, { waitUntil: 'load', timeout: 20000 });

            // Scroll the navigated page too
            const navScrolls = 2 + Math.floor(Math.random() * 3);
            for (let s = 0; s < navScrolls; s++) {
              await tab.evaluate((px) => window.scrollBy(0, px), 200 + Math.floor(Math.random() * 300));
              await new Promise(r => setTimeout(r, 400 + Math.random() * 1000));
            }

            await new Promise(r => setTimeout(r, 2000 + Math.random() * 4000));
            console.log(`    → nav ${nav + 1}: ${new URL(internalLink).pathname}`);
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
const mobileCount = results.filter(r => {
  if (r.status !== 'ok' || !r.viewport) return false;
  const w = parseInt(r.viewport.split('x')[0], 10);
  return w <= 768;
}).length;
const desktopCount = ok - mobileCount;
const avgTime = Math.round(results.filter(r => r.status === 'ok').reduce((s, r) => s + r.elapsed, 0) / (ok || 1));

console.log(`\n=== Summary ===`);
console.log(`Total: ${results.length} | OK: ${ok} | Error: ${err}`);
console.log(`AMP visits: ${ampCount} | Canonical: ${ok - ampCount}`);
console.log(`Mobile: ${mobileCount} | Desktop: ${desktopCount}`);
console.log(`Avg dwell: ${avgTime}ms`);
console.log(`Saved: ${outFile}`);
