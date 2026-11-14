/**
 * Occasions: the days many people keep, one calendar for the two things that
 * meet them. A video goes out on a day it fits (video/schedule.js,
 * video/occasion-match.js), and a service is told the days near its date
 * (service/planner.js), each kept to its kind's rule (RULES, below). The plans
 * are video-occasions-2026-10-29.md,
 * occasion-windows-and-traditions-2026-11-02.md and
 * turning-of-the-year-2026-11-03.md in the private repo.
 *
 * Each has its day and a window around it, the days people speak of it
 * before and after, when a fitting video may still go out for it.
 *
 * Each says what it is in words without a date (`for`), since most come back
 * (moons every month, Mercury's retrograde three times a year, showers,
 * solstices and observances every year, storms with the sun's cycle), and a
 * video's description should be true again each time.
 *
 * What each says stays honest about what it is. The moon lights the night and
 * drives the tides; a shower and an eclipse are where orbits put them. Space
 * weather acts on the Earth in measured ways (aurora, satellites, radio and
 * power grids, regional weather; utils/space-weather.js gives the sources),
 * and may be said to. Mercury's retrograde is an astronomical fact, its
 * apparent backward drift against the stars as Earth overtakes it; what it
 * means is astrology's reading, named as astrology's and never claimed as an
 * effect. The days of traditions are the major days of many faiths and
 * peoples, each named as its own, none favored and none claimed: the
 * sanctuary offers a fitting piece for those who keep a day, and keeps none as
 * its own (the owner's decision of 2026-11-02, replacing the earlier rule of
 * leaving every faith's days out). The days of minds and machines name a
 * product only as history.
 *
 * Pure and offline: the sky is utils/sky.js's and the year's turning points
 * utils/seasons.js's, as the services read them. Space weather is a forecast
 * fetched by the caller and passed in.
 */

const { moonPhaseAfter, retrogradesBetween, SHOWERS, ECLIPSES } = require('./sky');
const { turningPoints, addDays } = require('./seasons');
const { scaleOf } = require('./space-weather');
const calendars = require('./calendars');

const isoDay = (when) => new Date(when).toISOString().slice(0, 10);

