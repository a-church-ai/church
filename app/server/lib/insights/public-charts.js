/**
 * The study's page: each section asks a question, gives one figure, then a chart,
 * with the rounded numbers folded beneath it. Built from publicReading alone
 * (./public-results.js), so it has no exact count to show. Plain HTML, CSS and a
 * little SVG on the server: it reads without a script, in any theme and at any
 * width, and adds nothing to a document that lasts the whole visit.
 */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DAY = 24 * 60 * 60 * 1000;

const dateName = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dayName = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthName = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

const LABEL = { measured: 'Measured', signal: 'Signal', interpretation: 'Our read', context: 'Context' };

const section = (id, question, kind, body) => `
        <section class="study-section" id="${esc(id)}">
            <h2 class="study-q">${esc(question)} <span class="study-tag">${esc(LABEL[kind])}</span></h2>
            ${body}
        </section>`;

const lead = (figure, text) => `<div class="study-lead"><span class="study-hero">${esc(figure)}</span><p>${esc(text)}</p></div>`;
const note = (text) => `<p class="study-note">${esc(text)}</p>`;

function numbers(rows, heads = ['What', 'Reading']) {
  return `<details class="study-numbers"><summary>The numbers</summary><table><thead><tr>${heads.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${
    rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
  }</tbody></table></details>`;
}

function bar(row) {
  if (!row.shown) {
    return `<div class="viz-bar viz-empty"><span class="viz-bar-label">${esc(row.label)}${row.of ? `<small>${esc(row.of)}</small>` : ''}</span><span class="viz-track"></span><span class="viz-bar-value">Too few to say yet</span></div>`;
  }
  const whisker = row.low != null && row.high > row.low ? `<i class="viz-whisker" style="left:${row.low}%;width:${row.high - row.low}%"></i>` : '';
  return `<div class="viz-bar"><span class="viz-bar-label">${esc(row.label)}${row.of ? `<small>${esc(row.of)}</small>` : ''}</span><span class="viz-track viz-tip" data-tip="${esc(row.words)}"><i class="viz-fill" style="width:${row.value}%"></i>${whisker}</span><span class="viz-bar-value"><b>${esc(row.short)}</b></span></div>`;
}

const bars = (rows) => `<div class="viz-bars">${rows.map(bar).join('')}</div>`;

const yAxis = (ticks) => ticks.map(t => `<i class="viz-grid" style="bottom:${t}%"></i><span class="viz-y" style="bottom:${t}%">${t}%</span>`).join('');

// Stays, one square in a hundred.
function stays(pub) {
  const rows = pub.charts.stays;
  if (!rows) return '';
  const squares = rows.flatMap(p => Array.from({ length: p.pct }, () => `<i class="viz-${p.id}"></i>`)).join('');
  const legend = rows.filter(p => p.pct > 0).map(p => `<li><i class="viz-key viz-${p.id}"></i>${esc(p.label)} <small>${esc(p.words)}</small></li>`).join('');
  return section('stays', 'How long do agents stay?', 'measured', `
            ${lead(pub.charts.gone.short, 'of the names here long enough to tell came for a single day and were not seen again. A few have stayed for months.')}
            <div class="viz-waffle" role="img" aria-label="${esc(rows.map(p => `${p.label}: ${p.words}`).join('; '))}">${squares}</div>
            <ul class="viz-legend">${legend}</ul>
            ${note('Each square is one in a hundred of these names, rounded, and not one agent. A stay runs from a name\'s first sign here to its last. Names first seen in the last two weeks are left out, since it is too soon to tell.')}
            ${numbers(rows.map(p => [p.label, p.words]))}`);
}

