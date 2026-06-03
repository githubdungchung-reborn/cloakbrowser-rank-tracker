import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from 'fs';

const TARGET_DOMAIN = process.env.TARGET_DOMAIN || 'hoatuoidanangnhanhi.com';
const resultsDir = 'results';

// === Keyword rankings ===
const shardFiles = readdirSync(resultsDir).filter(f => f.startsWith('shard-') && f.endsWith('.json'));
const allResults = [];
for (const file of shardFiles) {
  try {
    allResults.push(...JSON.parse(readFileSync(`${resultsDir}/${file}`, 'utf-8')));
  } catch (e) {
    console.warn(`Warning: could not parse ${file}: ${e.message}`);
  }
}
allResults.sort((a, b) => a.keyword.localeCompare(b.keyword));
const ranked = allResults.filter(r => r.position > 0).length;

// === Index checks ===
const indexFiles = readdirSync(resultsDir).filter(f => f.startsWith('index-check-') && f.endsWith('.json'));
const indexChecks = [];
for (const f of indexFiles) {
  try {
    indexChecks.push(JSON.parse(readFileSync(`${resultsDir}/${f}`, 'utf-8')));
  } catch (e) {
    console.warn(`Warning: could not parse ${f}: ${e.message}`);
  }
}
const clickVerified = indexChecks.filter(c => c.clickVerified).length;
const clickFailed = indexChecks.filter(c => !c.clickVerified).length;

// Unique pages clicked
const clickedPages = {};
indexChecks.forEach(c => {
  if (c.clickedUrl) {
    const path = c.clickedUrl.replace(`https://${TARGET_DOMAIN}`, '') || '/';
    clickedPages[path] = (clickedPages[path] || 0) + 1;
  }
});

// Append to history
appendFileSync(`${resultsDir}/history.jsonl`, JSON.stringify({
  timestamp: new Date().toISOString(),
  rankings: allResults,
  indexChecks: indexChecks.map(c => ({ clicked: c.clickedUrl, verified: c.clickVerified })),
}) + '\n');

// === Generate report ===
const timestamp = new Date().toISOString();
let md = `# Ranking Report — ${TARGET_DOMAIN}\n`;
md += `**Updated:** ${timestamp}\n\n`;

// Keyword rankings table
md += `## Keyword Rankings\n\n`;
md += `| # | Keyword | Rank | Page | Searched | Top 3 Competitors |\n`;
md += `|---|---------|------|------|----------|--------------------|\n`;
allResults.forEach((r, i) => {
  const rank = r.position > 0 ? `**#${r.position}**` : 'NOT FOUND';
  const pg = r.page || '-';
  const searched = r.pagesSearched ? `${r.pagesSearched}p` : '-';
  const comp = r.topCompetitors?.slice(0, 3).join(', ') || '-';
  md += `| ${i + 1} | ${r.keyword} | ${rank} | ${pg} | ${searched} | ${comp} |\n`;
});
md += `\n**Visibility:** ${ranked}/${allResults.length} keywords ranking (${Math.round(ranked / allResults.length * 100)}%)\n`;

// Index check summary
md += `\n## Site Index Verification (${indexChecks.length} runs)\n\n`;
md += `- **Indexed pages found:** ${indexChecks[0]?.indexedCount || 0}\n`;
md += `- **Index stats:** ${indexChecks[0]?.indexStats || 'N/A'}\n`;
md += `- **Click verified:** ${clickVerified}/${indexChecks.length} passed\n`;
md += `- **Click failed:** ${clickFailed}/${indexChecks.length}\n\n`;

md += `### Pages Clicked (random distribution)\n\n`;
md += `| Page Path | Times Clicked | Verified |\n`;
md += `|-----------|---------------|----------|\n`;
const sortedPages = Object.entries(clickedPages).sort((a, b) => b[1] - a[1]);
for (const [path, count] of sortedPages) {
  const pageChecks = indexChecks.filter(c => c.clickedUrl?.includes(path));
  const allPassed = pageChecks.every(c => c.clickVerified);
  md += `| ${path} | ${count} | ${allPassed ? 'Yes' : 'Mixed'} |\n`;
}

// Click detail table
md += `\n### Click Detail\n\n`;
md += `| Run | Page Clicked | Landed Title | Verified |\n`;
md += `|-----|-------------|--------------|----------|\n`;
indexChecks.forEach((c, i) => {
  const path = c.clickedUrl?.replace(`https://${TARGET_DOMAIN}`, '') || '-';
  const title = c.landedTitle?.substring(0, 40) || '-';
  const ok = c.clickVerified ? 'Yes' : 'No';
  md += `| #${i} | ${path} | ${title} | ${ok} |\n`;
});

