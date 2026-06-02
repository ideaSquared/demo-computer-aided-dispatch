import Fastify from 'fastify';
import { config } from './config.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

app.get('/health', async () => ({ status: 'ok', service: 'service.geo' }));

const port = config.PORT;
await app.listen({ host: '0.0.0.0', port });
app.log.info({ port, service: 'service.geo' }, 'service started');
