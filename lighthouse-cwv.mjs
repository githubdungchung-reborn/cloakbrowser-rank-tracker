/**
 * Lighthouse CWV Verification Script
 * Runs Lighthouse on key pages and collects CWV metrics.
 *
 * Usage: node lighthouse-cwv.mjs
 * Env:   TARGET_DOMAIN — e.g. hoatuoidanangnhanhi.com
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';

const DOMAIN = process.env.TARGET_DOMAIN || 'hoatuoidanangnhanhi.com';
const BASE = `https://${DOMAIN}`;

const PAGES = [
  '/',
  '/san-pham/',
  '/danh-muc/hoa-sinh-nhat/',
  '/san-pham/bo-hoa-hong-do-dai/',
  '/amp/',
];

console.log(`=== Lighthouse CWV Verification ===`);
console.log(`Domain: ${DOMAIN}`);
console.log(`Pages: ${PAGES.length}\n`);

const results = [];

for (const page of PAGES) {
  const url = `${BASE}${page}`;
  console.log(`Testing: ${url}`);

  try {
    const raw = execSync(
      `lighthouse "${url}" --chrome-flags="--headless --no-sandbox --disable-gpu" --output=json --quiet --only-categories=performance --preset=desktop`,
      { timeout: 60000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const report = JSON.parse(raw);
    const perf = report.categories?.performance?.score ?? null;
    const audits = report.audits || {};

    const lcp = audits['largest-contentful-paint']?.numericValue ?? null;
    const cls = audits['cumulative-layout-shift']?.numericValue ?? null;
    const inp = audits['interaction-to-next-paint']?.numericValue ?? null;
    const fcp = audits['first-contentful-paint']?.numericValue ?? null;
    const ttfb = audits['server-response-time']?.numericValue ?? null;

    const entry = {
      page,
      score: perf,
      lcp: lcp != null ? Math.round(lcp) : null,
      cls: cls != null ? Math.round(cls * 1000) / 1000 : null,
      inp: inp != null ? Math.round(inp) : null,
      fcp: fcp != null ? Math.round(fcp) : null,
      ttfb: ttfb != null ? Math.round(ttfb) : null,
    };

    results.push(entry);
    console.log(`  ✓ Score: ${perf != null ? Math.round(perf * 100) : 'N/A'}% | LCP:${entry.lcp ?? '?'}ms | CLS:${entry.cls ?? '?'} | INP:${entry.inp ?? '?'}ms | FCP:${entry.fcp ?? '?'}ms`);

  } catch (err) {
    results.push({ page, score: null, error: err.message?.substring(0, 100) });
    console.log(`  ✗ Error: ${err.message?.substring(0, 80)}`);
  }
}

// Save results
mkdirSync('results', { recursive: true });
const out = {
  timestamp: new Date().toISOString(),
  domain: DOMAIN,
  pages: results,
};
writeFileSync('results/lighthouse-cwv.json', JSON.stringify(out, null, 2));

// Summary
const good = results.filter((r) => r.score >= 0.9).length;
console.log(`\n=== Summary ===`);
console.log(`Performance scores: ${good}/${results.length} pages >= 90%`);
for (const r of results) {
  const score = r.score != null ? `${Math.round(r.score * 100)}%` : 'N/A';
  console.log(`  ${r.page.padEnd(35)} ${score} | LCP:${r.lcp ?? '?'}ms | CLS:${r.cls ?? '?'} | INP:${r.inp ?? '?'}ms`);
}
console.log(`\nSaved: results/lighthouse-cwv.json`);