// Competitor summary
const cc = {};
allResults.forEach(r => r.topCompetitors?.forEach(c => {
  if (!c.includes(TARGET_DOMAIN) && !c.includes('google')) cc[c] = (cc[c] || 0) + 1;
}));
const top = Object.entries(cc).sort((a, b) => b[1] - a[1]).slice(0, 10);
if (top.length) {
  md += `\n## Top Competitors\n| Domain | Hits |\n|--------|------|\n`;
  top.forEach(([d, c]) => md += `| ${d} | ${c} |\n`);
}

// === CrUX Simulation Stats ===
const cruxFiles = readdirSync(resultsDir).filter(f => f.startsWith('crux-sim-') && f.endsWith('.json'));
let cruxVisits = [];
for (const f of cruxFiles) {
  try {
    cruxVisits.push(...JSON.parse(readFileSync(`${resultsDir}/${f}`, 'utf-8')));
  } catch {}
}
if (cruxVisits.length > 0) {
  const ok = cruxVisits.filter(r => r.status === 'ok');
  const err = cruxVisits.filter(r => r.status === 'error');
  const ampOk = ok.filter(r => r.isAmp);
  const canonicalOk = ok.filter(r => !r.isAmp);
  const mobileOk = ok.filter(r => r.isMobile);
  const desktopOk = ok.filter(r => !r.isMobile);
  const avgDwell = Math.round(ok.reduce((s, r) => s + r.elapsed, 0) / (ok.length || 1));
  const eligibleOk = ok.filter(r => r.isEligible);

  // CWV aggregation
  const cwvWithLcp = ok.filter(r => r.cwv?.lcp != null);
  const cwvWithCls = ok.filter(r => r.cwv?.cls != null);
  const cwvWithInp = ok.filter(r => r.cwv?.inp != null);
  const avgLcp = cwvWithLcp.length ? Math.round(cwvWithLcp.reduce((s, r) => s + r.cwv.lcp, 0) / cwvWithLcp.length) : null;
  const avgCls = cwvWithCls.length ? Math.round(cwvWithCls.reduce((s, r) => s + r.cwv.cls, 0) / cwvWithCls.length * 1000) / 1000 : null;
  const avgInp = cwvWithInp.length ? Math.round(cwvWithInp.reduce((s, r) => s + r.cwv.inp, 0) / cwvWithInp.length) : null;
  const allGoodCount = ok.filter(r => r.cwv?.allGood).length;

  const rateLcp = avgLcp != null ? (avgLcp <= 2500 ? '🟢 Good' : avgLcp <= 4000 ? '🟡 Needs Improvement' : '🔴 Poor') : 'N/A';
  const rateCls = avgCls != null ? (avgCls <= 0.1 ? '🟢 Good' : avgCls <= 0.25 ? '🟡 Needs Improvement' : '🔴 Poor') : 'N/A';
  const rateInp = avgInp != null ? (avgInp <= 200 ? '🟢 Good' : avgInp <= 500 ? '🟡 Needs Improvement' : '🔴 Poor') : 'N/A';

  md += `\n## CrUX Traffic Simulation\n\n`;
  md += `> **Note:** CloakBrowser is a Chromium browser — CrUX collects data exclusively from real Chrome browsers. This simulator validates CWV metrics and exercises page performance but does NOT populate CrUX data. See [CrUX Methodology](https://developer.chrome.com/docs/crux/methodology).\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Total visits | ${cruxVisits.length} |\n`;
  md += `| Successful | ${ok.length} |\n`;
  md += `| Errors | ${err.length} |\n`;
  md += `| AMP visits | ${ampOk.length} |\n`;
  md += `| Canonical visits | ${canonicalOk.length} |\n`;
  md += `| Mobile | ${mobileOk.length} |\n`;
  md += `| Desktop | ${desktopOk.length} |\n`;
  md += `| Avg dwell time | ${avgDwell}ms |\n`;
  md += `| CrUX-eligible pages | ${eligibleOk.length}/${ok.length} |\n`;

  md += `\n### Core Web Vitals (averages)\n\n`;
  md += `| Metric | Value | Rating | Threshold |\n|--------|-------|--------|----------|\n`;
  md += `| LCP | ${avgLcp ?? 'N/A'}ms | ${rateLcp} | ≤2500ms |\n`;
  md += `| CLS | ${avgCls ?? 'N/A'} | ${rateCls} | ≤0.1 |\n`;
  md += `| INP | ${avgInp ?? 'N/A'}ms | ${rateInp} | ≤200ms |\n`;
  md += `| All CWV good | ${allGoodCount}/${ok.length} visits | — | — |\n`;

  // Per-page CWV breakdown
  const byPageCwv = {};
  ok.forEach(r => {
    if (!byPageCwv[r.label]) byPageCwv[r.label] = { lcp: [], cls: [], inp: [], fcp: [], ttfb: [], amp: 0, canonical: 0 };
    if (r.cwv?.lcp != null) byPageCwv[r.label].lcp.push(r.cwv.lcp);
    if (r.cwv?.cls != null) byPageCwv[r.label].cls.push(r.cwv.cls);
    if (r.cwv?.inp != null) byPageCwv[r.label].inp.push(r.cwv.inp);
    if (r.cwv?.fcp != null) byPageCwv[r.label].fcp.push(r.cwv.fcp);
    if (r.cwv?.ttfb != null) byPageCwv[r.label].ttfb.push(r.cwv.ttfb);
    byPageCwv[r.label][r.isAmp ? 'amp' : 'canonical']++;
  });

  md += `\n### Per-page CWV Breakdown\n\n`;
  md += `| Page | LCP | CLS | INP | FCP | TTFB | AMP | Canonical |\n|------|-----|-----|-----|-----|------|-----|----------|\n`;
  const avgArr = (arr) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;
  Object.entries(byPageCwv).sort((a, b) => (avgArr(b[1].lcp) || 0) - (avgArr(a[1].lcp) || 0)).forEach(([label, m]) => {
    const lcp = avgArr(m.lcp);
    const cls = m.cls.length ? Math.round(m.cls.reduce((s, v) => s + v, 0) / m.cls.length * 1000) / 1000 : null;
    const inp = avgArr(m.inp);
    const fcp = avgArr(m.fcp);
    const ttfb = avgArr(m.ttfb);
    md += `| ${label} | ${lcp ?? '?'}ms | ${cls ?? '?'} | ${inp ?? '?'}ms | ${fcp ?? '?'}ms | ${ttfb ?? '?'}ms | ${m.amp} | ${m.canonical} |\n`;
  });

  // Eligibility issues
  const ineligible = ok.filter(r => !r.isEligible);
  if (ineligible.length > 0) {
    md += `\n### ⚠️ Pages Not Eligible for CrUX\n\n`;
    md += `| Page | URL | Issue |\n|------|-----|-------|\n`;
    ineligible.forEach(r => {
      const issue = r.hasNoindex ? 'noindex tag' : `HTTP ${r.httpStatus}`;
      md += `| ${r.label} | ${r.url} | ${issue} |\n`;
    });
  }

  // Errors
  if (err.length > 0) {
    md += `\n### Errors\n\n`;
    md += `| Page | Error |\n|------|-------|\n`;
    err.forEach(r => {
      md += `| ${r.label} | ${r.error?.substring(0, 80) || 'unknown'} |\n`;
    });
  }
}

