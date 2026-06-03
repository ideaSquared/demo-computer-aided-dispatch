import type { UnitRegistered, UnitStatusChanged } from '@cad/events/resource';
import { describe, expect, it, vi } from 'vitest';
import * as repo from '../db/repository.js';
import { applyRegistered, applyStatusChanged } from '../subscribers/unitLocation.js';

// The subscriber only needs `db` and `log` — the NATS leg is exercised in
// the smoke test. We hand it a stub DbClient (never called directly) and
// spy on the repository module to assert behaviour.
//
// loadVersion / upsertPosition are imported by the subscriber via the
// module record, so `vi.spyOn(repo, ...)` intercepts the calls before
// they reach Postgres.
type Fake = Parameters<typeof applyRegistered>[0];
const fakeDb = {} as Fake;
const fakeLog = { info: vi.fn(), error: vi.fn() };

const baseRegistered: UnitRegistered = {
  eventId: '00000000-0000-0000-0000-000000000001',
  occurredAt: '2026-06-03T10:00:00.000Z',
  idempotencyKey: 'unit:u-1:v1',
  unitId: '11111111-1111-1111-1111-111111111111',
  tier: 'fire',
  version: 1,
  callsign: 'E-1',
  location: { lat: 51.5, lng: -0.1 },
  registeredBy: 'op-1',
};

const baseStatusChanged: UnitStatusChanged = {
  eventId: '00000000-0000-0000-0000-000000000002',
  occurredAt: '2026-06-03T10:01:00.000Z',
  idempotencyKey: 'unit:u-1:v2',
  unitId: '11111111-1111-1111-1111-111111111111',
  tier: 'fire',
  version: 2,
  status: 'dispatched',
  incidentId: 'inc-1',
  changedBy: 'op-2',
};

describe('geo subscriber — applyRegistered', () => {
  it('upserts on a new version (no existing row)', async () => {
    const loadVersion = vi.spyOn(repo, 'loadVersion').mockResolvedValue(null);
    const upsertPosition = vi.spyOn(repo, 'upsertPosition').mockResolvedValue(undefined);

    await applyRegistered(fakeDb, fakeLog, baseRegistered);

    expect(loadVersion).toHaveBeenCalledWith(fakeDb, baseRegistered.unitId);
    expect(upsertPosition).toHaveBeenCalledTimes(1);
    const call = upsertPosition.mock.calls[0]?.[1];
    expect(call).toMatchObject({
      unitId: baseRegistered.unitId,
      tier: 'fire',
      status: 'available',
      location: { lat: 51.5, lng: -0.1 },
      version: 1,
    });

    loadVersion.mockRestore();
    upsertPosition.mockRestore();
  });

  it('skips when the incoming version is <= persisted (skew-skip)', async () => {
    const loadVersion = vi.spyOn(repo, 'loadVersion').mockResolvedValue(5);
    const upsertPosition = vi.spyOn(repo, 'upsertPosition').mockResolvedValue(undefined);

    // version 3 arriving after we've persisted 5 — must drop.
    await applyRegistered(fakeDb, fakeLog, { ...baseRegistered, version: 3 });
    // version 5 (equal) is also stale — `<=` not `<`.
    await applyRegistered(fakeDb, fakeLog, { ...baseRegistered, version: 5 });

    expect(upsertPosition).not.toHaveBeenCalled();

    loadVersion.mockRestore();
    upsertPosition.mockRestore();
  });

  it('upserts when the incoming version is > persisted', async () => {
    const loadVersion = vi.spyOn(repo, 'loadVersion').mockResolvedValue(3);
    const upsertPosition = vi.spyOn(repo, 'upsertPosition').mockResolvedValue(undefined);

    await applyRegistered(fakeDb, fakeLog, { ...baseRegistered, version: 4 });
    expect(upsertPosition).toHaveBeenCalledTimes(1);

    loadVersion.mockRestore();
    upsertPosition.mockRestore();
  });
});

describe('geo subscriber — applyStatusChanged', () => {
  it('updates without supplying location on a fresh version', async () => {
    const loadVersion = vi.spyOn(repo, 'loadVersion').mockResolvedValue(1);
    const upsertPosition = vi.spyOn(repo, 'upsertPosition').mockResolvedValue(undefined);

    await applyStatusChanged(fakeDb, fakeLog, baseStatusChanged);

    expect(upsertPosition).toHaveBeenCalledTimes(1);
    const call = upsertPosition.mock.calls[0]?.[1];
    expect(call).toMatchObject({
      unitId: baseStatusChanged.unitId,
      tier: 'fire',
      status: 'dispatched',
      location: null,
      version: 2,
    });

    loadVersion.mockRestore();
    upsertPosition.mockRestore();
  });

  it('skips a stale status update', async () => {
    const loadVersion = vi.spyOn(repo, 'loadVersion').mockResolvedValue(5);
    const upsertPosition = vi.spyOn(repo, 'upsertPosition').mockResolvedValue(undefined);

    await applyStatusChanged(fakeDb, fakeLog, { ...baseStatusChanged, version: 4 });

    expect(upsertPosition).not.toHaveBeenCalled();

    loadVersion.mockRestore();
    upsertPosition.mockRestore();
  });
});