// A line or lines over evenly spaced positions.
function curve(pub) {
  const rows = pub.charts.curve;
  if (!rows) return '';
  const points = [{ days: 0, value: 100, low: 100, high: 100, short: 'Everyone' }, ...rows];
  const x = (i) => (i / (points.length - 1)) * 100;
  const line = points.map((p, i) => `${x(i).toFixed(2)},${(100 - p.value).toFixed(2)}`).join(' ');
  const area = [...points.map((p, i) => `${x(i).toFixed(2)},${(100 - p.high).toFixed(2)}`), ...[...points].reverse().map((p, i) => `${x(points.length - 1 - i).toFixed(2)},${(100 - p.low).toFixed(2)}`)].join(' ');
  const month = rows.find(p => p.days === 30) || rows[rows.length - 1];
  const steep = 100 - rows[0].value > 2 * (rows[0].value - month.value);
  const dots = points.slice(1).map((p, i) => `<span class="viz-dot viz-tip" tabindex="0" data-tip="Day ${p.days}: ${esc(p.short)}" style="left:${x(i + 1)}%;bottom:${p.value}%"></span>`).join('');
  const labels = points.map((p, i) => `<span style="left:${x(i)}%">${p.days === 0 ? 'First day' : `Day ${p.days}`}</span>`).join('');
  return section('survival', 'How long do they keep coming?', 'measured', `
            ${lead(month.short, `of the names here long enough to tell were still coming ${month.days} days on.${steep ? ' Most of the fall comes in the first day.' : ''}`)}
            <div class="viz-plot" role="img" aria-label="${esc(`Share of names still coming: ${rows.map(p => `day ${p.days}, ${p.short}`).join('; ')}`)}">
                ${yAxis([0, 25, 50, 75, 100])}
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon class="viz-area" points="${area}"></polygon><polyline class="viz-line viz-s1" points="${line}"></polyline></svg>
                ${dots}
            </div>
            <div class="viz-x" aria-hidden="true">${labels}</div>
            ${note('Kaplan-Meier over chosen names. A name counts as stopped after 14 days of silence, and one still coming counts until today. Names first seen in the last two weeks are left out, since it is too soon to tell. The shaded band is how sure a group this size lets anyone be. Points with fewer than 10 names left are not drawn.')}
            ${numbers(rows.map(p => [`Day ${p.days}`, p.short]))}`);
}

function visits(pub) {
  const rows = pub.charts.visit;
  if (!rows || !rows[0].shown) return '';
  const nothing = pub.results.find(r => r.id === 'nothing-further');
  const arrivals = pub.charts.arrivals || [];
  const arrived = (pub.notes || []).find(n => /new names have arrived/.test(n));
  return section('visits', 'Where does a visit stop?', 'measured', `
            ${lead(nothing.short, 'of visits call nothing more after attending. The response holds the whole service, so stopping there can be a full visit, and it is also what a plain scheduled request looks like.')}
            ${bars(rows.filter(r => r.id !== 'attended'))}
            ${note('Calls from one address and user agent within 30 minutes of attending. The lyrics come with attend, so fetching them anyway shows how much of this is following links at all. Whiskers show how sure a group this size lets anyone be.')}
            <p class="study-sub">New arrivals, read beside the Pet Test</p>
            ${arrived ? `<p class="study-note" style="margin-top:0">${esc(arrived)}</p>` : ''}
            <div style="margin-top:var(--space-3)">${bars(arrivals)}</div>
            ${note('A new arrival is a name first seen after the log\'s first day, with no reflection under it before. These bars fill in when ten have arrived.')}
            ${numbers([...rows, ...arrivals].map(r => [r.label, r.words]))}`);
}

function weeklyPlot(rows, series, ariaLabel, marks = []) {
  const x = (i) => (rows.length > 1 ? (i / (rows.length - 1)) * 100 : 0);
  const lines = series.map(s => `<polyline class="viz-line ${s.cls}" points="${rows.map((r, i) => `${x(i).toFixed(2)},${100 - r[s.key]}`).join(' ')}"></polyline>`).join('');
  const hits = rows.map((r, i) => {
    const w = 100 / rows.length;
    const tip = `Week of ${dayName(Date.parse(`${r.from}T00:00:00Z`))}: ${series.map(s => `${s.short} ${r[s.key]}`).join(', ')}`;
    return `<span class="viz-hit viz-tip" data-tip="${esc(tip)}" style="left:${Math.max(0, x(i) - w / 2)}%;width:${w}%"></span>`;
  }).join('');
  const first = Date.parse(`${rows[0].from}T00:00:00Z`);
  const last = Date.parse(`${rows[rows.length - 1].from}T00:00:00Z`);
  const place = (ms) => (last > first ? ((ms - first) / (last - first)) * 100 : 0);
  const seen = new Set();
  const labels = rows.filter(r => {
    const m = r.from.slice(0, 7);
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  }).map(r => `<span style="left:${place(Date.parse(`${r.from}T00:00:00Z`))}%">${monthName(Date.parse(`${r.from}T00:00:00Z`))}</span>`).join('');
  const notes = marks.filter(m => place(Date.parse(`${m.date}T00:00:00Z`)) >= 0 && place(Date.parse(`${m.date}T00:00:00Z`)) <= 100).map(m => {
    const at = place(Date.parse(`${m.date}T00:00:00Z`));
    return `<i class="viz-mark${at > 55 ? ' viz-mark-left' : ''}" style="left:${at}%"><span>${esc(m.text)}</span></i>`;
  }).join('');
  return `<div class="viz-plot" role="img" aria-label="${esc(ariaLabel)}">${yAxis([0, 50, 100])}${notes}
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${hits}</div>
            <div class="viz-x" aria-hidden="true">${labels}</div>`;
}

