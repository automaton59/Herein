import { describe, expect, it } from 'vitest';
import {
  APP_DISPLAY_NAME,
  APP_PACKAGE_NAME,
  APP_USER_DATA_DIR_NAME,
  APP_ZH_NAME,
} from './appIdentity';

describe('appIdentity', () => {
  it('uses the Herein brand and data namespace', () => {
    expect(APP_DISPLAY_NAME).toBe('Herein');
    expect(APP_ZH_NAME).toBe('此间');
    expect(APP_PACKAGE_NAME).toBe('herein');
    expect(APP_USER_DATA_DIR_NAME).toBe('herein');
  });
});
