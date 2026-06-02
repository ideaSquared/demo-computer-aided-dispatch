import { describe, expect, it } from 'vitest';

describe('@cad/service.auth', () => {
  it('module shape is importable', async () => {
    const mod = await import('../config.js');
    expect(mod).toBeTruthy();
  });
});
