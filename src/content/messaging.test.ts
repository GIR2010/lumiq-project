import { expect, test, vi } from 'vitest';
import { createMessenger } from './messaging';

function setup(impl: (n: number) => unknown) {
  let n = 0;
  const sendMessage = vi.fn(async () => { const r = impl(++n); if (r instanceof Error) throw r; return r; });
  const wait = vi.fn(async () => {}); const onInvalidated = vi.fn();
  return { m: createMessenger({ sendMessage: sendMessage as never, wait, onInvalidated }), sendMessage, wait, onInvalidated };
}
const conn = () => new Error('Could not establish connection. Receiving end does not exist.');
const inval = () => new Error('Extension context invalidated.');

test('GET_CONFIG: одна повторная попытка через 100 мс при ошибке соединения', async () => {
  const { m, sendMessage, wait } = setup((n) => (n === 1 ? conn() : null));
  await expect(m.send({ type: 'GET_CONFIG' }, true)).resolves.toBeNull();
  expect(sendMessage).toHaveBeenCalledTimes(2); expect(wait).toHaveBeenCalledWith(100);
});
test('второй сбой пробрасывается, третьей попытки нет', async () => {
  const { m, sendMessage } = setup(() => conn());
  await expect(m.send({ type: 'GET_CONFIG' }, true)).rejects.toThrow('Could not establish');
  expect(sendMessage).toHaveBeenCalledTimes(2);
});
test('другие типы запросов не повторяются', async () => {
  const { m, sendMessage, wait } = setup(() => conn());
  await expect(m.send({ type: 'REPORT_STATE', state: { status: 'active', detectedDark: false } })).rejects.toThrow();
  expect(sendMessage).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
});
test('invalidated с первой попытки → onInvalidated, без повтора', async () => {
  const { m, sendMessage, onInvalidated } = setup(() => inval());
  await expect(m.send({ type: 'GET_CONFIG' }, true)).rejects.toThrow('invalidated');
  expect(onInvalidated).toHaveBeenCalledTimes(1); expect(sendMessage).toHaveBeenCalledTimes(1);
});
test('invalidated на повторе → onInvalidated', async () => {
  const { m, onInvalidated } = setup((n) => (n === 1 ? conn() : inval()));
  await expect(m.send({ type: 'GET_CONFIG' }, true)).rejects.toThrow('invalidated');
  expect(onInvalidated).toHaveBeenCalledTimes(1);
});
test('FETCH_CSS: {error} → отклонение, {text} → текст', async () => {
  const bad = setup(() => ({ error: 'HTTP 404' }));
  await expect(bad.m.fetchCss('https://x/a.css')).rejects.toThrow('HTTP 404');
  const ok = setup(() => ({ text: 'a{}' }));
  await expect(ok.m.fetchCss('https://x/a.css')).resolves.toBe('a{}');
});
