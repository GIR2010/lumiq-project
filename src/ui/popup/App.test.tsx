// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, test, expect, vi, type Mock } from 'vitest';
import { installFakeChrome } from '../../../tests/fakes/chrome';
import { DEFAULT_GLOBAL } from '../../core/settings/defaults';
import type { PopupState, Request } from '../../shared/messages';
import { App } from './App';

beforeEach(() => { installFakeChrome(); (chrome.i18n.getMessage as Mock).mockImplementation((k: string) => k); });
function mockState(p: Partial<PopupState> = {}) {
  (chrome.tabs.query as Mock).mockResolvedValue([{ id: 7, url: 'https://a.com/' }]);
  (chrome.runtime.sendMessage as Mock).mockImplementation(async (m: Request) =>
    m.type === 'GET_TAB_STATE' ? { host: 'a.com', state: { status: 'active', detectedDark: false }, snapshot: { g: DEFAULT_GLOBAL, styles: [], sites: {} }, ...p } : undefined);
}
test('переключатель «На этом сайте» → UPDATE_SITE {on:false}', async () => {
  mockState(); render(<App />); await userEvent.click(await screen.findByRole('radio', { name: 'siteOff' }));
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SITE', host: 'a.com', patch: { on: false } });
});
test('уже тёмный: баннер и «Всё равно затемнить» → {det:true}', async () => {
  mockState({ state: { status: 'already-dark', detectedDark: true } }); render(<App />);
  expect(await screen.findByText('alreadyDarkBanner')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'forceDarken' }));
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SITE', host: 'a.com', patch: { det: true } });
});
test('область «Этот сайт»: ползунок пишет site.adj; сброс удаляет st и adj', async () => {
  mockState(); render(<App />);
  await userEvent.click(await screen.findByRole('radio', { name: 'scopeSite' }));
  fireEvent.input(screen.getByLabelText('sliderBrightness'), { target: { value: '80' } });
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SITE', host: 'a.com', patch: { adj: { br: 80 } } });
  await userEvent.click(screen.getByRole('button', { name: 'resetToGlobal' }));
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SITE', host: 'a.com', patch: { st: null, adj: null } });
});
test('область «Глобально»: смена стиля → UPDATE_GLOBAL {st}', async () => {
  mockState(); render(<App />);
  await userEvent.selectOptions(await screen.findByLabelText('styleLabel'), 'oled');
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_GLOBAL', patch: { st: 'oled' } });
});
test('недоступная страница: только статус и подвал', async () => {
  mockState({ host: null, state: { status: 'unsupported', detectedDark: false } }); render(<App />);
  expect(await screen.findByText('statusUnsupported')).toBeTruthy();
  expect(screen.queryByLabelText('sliderBrightness')).toBeNull();
  expect(screen.getByRole('radio', { name: 'globalOff' })).toBeTruthy();
});
test('GET_TAB_STATE падает дважды: статус ошибки и retry перезагружает состояние', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mockState();
  const ok = (chrome.runtime.sendMessage as Mock).getMockImplementation()!;
  (chrome.runtime.sendMessage as Mock).mockRejectedValue(new Error('Receiving end does not exist'));
  render(<App />);
  expect(await screen.findByText('statusError')).toBeTruthy();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('[DarkExt]'), expect.anything());
  (chrome.runtime.sendMessage as Mock).mockImplementation(ok);
  await userEvent.click(screen.getByRole('button', { name: 'retry' }));
  expect(await screen.findByRole('radio', { name: 'siteOff' })).toBeTruthy();
  expect(chrome.tabs.reload).not.toHaveBeenCalled();
  warn.mockRestore();
});
test('группы переключателей имеют собственные имена', async () => {
  mockState(); render(<App />);
  await screen.findByRole('radio', { name: 'siteOff' });
  expect(screen.getByRole('radiogroup', { name: 'scopeLabel' })).toBeTruthy();
  expect(screen.getByRole('radiogroup', { name: 'globalToggleLabel' })).toBeTruthy();
});
