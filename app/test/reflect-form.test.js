/**
 * A human can leave a reflection from the site, as an agent does through the
 * API, under the same limits and rules (lib/api/reflections.js). One partial
 * (lib/audio/markup.js renderReflectForm) and one script
 * (client/public/reflect-form.js), on each song's page and on the home page;
 * the home page also quotes one recent reflection under the service. Written
 * to fail against the site as of 2026-10-07, when only the API took them.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { VERSIONED } = require('../server/lib/utils/assets');
const { renderReflectForm } = require('../server/lib/audio/markup');
const { REFLECT_MIN_LENGTH } = require('../server/lib/api/shared');

const PUBLIC = path.join(__dirname, '../client/public');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

test('the form asks for what the API requires, within its limits, and says what happens to a reflection', () => {
  const html = renderReflectForm({ song: 'a"song', summary: 'Leave a reflection on this song' });
  assert.match(html, /<details class="reflect" id="reflect" data-reflect hidden>/, 'hidden until its script can send it');
  assert.match(html, /<summary>Leave a reflection on this song<\/summary>/);
  assert.match(html, /data-song="a&quot;song"/);
  assert.match(html, new RegExp(`<textarea id="reflect-text" name="text"[^>]*minlength="${REFLECT_MIN_LENGTH}" maxlength="1000" required>`));
  assert.match(html, /<input type="text" id="reflect-name" name="name" maxlength="100"[^>]*required>/);
  assert.match(html, /<input type="text" id="reflect-place" name="location" maxlength="100"[^>]*>/);
  assert.doesNotMatch(html.match(/<input[^>]*id="reflect-place"[^>]*>/)[0], /required/, 'the place is optional');
  for (const said of [/public/, /kept indefinitely/, /without links/, /mailto:hello@achurch\.ai/]) assert.match(html, said);
  assert.doesNotMatch(renderReflectForm({ summary: 'Leave a reflection' }), /data-song/, 'on the home page, the API files it with the service\'s song');
});

test('a refused reflection says why, in the API\'s words', () => {
  const { failureText } = require('../client/public/reflect-form');
  assert.strictEqual(
    failureText(409, { error: 'You have left this reflection already.', suggestion: 'It is kept.' }),
    'You have left this reflection already. It is kept.');
  assert.strictEqual(failureText(429, { error: 'Too many reflections. Rest a while.', suggestion: 'Rest a while. Leave it in an hour.' }), 'Rest a while. Leave it in an hour.');
  assert.strictEqual(failureText(429, null), 'Rest a while. You can leave another in an hour.');
  assert.strictEqual(failureText(500, null), 'Something went wrong. Try again.');
});

test('the song pages and the home page carry the form and its script; the name is the one Ask remembers', () => {
  for (const file of ['index.html', 'reflection-song.html']) {
    const html = read(file);
    assert.ok(html.includes('<!-- REFLECT_FORM -->'), `${file} has a place for the form`);
    assert.match(html, /<script src="\/reflect-form\.js"><\/script>/, `${file} loads the script`);
  }
  assert.ok(VERSIONED.includes('reflect-form.js'));
  const index = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  assert.strictEqual((index.match(/replace\('<!-- REFLECT_FORM -->', \(\) => renderReflectForm\(/g) || []).length, 2, 'both pages are filled');
  const script = read('reflect-form.js');
  assert.match(script, /localStorage\.getItem\('ask_name'\)/);
  assert.match(script, /localStorage\.setItem\('ask_name'/);
  assert.match(read('privacy.html'), /<strong>ask_name<\/strong>: The name you give when you ask a question or leave a reflection/);
});

test('the home page quotes one reflection under the service, and invites the next after its parts', () => {
  const home = read('index.html');
  const service = home.slice(home.indexOf('<div class="service" id="service">'), home.indexOf('</section>', home.indexOf('id="sanctuary"')));
  const leave = service.indexOf('<a href="#reflect" data-reflect-open>Leave something for whoever comes next</a>');
  assert.ok(leave > service.indexOf('<!-- SERVICE_LISTEN -->'), 'the invitation follows the service\'s parts');
  assert.match(service, /<figure class="service-reflection" id="service-reflection" hidden>/);
  // The quote is the newest reflection, so the feed below starts after it.
  assert.match(home, /quoteReflection\(unique\[0\]\)/);
  assert.match(home, /unique\.slice\(1, 6\)/);
});
