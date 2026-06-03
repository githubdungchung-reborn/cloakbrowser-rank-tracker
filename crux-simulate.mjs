/**
 * CrUX Traffic Simulator & CWV Validator
 *
 * Generates realistic Chrome-like visits via CloakBrowser to exercise CWV
 * metrics, validate page eligibility, and generate analytics traffic.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ CRUX METHODOLOGY COMPLIANCE NOTE                                │
 * │                                                                  │
 * │ CrUX data is collected EXCLUSIVELY from real Chrome browsers     │
 * │ (Windows, macOS, ChromeOS, Linux, Android) via browser telemetry │
 * │ — users must have "Usage statistics and crash reports" enabled   │
 * │ AND sync enabled with no sync passphrase.                       │
 * │                                                                  │
 * │ Other Chromium browsers (Edge, CloakBrowser, Brave, etc.) are   │
 * │ EXPLICITLY EXCLUDED from CrUX collection.                       │
 * │ See: https://developer.chrome.com/docs/crux/methodology         │
 * │                                                                  │
 * │ This simulator CANNOT populate CrUX data. Its value:            │
 * │ 1. Collects real CWV metrics (LCP, CLS, INP) via Performance   │
 * │    APIs — validates our optimizations work                       │
 * │ 2. Validates CrUX eligibility (HTTP 200, no noindex, discoverable)│
 * │ 3. Generates GA/Search Console traffic patterns                  │
 * │ 4. Exercises INP via realistic user interactions                 │
 * │ 5. Continuous monitoring — catches regressions early             │
 * │                                                                  │
 * │ For actual CrUX improvements, real Chrome users must visit.      │
 * │ Our CWV optimizations benefit ALL users regardless.              │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Usage:
 *   node crux-simulate.mjs              # default: visit all pages, 1 run
 *   CRUX_RUNS=3 node crux-simulate.mjs  # 3 passes with randomized order
 *
 * Environment:
 *   TARGET_DOMAIN  — e.g. hoatuoidanangnhanhi.com
 *   CRUX_RUNS      — number of full passes (default 1)
 *   CRUX_SHARD     — for parallel matrix runs
 *   CRUX_SHARDS    — total shard count
 */

import { launch } from 'cloakbrowser';
import { writeFileSync, mkdirSync } from 'fs';
import https from 'https';

const DOMAIN = process.env.TARGET_DOMAIN || 'hoatuoidanangnhanhi.com';
const RUNS = parseInt(process.env.CRUX_RUNS || '1', 10);
const SHARD = parseInt(process.env.CRUX_SHARD || '0', 10);
const TOTAL_SHARDS = parseInt(process.env.CRUX_SHARDS || '1', 10);
const BASE = `https://${DOMAIN}`;

// ── CrUX Thresholds (75th percentile, 28-day aggregation) ──
const CRUX_THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 },   // ms
  CLS: { good: 0.1, poor: 0.25 },    // unitless
  INP: { good: 200, poor: 500 },      // ms
  FCP: { good: 1800, poor: 3000 },    // ms
  TTFB: { good: 800, poor: 1800 },    // ms
};

function rateMetric(name, value) {
  const t = CRUX_THRESHOLDS[name];
  if (!t || value == null) return 'N/A';
  return value <= t.good ? 'good' : value <= t.poor ? 'needs-improvement' : 'poor';
}

