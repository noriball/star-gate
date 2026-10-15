import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { CSP } from './src/csp';

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) { const p = join(dir, f); statSync(p).isDirectory() ? walk(p, out) : out.push(p); }
  return out;
}

/** Production only: adds the CSP meta tag, then writes sw.js with the precache list and a version derived from file contents. */
function appShell(): Plugin {
  let outDir = 'dist';
  return {
    name: 'star-gate-app-shell',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    transformIndexHtml: { order: 'post', handler: html => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`) },
    closeBundle() {
      const swPath = join(outDir, 'sw.js');
      if (!existsSync(swPath)) return;
      const files = walk(outDir).filter(f => f !== swPath && !f.endsWith('.map')).map(f => relative(outDir, f).split('\\').join('/')).sort();
      const h = createHash('sha256'); for (const f of files) { h.update(f); h.update(readFileSync(join(outDir, f))); }
      const urls = ['./', ...files.map(f => './' + f)];
      writeFileSync(swPath, readFileSync(swPath, 'utf8').replace('__VERSION__', h.digest('hex').slice(0, 12)).replace('__PRECACHE__', JSON.stringify(urls)));
    },
  };
}

const https = process.env.VITE_HTTPS === '1' && existsSync('.certs/key.pem')
  ? { key: readFileSync('.certs/key.pem'), cert: readFileSync('.certs/cert.pem') } : undefined;

export default defineConfig({
  base: './',                       // relative URLs: the build works from any static host and any sub-path
  plugins: [appShell()],
  server: { host: process.env.VITE_HTTPS === '1' ? true : '127.0.0.1', https },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
