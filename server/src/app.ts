import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { aiAvailable, config, resolveEngine } from './config.js';
import { errorHandler, jobsRouter, templateRouter } from './routes/jobs.js';
import { exportsRouter } from './routes/exports.js';
import { quarterlyRouter } from './routes/quarterly.js';
import { importsRouter } from './routes/imports.js';
import { logWriterRouter } from './routes/logWriter.js';
import { voiceRouter } from './routes/voice.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    const engine = resolveEngine();
    res.json({
      ok: true,
      engine,
      aiConfigured: aiAvailable(),
      model: engine === 'ai' ? config.ai.model : 'built-in rules (no AI)',
    });
  });

  app.use('/api/jobs', jobsRouter());
  app.use('/api/exports', exportsRouter());
  app.use('/api/quarterly', quarterlyRouter());
  app.use('/api/imports', importsRouter());
  app.use('/api/log-writer', logWriterRouter());
  app.use('/api/voice', voiceRouter());
  app.use('/api/templates', templateRouter());
  app.use(errorHandler());

  // Serve the built frontend in production.
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  }

  return app;
}