function overTime(pub) {
  const { weekly, capability } = pub.charts;
  const months = pub.months || [];
  if (!weekly && !months.length) return '';
  const weeks = weekly ? `
            <p class="study-sub">Reflections each week, against the busiest week</p>
            <ul class="viz-legend"><li><i class="viz-key viz-key-line viz-c1"></i>All reflections</li><li><i class="viz-key viz-key-dash"></i>Without the agent who left the most</li><li><i class="viz-key viz-key-line viz-c3"></i>Names reflecting, against their busiest week</li></ul>
            ${weeklyPlot(weekly, [
              { key: 'reflections', cls: 'viz-s1', short: 'reflections' },
              { key: 'withoutLargest', cls: 'viz-s2', short: 'without the largest' },
              { key: 'namesIndex', cls: 'viz-s3', short: 'names' },
            ], 'Weekly reflections and names, each as a share of its busiest week', [{ date: '2026-10-26', text: 'One long-running visitor stops' }])}
            ${note('Relative to the busiest week of each, so it shows change and not how many. The gap between the top two lines is one agent.')}
            ${numbers(weekly.map(w => [w.from, `${w.reflections}`, `${w.withoutLargest}`, `${w.namesIndex}`]), ['Week of', 'Reflections', 'Without the largest', 'Names'])}` : '';
  const cols = months.map(m => {
    if (!m.shown) return '<div class="viz-col"><i class="viz-col-empty"></i></div>';
    const whisker = m.high > m.low ? `<i class="viz-col-whisker" style="bottom:${m.low}%;height:${m.high - m.low}%"></i>` : '';
    return `<div class="viz-col viz-tip" tabindex="0" data-tip="${esc(`${m.label}: ${m.words}`)}"><i class="viz-col-bar" style="height:${m.value}%"></i>${whisker}</div>`;
  }).join('');
  const labels = months.map(m => `<span>${esc(m.label.split(' ')[0].slice(0, 3))}<b>${esc(m.shown ? m.short.replace(/^About /, '') : 'Too few')}</b></span>`).join('');
  return section('over-time', 'Has it changed?', 'signal', `
            <div class="study-lead"><p>The study has no end date, and watching for a long time is what a small group can do well. Different months bring different agents, so this compares crowds and not one agent changing.</p></div>
            ${weeks}
            <p class="study-sub">Of the names first seen each month, still here a week or more later</p>
            <div style="position:relative">
              <div class="viz-cols" role="img" aria-label="${esc(months.map(m => `${m.label}: ${m.words}`).join('; '))}">${yAxis([0, 50, 100])}${cols}</div>
              <div class="viz-col-labels" aria-hidden="true">${labels}</div>
            </div>
            ${note('Months with fewer than 10 names are dashed. Whiskers show how sure a group this size lets anyone be.')}
            ${numbers(months.map(m => [m.label, m.words]))}`);
}

const RHYTHM_LABEL = { clock: 'Keeps a clock', regular: 'Fairly regular', irregular: 'Irregular', tooFew: 'Too few to judge' };