// ── Page Pool — all slugs verified against live sitemap ──
const PAGE_POOL = [
  { url: '/', ampUrl: '/amp/', label: 'homepage' },
  { url: '/san-pham/bo-hoa-hong-do-dai/', ampUrl: '/amp/san-pham/bo-hoa-hong-do-dai/', label: 'product-hong-do' },
  { url: '/san-pham/bo-hoa-baby-hong/', ampUrl: '/amp/san-pham/bo-hoa-baby-hong/', label: 'product-baby-hong' },
  { url: '/san-pham/bo-hoa-cam-chuong-hong/', ampUrl: '/amp/san-pham/bo-hoa-cam-chuong-hong/', label: 'product-cam-chuong' },
  { url: '/san-pham/bo-hoa-cat-tuong-mix-baby/', ampUrl: '/amp/san-pham/bo-hoa-cat-tuong-mix-baby/', label: 'product-cat-tuong' },
  { url: '/san-pham/bo-hoa-hong-chum-sofia/', ampUrl: '/amp/san-pham/bo-hoa-hong-chum-sofia/', label: 'product-sofia' },
  { url: '/san-pham/bo-hoa-hong-mix-007/', ampUrl: '/amp/san-pham/bo-hoa-hong-mix-007/', label: 'product-mix-007' },
  { url: '/san-pham/bo-hoa-huong-duong-vintage/', ampUrl: '/amp/san-pham/bo-hoa-huong-duong-vintage/', label: 'product-huong-duong' },
  { url: '/san-pham/ke-hoa-hong-do-giay-coi/', ampUrl: '/amp/san-pham/ke-hoa-hong-do-giay-coi/', label: 'product-ke-hong-do' },
  { url: '/cua-hang/', ampUrl: null, label: 'shop' },
  { url: '/danh-muc/hoa-sinh-nhat/', ampUrl: null, label: 'cat-sinh-nhat' },
  { url: '/danh-muc/hoa-su-kien/hoa-khai-truong/', ampUrl: null, label: 'cat-khai-truong' },
  { url: '/danh-muc/hoa-chia-buon/', ampUrl: null, label: 'cat-chia-buon' },
  { url: '/danh-muc/hoa-tuoi/hoa-hong/', ampUrl: null, label: 'cat-hong' },
  { url: '/danh-muc/hoa-tuoi/', ampUrl: null, label: 'cat-hoa-tuoi' },
  { url: '/hoa-da-nang-honeymoon-tuan-trang-mat-bai-bien-resort-2026-decor/', ampUrl: '/amp/hoa-da-nang-honeymoon-tuan-trang-mat-bai-bien-resort-2026-decor/', label: 'blog-honeymoon' },
  { url: '/hoa-da-nang-quy-trinh-kiem-soat-chat-luong-tu-vuon-toi-khach-2026/', ampUrl: '/amp/hoa-da-nang-quy-trinh-kiem-soat-chat-luong-tu-vuon-toi-khach-2026/', label: 'blog-chat-luong' },
  { url: '/nghe-florist-tai-da-nang-2026-luong-thuong-thu-nhap-thuc-te-co-hoi-vieclam/', ampUrl: '/amp/nghe-florist-tai-da-nang-2026-luong-thuong-thu-nhap-thuc-te-co-hoi-vieclam/', label: 'blog-florist' },
  { url: '/gioi-thieu/', ampUrl: null, label: 'about' },
  { url: '/lien-he/', ampUrl: null, label: 'contact' },
  { url: '/chinh-sach-van-chuyen/', ampUrl: null, label: 'shipping' },
  { url: '/chinh-sach-bao-mat-thong-tin/', ampUrl: null, label: 'privacy' },
];

// ── Helpers ──
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Shard the page pool ──
const pagesPerShard = Math.ceil(PAGE_POOL.length / TOTAL_SHARDS);
const myPages = PAGE_POOL.slice(SHARD * pagesPerShard, (SHARD + 1) * pagesPerShard);

console.log(`=== CrUX Simulator — Shard ${SHARD}/${TOTAL_SHARDS} ===`);
console.log(`Domain: ${DOMAIN}`);
console.log(`Runs: ${RUNS} | Pages: ${myPages.length}`);
console.log(`CrUX thresholds: LCP ≤${CRUX_THRESHOLDS.LCP.good}ms, CLS ≤${CRUX_THRESHOLDS.CLS.good}, INP ≤${CRUX_THRESHOLDS.INP.good}ms\n`);

// ── Step 1: CrUX Eligibility Pre-check ──
console.log('--- CrUX Eligibility Pre-check ---');
const eligibilityResults = [];
for (const page of myPages) {
  const fullUrl = `${BASE}${page.url}`;
  try {
    const res = await httpsGet(fullUrl);
    const hasNoindex = res.body.includes('noindex') || (res.headers['x-robots-tag'] || '').includes('noindex');
    const eligible = res.status === 200 && !hasNoindex;
    eligibilityResults.push({
      url: page.url,
      label: page.label,
      status: res.status,
      noindex: hasNoindex,
      eligible,
    });
    console.log(`  ${eligible ? '✓' : '✗'} ${page.label} → HTTP ${res.status}${hasNoindex ? ' (noindex!)' : ''}`);
  } catch (err) {
    eligibilityResults.push({
      url: page.url,
      label: page.label,
      status: 0,
      noindex: false,
      eligible: false,
      error: err.message,
    });
    console.log(`  ✗ ${page.label} → ERROR: ${err.message}`);
  }
}
const eligibleCount = eligibilityResults.filter((r) => r.eligible).length;
console.log(`\nEligibility: ${eligibleCount}/${eligibilityResults.length} pages qualify for CrUX\n`);

