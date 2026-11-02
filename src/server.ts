import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const { app, store } = await buildApp({ config });

const sweeper = setInterval(() => store.sweep(), Math.min(config.sessionTtlMs, 60_000));
sweeper.unref();

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  clearInterval(sweeper);
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'shutdown failed');
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
}
