const major = Number(process.versions.node.split('.')[0] ?? 0);
if (major < 22) {
  console.error('Lingxi requires Node.js 22 or newer (built-in node:sqlite).');
  process.exit(1);
}

const originalEmitWarning = process.emitWarning.bind(process);

process.emitWarning = ((warning, ...args: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning instanceof Error ? warning.message : '';
  if (text.includes('SQLite is an experimental feature')) {
    return;
  }
  return Reflect.apply(originalEmitWarning, process, [warning, ...args]);
}) as typeof process.emitWarning;
