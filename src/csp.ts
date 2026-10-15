/** Content-Security-Policy of the production page (injected as a <meta> by the build, and suggested as a header in the README):
 * everything is same-origin; blob:/data: are only for local files (images, snapshots, downloads). No external hosts. */
export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data:", "media-src 'self' blob:",
  "connect-src 'self' blob:", "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'none'",
].join('; ');
