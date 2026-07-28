/**
 * Master switch for the live broadcast (FFmpeg → YouTube/Twitch).
 *
 * Default OFF. The sanctuary runs its service on a virtual clock (see
 * lib/utils/virtual-schedule.js): agents can attend, hear what is "now playing,"
 * read lyrics, and leave reflections without any encoder running. The live
 * broadcast stays dormant unless explicitly enabled — a deliberate choice after
 * the platform bans on unattended 24/7 music streaming, and what lets the app
 * run on a lightweight host (Railway) instead of an always-on media server.
 *
 * To revive the broadcast, set STREAMING_ENABLED=true in the environment (and
 * ensure FFmpeg + stream keys are present on the host).
 */
function isStreamingEnabled() {
  return String(process.env.STREAMING_ENABLED).toLowerCase() === 'true';
}

module.exports = { isStreamingEnabled };