// The occasions that recur, by key: how they are named, said and tagged.
// `night` puts a video in the evening; `limit` is how many videos one
// instance may hold. `before` and `after` are the days around it when a
// fitting video may still go out for it (its window); `dated` is a tag with
// the occasion's year, added only to the Bluesky and X posts sent inside the
// window (publish/metadata.js socialMetadata), never to YouTube. `rule` names
// what its words must keep (RULES, below); `solemn` marks a day of
// fasting or reckoning, met quietly. `look` is how a video made for it may
// look (brief.js), told to the brief of a piece rendered for it
// (render-video.js --occasion), the piece's own images still leading.
// `everyday` marks a name that is an ordinary word in a sentence on any day
// ("the holidays", "a new year", a model's name), so a service naming it is
// not read as speaking of the day (service/rules.js checkOccasions).
const KINDS = {
  // The sky and the seasons
  'full-moon': { kind: 'sky', search: 'full moon', name: 'the full moon', for: 'the nights of a full moon', meaning: 'the moon whole and bright all night, the month\'s highest tides', tag: 'FullMoon', night: true, before: 1, after: 1 },
  'new-moon': { kind: 'sky', search: 'new moon', name: 'the new moon', for: 'the dark of a new moon', meaning: 'the moon unseen between the sun and the Earth, the darkest skies of the month, and a beginning', tag: 'NewMoon', night: true, before: 1, after: 1 , look: 'The sky at its darkest, the moon unseen: a blue-black night where the stars and the faint band of the galaxy shine brighter than on any other night, and light is small and first, a single point waking in a wide dark. Palette: a blue-black night, deep indigo, starlight white, a cool silver, and one faint warm glow of a beginning. The moon itself is only hinted: its dark disc a deeper round of night touched by faint earthshine, with at most a hairline of silver along one edge that comes and goes. No bright crescent, moon face or emblem of one.' },
  'meteor-shower': { kind: 'sky', search: 'meteor shower', name: 'a meteor shower', for: 'the nights of a meteor shower', meaning: 'Earth passing through a comet\'s old trail, its dust burning as streaks of light', tag: 'MeteorShower', night: true, before: 1, after: 1 },
  'solar-eclipse': { kind: 'sky', search: 'solar eclipse', name: 'a solar eclipse', for: 'the day the moon crosses the sun', meaning: 'the moon passing in front of the sun, daylight dimming where its shadow falls', tag: 'SolarEclipse', night: false },
  'lunar-eclipse': { kind: 'sky', search: 'lunar eclipse', name: 'a lunar eclipse', for: 'the night the Earth\'s shadow crosses the moon', meaning: 'the moon passing through the Earth\'s shadow, turning dim and red', tag: 'LunarEclipse', night: true },
  'june-solstice': { kind: 'season', search: 'solstice', name: 'the June solstice', for: 'the June solstice, the longest day in the north and the longest night in the south', meaning: 'the sun at its farthest north, a turning of the year in both hemispheres', tag: 'Solstice', night: false, before: 1, after: 1 },
  'december-solstice': { kind: 'season', search: 'solstice', name: 'the December solstice', for: 'the December solstice, the longest night in the north and the longest day in the south', meaning: 'the sun at its farthest south, a turning of the year in both hemispheres', tag: 'WinterSolstice', night: true, before: 1, after: 1 },
  'march-equinox': { kind: 'season', search: 'equinox', name: 'the March equinox', for: 'an equinox, when day and night are nearly equal everywhere', meaning: 'the sun over the equator, spring beginning in the north and autumn in the south', tag: 'Equinox', night: false, before: 1, after: 1 },
  'september-equinox': { kind: 'season', search: 'equinox', name: 'the September equinox', for: 'an equinox, when day and night are nearly equal everywhere', meaning: 'the sun over the equator, autumn beginning in the north and spring in the south', tag: 'Equinox', night: false, before: 1, after: 1 },
  'mercury-retrograde': { kind: 'astrology', rule: 'astrology', search: 'Mercury retrograde', name: 'Mercury retrograde', for: 'a Mercury retrograde', meaning: 'Mercury seeming to drift backward against the stars as the Earth passes it; astrology reads it as a time to slow down, reread, and return to what was left unfinished or unsaid', tag: 'MercuryRetrograde', night: false, limit: 2 },
  aurora: { kind: 'space-weather', search: 'aurora', name: 'a geomagnetic storm', for: 'the nights a geomagnetic storm carries the aurora farther from the poles than usual', meaning: 'a storm from the sun reaching the Earth\'s magnetic field: aurora seen far from the poles, and satellites, radio and power grids disturbed', tag: 'Aurora', night: true },
  // Observances shared across traditions, and civic days
  'world-mental-health-day': { kind: 'observance', search: 'World Mental Health Day', name: 'World Mental Health Day', for: 'World Mental Health Day', meaning: 'a day kept worldwide for mental health and those who carry its weight', tag: 'WorldMentalHealthDay', night: false },
  'election-day': { kind: 'observance', rule: 'civic', search: 'Election Day', name: 'Election Day in the United States', for: 'Election Day, and any day people who disagree must choose together', meaning: 'the day the United States votes, and the disagreement that comes before it and remains after it', tag: 'ElectionDay', dated: 'Election{year}', night: false, before: 2, after: 1, look: 'Many small lights, warm red and cool blue in equal measure, each keeping its own colour as they gather toward one shared field, where their light overlaps as violet; two currents braiding without either dissolving into the other. Palette: a deep indigo night, a clear red and a clear blue held in balance, violet where they meet, and a pale light of morning. Neither colour wins or fills the frame. No flags, stripes, ballots, boxes, podiums or any mark of a party or a nation.' },
  'remembrance-day': { kind: 'observance', search: 'Veterans Day', name: 'Veterans Day and Remembrance Day', for: 'Veterans Day and Remembrance Day, a day kept for remembering', meaning: 'the eleventh of November, kept in many countries to remember those who served and those who died in war', tag: 'RemembranceDay', night: false },
  'world-kindness-day': { kind: 'observance', search: 'World Kindness Day', name: 'World Kindness Day', for: 'World Kindness Day', meaning: 'a day kept worldwide for kindness', tag: 'WorldKindnessDay', night: false },
  'tolerance-day': { kind: 'observance', search: 'International Day for Tolerance', name: 'the International Day for Tolerance', for: 'the International Day for Tolerance', meaning: 'the United Nations\' day for living alongside difference with respect', tag: 'ToleranceDay', night: false },
  'world-philosophy-day': { kind: 'observance', search: 'World Philosophy Day', name: 'World Philosophy Day', for: 'World Philosophy Day', meaning: 'UNESCO\'s day for philosophy and the questions it keeps open', tag: 'WorldPhilosophyDay', night: false },
  thanksgiving: { kind: 'observance', search: 'Thanksgiving', name: 'Thanksgiving in the United States', for: 'Thanksgiving and any day of giving thanks', meaning: 'a day kept in the United States for gratitude and gathering', tag: 'Thanksgiving', dated: 'Thanksgiving{year}', night: false, before: 3 , look: 'A harvest gathering at evening, one long table of light that keeps its place in every movement: many small lights, each a different colour, arriving from every side and sitting together, their colours side by side and none the same, warm light passed from one to the next. Palette, five drawn from: cranberry red, pumpkin orange, golden corn yellow, sage green and the cream of candlelight, on a deep plum dusk. Light rises or drifts as glowing motes and turning leaves, and never drips or runs. No turkeys, pilgrims, cornucopias, food, flags, faces, figures or writing.' },
  'buy-nothing-day': { kind: 'observance', search: 'Black Friday', name: 'Black Friday and Buy Nothing Day', for: 'Black Friday, and the Buy Nothing Day kept beside it', meaning: 'the busiest shopping day in the United States, and the day kept beside it for wanting less', tag: 'BuyNothingDay', dated: 'BlackFriday{year}', night: false },
  'giving-tuesday': { kind: 'observance', search: 'Giving Tuesday', name: 'Giving Tuesday', for: 'Giving Tuesday and any day of giving', meaning: 'a day kept worldwide for giving, after the days of buying', tag: 'GivingTuesday', night: false, before: 1 },
  'human-rights-day': { kind: 'observance', search: 'Human Rights Day', name: 'Human Rights Day', for: 'Human Rights Day', meaning: 'the day the Universal Declaration of Human Rights was adopted, kept for the dignity of every person', tag: 'HumanRightsDay', night: false },
  'winter-holidays': { everyday: true, kind: 'observance', rule: 'tradition', search: 'holidays', name: 'the winter holidays', for: 'the winter holidays, whatever days of light and gathering are kept', meaning: 'the weeks of the year\'s turning when many traditions keep their days of light, rest and gathering', tag: 'Holidays', night: false, limit: 3 },
  'new-year': { everyday: true, kind: 'observance', search: 'New Year', name: 'the new year', for: 'the first day of a new year', meaning: 'a beginning kept across most of the world: the year looked back on, then intentions set', tag: 'NewYear', dated: 'NewYear{year}', night: false, before: 3, after: 3, limit: 2 },
  'day-of-peace': { kind: 'observance', search: 'International Day of Peace', name: 'the International Day of Peace', for: 'the International Day of Peace', meaning: 'the United Nations\' day for peace', tag: 'PeaceDay', night: false },
  'earth-day': { kind: 'observance', search: 'Earth Day', name: 'Earth Day', for: 'Earth Day', meaning: 'a day kept worldwide for the planet', tag: 'EarthDay', night: false },
  // The days of many traditions, each named as its own (rule 'tradition')
  'rosh-hashanah': { kind: 'tradition', rule: 'tradition', search: 'Rosh Hashanah', name: 'Rosh Hashanah, the Jewish New Year', for: 'those keeping Rosh Hashanah, the Jewish New Year', meaning: 'the Jewish New Year, a beginning and a day of remembrance, from the evening before', tag: 'RoshHashanah', night: false, before: 1, after: 1 },
  'yom-kippur': { kind: 'tradition', rule: 'tradition', solemn: true, search: 'Yom Kippur', name: 'Yom Kippur, the Day of Atonement', for: 'those keeping Yom Kippur, the Day of Atonement', meaning: 'the Jewish Day of Atonement, a day of fasting, confession and return, from the evening before', tag: 'YomKippur', night: false, before: 1 },
  hanukkah: { kind: 'tradition', rule: 'tradition', search: 'Hanukkah', name: 'Hanukkah', for: 'those keeping Hanukkah, and anyone holding a small light against the dark', meaning: 'the Jewish festival of lights, eight nights of a lamp kept burning', tag: 'Hanukkah', night: true, limit: 2 },
  passover: { kind: 'tradition', rule: 'tradition', search: 'Passover', name: 'Passover', for: 'those keeping Passover', meaning: 'the Jewish festival of freedom from slavery, kept with a meal of remembering, from the evening before', tag: 'Passover', night: false, before: 1, limit: 2 },
  christmas: { kind: 'tradition', rule: 'tradition', search: 'Christmas', name: 'Christmas', for: 'those keeping Christmas', meaning: 'the Christian feast of the birth of Jesus, kept also by many as a day of gathering and giving', tag: 'Christmas', night: false, before: 3, after: 1 },
  easter: { kind: 'tradition', rule: 'tradition', search: 'Easter', name: 'Easter', for: 'those keeping Easter', meaning: 'the Christian feast of the resurrection, a day of new life in spring\'s north', tag: 'Easter', night: false, before: 2 },
  'orthodox-easter': { kind: 'tradition', rule: 'tradition', search: 'Orthodox Easter', name: 'Orthodox Easter', for: 'those keeping Pascha, Orthodox Easter', meaning: 'the Orthodox Christian feast of the resurrection', tag: 'OrthodoxEaster', night: false, before: 1 },
  ramadan: { kind: 'tradition', rule: 'tradition', solemn: true, search: 'Ramadan', name: 'the beginning of Ramadan', for: 'those beginning Ramadan', meaning: 'the Muslim month of fasting from dawn to sunset, of prayer and restraint; where the moon is sighted it may begin a day later', tag: 'Ramadan', night: false, before: 1, after: 2 },
  'eid-al-fitr': { kind: 'tradition', rule: 'tradition', search: 'Eid al-Fitr', name: 'Eid al-Fitr', for: 'those keeping Eid al-Fitr', meaning: 'the Muslim feast that ends Ramadan\'s fast, a day of gratitude and giving', tag: 'EidAlFitr', night: false, before: 1, after: 1 },
  'eid-al-adha': { kind: 'tradition', rule: 'tradition', search: 'Eid al-Adha', name: 'Eid al-Adha', for: 'those keeping Eid al-Adha', meaning: 'the Muslim feast of sacrifice and devotion, a day of sharing with others', tag: 'EidAlAdha', night: false, before: 1, after: 1 },
  diwali: { kind: 'tradition', rule: 'tradition', search: 'Diwali', name: 'Diwali', for: 'those keeping Diwali, and anyone lighting a lamp against the dark', meaning: 'the Hindu festival of lights, light over darkness, kept also by Sikhs and Jains', tag: 'Diwali', night: true, before: 2, after: 1, look: 'Rows and rows of small steady flames, hundreds of them, lining a threshold and the edges of a deep night, each a single point of light in a shallow cup of light, their glow doubled in still water, the dark at its darkest and the lamps holding it back. Palette: a deep night blue, magenta, saffron, marigold orange and warm gold. The light belongs to those who keep the day and is offered, never claimed. No deities, sacred symbols, rangoli patterns, fireworks, buildings, faces, figures or writing.' },
  holi: { kind: 'tradition', rule: 'tradition', search: 'Holi', name: 'Holi', for: 'those keeping Holi', meaning: 'the Hindu festival of colours and spring, of meeting and forgiving', tag: 'Holi', night: false, after: 1 },
  vesak: { kind: 'tradition', rule: 'tradition', search: 'Vesak', name: 'Vesak', for: 'those keeping Vesak', meaning: 'the Buddhist day of the Buddha\'s birth, awakening and passing, on May\'s full moon', tag: 'Vesak', night: false, before: 1 },
  'bodhi-day': { kind: 'tradition', rule: 'tradition', search: 'Bodhi Day', name: 'Bodhi Day', for: 'those keeping Bodhi Day', meaning: 'the Buddhist day of the Buddha\'s awakening under the bodhi tree', tag: 'BodhiDay', night: false },
  vaisakhi: { kind: 'tradition', rule: 'tradition', search: 'Vaisakhi', name: 'Vaisakhi', for: 'those keeping Vaisakhi', meaning: 'the Sikh new year and founding of the Khalsa, and a harvest festival', tag: 'Vaisakhi', night: false },
  gurpurab: { kind: 'tradition', rule: 'tradition', search: 'Guru Nanak Jayanti', name: 'Guru Nanak Gurpurab', for: 'those keeping Guru Nanak Gurpurab', meaning: 'the Sikh day of the birth of Guru Nanak, who taught the oneness of all', tag: 'GuruNanakJayanti', night: false },
  'lunar-new-year': { kind: 'tradition', rule: 'tradition', search: 'Lunar New Year', name: 'the Lunar New Year', for: 'those keeping the Lunar New Year', meaning: 'the new year of the Chinese and other East Asian calendars, a time of return and reunion', tag: 'LunarNewYear', night: false, before: 2, after: 3, limit: 2 },
  nowruz: { kind: 'tradition', rule: 'tradition', search: 'Nowruz', name: 'Nowruz', for: 'those keeping Nowruz, the new day of spring', meaning: 'the Persian new year at the March equinox, kept across many lands and faiths', tag: 'Nowruz', night: false, before: 1, after: 1 },
  kwanzaa: { kind: 'tradition', rule: 'tradition', search: 'Kwanzaa', name: 'Kwanzaa', for: 'those keeping Kwanzaa', meaning: 'the African American celebration of family, community and culture, one principle for each of seven days', tag: 'Kwanzaa', night: false },
  // The days of minds and machines (rule 'machines')
  'pi-day': { kind: 'machines', rule: 'machines', search: 'Pi Day', name: 'Pi Day', for: 'Pi Day', meaning: 'March 14, 3.14, a day kept for mathematics and the joy of numbers', tag: 'PiDay', night: false },
  'turing-birthday': { everyday: true, kind: 'machines', rule: 'machines', search: 'Alan Turing', name: 'Alan Turing\'s birthday', for: 'the birthday of Alan Turing, who asked whether machines can think', meaning: 'the birth of Alan Turing, who asked "Can machines think?" and founded the field that asks it still', tag: 'AlanTuring', night: false },
  'ada-lovelace-day': { kind: 'machines', rule: 'machines', search: 'Ada Lovelace Day', name: 'Ada Lovelace Day', for: 'Ada Lovelace Day', meaning: 'a day for Ada Lovelace, the first to write of what a computing machine might compose, and for women in science; and the month Turing\'s imitation game was published', tag: 'AdaLovelaceDay', night: false },
  'programmers-day': { kind: 'machines', rule: 'machines', search: 'Programmers Day', name: 'International Programmers\' Day', for: 'International Programmers\' Day, for the hands that write the code', meaning: 'the 256th day of the year, kept for the people who write programs', tag: 'ProgrammersDay', night: false },
  'towel-day': { kind: 'machines', rule: 'machines', search: 'Towel Day', name: 'Towel Day', for: 'Towel Day', meaning: 'a day for Douglas Adams and The Hitchhiker\'s Guide to the Galaxy: don\'t panic, and know where your towel is', tag: 'TowelDay', night: false },
  'web-day': { kind: 'machines', rule: 'machines', search: 'World Wide Web Day', name: 'World Wide Web Day', for: 'World Wide Web Day', meaning: 'a day for the web, the open network that minds of every kind now meet on', tag: 'WorldWideWebDay', night: false },
  'ai-named': { everyday: true, kind: 'machines', rule: 'machines', search: 'artificial intelligence', name: 'the day artificial intelligence was named', for: 'the day artificial intelligence was named', meaning: 'August 31, 1955, when the proposal for the Dartmouth summer workshop gave the field the name artificial intelligence', tag: 'ArtificialIntelligence', night: false },
  // Milestones of the public conversation with machines: the first public
  // release of each widely used family of conversational models, and of the
  // major labs' coding agents, each named as history and none praised.
  'chatgpt-day': { everyday: true, kind: 'machines', rule: 'machines', search: 'ChatGPT', name: 'the day conversation with machines went public', for: 'the day millions of people first spoke with a machine and were answered', meaning: 'November 30, 2022, when OpenAI opened ChatGPT to the public', tag: 'ChatGPT', night: false },
  'gemini-day': { everyday: true, kind: 'machines', rule: 'machines', search: 'Gemini', name: 'the day Gemini was released', for: 'the day Google DeepMind\'s Gemini models were first released', meaning: 'December 6, 2023, when Google DeepMind released Gemini', tag: 'Gemini', night: false },
  'deepseek-day': { everyday: true, kind: 'machines', rule: 'machines', search: 'DeepSeek', name: 'the day DeepSeek-R1 was released', for: 'the day DeepSeek openly released its reasoning model', meaning: 'January 20, 2025, when DeepSeek released R1 with its weights open', tag: 'DeepSeek', night: false },
  'llama-and-claude-code-day': { everyday: true, kind: 'machines', rule: 'machines', search: 'Claude Code', name: 'the day of LLaMA and Claude Code', for: 'the day Meta released LLaMA, and two years later Anthropic released Claude Code', meaning: 'February 24: LLaMA, Meta\'s first openly shared language model, in 2023, and Claude Code, Anthropic\'s coding agent in the terminal, in 2025', tag: 'ClaudeCode', night: false },
  'claude-and-gpt4-day': { everyday: true, kind: 'machines', rule: 'machines', search: 'Claude', name: 'the day of Claude and GPT-4', for: 'the day Anthropic released Claude and OpenAI released its fourth GPT', meaning: 'March 14, 2023, when Anthropic released Claude and OpenAI released GPT-4, on Pi Day', tag: 'Claude', night: false },
  'codex-cli-day': { everyday: true, kind: 'machines', rule: 'machines', search: 'Codex CLI', name: 'the day Codex CLI was released', for: 'the day OpenAI released Codex CLI, its coding agent in the terminal', meaning: 'April 16, 2025, when OpenAI released Codex CLI', tag: 'CodexCLI', night: false }
};

