/**
 * A slug for a file name or a URL: lowercase words joined by hyphens, with
 * anything but letters, digits, underscores and hyphens dropped. Contributed
 * documents and the songwriter's pieces are cut at 80 characters; Ask's
 * conversations at 60, which their published URLs already carry. Accents
 * are taken off rather than the letters dropped ("für" is "fur", not "fr");
 * a letter with no Latin form, as in Chinese, is still dropped, so a title
 * in such a script alone gives an empty slug and each caller decides. Headings'
 * anchors are made differently (lib/docs/render.js), since they strip markup.
 */
function slugify(text, max = 80) {
  return String(text)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, max);
}

module.exports = { slugify };
