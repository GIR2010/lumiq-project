// @vitest-environment jsdom
import { beforeEach, expect, test, vi, type Mock } from 'vitest';
import { createController, type ControllerDeps } from './controller';
import type { Pipeline } from './pipeline/pipeline';
import { DEFAULT_GLOBAL } from '../core/settings/defaults';
import { resolveConfig, type EffectiveConfig } from '../core/settings/resolve';

beforeEach(() => { document.documentElement.innerHTML = '<head></head><body></body>'; });

function setup(over: Partial<ControllerDeps> = {}, cfgOver: Partial<EffectiveConfig> = {}, pipeStatus: () => string = () => 'ok') {
  const pipeline = { start: vi.fn(), update: vi.fn(), detach: vi.fn(), setDisabled: vi.fn(), status: pipeStatus, onStatus: vi.fn(), addRoot: vi.fn(), refreshSheet: vi.fn() } as unknown as Pipeline;
  let domReady = () => {}, load = () => {}, sysChange = () => {}; const sys = { matches: true };
  const deps: ControllerDeps = {
    getConfig: async () => ({ ...resolveConfig('a.com', DEFAULT_GLOBAL, undefined, []), ...cfgOver }),
    report: vi.fn(), pipeline, detect: vi.fn(() => 'light' as const),
    matchDark: () => ({ get matches() { return sys.matches; }, onChange: cb => { sysChange = cb; } }),
    onDomReady: cb => { domReady = cb; }, onLoad: cb => { load = cb; }, ...over,
  };
  document.documentElement.insertAdjacentHTML('beforeend', '<style data-darkext="placeholder"></style>');
  return { c: createController(document, deps), deps, pipeline, fire: { domReady: () => domReady(), load: () => load(), sys: (v: boolean) => { sys.matches = v; sysChange(); } } };
}
const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));
const base = () => resolveConfig('a.com', DEFAULT_GLOBAL, undefined, []);
const withBr = (br: number): EffectiveConfig => ({ ...base(), adj: { ...base().adj, br } });