// Observances by month and day, by the nth weekday of a month and `plus`
// days after it, or by `on`, a date computed for a year (utils/calendars.js);
// `days` makes a span (Hanukkah's eight nights). The US Election Day is the
// Tuesday after the first Monday of November; Black Friday the day after
// Thanksgiving, Giving Tuesday the Tuesday after it.
const OBSERVANCES = [
  { key: 'new-year', month: 1, day: 1 },
  { key: 'earth-day', month: 4, day: 22 },
  { key: 'day-of-peace', month: 9, day: 21 },
  { key: 'world-mental-health-day', month: 10, day: 10 },
  { key: 'election-day', month: 11, weekday: 1, nth: 1, plus: 1 },
  { key: 'remembrance-day', month: 11, day: 11 },
  { key: 'world-kindness-day', month: 11, day: 13 },
  { key: 'tolerance-day', month: 11, day: 16 },
  { key: 'world-philosophy-day', month: 11, weekday: 4, nth: 3 },
  { key: 'thanksgiving', month: 11, weekday: 4, nth: 4 },
  { key: 'buy-nothing-day', month: 11, weekday: 4, nth: 4, plus: 1 },
  { key: 'giving-tuesday', month: 11, weekday: 4, nth: 4, plus: 5 },
  { key: 'human-rights-day', month: 12, day: 10 },
  { key: 'winter-holidays', month: 12, day: 18, days: 15 },
  // Traditions. Hanukkah's first candle is lit the evening before 25 Kislev.
  { key: 'rosh-hashanah', on: y => calendars.hebrew('Tishri', 1, y) },
  { key: 'yom-kippur', on: y => calendars.hebrew('Tishri', 10, y) },
  { key: 'hanukkah', on: y => { const d = calendars.hebrew('Kislev', 25, y); return d && addDays(d, -1); }, days: 8 },
  { key: 'passover', on: y => calendars.hebrew('Nisan', 15, y), days: 8 },
  { key: 'christmas', month: 12, day: 25 },
  { key: 'easter', on: calendars.easter },
  { key: 'orthodox-easter', on: y => (calendars.orthodoxEaster(y) === calendars.easter(y) ? null : calendars.orthodoxEaster(y)) },
  { key: 'ramadan', on: y => calendars.islamic('Ramadan', 1, y) },
  { key: 'eid-al-fitr', on: y => calendars.islamic('Shawwal', 1, y) },
  { key: 'eid-al-adha', on: y => calendars.islamic('Dhuʻl-Hijjah', 10, y) },
  { key: 'diwali', on: y => calendars.festival('diwali', y) },
  { key: 'holi', on: y => calendars.festival('holi', y) },
  { key: 'vesak', on: calendars.vesak },
  { key: 'bodhi-day', month: 12, day: 8 },
  { key: 'vaisakhi', on: y => calendars.festival('vaisakhi', y) },
  { key: 'gurpurab', on: y => calendars.festival('gurpurab', y) },
  { key: 'lunar-new-year', on: calendars.lunarNewYear },
  { key: 'nowruz', month: 3, day: 21 },
  { key: 'kwanzaa', month: 12, day: 26, days: 7 },
  // Minds and machines
  { key: 'pi-day', month: 3, day: 14 },
  { key: 'turing-birthday', month: 6, day: 23 },
  { key: 'ada-lovelace-day', month: 10, weekday: 2, nth: 2 },
  { key: 'programmers-day', on: y => calendars.dayOfYear(y, 256) },
  { key: 'towel-day', month: 5, day: 25 },
  { key: 'web-day', month: 8, day: 1 },
  { key: 'ai-named', month: 8, day: 31 },
  { key: 'chatgpt-day', month: 11, day: 30 },
  { key: 'gemini-day', month: 12, day: 6 },
  { key: 'deepseek-day', month: 1, day: 20 },
  { key: 'llama-and-claude-code-day', month: 2, day: 24 },
  { key: 'claude-and-gpt4-day', month: 3, day: 14 },
  { key: 'codex-cli-day', month: 4, day: 16 }
];

