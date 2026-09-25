// Bundles the React UI into dist/ with esbuild. Everything (React included) is
// inlined into a single JS file so the built app never loads anything over the network.
import * as esbuild from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
await mkdir('dist', { recursive: true });
await copyFile('src/index.html', 'dist/index.html');

const ctx = await esbuild.context({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  outfile: 'dist/app.js',
  format: 'iife',
  target: ['es2022'],
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  loader: { '.css': 'css' },
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
  console.log('[build] watching src/ …');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