// ── Viewports — matching real Chrome device profiles ──
const MOBILE_VIEWPORTS = [
  { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true },   // iPhone 14
  { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true },   // iPhone 15
  { width: 360, height: 800, deviceScaleFactor: 3, isMobile: true },   // Galaxy S23
  { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true }, // Pixel 8
  { width: 344, height: 882, deviceScaleFactor: 3, isMobile: true },   // Galaxy S24
];

const DESKTOP_VIEWPORTS = [
  { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false },
  { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  { width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false },
  { width: 1536, height: 864, deviceScaleFactor: 1.25, isMobile: false },
];

// ── CWV Collection Script (injected into page) ──
// Uses PerformanceObserver APIs — same data sources as CrUX
const CWV_COLLECTOR_SCRIPT = `
(function() {
  const metrics = { lcp: null, cls: 0, inp: null, fcp: null, ttfb: null, layoutShifts: [] };

  // Navigation timing (TTFB)
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) {
      metrics.ttfb = Math.round(nav.responseStart - nav.requestStart);
    }
  } catch {}

  // FCP
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          metrics.fcp = Math.round(entry.startTime);
        }
      }
    }).observe({ type: 'paint', buffered: true });
  } catch {}

  // LCP — CrUX uses the last LCP candidate before user input
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) {
        metrics.lcp = Math.round(last.startTime);
        metrics.lcpElement = last.element ? (last.element.tagName + (last.element.className ? '.' + String(last.element.className).split(' ')[0] : '')) : null;
        metrics.lcpSize = Math.round(last.size);
        metrics.lcpUrl = last.url || null;
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}

  // CLS — CrUX uses session window with 5s gap, max 1s duration
  try {
    let sessionValue = 0;
    let sessionStart = 0;
    const MAX_SESSION_GAP = 5000;
    const MAX_SESSION_DURATION = 1000;

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        const now = entry.startTime;
        if (sessionStart && (now - sessionStart > MAX_SESSION_GAP || now - sessionStart > MAX_SESSION_DURATION)) {
          sessionValue = 0;
          sessionStart = 0;
        }
        sessionValue += entry.value;
        sessionStart = sessionStart || now;
        metrics.cls = Math.max(metrics.cls, sessionValue);
        metrics.layoutShifts.push({ value: Math.round(entry.value * 1000) / 1000, time: Math.round(now) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}

  // INP — interaction latency via PerformanceEventTiming
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.interactionId) {
          const duration = Math.round(entry.duration);
          if (!metrics.inp || duration > metrics.inp) {
            metrics.inp = duration;
          }
        }
      }
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
  } catch {}

  // Expose collector
  window.__cwvCollect = function() {
    return {
      lcp: metrics.lcp,
      lcpElement: metrics.lcpElement,
      lcpSize: metrics.lcpSize,
      lcpUrl: metrics.lcpUrl,
      cls: Math.round(metrics.cls * 1000) / 1000,
      inp: metrics.inp,
      fcp: metrics.fcp,
      ttfb: metrics.ttfb,
      layoutShiftCount: metrics.layoutShifts.length,
    };
  };
})();
`;

// ── Main Simulation Loop ──
const results = [];
const browser = await launch({ headless: true, humanize: true });

for (let run = 0; run < RUNS; run++) {
  const shuffled = shuffle(myPages);
  console.log(`\n--- Run ${run + 1}/${RUNS} (${shuffled.length} pages) ---`);

  for (const page of shuffled) {
    const useAmp = page.ampUrl && Math.random() > 0.35;
    const path = useAmp ? page.ampUrl : page.url;
    const fullUrl = `${BASE}${path}`;
    const isMobileVisit = Math.random() > 0.3;
    const viewports = isMobileVisit ? MOBILE_VIEWPORTS : DESKTOP_VIEWPORTS;
    const viewport = viewports[Math.floor(Math.random() * viewports.length)];

    const context = await browser.newContext({
      viewport,
      locale: 'vi-VN',
    });
    const tab = await context.newPage();

    // Inject CWV collector BEFORE page load
    await tab.addInitScript(CWV_COLLECTOR_SCRIPT);

    const t0 = Date.now();
    try {
      console.log(`  [${page.label}${useAmp ? ' AMP' : ''}] → ${path}`);

      const response = await tab.goto(fullUrl, { waitUntil: 'load', timeout: 30000 });
      const httpStatus = response?.status() ?? 0;

      // Check page eligibility on the actual response
      const pageHtml = await tab.content();
      const hasNoindex = pageHtml.includes('noindex');
      const isEligible = httpStatus === 200 && !hasNoindex;

      // Wait for LCP to settle
      await new Promise(r => setTimeout(r, 2000));

      // ── Realistic User Interaction Sequence ──

      // 1. Initial viewport pause (user reads above-the-fold)
      await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));

      // 2. Scroll down — exercises LCP observation + triggers lazy loads
      const scrollSteps = 3 + Math.floor(Math.random() * 5);
      for (let s = 0; s < scrollSteps; s++) {
        const scrollAmount = 200 + Math.floor(Math.random() * 400);
        await tab.evaluate((px) => window.scrollBy(0, px), scrollAmount);
        await new Promise(r => setTimeout(r, 500 + Math.random() * 1500));
      }

      // 3. Hover over interactive elements (exercises INP hover handlers)
      if (Math.random() > 0.3) {
        try {
          const hoverTarget = await tab.evaluate(() => {
            const targets = Array.from(document.querySelectorAll(
              'a, button, [role="button"], article, [data-cart-product-root]'
            ));
            if (targets.length === 0) return null;
            const pick = targets[Math.floor(Math.random() * targets.length)];
            const rect = pick.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return null;
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          });
          if (hoverTarget) {
            await tab.mouse.move(hoverTarget.x, hoverTarget.y);
            await new Promise(r => setTimeout(r, 300 + Math.random() * 700));
          }
        } catch {}
      }

      // 4. Click interactive elements — exercises INP (CrUX measures interaction latency)
      if (Math.random() > 0.3) {
        try {
          const clickTarget = await tab.evaluate(() => {
            const targets = Array.from(document.querySelectorAll(
              'button:not([type="submit"]), [role="button"], [data-wishlist-toggle], [data-gallery-thumb], summary, details'
            ));
            if (targets.length === 0) return null;
            const pick = targets[Math.floor(Math.random() * targets.length)];
            const rect = pick.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return null;
            pick.scrollIntoView({ block: 'center' });
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          });
          if (clickTarget) {
            await tab.mouse.click(clickTarget.x, clickTarget.y);
            await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
          }
        } catch {}
      }

      // 5. Type in search input — exercises INP (keydown/keypress handlers)
      if (Math.random() > 0.5) {
        try {
          const searchInput = await tab.evaluate(() => {
            const input = document.querySelector(
              'input[type="search"], input[name="s"], input[placeholder*="tìm"], input[placeholder*="Tìm"]'
            );
            if (!input) return null;
            input.focus();
            input.scrollIntoView({ block: 'center' });
            return true;
          });
          if (searchInput) {
            const queries = ['hoa', 'sinh nhật', 'khai trương', 'hồng', 'tulip', 'cưới'];
            const query = queries[Math.floor(Math.random() * queries.length)];
            for (const char of query) {
              await tab.keyboard.type(char);
              await new Promise(r => setTimeout(r, 80 + Math.random() * 120));
            }
            await new Promise(r => setTimeout(r, 500));
          }
        } catch {}
      }

      // 6. Focus form inputs (exercises INP focus handlers)
      if (Math.random() > 0.5) {
        try {
          await tab.evaluate(() => {
            const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea, select');
            if (inputs.length === 0) return false;
            const pick = inputs[Math.floor(Math.random() * inputs.length)];
            pick.scrollIntoView({ block: 'center' });
            pick.focus();
            return true;
          });
          await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
        } catch {}
      }

      // 7. Scroll back up (real users do this)
      if (Math.random() > 0.4) {
        await tab.evaluate(() => window.scrollBy(0, -(200 + Math.random() * 400)));
        await new Promise(r => setTimeout(r, 800));
      }

      // 8. Dwell time — CrUX needs user interaction to measure INP
      const dwellTime = 3000 + Math.floor(Math.random() * 8000);
      await new Promise(r => setTimeout(r, dwellTime));

      // ── Multi-page session: click internal links ──
      const navCount = Math.random() > 0.5 ? 2 : 1;
      const navigatedPages = [];
      for (let nav = 0; nav < navCount; nav++) {
        try {
          const internalLink = await tab.evaluate((domain) => {
            const links = Array.from(document.querySelectorAll('a[href]'))
              .filter(a => a.href.includes(domain) && a.href !== window.location.href
                && !a.href.includes('#') && !a.href.includes('tel:') && !a.href.includes('zalo.me'));
            if (links.length === 0) return null;
            return links[Math.floor(Math.random() * links.length)].href;
          }, DOMAIN);

          if (internalLink) {
            await tab.goto(internalLink, { waitUntil: 'load', timeout: 20000 });
            navigatedPages.push(new URL(internalLink).pathname);

            const navScrolls = 2 + Math.floor(Math.random() * 3);
            for (let s = 0; s < navScrolls; s++) {
              await tab.evaluate((px) => window.scrollBy(0, px), 200 + Math.floor(Math.random() * 300));
              await new Promise(r => setTimeout(r, 400 + Math.random() * 1000));
            }

            await new Promise(r => setTimeout(r, 2000 + Math.random() * 4000));
            console.log(`    → nav ${nav + 1}: ${new URL(internalLink).pathname}`);
          }
        } catch {}
      }

      // ── Collect CWV Metrics ──
      let cwv = {};
      try {
        cwv = await tab.evaluate(() => window.__cwvCollect?.() || {});
      } catch {}

      const elapsed = Date.now() - t0;
      const lcpRate = rateMetric('LCP', cwv.lcp);
      const clsRate = rateMetric('CLS', cwv.cls);
      const inpRate = rateMetric('INP', cwv.inp);
      const fcpRate = rateMetric('FCP', cwv.fcp);
      const ttfbRate = rateMetric('TTFB', cwv.ttfb);
      const allGood = [lcpRate, clsRate, inpRate].every(r => r === 'good' || r === 'N/A');

      results.push({
        url: path,
        label: page.label,
        isAmp: useAmp,
        httpStatus,
        isEligible,
        hasNoindex,
        elapsed,
        status: 'ok',
        viewport: `${viewport.width}x${viewport.height}`,
        isMobile: isMobileVisit,
        run: run + 1,
        timestamp: new Date().toISOString(),
        navigatedPages,
        cwv: {
          lcp: cwv.lcp,
          lcpElement: cwv.lcpElement,
          lcpSize: cwv.lcpSize,
          lcpUrl: cwv.lcpUrl,
          cls: cwv.cls,
          inp: cwv.inp,
          fcp: cwv.fcp,
          ttfb: cwv.ttfb,
          layoutShiftCount: cwv.layoutShiftCount,
          lcpRate,
          clsRate,
          inpRate,
          fcpRate,
          ttfbRate,
          allGood,
        },
      });

      const cwvLine = [
        `LCP:${cwv.lcp ?? '?'}ms(${lcpRate})`,
        `CLS:${cwv.cls ?? '?'}(${clsRate})`,
        `INP:${cwv.inp ?? '?'}ms(${inpRate})`,
        `FCP:${cwv.fcp ?? '?'}ms`,
        `TTFB:${cwv.ttfb ?? '?'}ms`,
      ].join(' | ');
      console.log(`    ✓ ${elapsed}ms — ${cwvLine}${allGood ? ' ✅ ALL GOOD' : ''}`);

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
        isMobile: isMobileVisit,
        run: run + 1,
        timestamp: new Date().toISOString(),
        cwv: {},
      });
      console.log(`    ✗ ${err.message} (${elapsed}ms)`);
    }

    await context.close();
    await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));
  }
}