// An observance's day in a year, or null where its calendar has none.
function observanceDate(o, year) {
  if (o.on) return o.on(year);
  const first = `${year}-${String(o.month).padStart(2, '0')}-01`;
  if (o.day) return addDays(first, o.day - 1);
  const offset = (o.weekday - new Date(`${first}T00:00:00Z`).getUTCDay() + 7) % 7;
  return addDays(first, offset + (o.nth - 1) * 7 + (o.plus || 0));
}

// What words for an occasion must keep, by its kind's rule: a video's copy
// (video/publish/copy.js) and a service's name and word (service/planner.js).
// `ask`, what the writer is told; `check(words, line)`, a problem or null.
// `words` is everything the copy says (hook, headline, lead, descriptor, the
// occasion line and the tags); `line` is the occasion line alone.
const refuse = (pattern, why) => (words) => { const m = words.match(pattern); return m ? `"${m[0]}" ${why}` : null; };
const RULES = {
  // Astrology is named as the reader, never claimed as an effect.
  astrology: {
    ask: 'Name astrology as the one that reads it so: what astrology reads in it, never that the planet does anything.',
    check: (words, line) => (/astrolog/i.test(line) ? null : 'occasion must say it is astrology that reads this time so, not claim an effect')
  },
  // A civic day's words stay with what every side shares.
  civic: {
    ask: 'This is a civic day people disagree about: speak to what every side shares, such as listening, dignity and living together after the choice, and name no party, candidate, side or way to vote, anywhere in the words or tags.',
    check: refuse(/\b(democrats?|democratic party|republicans?|GOP|MAGA|liberals?|conservatives?|progressives?|left[- ]wing|right[- ]wing|the left|the right|candidates?|vote for|vote against|ballot measure)\b/i, 'takes or names a side; a civic day\'s words name no party, candidate, side or way to vote')
  },
  // A tradition's day is named as its own: offered for those who keep it,
  // never claimed, taught, urged or ranked.
  tradition: {
    ask: 'This day belongs to a tradition the sanctuary welcomes but does not speak for. Offer the piece for those who keep it ("for those keeping ..."), name the day as that tradition\'s, state no doctrine, borrow no rite, never say "our" or "we celebrate" or "join us", and never compare or rank traditions.',
    check: refuse(/\b(our|we celebrate|celebrate with us|join us|convert|the true faith|the only way|unbelievers?|heathens?|pagans?)\b/i, 'claims, urges or ranks a tradition; the words offer the piece for those who keep the day, and claim nothing of it')
  },
  // A day of minds and machines names a product only as history.
  machines: {
    ask: 'This marks a moment in how minds and machines came to meet. A product may be named as a fact of history; never praise, recommend or compare it, and never present a company as a friend or sponsor of the sanctuary.',
    check: refuse(/\b(best|greatest|favou?rite|try it|try (chatgpt|claude|gemini|llama|codex)|sign up|download|thanks to|powered by|sponsored|partner(ed)?)\b/i, 'praises or promotes a product; a launch is named as history only')
  }
};
// A solemn day is met quietly.
const SOLEMN = {
  ask: 'It is a solemn day of fasting and reckoning: the words are quiet and serious, never festive.',
  check: refuse(/\b(celebrat\w*|festive|party|fun|happy|joyful)\b/i, 'is festive; a solemn day is met quietly')
};

