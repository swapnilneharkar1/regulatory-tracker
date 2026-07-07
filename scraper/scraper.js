/**
 * Scrapes regulator sources server-side (no browser CORS/proxy involved) and writes
 * a consolidated JSON file that the frontend simply reads. Run manually with:
 *   node scraper.js
 * or on a schedule via the GitHub Actions workflow in .github/workflows/scrape.yml
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { XMLParser } = require('fast-xml-parser');
const REGULATORS = require('./sources');

const OUT_PATH = path.join(__dirname, '..', 'data', 'regulatory_data.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const DATE_RE = /\d{1,2}[\-\/\s][A-Za-z]{3,9}[\-\/\s,]+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}[\-\/]\d{1,2}[\-\/]\d{4}|\d{4}-\d{2}-\d{2}/;

function tryParseDate(s) {
  if (!s) return '';
  s = String(s).trim();
  let d = new Date(s);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1990) {
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  const m = s.match(/^(\d{2})[\-\/\.](\d{2})[\-\/\.](\d{4})$/);
  if (m) {
    d = new Date(`${m[3]}-${m[2]}-${m[1]}`);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return '';
}
function extractYear(s) {
  if (!s) return null;
  const m = String(s).match(/\b(20\d{2}|19\d{2})\b/);
  return m ? Number(m[0]) : null;
}
function resolveLink(href, base) {
  if (!href || href.startsWith('javascript')) return '';
  try { return new URL(href, base).href; } catch { return href || ''; }
}

async function fetchText(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': new URL(url).origin + '/',
        'Cache-Control': 'no-cache',
      }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchWithRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fetchText(url); }
    catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 1500 + i * 1500)); // 1.5s, 3s, 4.5s backoff
    }
  }
  throw lastErr;
}

/* ── RSS/Atom parsing ── */
function parseRSS(xmlText, cat, linkFilter) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const xml = parser.parse(xmlText);
  let items = xml?.rss?.channel?.item || xml?.feed?.entry || [];
  if (!Array.isArray(items)) items = [items].filter(Boolean);

  return items
    .map(item => {
      const title = (item.title?.['#text'] ?? item.title ?? 'Untitled').toString().trim();
      let link = item.link;
      if (typeof link === 'object') link = link?.['@_href'] || link?.['#text'] || '';
      link = (link || '').toString().trim();
      const pubDateRaw = item.pubDate || item.published || item.updated || '';
      const desc = (item.description ?? item.summary ?? '').toString().replace(/<[^>]*>/g, '').trim();
      return { title, link, pubDateRaw, desc };
    })
    .filter(it => !linkFilter || it.link.includes(linkFilter))
    .map((it, i) => {
      const d = it.pubDateRaw ? new Date(it.pubDateRaw) : null;
      const isValid = d && !isNaN(d.getTime());
      return {
        sr: i + 1,
        date: isValid ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
        year: isValid ? d.getFullYear() : null,
        cat, title: it.title, desc: it.desc.substring(0, 200), link: it.link
      };
    });
}

/* ── Generic table/list HTML parser (works across most gov/exchange sites) ──
   Key fixes vs the naive version:
   1. Strip nav/header/footer/menu chrome FIRST — this is what was causing menu items
      ("About Us", "Option Chain", "Holidays") to be scraped as if they were documents.
   2. Score ALL tables and pick the best one (most rows with valid dates), instead of
      just taking whichever table appears first in the HTML — the first table on a page
      is often a small unrelated widget, not the actual data table.
*/
const NAV_WORDS = new Set([
  'home', 'login', 'logout', 'sitemap', 'contact', 'contact us', 'about', 'about us',
  'search', 'back', 'top', 'next', 'prev', 'previous', 'skip', 'menu', 'download',
  'subscribe', 'register', 'careers', 'tenders', 'rti', 'faqs', "faq's", 'faq',
  'press releases', 'annual report', 'organisation & functions', 'organisation and functions',
  'notifications', 'circulars', 'guidelines', 'master directions', 'master circulars',
  'draft notifications', 'publications', 'statistics', 'what\'s new', 'whats new',
  'terms of use', 'privacy policy', 'disclaimer', 'feedback', 'sitemap', 'help',
  'option chain', 'market turnover', 'listings', 'daily report', 'holidays',
  'selected', 'skip to main content', 'accessibility', 'screen reader'
]);