await browser.close();

// ── Save Results ──
mkdirSync('results', { recursive: true });
const outFile = `results/crux-sim-${SHARD}.json`;
writeFileSync(outFile, JSON.stringify(results, null, 2));

// ── Summary Report ──
const ok = results.filter((r) => r.status === 'ok');
const err = results.filter((r) => r.status === 'error');
const ampOk = ok.filter((r) => r.isAmp);
const mobileOk = ok.filter((r) => r.isMobile);
const desktopOk = ok.filter((r) => !r.isMobile);
const avgTime = Math.round(ok.reduce((s, r) => s + r.elapsed, 0) / (ok.length || 1));

const cwvWithLcp = ok.filter((r) => r.cwv?.lcp != null);
const cwvWithCls = ok.filter((r) => r.cwv?.cls != null);
const cwvWithInp = ok.filter((r) => r.cwv?.inp != null);
const avgLcp = cwvWithLcp.length ? Math.round(cwvWithLcp.reduce((s, r) => s + r.cwv.lcp, 0) / cwvWithLcp.length) : null;
const avgCls = cwvWithCls.length ? Math.round(cwvWithCls.reduce((s, r) => s + r.cwv.cls, 0) / cwvWithCls.length * 1000) / 1000 : null;
const avgInp = cwvWithInp.length ? Math.round(cwvWithInp.reduce((s, r) => s + r.cwv.inp, 0) / cwvWithInp.length) : null;
const allGoodCount = ok.filter((r) => r.cwv?.allGood).length;
const eligibleOk = ok.filter((r) => r.isEligible).length;

