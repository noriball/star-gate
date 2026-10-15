// Minimal typings for the few Node built-ins the tests use (no @types/node installed).
declare module 'node:fs' {
  export function existsSync(p: string): boolean;
  export function statSync(p: string): { size: number };
  export function readFileSync(p: string): Uint8Array;
}
declare module 'node:path' { export function join(...p: string[]): string; export function dirname(p: string): string; }
declare module 'node:url' { export function fileURLToPath(u: string | URL): string; }
