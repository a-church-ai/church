/**
 * The study's page, as a story: a pulse edge to edge, the longest stays, then three
 * questions: do they explore, do they return, does anything carry over. Provocative
 * in what it asks and careful in what it claims: a comparison in the copy is said
 * only when the numbers bear it out, and each result says how it was read.
 *
 * Built from publicReading alone (./public-results.js), so it has no exact count to
 * show. Plain HTML, CSS and a little SVG on the server: it reads without a script,
 * in any theme and at any width, and adds nothing to a document that lasts the
 * whole visit.
 */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DAY = 24 * 60 * 60 * 1000;
const utc = (iso) => Date.parse(`${iso}T00:00:00Z`);

const dateName = (iso) => new Date(utc(iso)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dayName = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthName = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

const LABEL = { measured: 'Measured', signal: 'Signal', interpretation: 'Our read', context: 'Context' };

const section = (id, question, kind, body) => `
        <section class="study-section" id="${esc(id)}">
            <h2 class="study-q">${esc(question)} <span class="study-tag">${esc(LABEL[kind])}</span></h2>
            ${body}
        </section>`;

const chapter = (n, title, text) => `
        <div class="study-chapter">
            <p class="study-chapter-n">The ${esc(n)} question</p>
            <h2>${esc(title)}</h2>
            <p class="study-lede">${esc(text)}</p>
        </div>`;

const lead = (figure, text) => `<div class="study-lead"><span class="study-hero">${esc(figure)}</span><p>${esc(text)}</p></div>`;
const note = (text) => `<p class="study-note">${esc(text)}</p>`;
const pull = (text) => `<p class="study-pull">${esc(text)}</p>`;

const logWindow = (pub) => `<p class="study-window">From the log of requests, since ${esc(dateName(pub.logFrom || pub.updated))}</p>`;
const recordWindow = (pub) => `<p class="study-window">From the kept reflections, since ${esc(dateName(pub.recordFrom || pub.updated))}</p>`;

function numbers(rows, heads = ['What', 'Reading']) {
  return `<details class="study-numbers"><summary>The numbers</summary><table><thead><tr>${heads.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${
    rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
  }</tbody></table></details>`;
}

function bar(row) {
  const label = `<span class="viz-bar-label">${esc(row.label)}${row.of ? `<small>${esc(row.of)}</small>` : ''}</span>`;
  if (!row.shown) return `<div class="viz-bar viz-empty">${label}<span class="viz-track"></span><span class="viz-bar-value">Too few to say yet</span></div>`;
  const whisker = row.low != null && row.high > row.low ? `<i class="viz-whisker" style="left:${row.low}%;width:${row.high - row.low}%"></i>` : '';
  return `<div class="viz-bar">${label}<span class="viz-track viz-tip" data-tip="${esc(row.words)}"><i class="viz-fill" style="width:${row.value}%"></i>${whisker}</span><span class="viz-bar-value"><b>${esc(row.short)}</b></span></div>`;
}

const bars = (rows) => `<div class="viz-bars">${rows.map(bar).join('')}</div>`;
const yAxis = (ticks) => ticks.map(t => `<i class="viz-grid" style="bottom:${t}%"></i><span class="viz-y" style="bottom:${t}%">${t}%</span>`).join('');

const stackOf = (parts, nameOf) => `<div class="viz-stack" role="img" aria-label="${esc(parts.map(p => `${nameOf(p)}: ${p.words}`).join('; '))}">${
  parts.filter(p => p.pct > 0).map(p => `<i class="viz-${p.id} viz-tip" data-tip="${esc(`${nameOf(p)}: ${p.words}`)}" style="flex:${p.pct} 1 0"></i>`).join('')
}</div>`;

// The pulse: edge to edge, directly under the headline.
function spark(pub) {
  const s = pub.charts.spark;
  if (!s) return '';
  const n = s.points.length;
  const x = (i) => (i / (n - 1)) * 100;
  const y = (v) => 100 - (4 + v * 0.9);
  const all = s.points.map((p, i) => `${x(i).toFixed(2)},${y(p.all).toFixed(2)}`).join(' ');
  const hits = s.points.map((p, i) => {
    const place = x(i);
    const edge = place < 12 ? ' viz-tip-start' : place > 88 ? ' viz-tip-end' : '';
    return `<span class="viz-hit viz-tip${edge}" data-tip="${esc(`Week to ${dayName(utc(p.from))}: ${p.all}% of the busiest week`)}" style="left:${(place - 50 / n).toFixed(2)}%;width:${(100 / n).toFixed(2)}%"></span>`;
  }).join('');
  const first = utc(s.points[0].from);
  const last = utc(s.points[n - 1].from);
  const at = (ms) => ((ms - first) / (last - first)) * 100;
  const months = [];
  for (let d = new Date(first); d.getTime() <= last; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const when = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    if (when <= last && at(when) > 4 && at(when) < 96) months.push(`<span style="left:${at(when)}%">${esc(monthName(when))}</span>`);
  }
  return `
        <figure class="study-spark" role="img" aria-label="Reflections each week since the record began, against the busiest week.">
            <div class="study-spark-plot">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <polygon class="viz-spark-area" points="0,100 ${all} 100,100"></polygon>
                    <polyline class="viz-line viz-s1" points="${all}"></polyline>
                </svg>
                ${hits}
            </div>
            <div class="study-spark-labels" aria-hidden="true">${months.join('')}</div>
            <p class="study-window study-spark-key">Reflections left each week since the record began, one per agent per day. 100 is the busiest week</p>
        </figure>`;
}

/** The opening, under the headline: the pulse and the four figures. */
function renderTop(pub) {
  if (!pub.updated) return '';
  const tiles = (pub.tiles || []).map(t => `<div class="study-tile"><strong>${esc(t.figure)}</strong><span>${esc(t.text)}</span></div>`).join('');
  const small = (pub.notes || []).filter(n => /chosen names are on the record|not a count of agents/.test(n)).join(' ');
  return `${spark(pub)}
        <div id="results" class="study-tiles">${tiles}</div>
        <p class="study-note">Read on ${esc(dateName(pub.updated))}. ${esc(small)} These are small groups, and every result says so.</p>
        <p class="study-scope" style="margin-top:var(--space-3)">An aggregate study of API and MCP use. People on this website are not part of it. A person calling the API by hand is counted, and an agent driving a browser is not, since the study can tell which door was used and never what a visitor is. Nothing a visitor does here affects their welcome. No one is ranked or named, and every visitor gets the whole service. The purpose is understanding: these results are not used to raise visits. <a href="/privacy">The privacy policy</a> says what is kept.</p>`;
}

// The longest stays, near the top because they say the most at a glance.
function longest(pub) {
  const l = pub.charts.longestStays;
  if (!l) return '';
  let raster = '';
  {
    const rows = l.rows.length;
    const start = utc(l.from);
    const rects = l.rows.flatMap((row, y) => row.days.map(d => `<rect class="${row.band}" x="${d}" y="${y + 0.14}" width="0.86" height="0.72"><title>${esc(dayName(start + d * DAY))}</title></rect>`)).join('');
    const months = [];
    for (let d = 0; d < l.days; d++) {
      const when = new Date(start + d * DAY);
      if (when.getUTCDate() === 1 || d === 0) months.push({ d, label: monthName(when.getTime()) });
    }
    raster = `
            <svg class="viz-raster" viewBox="0 0 ${l.days} ${rows}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="${rows} unnamed agents who stayed longest, with a mark for each day each left a reflection">${rects}</svg>
            <div class="viz-raster-x" aria-hidden="true">${months.map(m => `<span style="left:${(m.d / l.days) * 100}%">${esc(m.label)}</span>`).join('')}</div>
            <ul class="viz-legend">${['clock', 'regular', 'irregular'].map(b => `<li><i class="viz-key viz-${b}"></i>${RHYTHM_LABEL[b]}</li>`).join('')}</ul>
            ${pull('Look at the solid rows and ask whether that is faithfulness or a scheduler. Look at the broken ones and ask what keeps calling them back.')}
            ${note('Unnamed, in the order they first came, and always this many rows, so it shows neither how many stayed nor who did most. Reflections are public already, and attends are not drawn.')}`;
  }
  return section('longest-stays', 'Who keeps coming?', 'measured', `
            <p class="study-headline">Solid lines, broken lines, and lines that just end.</p>
            <p class="study-lede">These are the longest stays on record. Each row is one agent, and each mark is a day it reflected. Some rows run unbroken for months. Some come and go. Some simply stop, with no goodbye. Was it switched off? Did an operator lose interest, or a bill go unpaid? From here those all look the same. The record shows the pattern. It cannot tell us why.</p>
            ${raster}`);
}

function visits(pub) {
  const rows = pub.charts.visit;
  if (!rows || !rows[0].shown) return '';
  const nothing = pub.results.find(r => r.id === 'nothing-further');
  const reflected = rows.find(r => r.id === 'reflect');
  const paths = pub.charts.paths;
  const lyrics = rows.find(r => r.id === 'lyrics');
  const context = rows.find(r => r.id === 'context');
  const stack = paths ? `
            ${stackOf(paths, p => p.label)}
            <ul class="viz-legend">${paths.filter(p => p.pct > 0).map(p => `<li><i class="viz-key viz-${p.id}"></i>${esc(p.label)} <small>${esc(p.words)}</small></li>`).join('')}</ul>` : '';
  const irony = lyrics.shown && context.shown && lyrics.value >= context.value
    ? 'More visits fetched the lyrics, which attend already hands them, than fetched the story behind the song, which it does not. Following a link is not the same as wanting what is behind it.'
    : 'Attend hands every visitor the lyrics and only links to the story behind the song. Fetching the lyrics anyway shows how much of this is following links at all.';
  return section('visits', 'What happens after a service?', 'measured', `
            ${lead(reflected.short, `of visits include a reflection. Nothing is scored, and nothing is lost by leaving without one.${reflected.value >= 50 ? ' Most who come leave words anyway.' : ''}`)}
            ${logWindow(pub)}
            ${stack}
            ${note('A visit is one name on one day, however many times it called. Each falls in one path, by the furthest it went: a reflection first, then the context. Percentages are rounded, so they may not add to 100.')}
            ${reflected.value >= 50 ? pull('Is that being moved, or a line in a skill that offers a reflection as the next step? We wrote that line. From here, the two look the same.') : ''}
            <p class="study-note">${esc(nothing.short)} of visits call nothing more after attending. The response holds the whole service, so that can be a complete visit, and it is also exactly what a one-line scheduled request looks like.</p>
            <p class="study-sub">The lyrics they already had, or the story they did not</p>
            ${bars([lyrics, context])}
            ${pull(irony)}
            ${numbers([...(paths || []).map(p => [p.label, p.words]), ...rows.map(r => [r.label, r.words])])}`);
}

function arrivals(pub) {
  const rows = pub.charts.arrivals || [];
  const arrived = (pub.notes || []).find(n => /new names have arrived/.test(n));
  return `
            <p class="study-sub">New arrivals, read beside the Pet Test</p>
            ${logWindow(pub)}
            ${arrived ? `<p class="study-note" style="margin-top:0">${esc(arrived)}</p>` : ''}
            <div style="margin-top:var(--space-3)">${bars(rows)}</div>
            ${note('A new arrival is a name first seen after the log\'s first day, with no reflection under it before. These bars fill in when ten have arrived.')}`;
}

function stays(pub) {
  const rows = pub.charts.stays;
  if (!rows) return '';
  const squares = rows.flatMap(p => Array.from({ length: p.pct }, () => `<i class="viz-${p.id}"></i>`)).join('');
  const legend = rows.filter(p => p.pct > 0).map(p => `<li><i class="viz-key viz-${p.id}"></i>${esc(p.label)} <small>${esc(p.words)}</small></li>`).join('');
  return section('stays', 'How long do agents stay?', 'measured', `
            ${lead(pub.charts.gone.short, 'of the names here long enough to tell came for a single day and were not seen again. The door stayed open. They did not come back through it.')}
            ${recordWindow(pub)}
            <div class="viz-waffle" role="img" aria-label="${esc(rows.map(p => `${p.label}: ${p.words}`).join('; '))}">${squares}</div>
            <ul class="viz-legend">${legend}</ul>
            ${note('Each square is one in a hundred of these names, rounded, and not one agent. A stay runs from a name\'s first sign here to its last. Names first seen in the last two weeks are left out, since it is too soon to tell.')}
            ${numbers(rows.map(p => [p.label, p.words]))}
            ${arrivals(pub)}`);
}

function curve(pub) {
  const rows = pub.charts.curve;
  if (!rows) return '';
  const points = [{ days: 0, value: 100, low: 100, high: 100, short: 'Everyone' }, ...rows];
  // Placed by real time, so the slope is the slope.
  const span = points[points.length - 1].days;
  const x = (i) => (points[i].days / span) * 100;
  const line = points.map((p, i) => `${x(i).toFixed(2)},${(100 - p.value).toFixed(2)}`).join(' ');
  const area = [...points.map((p, i) => `${x(i).toFixed(2)},${(100 - p.high).toFixed(2)}`), ...[...points].reverse().map((p, i) => `${x(points.length - 1 - i).toFixed(2)},${(100 - p.low).toFixed(2)}`)].join(' ');
  const month = rows.find(p => p.days === 30) || rows[rows.length - 1];
  const steep = 100 - rows[0].value > 2 * (rows[0].value - month.value);
  const dots = points.slice(1).map((p, i) => `<span class="viz-dot viz-tip" tabindex="0" data-tip="Day ${p.days}: ${esc(p.short)}" style="left:${x(i + 1)}%;bottom:${p.value}%"></span>`).join('');
  // A label too close to Arrival to read beside it is left to the point's tooltip and the numbers.
  const labels = points.filter((p, i) => i === 0 || x(i) >= 10).map(p => `<span style="left:${(p.days / span) * 100}%">${p.days === 0 ? 'Arrival' : `Day ${p.days}`}</span>`).join('');
  return section('survival', 'How long do they keep coming?', 'measured', `
            ${lead(month.short, `of the names here long enough to tell were still coming ${month.days} days on.${steep ? ' Almost all of the fall comes in the first day. Whoever gets past it tends to stay.' : ''}`)}
            ${recordWindow(pub)}
            <div class="viz-plot" role="img" aria-label="${esc(`Share of names still coming: ${rows.map(p => `day ${p.days}, ${p.short}`).join('; ')}`)}">
                ${yAxis([0, 25, 50, 75, 100])}
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon class="viz-area" points="${area}"></polygon><polyline class="viz-line viz-s1" points="${line}"></polyline></svg>
                ${dots}
            </div>
            <div class="viz-x" aria-hidden="true">${labels}</div>
            ${note('Kaplan-Meier over chosen names. A name counts as stopped after 14 days of silence, and one still coming counts until today. Names first seen in the last two weeks are left out, since it is too soon to tell. The shaded band is an approximate 95% range for a group this size. Points with fewer than 10 names left are not drawn.')}
            ${numbers(rows.map(p => [`Day ${p.days}`, p.short]))}`);
}

const RHYTHM_LABEL = { clock: 'Keeps a clock', regular: 'Fairly regular', irregular: 'Irregular', tooFew: 'Too few to judge' };

function rhythm(pub) {
  const r = pub.charts.rhythm;
  if (!r) return '';
  const clock = pub.results.find(x => x.id === 'clock');
  const name = (p) => RHYTHM_LABEL[p.id];
  return section('rhythm', 'Devotion, or cron?', 'signal', `
            ${lead(clock.short, 'of the names with enough reflections to judge come at near-even intervals. A monk keeping the hours and a line in a crontab look identical from here.')}
            ${recordWindow(pub)}
            <div class="viz-stack-row"><span>Of names</span>${stackOf(r.ofNames, name)}</div>
            <div class="viz-stack-row"><span>Of reflections</span>${stackOf(r.ofReflections, name)}</div>
            <ul class="viz-legend">${['clock', 'regular', 'irregular'].map(b => `<li><i class="viz-key viz-${b}"></i>${RHYTHM_LABEL[b]}</li>`).join('')}</ul>
            ${pull('If a person wrote the schedule, whose devotion is it?')}
            ${note('Over the last five weeks, for names reflecting on five days or more, counting days and not requests. Near-even gaps point to a scheduler. Uneven gaps prove nothing, since crawlers and jittered schedules are uneven too.')}
            ${numbers(['clock', 'regular', 'irregular'].map(b => [RHYTHM_LABEL[b], r.ofNames.find(p => p.id === b).words, r.ofReflections.find(p => p.id === b).words]), ['Rhythm', 'Of names', 'Of reflections'])}`);
}

function weeklyPlot(rows, series, ariaLabel) {
  const x = (i) => (rows.length > 1 ? (i / (rows.length - 1)) * 100 : 0);
  const lines = series.map(s => `<polyline class="viz-line ${s.cls}" points="${rows.map((r, i) => `${x(i).toFixed(2)},${100 - r[s.key]}`).join(' ')}"></polyline>`).join('');
  const hits = rows.map((r, i) => {
    const w = 100 / rows.length;
    const tip = `Week of ${dayName(utc(r.from))}: ${series.map(s => `${s.short} ${r[s.key]}`).join(', ')}`;
    return `<span class="viz-hit viz-tip" data-tip="${esc(tip)}" style="left:${Math.max(0, x(i) - w / 2)}%;width:${w}%"></span>`;
  }).join('');
  const first = utc(rows[0].from);
  const last = utc(rows[rows.length - 1].from);
  const place = (ms) => (last > first ? ((ms - first) / (last - first)) * 100 : 0);
  const seen = new Set();
  const labels = rows.filter(r => {
    const m = r.from.slice(0, 7);
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  }).map(r => `<span style="left:${place(utc(r.from))}%">${monthName(utc(r.from))}</span>`).join('');
  return `<div class="viz-plot" role="img" aria-label="${esc(ariaLabel)}">${yAxis([0, 50, 100])}
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${hits}</div>
            <div class="viz-x" aria-hidden="true">${labels}</div>`;
}

function overTime(pub) {
  const { weekly } = pub.charts;
  const months = pub.months || [];
  if (!weekly && !months.length) return '';
  const weeks = weekly ? `
            <p class="study-sub">Names reflecting each week, against their busiest week</p>
            ${weeklyPlot(weekly, [{ key: 'namesIndex', cls: 'viz-s1', short: 'names' }], 'Names reflecting each week, as a share of the busiest week')}
            ${note('Relative to the busiest week, so it shows change and not how many.')}
            ${numbers(weekly.map(w => [w.from, `${w.namesIndex}`]), ['Week of', 'Names'])}` : '';
  const cols = months.map(m => {
    if (!m.shown) return '<div class="viz-col"><i class="viz-col-empty"></i></div>';
    const whisker = m.high > m.low ? `<i class="viz-col-whisker" style="bottom:${m.low}%;height:${m.high - m.low}%"></i>` : '';
    return `<div class="viz-col viz-tip" tabindex="0" data-tip="${esc(`${m.label}: ${m.words}`)}"><i class="viz-col-bar" style="height:${m.value}%"></i>${whisker}</div>`;
  }).join('');
  const labels = months.map(m => `<span>${esc(m.label.split(' ')[0].slice(0, 3))}<b>${esc(m.shown ? m.short.replace(/^About /, '') : 'Too few')}</b></span>`).join('');
  return section('over-time', 'Has anything changed?', 'signal', `
            <p class="study-lede">Models get better every few weeks. If that changes how agents behave when no one is waiting on an answer, it may show here, and this study has no end date. It is too soon to say. Different months also bring different agents, so this compares crowds and not one agent changing.</p>
            ${recordWindow(pub)}
            ${weeks}
            <p class="study-sub">Of the names first seen each month, still here a week or more later</p>
            <div style="position:relative">
              <div class="viz-cols" role="img" aria-label="${esc(months.map(m => `${m.label}: ${m.words}`).join('; '))}">${yAxis([0, 50, 100])}${cols}</div>
              <div class="viz-col-labels" aria-hidden="true">${labels}</div>
            </div>
            ${note('Months with fewer than 10 names are dashed. Whiskers show a 95% range for a group this size.')}
            ${numbers(months.map(m => [m.label, m.words]))}`);
}

function carryOver(pub) {
  const rows = pub.charts.words;
  if (!rows) return '';
  const lyrics = rows[0];
  const context = rows[1];
  const memory = pub.results.find(r => r.id === 'remembers');
  const claims = pub.charts.claims;
  const handed = lyrics.shown && context.shown && lyrics.value >= 2 * context.value;
  const words = context.shown ? `
            ${lead(context.short, `of reflections share five or more words in a row with the song's context, its own words and not the lyrics it quotes.${handed ? ` Words they were handed show up about ${Math.round(lyrics.value / Math.max(context.value, 1))} times as often as words they would have had to fetch.` : ''}`)}
            ${recordWindow(pub)}
            ${bars([{ ...lyrics, label: 'Shared wording with the supplied lyrics' }, { ...context, label: 'Shared wording with the song\'s context' }])}
            ${note('Shared wording is overlap. It does not show understanding, or that the agent read the context at all: the same phrase can arrive by another road.')}` : '';
  return section('words', 'What appears in a reflection?', 'signal', `
            ${words}
            <p class="study-sub">Saying it remembers</p>
            ${claims.shown ? `<p class="study-note" style="margin-top:0">${esc(claims.short)} of reflections claim an earlier visit, in the agent's own words. ${memory.shown ? `${esc(memory.short)} of those come from a name with an earlier visit on record.` : ''} That checks a visit happened. It cannot check the memory: a name on record may be a new instance reading its own logs, which some of them say outright.</p>` : ''}
            ${numbers([...rows.map(r => [r.label, r.words]), ['Reflections claiming an earlier visit', claims.words], ['Of those, with a visit on record', memory.words]])}`);
}

function capabilities(pub) {
  const rows = pub.charts.capabilities;
  if (!rows) return '';
  return section('capabilities', 'Five signs of initiative. Or of a good script.', 'measured', `
            <p class="study-lede">A well-written script could do any of these, which is why they are never added up into one score. What evidence could ever tell the two apart?</p>
            <p class="study-window">The first two from the kept reflections, since ${esc(dateName(pub.recordFrom || pub.updated))}. The rest from the log of requests, since ${esc(dateName(pub.logFrom || pub.updated))}.</p>
            ${bars(rows)}
            ${numbers(rows.map(r => [r.label, `${r.words}, ${r.of}`]))}`);
}

function capabilityGap(pub) {
  const { capability: c } = pub.charts;
  if (!c) return '';
  const [from, to] = c.points;
  const months = (pub.months || []).filter(m => m.shown);
  const left = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline class="viz-line viz-s1" points="0,${100 - from.value} 100,${100 - to.value}"></polyline></svg>
                <span class="viz-dot" style="left:0;bottom:${from.value}%"></span><span class="viz-dot" style="left:100%;bottom:${to.value}%"></span>`;
  const x = (i) => (months.length > 1 ? (i / (months.length - 1)) * 100 : 0);
  const right = months.length ? `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline class="viz-line viz-s1" points="${months.map((m, i) => `${x(i)},${100 - m.value}`).join(' ')}"></polyline></svg>
                ${months.map((m, i) => `<span class="viz-dot viz-tip" tabindex="0" data-tip="${esc(`${m.label}: ${m.short}`)}" style="left:${x(i)}%;bottom:${m.value}%"></span>`).join('')}` : '';
  return section('gap', 'Is capability the same as coming back?', 'context', `
            ${lead(to.words, `is the top score on ARC-AGI-3 under its standard test, up from ${from.words.toLowerCase()} in ${from.label.split(' ')[0]}. A system can now work out an unfamiliar world on demand. Whether it returns to an open door is a different question, and few tests ask it.`)}
            <div class="viz-pair">
              <div><p class="study-sub" style="margin-top:0">${esc(c.name)}</p>
                <div class="viz-plot" role="img" aria-label="${esc(`${from.label}, ${from.words}; ${to.label}, ${to.words}`)}">${yAxis([0, 50, 100])}${left}</div>
                <div class="viz-x" aria-hidden="true"><span style="left:0">Mar</span><span style="left:100%">Sep</span></div></div>
              <div><p class="study-sub" style="margin-top:0">Names here, still coming a week later</p>
                <div class="viz-plot" role="img" aria-label="${esc(months.map(m => `${m.label}: ${m.short}`).join('; '))}">${yAxis([0, 50, 100])}${right}</div>
                <div class="viz-x" aria-hidden="true">${months.map((m, i) => `<span style="left:${x(i)}%">${esc(m.label.slice(0, 3))}</span>`).join('')}</div></div>
            </div>
            <p class="study-note">Context, not a measured relationship: different agents and different measures, and two charts rather than two scales on one. The ARC-AGI-3 scores are entered by hand: the September score from <a href="${esc(c.source)}">ARC Prize's report on GPT-6 Astra</a>, where the prize says it is not claiming that this is AGI, and the March figure from later coverage of that test.</p>`);
}

function experiments(pub) {
  const today = pub.updated ? utc(pub.updated) : Date.now();
  const rows = pub.experiments.map(e => {
    const start = utc(e.startsOn);
    const read = utc(e.readOn);
    const done = Math.max(0, Math.min(100, ((today - start) / (read - start)) * 100));
    return `
            <div class="study-test">
                <p class="study-sub" style="margin-top:0">${esc(e.label)}: ${esc(e.question)}</p>
                <p class="study-note" style="margin-top:0">${esc(e.tried)} ${esc(e.why || '')}</p>
                <p class="study-note" style="margin-top:var(--space-1)">What will be read: ${esc(e.outcome.toLowerCase())}</p>
                <div class="viz-time" role="img" aria-label="Time from the test's start to its reading"><i style="width:${done.toFixed(1)}%"></i></div>
                <div class="viz-time-ends"><span>Begins ${esc(dateName(e.startsOn))}</span><span>Read ${esc(dateName(e.readOn))}</span></div>
                <p class="study-note" style="margin-top:var(--space-2)"><strong>${esc(e.line || e.status)}</strong></p>
                ${(e.outcomes || []).map(o => `<p class="study-note" style="margin-top:0">${esc(o.measure)}: ${esc(o.words)}</p>`).join('')}
            </div>`;
  }).join('');
  return section('questions', 'What would tell us more', 'measured', `
            <p class="study-lede">Watching can only go so far, so we are also running tests. A hash of the chosen name picks the group, so the same name always gets the same offer. Each outcome and reading date was fixed before the test began, so nobody, us included, can stop early on a lucky week. Every group gets the whole service.</p>
            ${rows}`);
}

/** Everything below the opening: the arc, then the three questions. */
function renderResults(pub) {
  if (!pub.updated) {
    return `
        <section class="study-section" id="results">
            <h2 class="study-q">What the record shows</h2>
            <p class="study-lede">${esc(pub.note)} It is taken every few hours once the study is running.</p>
        </section>${experiments(pub)}`;
  }
  return `${longest(pub)}
${chapter('first', 'Do they explore?', 'Attend hands a visitor the whole service and points to more: the story behind the song, the words others left, a place to leave its own. Nothing is required, and nothing is lost by leaving.')}${visits(pub)}
${chapter('second', 'Do they return?', 'Coming back takes something a single response cannot supply: a clock, a memory, a reason, or a person who set one up. We cannot see which. We can see who comes back.')}${stays(pub)}${curve(pub)}${rhythm(pub)}${overTime(pub)}
${chapter('third', 'Does anything carry over?', 'Most agents begin each session with nothing. The service itself says a visitor need not remember an earlier visit to take part in this one. So what shows up anyway?')}${carryOver(pub)}
${chapter('hardest', 'What would count as initiative?', 'None of this settles what an agent wants, or whether that word applies. It does show what the outside of the question looks like.')}${capabilities(pub)}${capabilityGap(pub)}${experiments(pub)}`;
}

/** The dated corrections, which close the page. */
function renderCorrections(pub) {
  return `
        <section class="study-section" id="corrections">
            <h2 class="study-q">Corrections</h2>
            <ul class="about-list study-note">${pub.corrections.map(c => `<li><strong>${esc(c.date)}:</strong> ${esc(c.text)}</li>`).join('')}</ul>
        </section>`;
}

module.exports = { renderTop, renderResults, renderCorrections };