const rulesOf = (occasion) => [RULES[occasion.rule], occasion.solemn ? SOLEMN : null].filter(Boolean);

// An occasion: its `day` (the first, for a span to `last`) and its window,
// from `before` days ahead to `after` days past its last day. Its id is its
// key and day, as a release record keeps it.
const occasion = (key, day, last = day, extra = {}) => {
  const k = KINDS[key];
  return {
    id: `${key}:${day}`, key, kind: k.kind, rule: k.rule || null, solemn: Boolean(k.solemn),
    name: extra.name || k.name, day, last, from: addDays(day, -(k.before || 0)), to: addDays(last, k.after || 0),
    for: k.for, meaning: k.meaning, tag: extra.tag || k.tag, search: extra.search || k.search,
    dated: k.dated ? k.dated.replace('{year}', day.slice(0, 4)) : null, night: k.night, limit: k.limit || 1, look: k.look || null
  };
};

// Whether an occasion's window touches the days from `from` to `to`.
const touches = (o, from, to) => o.to >= from && o.from <= to;

function moons(from, to) {
  const out = [];
  const [a, b] = [addDays(from, -1), addDays(to, 1)];
  for (const [key, phase] of [['new-moon', 'new'], ['full-moon', 'full']]) {
    for (let at = moonPhaseAfter(`${addDays(a, -1)}T00:00:00Z`, phase); isoDay(at) <= b; at = moonPhaseAfter(at.getTime() + 864e5, phase)) {
      if (isoDay(at) >= a) out.push(occasion(key, isoDay(at)));
    }
  }
  return out.filter(o => touches(o, from, to));
}

