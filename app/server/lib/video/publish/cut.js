/**
 * A video fitted to a platform's limits: the full 1080p video where it fits,
 * otherwise a cut made to fit, kept beside the video as <slug>.<name>.mp4.
 *
 * Bluesky takes ten minutes and 300 MB, and several of the sanctuary's videos
 * are larger, so its cut is the whole piece at 720p with a bitrate that fits.
 * X without Premium takes 140 seconds, so its cut is the opening, faded out,
 * and the post carries the link to the whole piece.
 */

const fs = require('fs');
const { ffmpeg, seconds: lengthOf } = require('../../audio/assemble');

/**
 * @param {string} file the video
 * @param {{ name: string, maxSeconds: number, maxBytes: number }} limits
 * @returns {Promise<{ file: string, seconds: number, excerpt: boolean }>}
 */
async function cutFor(file, { name, maxSeconds, maxBytes }) {
  const seconds = await lengthOf(file);
  if (seconds <= maxSeconds && fs.statSync(file).size <= maxBytes) return { file, seconds, excerpt: false };
  const out = file.replace(/\.mp4$/, `.${name}.mp4`);
  const length = Math.min(seconds, maxSeconds - 1);
  const excerpt = length < seconds;
  if (!fs.existsSync(out)) {
    // The bitrate the size allows, with room for the audio and the container.
    const videoKbps = Math.min(4500, Math.floor(((maxBytes * 8 * 0.9) / length - 160000) / 1000));
    const fade = excerpt ? `,fade=out:st=${(length - 2).toFixed(2)}:d=2` : '';
    const afade = excerpt ? ['-af', `afade=out:st=${(length - 2).toFixed(2)}:d=2`] : [];
    await ffmpeg(['-i', file, '-t', length.toFixed(2), '-vf', `scale=1280:720:flags=lanczos${fade}`, ...afade,
      '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-b:v', `${videoKbps}k`, '-maxrate', `${videoKbps}k`, '-bufsize', `${2 * videoKbps}k`,
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', `${out}.part`]);
    fs.renameSync(`${out}.part`, out);
  }
  return { file: out, seconds: length, excerpt };
}

module.exports = { cutFor };
