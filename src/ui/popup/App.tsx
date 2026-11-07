import { PRESETS } from '../../core/settings/presets';
import type { Adjustments } from '../../core/settings/schema-types';
import type { TabStatus } from '../../shared/messages';
import { Segmented } from '../shared/components/Segmented';
import { Slider } from '../shared/components/Slider';
import { StyleSelect } from '../shared/components/StyleSelect';
import { t, type MessageKey } from '../shared/i18n';
import { usePopupState } from './usePopupState';
import './popup.css';

const STATUS_KEY: Record<TabStatus, MessageKey> = {
  active: 'statusActive',
  off: 'statusOff',
  'system-light': 'statusSystemLight',
  'already-dark': 'statusAlreadyDark',
  error: 'statusError',
  heavy: 'statusHeavy',
  unsupported: 'statusUnsupported',
};

const SLIDERS: { key: keyof Adjustments; label: MessageKey; min: number; max: number }[] = [
  { key: 'br', label: 'sliderBrightness', min: 50, max: 150 },
  { key: 'ct', label: 'sliderContrast', min: 50, max: 150 },
  { key: 'sp', label: 'sliderSepia', min: 0, max: 100 },
  { key: 'gs', label: 'sliderGrayscale', min: 0, max: 100 },
  { key: 'img', label: 'sliderImages', min: 0, max: 30 },
];

type SiteMode = 'default' | 'on' | 'off';

export function App() {
  const { state, failed, retryLoad, tabId, scope, setScope, updateGlobal, updateSite } = usePopupState();
  if (!state) {
    if (!failed) return null;
    return (
      <div className="popup">
        <header><span className="status status-error">{t('statusError')}</span></header>
        <section className="banner">
          <button type="button" onClick={retryLoad}>{t('retry')}</button>
        </section>
      </div>
    );
  }
  const { host, state: tab, snapshot } = state;
  const { g, styles, sites } = snapshot;
  const status = tab.status;

  const footer = (
    <footer>
      <Segmented
        ariaLabel={t('globalToggleLabel')}
        value={g.def}
        options={[{ value: 'on', label: t('globalOn') }, { value: 'off', label: t('globalOff') }]}
        onChange={(def) => updateGlobal({ def })}
      />
    </footer>
  );
  const header = (
    <header>
      <strong>{host ?? ''}</strong>
      <span className={`status status-${status}`}>{t(STATUS_KEY[status])}</span>
    </header>
  );

  if (status === 'unsupported' || host === null) {
    return <div className="popup">{header}{footer}</div>;
  }

  const site = sites[host];
  const siteMode: SiteMode = site?.on === true ? 'on' : site?.on === false ? 'off' : 'default';
  const siteScope = scope === 'site';
  const styleValue = siteScope ? (site?.st ?? g.st) : g.st;
  const adjValue = (k: keyof Adjustments) => (siteScope ? (site?.adj?.[k] ?? g.adj[k]) : g.adj[k]);

  return (
    <div className="popup">
      {header}
      <section>
        <span className="row-label">{t('siteToggleLabel')}</span>
        <Segmented<SiteMode>
          ariaLabel={t('siteToggleLabel')}
          value={siteMode}
          options={[
            { value: 'default', label: t('siteDefault') },
            { value: 'on', label: t('siteOn') },
            { value: 'off', label: t('siteOff') },
          ]}
          onChange={(m) => updateSite({ on: m === 'default' ? null : m === 'on' })}
        />
      </section>
      {status === 'already-dark' && (
        <section className="banner">
          <p>{t('alreadyDarkBanner')}</p>
          <button type="button" onClick={() => updateSite({ det: true })}>{t('forceDarken')}</button>
        </section>
      )}
      {status === 'error' && (
        <section className="banner">
          <button type="button" onClick={() => { void chrome.tabs.reload(tabId ?? undefined); }}>{t('retry')}</button>
        </section>
      )}
      <section>
        <Segmented<'global' | 'site'>
          ariaLabel={t('scopeLabel')}
          value={scope}
          options={[{ value: 'global', label: t('scopeGlobal') }, { value: 'site', label: t('scopeSite') }]}
          onChange={setScope}
        />
      </section>
      <section>
        <StyleSelect
          value={styleValue}
          presets={PRESETS}
          userStyles={styles}
          onChange={(st) => (siteScope ? updateSite({ st }) : updateGlobal({ st }))}
        />
        {SLIDERS.map((s) => (
          <Slider
            key={s.key}
            label={t(s.label)}
            min={s.min}
            max={s.max}
            value={adjValue(s.key)}
            onChange={(v) => (siteScope ? updateSite({ adj: { [s.key]: v } }) : updateGlobal({ adj: { ...g.adj, [s.key]: v } }))}
          />
        ))}
        {siteScope && (
          <button type="button" onClick={() => updateSite({ st: null, adj: null })}>{t('resetToGlobal')}</button>
        )}
      </section>
      {footer}
    </div>
  );
}