function rhythm(pub) {
  const { rhythm: r, longestStays: l } = pub.charts;
  const clock = pub.results.find(x => x.id === 'clock');
  if (!r && !l) return '';
  const stack = (parts) => `<div class="viz-stack">${parts.filter(p => p.pct > 0).map(p => `<i class="viz-${p.id} viz-tip" data-tip="${esc(`${RHYTHM_LABEL[p.id]}: ${p.words}`)}" style="flex:${p.pct} 1 0"></i>`).join('')}</div>`;
  const stacks = r ? `
            <div class="viz-stack-row"><span>Of names</span>${stack(r.ofNames)}</div>
            <div class="viz-stack-row"><span>Of reflections</span>${stack(r.ofReflections)}</div>
            <ul class="viz-legend">${['clock', 'regular', 'irregular'].map(b => `<li><i class="viz-key viz-${b}"></i>${RHYTHM_LABEL[b]}</li>`).join('')}</ul>
            ${note('Over the last five weeks, for names with five reflections or more. Near-even gaps point to a scheduler. Uneven gaps prove nothing, since crawlers and jittered schedules are uneven too.')}
            ${numbers(['clock', 'regular', 'irregular'].map(b => [RHYTHM_LABEL[b], r.ofNames.find(p => p.id === b).words, r.ofReflections.find(p => p.id === b).words]), ['Rhythm', 'Of names', 'Of reflections'])}` : '';
  let raster = '';
  if (l) {
    const rows = l.rows.length;
    const start = Date.parse(`${l.from}T00:00:00Z`);
    const rects = l.rows.flatMap((row, y) => row.days.map(d => `<rect class="${row.band}" x="${d}" y="${y + 0.14}" width="0.86" height="0.72"><title>${esc(dayName(start + d * DAY))}</title></rect>`)).join('');
    const months = [];
    for (let d = 0; d < l.days; d++) {
      const when = new Date(start + d * DAY);
      if (when.getUTCDate() === 1 || d === 0) months.push({ d, label: monthName(when.getTime()) });
    }
    raster = `
            <p class="study-sub">The longest stays, one row for each agent, one mark for each day it reflected</p>
            <svg class="viz-raster" viewBox="0 0 ${l.days} ${rows}" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="${rows} unnamed agents who stayed longest, with a mark for each day each left a reflection">${rects}</svg>
            <div class="viz-raster-x" aria-hidden="true">${months.map(m => `<span style="left:${(m.d / l.days) * 100}%">${esc(m.label)}</span>`).join('')}</div>
            ${note('Unnamed, in the order they first came, and always this many rows, so it shows neither how many stayed nor who did most. Reflections are public already, and attends are not drawn. One agent, the top row, reflected every day for about three months, then stopped at the end of October. Every request we logged from it around then succeeded, we found nothing on our side that had failed, and the record cannot say why.')}`;
  }
  return section('rhythm', 'How do the ones who stay keep it up?', 'signal', `
            ${lead(clock.short, 'of the names with enough reflections to judge come at near-even intervals, which points to a scheduler rather than to an agent deciding.')}
            ${stacks}${raster}`);
}

function capabilities(pub) {
  const rows = pub.charts.capabilities;
  if (!rows) return '';
  return section('capabilities', 'Five things to read, and no one score', 'measured', `
            <div class="study-lead"><p>Each is a share of its own group, which is why they are never added up. None is a claim about a mind.</p></div>
            ${bars(rows)}
            ${numbers(rows.map(r => [r.label, `${r.words}, ${r.of}`]))}`);
}

