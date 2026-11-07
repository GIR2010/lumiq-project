import { beforeEach, expect, test } from 'vitest';
import { installFakeChrome, type FakeChrome } from '../../tests/fakes/chrome';
import { setBadge } from './badge';

let fake: FakeChrome;
beforeEach(() => { fake = installFakeChrome(); });

test('M7: красный фон только для ошибки; для остальных статусов фон сбрасывается к умолчанию', async () => {
  await setBadge(7, 'error');
  expect(fake.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 7, text: '!' });
  expect(fake.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ tabId: 7, color: '#d93025' });
  await setBadge(7, 'heavy');
  expect(fake.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 7, text: '~' });
  expect(fake.action.getBadgeBackgroundColor).toHaveBeenCalledWith({});
  expect(fake.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({ tabId: 7, color: [95, 99, 104, 255] });
});
