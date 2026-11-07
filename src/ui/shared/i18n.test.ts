import en from '../../../public/_locales/en/messages.json';
import ru from '../../../public/_locales/ru/messages.json';
import { t } from './i18n';

test('ru и en содержат одинаковые ключи', () => {
  expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
});
test('каждое сообщение имеет непустой message', () => {
  for (const m of [...Object.values(en), ...Object.values(ru)]) expect(m.message.length).toBeGreaterThan(0);
});
test('t делегирует chrome.i18n.getMessage и возвращает ключ при пустом ответе', () => {
  (globalThis as any).chrome = { i18n: { getMessage: (k: string) => (k === 'statusActive' ? 'Активно' : '') } };
  expect(t('statusActive')).toBe('Активно');
  expect(t('statusOff')).toBe('statusOff');
});
