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
      // Try every date-ish field the feed might use before giving up
      const pubDateRaw = item.pubDate || item.published || item.updated || item.date
        || item['dc:date'] || item.pubdate || '';
      const desc = (item.description ?? item.summary ?? '').toString().replace(/<[^>]*>/g, '').trim();
      return { title, link, pubDateRaw, desc };
    })
    .filter(it => !linkFilter || it.link.includes(linkFilter))
    .map((it, i) => {
      let d = it.pubDateRaw ? new Date(it.pubDateRaw) : null;
      let isValid = d && !isNaN(d.getTime());
      // Fallback: many gov sites put month-year in the URL slug itself, e.g.
      // .../legal/circulars/jul-2026/some-title_12345.html — extract that if the
      // feed's own date field is missing or unparseable. Gives month+year precision
      // even without an exact day.
      if (!isValid) {
        const slugMatch = it.link.match(/\/([a-z]{3,4})-(\d{4})\//i);
        if (slugMatch) {
          const monthGuess = new Date(`01 ${slugMatch[1]} ${slugMatch[2]}`);
          if (!isNaN(monthGuess.getTime())) { d = monthGuess; isValid = true; }
        }
      }
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

// Social-share and pagination chrome is extremely common CMS boilerplate across many
// government sites, and worth excluding explicitly regardless of date proximity — it
// often sits directly next to a genuine date by design (post metadata blocks).
const SHARE_OR_PAGING_RE = /^(share (on|of) |tweet|pin it|next\b|previous\b|«|»|prev\b)/i;

function stripChrome($) {
  $('nav, header, footer, .nav, .navbar, .menu, .breadcrumb, .breadcrumbs, #menu, #nav, #header, #footer, .sidebar, .footer, .header').remove();
  return $;
}

const GENERIC_LINK_WORDS = new Set(['view', 'download', 'view/download', 'click here', 'open', 'pdf', 'details', 'more', 'read more', 'view pdf', 'download pdf']);

function pickTitleFromCells(cellTexts) {
  // Prefer the longest cell that isn't a date and isn't a generic link label like "View" —
  // government sites often put the real title in a plain-text column and reserve the anchor
  // for a throwaway "View"/"Download" link in a different column.
  let best = '';
  for (const t of cellTexts) {
    if (t.length < 8) continue;
    if (DATE_RE.test(t) && t.length < 20) continue; // skip pure-date cells
    if (GENERIC_LINK_WORDS.has(t.toLowerCase())) continue;
    if (t.length > best.length) best = t;
  }
  return best;
}

function scoreTable($, tbl, base, cat) {
  const trs = $(tbl).find('tr');
  if (trs.length < 2) return null;
  const candidateRows = [];
  trs.each((i, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;
    const cellTexts = tds.toArray().map(td => $(td).text().trim());
    const title = pickTitleFromCells(cellTexts);
    if (!title || NAV_WORDS.has(title.toLowerCase())) return;
    // Link: prefer an anchor within the cell that actually contains the title text;
    // fall back to the first anchor in the row otherwise.
    let link = '';
    tds.each((_, td) => {
      if (link) return;
      if ($(td).text().trim() === title) {
        const a = $(td).find('a[href]').first();
        if (a.length) link = a.attr('href') || '';
      }
    });
    if (!link) link = $(tr).find('a[href]').first().attr('href') || '';
    link = resolveLink(link, base);
    const dateText = cellTexts.find(t => DATE_RE.test(t) && t !== title) || '';
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

  // Pass 2: list items with anchors — require a real nearby date, same reasoning as Pass 3
  // below. Without this, share-widget links ("Share on Facebook") and sidebar nav items
  // (which are also <li><a>...) get scraped as if they were real documents.
  $('ul li, ol li').each((_, li) => {
    if (rows.length >= 40) return;
    const a = $(li).find('a[href]').first();
    if (!a.length) return;
    const t = a.text().trim().replace(/\s+/g, ' ');
    if (t.length < 10 || NAV_WORDS.has(t.toLowerCase()) || SHARE_OR_PAGING_RE.test(t)) return;
    const dateMatch = $(li).text().match(DATE_RE);
    if (!dateMatch) return; // no date nearby — skip rather than guess
    const d = tryParseDate(dateMatch[0]);
    rows.push({ sr: rows.length + 1, date: d || dateMatch[0], year: extractYear(d || dateMatch[0]), cat, title: t, desc: '', link: resolveLink(a.attr('href') || '', base) });
  });
  if (rows.length) return rows;

  // Pass 3: last resort — meaningful anchors, but ONLY keep ones with a real nearby date.
  // Date lookup is purely position-based (search text immediately after, then before, the
  // anchor's own position in the page) rather than via closest('div') — an earlier version
  // used closest() with a text-length cutoff to avoid matching giant wrapper divs, but that
  // heuristic breaks down on pages with only a few items, where even a "whole section"
  // wrapper is short enough to look like a single item. Position-based search doesn't have
  // this failure mode since it always respects the actual order of content on the page.
  const seen = new Set();
  const fullText = $('body').text();
  $('a[href]').each((_, a) => {
    if (rows.length >= 40) return;
    const t = $(a).text().trim().replace(/\s+/g, ' ');
    if (t.length < 10 || t.length > 300 || seen.has(t) || NAV_WORDS.has(t.toLowerCase())) return;
    if (SHARE_OR_PAGING_RE.test(t)) return;
    seen.add(t);

    let dateText = '';
    const pos = fullText.indexOf(t);
    if (pos !== -1) {
      // Prefer a date immediately AFTER the title (typical of article/card layouts where
      // metadata follows the heading) before falling back to searching BEFORE it (typical
      // of table rows where a date column precedes the title column).
      const afterTxt = fullText.substring(pos + t.length, pos + t.length + 100);
      const beforeTxt = fullText.substring(Math.max(0, pos - 100), pos);
      dateText = afterTxt.match(DATE_RE)?.[0] || beforeTxt.match(DATE_RE)?.[0] || '';
    }
    if (!dateText) return; // no date nearby — most likely nav/chrome, skip it
    const d = tryParseDate(dateText);
    rows.push({ sr: rows.length + 1, date: d || dateText, year: extractYear(d || dateText), cat, title: t, desc: '', link: resolveLink($(a).attr('href') || '', base) });
  });
  return rows;
}

/* ── Card-feed parser (e.g. PCAOB: repeating "date / heading / Read more" blocks,
   not a table and not a <ul> list — common in modern CMS-driven news feeds) ── */
function parseCardFeed(html, base, cat) {
  const $ = stripChrome(cheerio.load(html));
  const rows = [];
  $('h2, h3, h4').each((_, h) => {
    if (rows.length >= 40) return;
    const title = $(h).text().trim();
    if (title.length < 15 || NAV_WORDS.has(title.toLowerCase())) return;

    // Date usually appears as a text sibling shortly before the heading
    let dateText = '';
    let prev = $(h).prev();
    for (let hops = 0; prev.length && hops < 3 && !dateText; hops++) {
      const m = prev.text().trim().match(DATE_RE);
      if (m) dateText = m[0];
      prev = prev.prev();
    }
    if (!dateText) {
      const m = $(h).parent().text().match(DATE_RE);
      if (m) dateText = m[0];
    }
    if (!dateText) return; // no date found nearby — likely not a real feed item

    // Link usually appears as a "Read more"-style anchor shortly after the heading
    let link = '';
    let next = $(h).next();
    for (let hops = 0; next.length && hops < 3 && !link; hops++) {
      const a = next.is('a[href]') ? next : next.find('a[href]').first();
      if (a.length) link = a.attr('href') || '';
      next = next.next();
    }
    if (!link) {
      const a = $(h).parent().find('a[href]').first();
      if (a.length) link = a.attr('href') || '';
    }

    const d = tryParseDate(dateText);
    rows.push({ sr: rows.length + 1, date: d || dateText, year: extractYear(d || dateText), cat, title, desc: '', link: resolveLink(link, base) });
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

const DEBUG_DIR = path.join(__dirname, '..', 'data', 'debug');
function dumpDebugHtml(key, html) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    // Cap size so the repo doesn't bloat — first 150KB is plenty to see the real structure.
    fs.writeFileSync(path.join(DEBUG_DIR, `${key}.html`), html.slice(0, 150000));
  } catch (e) { /* non-fatal — debugging aid only */ }
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

  if (tab.htmlParse === 'headless') {
    const html = await fetchViaHeadlessBrowser(tab.src);
    const rows = parseGenericHTML(html, tab.src, cat);
    if (!rows.length) dumpDebugHtml(tab.key, html);
    return rows;
  }

  const html = await fetchWithRetry(tab.src);
  let rows;
  switch (tab.htmlParse) {
    case 'linklist':      rows = parseLinkList(html, tab.src, cat); break;
    case 'nse_next_data': rows = parseNSENextData(html, tab.src, cat); break;
    default:               rows = parseGenericHTML(html, tab.src, cat);
  }
  if (!rows.length) dumpDebugHtml(tab.key, html);
  return rows;
}

/* ── Headless browser fetch (Puppeteer) — for sites that render their content list
   via JavaScript after page load (BSE, PCAOB), where a plain HTTP fetch just sees an
   empty shell. One browser instance is reused across all headless-required tabs to
   avoid the overhead of launching Chromium repeatedly. ── */
let _browserPromise = null;
function getBrowser() {
  if (!_browserPromise) {
    const puppeteer = require('puppeteer');
    _browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return _browserPromise;
}

async function closeBrowser() {
  if (_browserPromise) {
    const browser = await _browserPromise;
    await browser.close();
    _browserPromise = null;
  }
}

async function fetchViaHeadlessBrowser(url, timeoutMs = 45000) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
    // Give client-side rendering a moment to settle after the network goes idle —
    // some sites still run a final render pass (e.g. React hydration) after their
    // last network request completes.
    await new Promise(r => setTimeout(r, 2000));
    return await page.content();
  } finally {
    await page.close();
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

  await closeBrowser();
}

main().catch(async e => { console.error(e); await closeBrowser(); process.exit(1); });
