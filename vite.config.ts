import { defineConfig, type Plugin } from 'vite';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RENDERS = resolve(__dirname, 'renders');
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const FILE = /^(frame_\d{6}\.png|meta\.json|encode\.sh)$/;

/** Dev-only frame sink for the offline exporter: GET list, POST file, DELETE all frames. */
function exportSink(): Plugin {
  return {
    name: 'star-gate-export-sink',
    configureServer(server) {
      server.middlewares.use('/__export', (req, res) => {
        const [name, file] = (req.url ?? '').split('?')[0].split('/').filter(Boolean);
        const done = (code: number, body = '') => { res.statusCode = code; res.end(body); };
        if (!name || !NAME.test(name)) return done(400, 'bad name');
        const dir = join(RENDERS, name);
        if (req.method === 'GET' && file === 'list') {
          return done(200, JSON.stringify(existsSync(dir) ? readdirSync(dir) : []));
        }
        if (req.method === 'DELETE' && file === 'frames') {
          if (existsSync(dir)) for (const f of readdirSync(dir)) if (/^frame_\d{6}\.png$/.test(f)) rmSync(join(dir, f));
          return done(200, 'ok');
        }
        if (req.method === 'POST' && file && FILE.test(file)) {
          const chunks: Buffer[] = [];
          req.on('data', c => chunks.push(c));
          req.on('end', () => {
            mkdirSync(dir, { recursive: true });
            const tmp = join(dir, file + '.part');
            writeFileSync(tmp, Buffer.concat(chunks));
            renameSync(tmp, join(dir, file)); // atomic: a cancelled/crashed export never leaves a half-written frame
            done(200, 'ok');
          });
          return;
        }
        done(404);
      });
    },
  };
}

export default defineConfig({
  plugins: [exportSink()],
  server: { host: '127.0.0.1' },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
