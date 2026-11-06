// запускает сборку и проверяет dist
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
test('сборка создаёт все входы манифеста', () => {
  execSync('npm run build', { stdio: 'inherit' });
  const m = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
  for (const f of ['background.js', 'content.js', 'main-world.js', 'placeholder.js', 'placeholder-sys.js', 'popup/index.html', '_locales/ru/messages.json'])
    expect(existsSync(`dist/${f}`)).toBe(true);
  expect(m.permissions).toEqual(['storage', 'scripting']);
  expect(m.host_permissions).toEqual(['<all_urls>']);
  expect(readFileSync('dist/content.js', 'utf8')).not.toMatch(/^\s*import\s/m); // IIFE, без ESM
}, 120_000);
