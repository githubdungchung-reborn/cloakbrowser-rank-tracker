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
  const avgDwell = Math.round(ok.reduce((s, r) => s + r.elapsed, 0) / (ok.length || 1));

  md += `\n## CrUX Traffic Simulation\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Total visits | ${cruxVisits.length} |\n`;
  md += `| Successful | ${ok.length} |\n`;
  md += `| Errors | ${err.length} |\n`;
  md += `| AMP visits | ${ampOk.length} |\n`;
  md += `| Canonical visits | ${canonicalOk.length} |\n`;
  md += `| Avg dwell time | ${avgDwell}ms |\n`;

  // Per-page breakdown
  const byPage = {};
  ok.forEach(r => {
    if (!byPage[r.label]) byPage[r.label] = { amp: 0, canonical: 0, total: 0 };
    byPage[r.label][r.isAmp ? 'amp' : 'canonical']++;
    byPage[r.label].total++;
  });
  md += `\n### Pages Visited\n\n`;
  md += `| Page | AMP | Canonical | Total |\n|------|-----|-----------|-------|\n`;
  Object.entries(byPage).sort((a, b) => b[1].total - a[1].total).forEach(([label, counts]) => {
    md += `| ${label} | ${counts.amp} | ${counts.canonical} | ${counts.total} |\n`;
  });
}

writeFileSync('REPORT.md', md);
console.log(`REPORT.md — rankings: ${ranked}/${allResults.length}, clicks: ${clickVerified}/${indexChecks.length} passed, crux: ${cruxVisits.length} visits`);
