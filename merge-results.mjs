import { readFileSync, writeFileSync, readdirSync, existsSync, appendFileSync } from 'fs';

const TARGET_DOMAIN = process.env.TARGET_DOMAIN || 'hoatuoidanangnhanhi.com';
const resultsDir = 'results';
const files = readdirSync(resultsDir).filter(f => f.startsWith('shard-') && f.endsWith('.json'));

const allResults = [];
for (const file of files) {
  allResults.push(...JSON.parse(readFileSync(`${resultsDir}/${file}`, 'utf-8')));
}
allResults.sort((a, b) => a.keyword.localeCompare(b.keyword));

const timestamp = new Date().toISOString();
const ranked = allResults.filter(r => r.position > 0).length;

// Append to history
if (!existsSync(resultsDir)) { /* noop */ }
appendFileSync(`${resultsDir}/history.jsonl`, JSON.stringify({ timestamp, results: allResults }) + '\n');

// Generate markdown report
let md = `# Ranking Report — ${TARGET_DOMAIN}\n`;
md += `**Updated:** ${timestamp}\n\n`;
md += `| # | Keyword | Rank | Top 3 Competitors |\n`;
md += `|---|---------|------|--------------------|\n`;
allResults.forEach((r, i) => {
  const rank = r.position > 0 ? `**#${r.position}**` : 'NOT FOUND';
  const comp = r.topCompetitors?.slice(0, 3).join(', ') || '-';
  md += `| ${i + 1} | ${r.keyword} | ${rank} | ${comp} |\n`;
});
md += `\n**Visibility:** ${ranked}/${allResults.length} keywords ranking (${Math.round(ranked / allResults.length * 100)}%)\n`;

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

writeFileSync('REPORT.md', md);
console.log(`REPORT.md generated — ${ranked}/${allResults.length} ranking`);
