// Creates a self-signed certificate for `npm run dev:https` (needs the `openssl` command; nothing leaves this machine).
// The certificate lists localhost and every LAN address of this computer so a phone can open https://<lan-ip>:5173.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.certs');
const key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem');
const lan = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
if (existsSync(key) && existsSync(cert) && !process.argv.includes('--force')) {
  console.log(`[dev-cert] using existing ${dir} (run with --force to recreate, e.g. after your LAN address changed)`);
} else {
  mkdirSync(dir, { recursive: true });
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...lan.map(a => `IP:${a}`)].join(',');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '30', '-subj', '/CN=star-gate-dev', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
  console.log(`[dev-cert] created ${cert} (valid 30 days) for ${san}`);
}
console.log(lan.length ? `[dev-cert] open on a phone on the same Wi-Fi: ${lan.map(a => `https://${a}:5173`).join('  ')}` : '[dev-cert] no LAN address found');