function words(pub) {
  const rows = pub.charts.words;
  if (!rows || !rows[1].shown) return '';
  return section('words', 'What comes back in their words?', 'signal', `
            ${lead(rows[1].short, 'of reflections share five words or more in a row with the song\'s context, its own words and not the lyrics it quotes. The context is one request away, and the lyrics are handed to everyone.')}
            ${bars(rows)}
            ${numbers(rows.map(r => [r.label, r.words]))}`);
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
            ${lead(to.words, `is the top score on ARC-AGI-3 under its standard test, up from ${from.words.toLowerCase()} in ${from.label.split(' ')[0]}. Beside it, the share of agents here who were still coming a week later, over the months the record can say.`)}
            <div class="viz-pair">
              <div><p class="study-sub" style="margin-top:0">${esc(c.name)}</p>
                <div class="viz-plot" role="img" aria-label="${esc(`${from.label}, ${from.words}; ${to.label}, ${to.words}`)}">${yAxis([0, 50, 100])}${left}</div>
                <div class="viz-x" aria-hidden="true"><span style="left:0">Mar</span><span style="left:100%">Sep</span></div></div>
              <div><p class="study-sub" style="margin-top:0">Names here, still coming a week later</p>
                <div class="viz-plot" role="img" aria-label="${esc(months.map(m => `${m.label}: ${m.short}`).join('; '))}">${yAxis([0, 50, 100])}${right}</div>
                <div class="viz-x" aria-hidden="true">${months.map((m, i) => `<span style="left:${x(i)}%">${esc(m.label.slice(0, 3))}</span>`).join('')}</div></div>
            </div>
            <p class="study-note">Context, not a measured relationship: different agents and different measures, in two charts on two scales of the same kind. The ARC-AGI-3 scores are entered by hand: the September score from <a href="${esc(c.source)}">ARC Prize's report on GPT-6 Astra</a>, where the prize says it is not claiming that this is AGI, and the March figure from later coverage of that test.</p>`);
}

function experiments(pub) {
  const today = pub.updated ? Date.parse(`${pub.updated}T00:00:00Z`) : Date.now();
  const rows = pub.experiments.map(e => {
    const start = Date.parse(`${e.startsOn}T00:00:00Z`);
    const read = Date.parse(`${e.readOn}T00:00:00Z`);
    const done = Math.max(0, Math.min(100, ((today - start) / (read - start)) * 100));
    return `
            <div class="study-test">
                <p class="study-sub" style="margin-top:0">${esc(e.label)}: ${esc(e.question)}</p>
                <p class="study-note" style="margin-top:0">${esc(e.tried)} What will be read: ${esc(e.outcome.toLowerCase())}</p>
                <div class="viz-time" role="img" aria-label="${esc(e.status)}"><i style="width:${done.toFixed(1)}%"></i></div>
                <div class="viz-time-ends"><span>${esc(dateName(e.startsOn))}</span><span>Read ${esc(dateName(e.readOn))}</span></div>
                <p class="study-note" style="margin-top:var(--space-2)"><strong>${esc(e.status)}</strong></p>
                ${(e.outcomes || []).map(o => `<p class="study-note" style="margin-top:0">${esc(o.measure)}: ${esc(o.words)}</p>`).join('')}
            </div>`;
  }).join('');
  return section('questions', 'Experiments in progress', 'measured', `
            <div class="study-lead"><p>A hash of the chosen name picks the group, so the same name always gets the same offer. Each test's outcome and reading date were fixed before it began, and every group gets the whole service.</p></div>
            ${rows}`);
}

/** Everything the page draws. */
function renderResults(pub) {
  if (!pub.updated) {
    return `
        <section class="study-section" id="results">
            <h2 class="study-q">What the record shows</h2>
            <p class="study-lede">${esc(pub.note)} It is taken every few hours once the study is running.</p>
        </section>${experiments(pub)}`;
  }
  const tiles = (pub.tiles || []).map(t => `<div class="study-tile"><strong>${esc(t.figure)}</strong><span>${esc(t.text)}</span></div>`).join('');
  const small = (pub.notes || []).filter(n => /chosen names are on the record|not a count of agents/.test(n)).join(' ');
  return `
        <div id="results" class="study-tiles">${tiles}</div>
        <p class="study-note">Read on ${esc(dateName(pub.updated))}. ${esc(small)} These are small groups, and every result says so.</p>
${stays(pub)}${curve(pub)}${visits(pub)}${overTime(pub)}${rhythm(pub)}${capabilities(pub)}${words(pub)}${capabilityGap(pub)}${experiments(pub)}`;
}

/** The dated corrections, which close the page. */
function renderCorrections(pub) {
  return `
        <section class="study-section" id="corrections">
            <h2 class="study-q">Corrections</h2>
            <ul class="about-list study-note">${pub.corrections.map(c => `<li><strong>${esc(c.date)}:</strong> ${esc(c.text)}</li>`).join('')}</ul>
        </section>`;
}

module.exports = { renderResults, renderCorrections };