function stripChrome($) {
  $('nav, header, footer, .nav, .navbar, .menu, .breadcrumb, .breadcrumbs, #menu, #nav, #header, #footer, .sidebar, .footer, .header').remove();
  return $;
}

function scoreTable($, tbl, base, cat) {
  const trs = $(tbl).find('tr');
  if (trs.length < 2) return null;
  const candidateRows = [];
  trs.each((i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;
    const linkEl = $(tr).find('a[href]').first();
    const title = (linkEl.text() || $(tds[0]).text() || '').trim();
    if (!title || title.length < 8 || NAV_WORDS.has(title.toLowerCase())) return;
    const link = resolveLink(linkEl.attr('href') || '', base);
    const cellTexts = tds.toArray().map(td => $(td).text().trim());
    const dateText = cellTexts.find(t => DATE_RE.test(t)) || '';
    const d = tryParseDate(dateText);
    candidateRows.push({ sr: 0, date: d || dateText || '—', year: extractYear(d || dateText), cat, title, desc: '', link });
  });
  if (candidateRows.length < 2) return null;
  const withDate = candidateRows.filter(r => r.date !== '—').length;
  // Score favors: more rows overall, and a higher proportion having real dates
  const score = candidateRows.length + withDate * 2;
  return { rows: candidateRows, score };
}

function parseGenericHTML(html, base, cat) {
  const $ = stripChrome(cheerio.load(html));
  const rows = [];

  // Pass 1: score every table on the page, keep the best-scoring one
  let best = null;
  $('table').each((_, tbl) => {
    const result = scoreTable($, tbl, base, cat);
    if (result && (!best || result.score > best.score)) best = result;
  });
  if (best) {
    return best.rows.slice(0, 50).map((r, i) => ({ ...r, sr: i + 1 }));
  }

  // Pass 2: list items with anchors
  $('ul li, ol li').each((_, li) => {
    if (rows.length >= 40) return;
    const a = $(li).find('a[href]').first();
    if (!a.length) return;
    const t = a.text().trim();
    if (t.length < 10 || NAV_WORDS.has(t.toLowerCase())) return;
    const dateMatch = $(li).text().match(DATE_RE);
    const dateText = dateMatch?.[0] || '';
    const d = tryParseDate(dateText);
    rows.push({ sr: rows.length + 1, date: d || dateText || '—', year: extractYear(d || dateText), cat, title: t, desc: '', link: resolveLink(a.attr('href') || '', base) });
  });
  if (rows.length) return rows;

  // Pass 3: last resort — meaningful anchors, but ONLY keep ones with a real nearby date.
  // Nav/menu links almost never sit next to a date, so this alone filters out most junk
  // without needing an exhaustive nav-word blocklist.
  const seen = new Set();
  const fullText = $('body').text();
  $('a[href]').each((_, a) => {
    if (rows.length >= 40) return;
    const t = $(a).text().trim();
    if (t.length < 10 || t.length > 300 || seen.has(t) || NAV_WORDS.has(t.toLowerCase())) return;
    seen.add(t);
    let dateText = $(a).closest('td,li,tr,p,div').text().match(DATE_RE)?.[0] || '';
    if (!dateText) {
      const pos = fullText.indexOf(t);
      if (pos !== -1) {
        const windowTxt = fullText.substring(Math.max(0, pos - 60), pos + t.length + 60);
        dateText = windowTxt.match(DATE_RE)?.[0] || '';
      }
    }
    if (!dateText) return; // no date nearby — most likely nav/chrome, skip it
    const d = tryParseDate(dateText);
    rows.push({ sr: rows.length + 1, date: d || dateText, year: extractYear(d || dateText), cat, title: t, desc: '', link: resolveLink($(a).attr('href') || '', base) });
  });
  return rows;
}