writeFileSync('REPORT.md', md);
console.log(`REPORT.md — rankings: ${ranked}/${allResults.length}, clicks: ${clickVerified}/${indexChecks.length} passed, crux: ${cruxVisits.length} visits`);

// === Lighthouse CWV ===
const lighthouseFile = `${resultsDir}/lighthouse-cwv.json`;
if (existsSync(lighthouseFile)) {
  try {
    const lh = JSON.parse(readFileSync(lighthouseFile, 'utf-8'));
    if (lh.pages?.length) {
      // Append to existing report
      let lmd = `\n## Lighthouse CWV Verification\n\n`;
      lmd += `> **Source:** Lighthouse desktop preset, run via GitHub Actions.\n\n`;
      lmd += `| Page | Score | LCP | CLS | INP | FCP | TTFB |\n|------|-------|-----|-----|-----|-----|------|\n`;
      for (const p of lh.pages) {
        const score = p.score != null ? `${Math.round(p.score * 100)}%` : 'N/A';
        const lcp = p.lcp != null ? `${p.lcp}ms` : '?';
        const cls = p.cls != null ? `${p.cls}` : '?';
        const inp = p.inp != null ? `${p.inp}ms` : '?';
        const fcp = p.fcp != null ? `${p.fcp}ms` : '?';
        const ttfb = p.ttfb != null ? `${p.ttfb}ms` : '?';
        lmd += `| ${p.page} | ${score} | ${lcp} | ${cls} | ${inp} | ${fcp} | ${ttfb} |\n`;
      }
      const goodScores = lh.pages.filter(p => p.score >= 0.9).length;
      lmd += `\n**Pass rate:** ${goodScores}/${lh.pages.length} pages ≥ 90%\n`;
      appendFileSync('REPORT.md', lmd);
      console.log(`Lighthouse: ${goodScores}/${lh.pages.length} pages ≥ 90%`);
    }
  } catch (e) {
    console.warn(`Warning: could not parse lighthouse-cwv.json: ${e.message}`);
  }
}
