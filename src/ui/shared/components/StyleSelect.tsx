import { useId } from 'react';
import type { PRESETS } from '../../../core/settings/presets';
import type { StyleColors, UserStyle } from '../../../core/settings/schema-types';
import { t } from '../i18n';

export interface StyleSelectProps {
  value: string;
  presets: typeof PRESETS;
  userStyles: UserStyle[];
  onChange: (id: string) => void;
}

export function StyleSelect({ value, presets, userStyles, onChange }: StyleSelectProps) {
  const id = useId();
  const colors: StyleColors | undefined =
    presets.find((p) => p.id === value)?.colors ?? userStyles.find((s) => s.id === value)?.c;
  return (
    <div className="style-select">
      <label htmlFor={id}>{t('styleLabel')}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {presets.map((p) => <option key={p.id} value={p.id}>{t(p.nameKey)}</option>)}
        {userStyles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {colors && (
        <span className="swatches" aria-hidden="true">
          {(['bg', 'text', 'accent'] as const).map((k) => (
            <i key={k} style={{ background: colors[k] }} />
          ))}
        </span>
      )}
    </div>
  );
}
