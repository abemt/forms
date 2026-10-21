import './polyfill.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { jobManager } from './services/jobManager.js';
import { createLogger } from './logger.js';
import { initExports } from './services/reportExports.js';
import { initQuarterly } from './services/quarterlyReports.js';
import { initVoice } from './services/voice/transcriber.js';

const log = createLogger('server');

async function main(): Promise<void> {
  await jobManager.init();
  await initExports();
  await initQuarterly();
  await initVoice();
  const app = createApp();
  app.listen(config.port, () => {
    log.info(`Form 680 AutoNotes server listening on http://localhost:${config.port}`);
    log.info(`data dir: ${config.dataDir}`);
    log.info(
      `AI: ${config.ai.model} @ ${config.ai.baseUrl} (${config.ai.apiKey ? 'key set' : 'NO KEY SET'})`,
    );
  });
}

main().catch((err) => {
  log.error(`fatal: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
