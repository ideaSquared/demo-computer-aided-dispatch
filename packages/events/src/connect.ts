import { type NatsConnection, connect as natsConnect } from 'nats';

/**
 * Connect to a NATS server. Convention: services call this once at startup
 * and reuse the returned connection for `publish` / `subscribe`.
 *
 *   const nats = await connect(config.NATS_URL);
 *   await publish({ nats }, ...);
 */
export async function connect(url: string): Promise<NatsConnection> {
  return natsConnect({ servers: url });
}

export type { NatsConnection } from 'nats';
