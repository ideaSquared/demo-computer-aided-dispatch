import type { NearestKRequest, NearestKResponse } from '@cad/proto';
import { GeoV1 } from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import { describe, expect, it, vi } from 'vitest';
import * as repo from '../db/repository.js';
import { createHandlers, SERVER_MAX_K } from '../grpc/handlers.js';

// The handlers reach into the repository module for `nearestK`; we spy on
// the export so we don't need a live Postgres for the unit tests. A fake
// DbClient stand-in is fine — the spy intercepts before any SQL runs.
const fakeDb = {} as Parameters<typeof repo.nearestK>[0];

function call<TReq>(req: TReq): grpc.ServerUnaryCall<TReq, unknown> {
  return { request: req, metadata: new grpc.Metadata() } as grpc.ServerUnaryCall<TReq, unknown>;
}

function makeRow(id: string, lat: number, lng: number, distance: number): repo.PositionRow {
  return {
    unit_id: id,
    tier: 'fire',
    status: 'available',
    lat,
    lng,
    distance_m: distance,
    updated_at: '2026-06-03T10:00:00.000Z',
  };
}

describe('geo gRPC handler — NearestK', () => {
  it('returns rows ordered nearest-first, mapped to proto', async () => {
    // The repository is responsible for ordering (KNN GiST); we return
    // pre-sorted rows and assert the handler doesn't shuffle them.
    const rows = [
      makeRow('u-near', 51.5074, -0.1278, 50),
      makeRow('u-mid', 51.51, -0.13, 600),
      makeRow('u-far', 51.55, -0.05, 6000),
    ];
    const spy = vi.spyOn(repo, 'nearestK').mockResolvedValue(rows);
    const handlers = createHandlers({ db: fakeDb });

    const result = await new Promise<NearestKResponse>((resolve, reject) => {
      handlers.nearestK(
        call<NearestKRequest>({
          origin: { lat: 51.508, lng: -0.128 },
          tier: GeoV1.ServiceTier.FIRE,
          status: GeoV1.UnitStatus.AVAILABLE,
          k: 3,
        }),
        (err, res) => (err ? reject(err) : resolve(res as NearestKResponse)),
      );
    });

    expect(result.results.map((r) => r.unitId)).toEqual(['u-near', 'u-mid', 'u-far']);
    expect(result.results[0]?.distanceM).toBe(50);
    expect(result.results[0]?.tier).toBe(GeoV1.ServiceTier.FIRE);
    expect(result.results[0]?.status).toBe(GeoV1.UnitStatus.AVAILABLE);
    expect(result.results[0]?.location).toEqual({ lat: 51.5074, lng: -0.1278 });

    spy.mockRestore();
  });

  it('caps k at SERVER_MAX_K (50)', async () => {
    const spy = vi.spyOn(repo, 'nearestK').mockResolvedValue([]);
    const handlers = createHandlers({ db: fakeDb });

    await new Promise<void>((resolve, reject) => {
      handlers.nearestK(
        call<NearestKRequest>({
          origin: { lat: 0, lng: 0 },
          tier: GeoV1.ServiceTier.UNSPECIFIED,
          status: GeoV1.UnitStatus.UNSPECIFIED,
          k: 1_000_000,
        }),
        (err) => (err ? reject(err) : resolve()),
      );
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1].k).toBe(SERVER_MAX_K);

    spy.mockRestore();
  });

  it('uses a floor of 1 when k is zero (proto3 default)', async () => {
    const spy = vi.spyOn(repo, 'nearestK').mockResolvedValue([]);
    const handlers = createHandlers({ db: fakeDb });

    await new Promise<void>((resolve, reject) => {
      handlers.nearestK(
        call<NearestKRequest>({
          origin: { lat: 0, lng: 0 },
          tier: GeoV1.ServiceTier.UNSPECIFIED,
          status: GeoV1.UnitStatus.UNSPECIFIED,
          k: 0,
        }),
        (err) => (err ? reject(err) : resolve()),
      );
    });

    expect(spy.mock.calls[0]?.[1].k).toBe(1);

    spy.mockRestore();
  });

  it('rejects a missing origin with INVALID_ARGUMENT', async () => {
    const handlers = createHandlers({ db: fakeDb });

    type ErrLike = { code?: number } | null;
    const err = await new Promise<ErrLike>((resolve) => {
      handlers.nearestK(
        call<NearestKRequest>({
          origin: undefined,
          tier: GeoV1.ServiceTier.UNSPECIFIED,
          status: GeoV1.UnitStatus.UNSPECIFIED,
          k: 1,
        }),
        (e) => resolve(e as ErrLike),
      );
    });

    expect(err?.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it('translates tier + status filters to repository vocabulary', async () => {
    const spy = vi.spyOn(repo, 'nearestK').mockResolvedValue([]);
    const handlers = createHandlers({ db: fakeDb });

    await new Promise<void>((resolve, reject) => {
      handlers.nearestK(
        call<NearestKRequest>({
          origin: { lat: 1, lng: 2 },
          tier: GeoV1.ServiceTier.MEDICAL,
          status: GeoV1.UnitStatus.AVAILABLE,
          k: 5,
        }),
        (err) => (err ? reject(err) : resolve()),
      );
    });

    expect(spy.mock.calls[0]?.[1]).toMatchObject({
      origin: { lat: 1, lng: 2 },
      tier: 'medical',
      status: 'available',
      k: 5,
    });

    spy.mockRestore();
  });
});