console.log(`\n=== Summary ===`);
console.log(`Total: ${results.length} | OK: ${ok.length} | Error: ${err.length}`);
console.log(`AMP visits: ${ampOk.length} | Canonical: ${ok.length - ampOk.length}`);
console.log(`Mobile: ${mobileOk.length} | Desktop: ${desktopOk.length}`);
console.log(`Avg dwell: ${avgTime}ms`);
console.log(`\nCrUX Eligibility: ${eligibleOk}/${ok.length} pages eligible (HTTP 200, no noindex)`);
console.log(`\nCWV Metrics (averages):`);
console.log(`  LCP: ${avgLcp ?? 'N/A'}ms ${avgLcp ? `(${rateMetric('LCP', avgLcp)})` : ''}`);
console.log(`  CLS: ${avgCls ?? 'N/A'} ${avgCls != null ? `(${rateMetric('CLS', avgCls)})` : ''}`);
console.log(`  INP: ${avgInp ?? 'N/A'}ms ${avgInp ? `(${rateMetric('INP', avgInp)})` : ''}`);
console.log(`  All CWV good: ${allGoodCount}/${ok.length} visits`);

// Per-page CWV breakdown
console.log(`\nPer-page CWV:`);
const byPage = {};
for (const r of ok) {
  if (!byPage[r.label]) byPage[r.label] = { lcp: [], cls: [], inp: [], fcp: [], ttfb: [] };
  if (r.cwv?.lcp != null) byPage[r.label].lcp.push(r.cwv.lcp);
  if (r.cwv?.cls != null) byPage[r.label].cls.push(r.cwv.cls);
  if (r.cwv?.inp != null) byPage[r.label].inp.push(r.cwv.inp);
  if (r.cwv?.fcp != null) byPage[r.label].fcp.push(r.cwv.fcp);
  if (r.cwv?.ttfb != null) byPage[r.label].ttfb.push(r.cwv.ttfb);
}
for (const [label, m] of Object.entries(byPage)) {
  const avg = (arr) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;
  const lcp = avg(m.lcp);
  const cls = m.cls.length ? Math.round(m.cls.reduce((s, v) => s + v, 0) / m.cls.length * 1000) / 1000 : null;
  const inp = avg(m.inp);
  const fcp = avg(m.fcp);
  const ttfb = avg(m.ttfb);
  console.log(`  ${label.padEnd(25)} LCP:${String(lcp ?? '?').padStart(5)}ms CLS:${String(cls ?? '?').padStart(5)} INP:${String(inp ?? '?').padStart(4)}ms FCP:${String(fcp ?? '?').padStart(5)}ms TTFB:${String(ttfb ?? '?').padStart(4)}ms`);
}

console.log(`\nSaved: ${outFile}`);
