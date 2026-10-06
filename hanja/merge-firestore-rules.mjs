import fs from 'node:fs';

const basePath = new URL('../firestore.rules', import.meta.url);
const fragmentPath = new URL('./firestore.rules.fragment', import.meta.url);

const base = fs.readFileSync(basePath, 'utf8');
const fragment = fs.readFileSync(fragmentPath, 'utf8').trimEnd();
const marker = '// Hanja cross-device sync: each user can only access their own study state.';

if (base.includes(marker)) {
  console.log('Hanja sync rules already present; no merge needed.');
  process.exit(0);
}

const closing = '\n  }\n}';
const at = base.lastIndexOf(closing);
if (at < 0) throw new Error('Could not locate the closing Firestore rules block.');

const merged = `${base.slice(0, at)}\n${fragment}\n${base.slice(at)}`;
fs.writeFileSync(basePath, merged, 'utf8');
console.log('Merged Hanja cross-device sync rules into firestore.rules for deployment.');
