/**
 * /church-music's numbers: what people search for about church music, on
 * Google and on YouTube (church-music-data.json, from Google Trends). One
 * source for the page's tables, its charts and /church-music.csv, so the
 * three cannot disagree.
 *
 * Combined is the geometric mean of the two platforms, so a search that lives
 * on one of them is neither hidden nor inflated; a value under 0.1 counts as
 * 0.1. The charts are on a log scale, 1 to 1000 with the anchor at 100, a dot
 * for each platform joined by a line: a long line is a search that lives on
 * one platform.
 */

const DATA = require('./church-music-data.json');

const FLOOR = 0.1;
const combined = (g, y) => Math.sqrt(Math.max(g, FLOOR) * Math.max(y, FLOOR));
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// As the meditation research shows them: whole numbers from 10, one decimal
// below, and "<0.1" for what Trends cannot tell from nothing.
const shown = v => (v < 0.1 ? '&lt;0.1' : v >= 10 ? String(Math.round(v)) : v.toFixed(1));
const change = c => (c === null || c === undefined ? '' : `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)}%`);

function ranked(set) {
  return set.terms
    .map(t => ({ ...t, combined: combined(t.google, t.youtube) }))
    .sort((a, b) => b.combined - a.combined);
}

// A table of one comparison, its anchor in bold. withChange adds the
// five-year column; terms too small to measure leave it empty.
function renderTable(set, { caption, withChange = false, ids = {} } = {}) {
  const rows = ranked(set).map(t => {
    const name = t.term === set.anchor ? `<strong>${escape(t.term)}</strong>` : escape(t.term);
    const linked = ids[t.term] ? `<a href="#${ids[t.term]}">${name}</a>` : name;
    const c = t.change5y || {};
    return `<tr><th scope="row">${linked}</th><td>${shown(t.google)}</td><td>${shown(t.youtube)}</td><td>${shown(t.combined)}</td>`
      + (withChange ? `<td>${change(c.google)}</td><td>${change(c.youtube)}</td>` : '') + '</tr>';
  }).join('\n');
  const head = `<tr><th scope="col">Search</th><th scope="col">Google</th><th scope="col">YouTube</th><th scope="col">Combined</th>`
    + (withChange ? '<th scope="col">5 years, Google</th><th scope="col">5 years, YouTube</th>' : '') + '</tr>';
  return `<div class="data-table-wrap"><table class="data-table">${caption ? `<caption>${escape(caption)}</caption>` : ''}\n<thead>${head}</thead>\n<tbody>\n${rows}\n</tbody></table></div>`;
}

// The dot chart: each search a row, Google and YouTube a dot each on a log
// scale from 1 to 1000, joined by a line. Values under 1 sit at the left edge.
function renderChart(set, { label }) {
  const rows = ranked(set);
  const left = 180;
  const width = 660;
  const plot = width - left - 16;
  const rowH = 22;
  const top = 26;
  const height = top + rows.length * rowH + 30;
  const x = v => left + (Math.log10(Math.min(Math.max(v, 1), 1000)) / 3) * plot;
  const ticks = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  const grid = ticks.map(t => `<line class="dot-chart-grid" x1="${x(t).toFixed(1)}" y1="${top - 6}" x2="${x(t).toFixed(1)}" y2="${height - 24}"/>`
    + `<text class="dot-chart-tick" x="${x(t).toFixed(1)}" y="${height - 8}" text-anchor="middle">${t}</text>`).join('');
  const anchorLine = `<line class="dot-chart-anchor" x1="${x(100).toFixed(1)}" y1="${top - 6}" x2="${x(100).toFixed(1)}" y2="${height - 24}"/>`;
  const marks = rows.map((r, i) => {
    const y = top + i * rowH + rowH / 2;
    const g = x(r.google);
    const yt = x(r.youtube);
    return `<text class="dot-chart-label" x="${left - 10}" y="${y + 4}" text-anchor="end">${escape(r.term)}</text>`
      + `<line class="dot-chart-span" x1="${Math.min(g, yt).toFixed(1)}" y1="${y}" x2="${Math.max(g, yt).toFixed(1)}" y2="${y}"/>`
      + `<circle class="dot-chart-google" cx="${g.toFixed(1)}" cy="${y}" r="5"/>`
      + `<circle class="dot-chart-youtube" cx="${yt.toFixed(1)}" cy="${y}" r="5"/>`;
  }).join('');
  const legend = `<g class="dot-chart-legend"><circle class="dot-chart-google" cx="${left}" cy="10" r="5"/><text x="${left + 10}" y="14">Google</text>`
    + `<circle class="dot-chart-youtube" cx="${left + 80}" cy="10" r="5"/><text x="${left + 90}" y="14">YouTube</text></g>`;
  return `<figure class="dot-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(label)}">${legend}${grid}${anchorLine}${marks}</svg>`
    + `<figcaption>${escape(label)}. The table holds the same numbers.</figcaption></figure>`;
}

// One table of the countries: each term against "church music" in each place.
function renderCountries() {
  const { places, terms, anchor } = DATA.countries;
  const head = `<tr><th scope="col">Search</th>${places.map(p => `<th scope="col">${escape(p.name)}</th>`).join('')}</tr>`;
  const rows = terms.map(t => `<tr><th scope="row">${escape(t.term)}</th>${places.map(p => {
    const v = t.values[p.code];
    return `<td>${shown(combined(v.google, v.youtube))}</td>`;
  }).join('')}</tr>`).join('\n');
  return `<div class="data-table-wrap"><table class="data-table"><caption>Combined, against "${escape(anchor)}" = 100 in each country</caption>\n<thead>${head}</thead>\n<tbody>\n${rows}\n</tbody></table></div>`;
}

// /church-music.csv: every number on the page, one row per term, platform and
// place, so it can be checked and reused (CC BY 4.0, as the site is).
function csv() {
  const lines = ['set,term,anchor,place,window,google,youtube,combined,change_5y_google,change_5y_youtube'];
  const cell = v => (v === null || v === undefined ? '' : String(v));
  const q = s => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  for (const [name, set] of [['forms', DATA.forms], ['styles', DATA.styles]]) {
    for (const t of set.terms) {
      const c = t.change5y || {};
      lines.push([name, q(t.term), q(set.anchor), 'worldwide', '12 months', t.google, t.youtube, combined(t.google, t.youtube).toFixed(2), cell(c.google), cell(c.youtube)].join(','));
    }
  }
  for (const t of DATA.countries.terms) {
    for (const p of DATA.countries.places) {
      const v = t.values[p.code];
      lines.push(['countries', q(t.term), q(DATA.countries.anchor), p.code, '12 months', v.google, v.youtube, combined(v.google, v.youtube).toFixed(2), '', ''].join(','));
    }
  }
  return lines.join('\n') + '\n';
}

module.exports = { DATA, combined, ranked, renderTable, renderChart, renderCountries, csv };