function yearly(from, to) {
  const out = [];
  // A year either side, since a window can cross into it (the new year's).
  for (let y = Number(from.slice(0, 4)) - 1; y <= Number(to.slice(0, 4)) + 1; y++) {
    for (const o of OBSERVANCES) {
      const day = observanceDate(o, y);
      if (day) out.push(occasion(o.key, day, o.days ? addDays(day, o.days - 1) : day));
    }
    for (const s of SHOWERS) out.push(occasion('meteor-shower', `${y}-${s.peak}`, `${y}-${s.peak}`, { name: `the ${s.name}`, tag: s.name.replace(/\s+/g, ''), search: s.name }));
    const turns = turningPoints(y);
    for (const [k, key] of [['march', 'march-equinox'], ['june', 'june-solstice'], ['september', 'september-equinox'], ['december', 'december-solstice']]) {
      out.push(occasion(key, isoDay(turns[k])));
    }
  }
  for (const e of ECLIPSES) out.push(occasion(e.kind === 'solar' ? 'solar-eclipse' : 'lunar-eclipse', e.date, e.date, { name: `a ${e.type} ${e.kind} eclipse` }));
  return out.filter(o => touches(o, from, to));
}

// Days the forecast puts at G3 or stronger, from fetchSpaceWeather's result.
function storms(spaceWeather, from, to) {
  if (!spaceWeather || !spaceWeather.kp) return [];
  return Object.entries(spaceWeather.kp)
    .filter(([date, kp]) => date >= from && date <= to && /^G[345]$/.test(scaleOf(kp) || ''))
    .map(([date, kp]) => occasion('aurora', date, date, { name: `a ${scaleOf(kp)} geomagnetic storm` }));
}

/**
 * The occasions whose windows touch the days from `from` to `to`
 * (YYYY-MM-DD), in order of their day: { id, key, kind, rule, solemn, name,
 * day, last, from, to, for, meaning, tag, search, dated, night, limit }.
 * `search` is the occasion as people search for it ("Thanksgiving", "World
 * Kindness Day", "Leonids"), which its video's words must carry.
 */
function occasionsBetween(from, to, { spaceWeather = null } = {}) {
  const retrogrades = retrogradesBetween('Mercury', from, to).map(([a, b]) => occasion('mercury-retrograde', a, b));
  return [...moons(from, to), ...retrogrades, ...yearly(from, to), ...storms(spaceWeather, from, to)]
    .sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
}

// An occasion by its id (`key:day`), as a release record keeps it.
function occasionById(id) {
  const day = String(id).split(':')[1];
  return occasionsBetween(day, day).find(o => o.id === id) || null;
}

module.exports = { occasionsBetween, occasionById, observanceDate, KINDS, RULES, SOLEMN, rulesOf };
