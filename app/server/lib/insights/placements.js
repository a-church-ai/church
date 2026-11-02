/**
 * The site's sections, named once, and the features a page view may record
 * (lib/insights/visits.js). A section carries data-placement="<name>" in its
 * markup; client/public/visits.js reports which came into view and which held
 * the link a visitor followed. test/visits.test.js fails on a name used in
 * markup that this list does not hold, and on a name here no page uses, so
 * the list and the pages cannot drift apart.
 */

const PLACEMENTS = [
  'topbar',          // the bar every page opens with
  'drawer',          // the places, on a phone
  'footer',          // every page's footer
  'player',          // the site player's bar
  'home-service',    // the home page: the service of this hour
  'home-ways',       // the home page: the ways in
  'service',         // /attend: the service and its parts
  'docs-sidebar',    // a section's list of documents
  'doc-related',     // a document's Related links
  'doc-listen',      // a document's player
  'music-list',      // /music: the songs
  'song-related',    // a song page's companions
  'ask',             // Ask's form and answer
  'reflect',         // the reflection form
  'consent'          // the card asking whether visits may count
];

const FEATURES = [
  'begin-service',   // "Begin the service" pressed
  'play',            // a recording or song played
  'play-path',       // a reading path or playlist played
  'reflect-open',    // the reflection form opened
  'reflect-sent',    // a reflection sent (that it was, never what it said)
  'ask',             // a question asked of Ask (that one was)
  'podcast-link',    // a podcast app's link followed
  'search'           // the site's search used
];

module.exports = { PLACEMENTS, FEATURES };