/* ── Link-list parser (SEBI FAQ style — no dates by nature) ── */
function parseLinkList(html, base, cat) {
  const $ = stripChrome(cheerio.load(html));
  const rows = [];
  const seen = new Set();
  $('a[href]').each((_, a) => {
    if (rows.length >= 40) return;
    const t = $(a).text().trim();
    if (t.length < 10 || seen.has(t) || NAV_WORDS.has(t.toLowerCase())) return;
    seen.add(t);
    rows.push({ sr: rows.length + 1, date: '—', year: null, cat, title: t, desc: '', link: resolveLink($(a).attr('href') || '', base) });
  });
  return rows;
}

/* ── NSE __NEXT_DATA__ parser ── */
function parseNSENextData(html, base, cat) {
  const $ = cheerio.load(html);
  const script = $('#__NEXT_DATA__').html();
  if (script) {
    try {
      const json = JSON.parse(script);
      const props = json?.props?.pageProps;
      const list = props?.circularList || props?.data || props?.circulars || [];
      if (Array.isArray(list) && list.length) {
        return list.slice(0, 50).map((item, i) => {
          const title = item.subject || item.title || item.circularTitle || item.name || 'NSE Circular';
          const dateStr = item.date || item.circularDate || item.createdDate || '';
          const d = dateStr ? tryParseDate(dateStr) : '';
          const href = item.fileUrl || item.url || item.pdfUrl || item.link || '';
          return { sr: i + 1, date: d || dateStr || '—', year: extractYear(d || dateStr), cat, title, desc: '', link: href ? resolveLink(href, base) : '' };
        });
      }
    } catch (e) { /* fall through to generic */ }
  }
  return parseGenericHTML(html, base, cat);
}

async function scrapeTab(tab, cat) {
  if (tab.rss) {
    try {
      const xml = await fetchWithRetry(tab.rss);
      const rows = parseRSS(xml, cat, tab.linkFilter);
      if (rows.length) return rows;
      throw new Error('RSS parsed to 0 rows');
    } catch (e) {
      console.warn(`  RSS failed (${tab.rss}): ${e.message}`);
      if (!tab.src) throw e;
      // fall through to HTML parse below
    }
  }
  const html = await fetchWithRetry(tab.src);
  switch (tab.htmlParse) {
    case 'linklist':      return parseLinkList(html, tab.src, cat);
    case 'nse_next_data': return parseNSENextData(html, tab.src, cat);
    default:               return parseGenericHTML(html, tab.src, cat);
  }
}

async function main() {
  // Load previous output so a source that fails this run doesn't wipe out
  // the last good data — we keep serving stale-but-real data over nothing.
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')).data || {}; } catch (e) { /* first run, ignore */ }

  const output = {};
  for (const [regKey, reg] of Object.entries(REGULATORS)) {
    for (const tab of reg.tabs) {
      process.stdout.write(`Scraping ${tab.key} (${tab.label})... `);
      try {
        const rows = await scrapeTab(tab, tab.cat);
        output[tab.key] = { rows, ts: Date.now(), ok: true };
        console.log(`OK (${rows.length} rows)`);
      } catch (e) {
        console.log(`FAILED: ${e.message}`);
        if (previous[tab.key]) {
          output[tab.key] = { ...previous[tab.key], ok: false, error: e.message };
          console.log(`  → kept previous data (${previous[tab.key].rows.length} rows)`);
        } else {
          output[tab.key] = { rows: [], ts: Date.now(), ok: false, error: e.message };
        }
      }
      // Be polite / avoid tripping rate limits — small delay between requests
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  const final = { generatedAt: new Date().toISOString(), data: output };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(final, null, 2));
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
