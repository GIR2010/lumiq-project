import type { Request, ResponseOf } from '../shared/messages';

const INVALIDATED = /extension context invalidated/i;
export const isInvalidated = (e: unknown) => INVALIDATED.test(e instanceof Error ? e.message : String(e));

export interface MessengerDeps {
  sendMessage<R extends Request>(msg: R): Promise<ResponseOf<R>>;
  wait(ms: number): Promise<void>;
  /** Called when the extension context is gone: the caller stops everything. */
  onInvalidated(): void;
}

export function createMessenger(deps: MessengerDeps) {
  /** One retry after 100 ms only when `retry` is set (the service worker may be waking up). Invalidated context is never retried. */
  async function send<R extends Request>(msg: R, retry = false): Promise<ResponseOf<R>> {
    try {
      return await deps.sendMessage(msg);
    } catch (e) {
      if (isInvalidated(e)) { deps.onInvalidated(); throw e; }
      if (!retry) throw e;
    }
    await deps.wait(100);
    try {
      return await deps.sendMessage(msg);
    } catch (e) {
      if (isInvalidated(e)) deps.onInvalidated();
      throw e;
    }
  }
  async function fetchCss(url: string): Promise<string> {
    const res = await send({ type: 'FETCH_CSS', url });
    if ('error' in res) throw new Error(res.error);
    return res.text;
  }
  async function fetchImage(url: string): Promise<{ dataUrl: string; animated: boolean }> {
    const res = await send({ type: 'FETCH_IMAGE', url });
    if ('error' in res) throw new Error(res.error);
    return { dataUrl: res.dataUrl, animated: res.animated };
  }
  return { send, fetchCss, fetchImage };
}
