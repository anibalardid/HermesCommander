import { describe, it, expect } from 'vitest';
import en from '../i18n/locales/en/translation.json';
import es from '../i18n/locales/es/translation.json';

type Nested = Record<string, unknown>;

function flatten(obj: Nested, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') {
      keys.push(...flatten(v as Nested, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

describe('i18n translations', () => {
  it('English and Spanish have the same set of keys', () => {
    const enKeys = flatten(en as Nested).sort();
    const esKeys = flatten(es as Nested).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it('has no empty translation values', () => {
    const check = (obj: Nested, lang: string) => {
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') check(v as Nested, lang);
        else expect(String(v).trim().length, `${lang}.${k} is empty`).toBeGreaterThan(0);
      }
    };
    check(en as Nested, 'en');
    check(es as Nested, 'es');
  });
});
