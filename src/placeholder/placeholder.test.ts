// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';

test('заглушка вставляет один <style data-darkext=placeholder>, повторный запуск не дублирует', async () => {
  await import('./placeholder'); // __SYS__ = false через define в vitest.config.ts
  expect(document.querySelectorAll('[data-darkext=placeholder]').length).toBe(1);
  expect(document.querySelector('[data-darkext=placeholder]')!.textContent).toBe('html{background-color:#1e1e1e!important;color:#e0e0e0!important}');
  vi.resetModules();
  await import('./placeholder');
  expect(document.querySelectorAll('[data-darkext=placeholder]').length).toBe(1);
});
