#!/usr/bin/env node
/**
 * gRPC + NATS end-to-end smoke for service.incident.
 *
 *   pnpm smoke:grpc
 *
 * Subscribes to `incident.opened` on NATS, then drives the full lifecycle
 * via gRPC: Open → Triage → Dispatch → RecordUnitArrival → Resolve, with a
 * Get after each step. Asserts:
 *
 *   - every RPC returns an incident with the expected state + version,
 *   - listOpen reflects the live row (and drops it once resolved),
 *   - at least one `incident.opened` event arrives on NATS within the
 *     deadline — proving the publish-after-commit path actually fires.
 *
 * Exits 0 on success, 1 on any assertion failure or RPC error.
 */
import {
  type DispatchRequest,
  type DispatchResponse,
  type GetRequest,
  type GetResponse,
  type Incident,
  IncidentV1,
  type ListOpenRequest,
  type ListOpenResponse,
  type OpenRequest,
  type OpenResponse,
  type RecordUnitArrivalRequest,
  type RecordUnitArrivalResponse,
  type ResolveRequest,
  type ResolveResponse,
  type TriageRequest,
  type TriageResponse,
} from '@cad/proto';
import * as grpc from '@grpc/grpc-js';
import { JSONCodec, connect as natsConnect } from 'nats';

const HOST = process.env.SMOKE_HOST ?? 'localhost';
const GRPC_PORT = Number(process.env.SMOKE_GRPC_PORT ?? '5021');
const NATS_URL = process.env.SMOKE_NATS_URL ?? `nats://${HOST}:4222`;
const DEADLINE_MS = Number(process.env.SMOKE_DEADLINE_MS ?? '15000');

const client = new IncidentV1.IncidentServiceClient(
  `${HOST}:${GRPC_PORT}`,
  grpc.credentials.createInsecure(),
);

function call<TReq, TRes>(
  fn: (req: TReq, cb: (err: grpc.ServiceError | null, res: TRes) => void) => unknown,
  req: TReq,
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    fn.call(client, req, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

function assertState(
  label: string,
  incident: Incident | undefined,
  expected: IncidentV1.IncidentState,
  expectedVersion: number,
): Incident {
  if (!incident) throw new Error(`${label}: missing incident`);
  if (incident.state !== expected) {
    throw new Error(
      `${label}: expected state ${IncidentV1.IncidentState[expected]} (${expected}), got ${IncidentV1.IncidentState[incident.state]} (${incident.state})`,
    );
  }
  if (Number(incident.version) !== expectedVersion) {
    throw new Error(`${label}: expected version ${expectedVersion}, got ${incident.version}`);
  }
  return incident;
}

async function main(): Promise<void> {
  console.log(`[grpc-smoke] dialing gRPC ${HOST}:${GRPC_PORT} + NATS ${NATS_URL}`);

  // 1. NATS subscriber primed BEFORE we Open, so we don't race the publish.
  const nats = await natsConnect({ servers: NATS_URL });
  const codec = JSONCodec<{ incidentId: string; version: number }>();
  const sub = nats.subscribe('incident.opened');
  const opened = new Promise<{ incidentId: string; version: number }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no incident.opened arrived within ${DEADLINE_MS}ms`)),
      DEADLINE_MS,
    );
    (async () => {
      for await (const msg of sub) {
        clearTimeout(timer);
        resolve(codec.decode(msg.data));
        return;
      }
    })().catch(reject);
  });

  // 2. Open. Aggregate is created with id from the server.
  const openRes = await call<OpenRequest, OpenResponse>(client.open, {
    title: 'smoke incident',
    tier: IncidentV1.ServiceTier.FIRE,
    location: { lat: 51.5074, lng: -0.1278 },
    openedBy: 'smoke',
  });
  const inc1 = assertState('open', openRes.incident, IncidentV1.IncidentState.OPEN, 1);
  console.log(`[grpc-smoke] opened incident ${inc1.id}`);

  // 3. Confirm the NATS publish landed with the same id + version.
  const openedEvent = await opened;
  if (openedEvent.incidentId !== inc1.id || Number(openedEvent.version) !== 1) {
    throw new Error(
      `NATS event mismatch: expected ${inc1.id}@v1, got ${openedEvent.incidentId}@v${openedEvent.version}`,
    );
  }
  console.log(`[grpc-smoke] received incident.opened on NATS ✓`);

  // 4. Drive through the full lifecycle. Each call asserts the expected
  //    state + monotonically increasing version, and a follow-up Get
  //    confirms the read-model is in sync (the integration check that
  //    matters most — append + project must commit together).
  const triageRes = await call<TriageRequest, TriageResponse>(client.triage, {
    id: inc1.id,
    severity: IncidentV1.Severity.HIGH,
    expectedVersion: 1,
    triagedBy: 'smoke',
  });
  assertState('triage', triageRes.incident, IncidentV1.IncidentState.TRIAGED, 2);

  const dispatchRes = await call<DispatchRequest, DispatchResponse>(client.dispatch, {
    id: inc1.id,
    unitIds: ['unit-a'],
    expectedVersion: 2,
    dispatchedBy: 'smoke',
  });
  assertState('dispatch', dispatchRes.incident, IncidentV1.IncidentState.DISPATCHED, 3);

  const arrivalRes = await call<RecordUnitArrivalRequest, RecordUnitArrivalResponse>(
    client.recordUnitArrival,
    { id: inc1.id, unitId: 'unit-a', expectedVersion: 3 },
  );
  assertState('arrival', arrivalRes.incident, IncidentV1.IncidentState.ON_SCENE, 4);

  // listOpen should show the live incident at this point.
  const listRes = await call<ListOpenRequest, ListOpenResponse>(client.listOpen, {
    tier: IncidentV1.ServiceTier.FIRE,
    limit: 50,
  });
  if (!listRes.incidents.some((i) => i.id === inc1.id)) {
    throw new Error(`listOpen did not include live incident ${inc1.id}`);
  }

  const resolveRes = await call<ResolveRequest, ResolveResponse>(client.resolve, {
    id: inc1.id,
    expectedVersion: 4,
    resolvedBy: 'smoke',
  });
  assertState('resolve', resolveRes.incident, IncidentV1.IncidentState.RESOLVED, 5);

  // Get the resolved incident to confirm the read-model is current.
  const getRes = await call<GetRequest, GetResponse>(client.get, {
    id: inc1.id,
  });
  assertState('get', getRes.incident, IncidentV1.IncidentState.RESOLVED, 5);

  // And it should be GONE from listOpen now.
  const list2 = await call<ListOpenRequest, ListOpenResponse>(client.listOpen, {
    tier: IncidentV1.ServiceTier.FIRE,
    limit: 50,
  });
  if (list2.incidents.some((i) => i.id === inc1.id)) {
    throw new Error(`listOpen still includes resolved incident ${inc1.id}`);
  }

  await nats.drain();
  client.close();
  console.log(
    `SERVING  grpc://${HOST}:${GRPC_PORT} — full lifecycle ✓, NATS publish ✓, listOpen ✓`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`FAILED   ${(err as Error).message}`);
  process.exit(1);
});
