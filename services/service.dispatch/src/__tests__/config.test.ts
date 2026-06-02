import { describe, expect, it } from 'vitest';

describe('@cad/service.dispatch', () => {
  it('module shape is importable', async () => {
    const mod = await import('../config.js');
    expect(mod).toBeTruthy();
  });
});