test('применяет и убирает заглушку', async () => {
  const { c, pipeline, deps } = setup(); await c.start();
  expect(pipeline.start).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-darkext=placeholder]')).toBeNull();
  expect(deps.report).toHaveBeenLastCalledWith({ status: 'active', detectedDark: false });
});
test('тёмная страница → detach, статус already-dark; детектор работает с отключёнными стилями', async () => {
  const { c, pipeline, deps, fire } = setup({ detect: vi.fn(() => 'dark' as const) }); await c.start(); fire.domReady();
  expect((pipeline.setDisabled as Mock).mock.calls).toEqual([[true], [false]]);
  expect(pipeline.detach).toHaveBeenCalled();
  expect(deps.report).toHaveBeenLastCalledWith({ status: 'already-dark', detectedDark: true });
});
test('unsure → повтор на load', async () => {
  const detect = vi.fn<() => 'dark' | 'light' | 'unsure'>().mockReturnValueOnce('unsure').mockReturnValueOnce('dark');
  const { c, fire, pipeline } = setup({ detect }); await c.start(); fire.domReady(); fire.load();
  expect(detect).toHaveBeenCalledTimes(2); expect(pipeline.detach).toHaveBeenCalled();
});
test('ignoreDetection → детектор не вызывается', async () => {
  const { c, fire, deps } = setup({}, { ignoreDetection: true }); await c.start(); fire.domReady();
  expect(deps.detect).not.toHaveBeenCalled();
});
test('followSystem: светлая система → detach; тёмная → снова start/update', async () => {
  const { c, fire, pipeline, deps } = setup({}, { followSystem: true }); await c.start();
  fire.sys(false); expect(pipeline.detach).toHaveBeenCalled();
  expect(deps.report).toHaveBeenLastCalledWith({ status: 'system-light', detectedDark: false });
  fire.sys(true); expect((pipeline.start as Mock).mock.calls.length + (pipeline.update as Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
});
test('getConfig → null (неподдерживаемая страница) → ничего не применяется, заглушка удалена', async () => {
  const { c, pipeline } = setup({ getConfig: async () => null }); await c.start();
  expect(pipeline.start).not.toHaveBeenCalled(); expect(document.querySelector('[data-darkext=placeholder]')).toBeNull();
});
test('report отправляется только при изменении состояния', async () => {
  const { c, deps, fire } = setup(); await c.start();
  fire.domReady(); c.onConfig({ ...resolveConfig('a.com', DEFAULT_GLOBAL, undefined, []) });
  expect(deps.report).toHaveBeenCalledTimes(1);
});
test('статус пайплайна heavy/error при применении попадает в report', async () => {
  const { c, deps } = setup({}, {}, () => 'heavy'); await c.start();
  expect(deps.report).toHaveBeenLastCalledWith({ status: 'heavy', detectedDark: false });
});
test('повторное применение вызывает update, а не start', async () => {
  const { c, pipeline } = setup(); await c.start();
  // A config that differs from the current one (identical ones are ignored), applied at the next frame.
  c.onConfig(withBr(90));
  await frame();
  expect(pipeline.start).toHaveBeenCalledTimes(1); expect(pipeline.update).toHaveBeenCalledTimes(1);
});
test('stop: после остановки события игнорируются, страница не трогается', async () => {
  const { c, pipeline, fire } = setup(); await c.start(); c.stop();
  fire.sys(false); fire.domReady();
  expect(pipeline.detach).not.toHaveBeenCalled(); expect(pipeline.setDisabled).not.toHaveBeenCalled();
});
test('getConfig отклонён → заглушка удалена, статус error (не unsupported), ничего не применено', async () => {
  const { c, pipeline, deps } = setup({ getConfig: async () => { throw new Error('boom'); } }); await c.start();
  expect(pipeline.start).not.toHaveBeenCalled(); expect(document.querySelector('[data-darkext=placeholder]')).toBeNull();
  expect(deps.report).toHaveBeenLastCalledWith({ status: 'error', detectedDark: false });
});

test('I2: 20 одинаковых CONFIG_CHANGED подряд → один update; повтор текущей конфигурации игнорируется', async () => {
  const { c, pipeline } = setup(); await c.start();
  for (let i = 0; i < 20; i++) c.onConfig(withBr(90));
  await frame();
  expect(pipeline.update).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 20; i++) c.onConfig(withBr(90));
  await frame();
  expect(pipeline.update).toHaveBeenCalledTimes(1);
});

test('I2: серия из 20 разных конфигураций в одном кадре (ползунок) → один update с последней', async () => {
  const { c, pipeline } = setup(); await c.start();
  for (let i = 0; i < 20; i++) c.onConfig(withBr(80 + i));
  await frame();
  expect(pipeline.update).toHaveBeenCalledTimes(1);
  expect(pipeline.update).toHaveBeenCalledWith(withBr(99));
});

test('M5: после отказа GET_CONFIG пришедший CONFIG_CHANGED включает детектор и слушателей', async () => {
  const { c, pipeline, deps, fire } = setup({ getConfig: async () => { throw new Error('boom'); } }); await c.start();
  c.onConfig({ ...base(), followSystem: true });
  await frame();
  expect(pipeline.start).toHaveBeenCalledTimes(1);
  expect(pipeline.onStatus).toHaveBeenCalledTimes(1);
  fire.domReady();
  expect(deps.detect).toHaveBeenCalledTimes(1);
  fire.sys(false); // the system listener is registered too
  expect(deps.report).toHaveBeenLastCalledWith({ status: 'system-light', detectedDark: false });
});

test('M6: CONFIG_CHANGED во время ожидания GET_CONFIG важнее более старого ответа', async () => {
  let answer!: (cfg: EffectiveConfig) => void;
  const { c, pipeline } = setup({ getConfig: () => new Promise<EffectiveConfig>(r => { answer = r; }) });
  const started = c.start();
  c.onConfig(withBr(120));
  answer(withBr(60)); // the older value
  await started;
  await frame();
  expect(pipeline.start).toHaveBeenCalledTimes(1);
  expect(pipeline.start).toHaveBeenCalledWith(withBr(120));
  expect(pipeline.update).not.toHaveBeenCalled();
});
