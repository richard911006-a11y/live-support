import { readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const sourcePath = process.argv[2];

if (sourcePath === undefined) {
  console.error('Usage: node scripts/run-ts.mjs <script.ts>');
  process.exit(1);
}

const absoluteSourcePath = resolve(sourcePath);
const runtimePath = `${absoluteSourcePath}.runtime.mjs`;
const source = await readFile(absoluteSourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  },
  fileName: absoluteSourcePath,
}).outputText;

await writeFile(runtimePath, transpiled, 'utf8');

try {
  await import(pathToFileURL(runtimePath).href);
} finally {
  await unlink(runtimePath).catch(() => undefined);
}
