
import 'dotenv/config';

import { LogLevel } from '@mastra/core/logger';
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import {
  CloudExporter,
  DefaultExporter,
  SensitiveDataFilter,
  SamplingStrategyType,
} from '@mastra/core/ai-tracing';
import { baqytAgent } from './agents/baqyt-agent';
import { scorers as baqytScorers } from './scorers/baqyt-scorer';
import { postgresStore } from './storage/postgres';

type MastraLogLevel = (typeof LogLevel)[keyof typeof LogLevel];
const LOG_LEVELS = new Set<MastraLogLevel>(Object.values(LogLevel) as MastraLogLevel[]);

const resolveLogLevel = (): MastraLogLevel => {
  const rawLevel = process.env.LOG_LEVEL?.toLowerCase() as MastraLogLevel | undefined;
  if (rawLevel && LOG_LEVELS.has(rawLevel)) {
    return rawLevel;
  }

  return process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO;
};

export const mastra = new Mastra({
  agents: { baqytAgent },
  scorers: baqytScorers,
  storage: postgresStore,
  server: {
    build: {
      swaggerUI: true,
      openAPIDocs: true,
    },
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: resolveLogLevel(),
  }),
  telemetry: {
    enabled: false,
  },
  observability: {
    default: { enabled: false },
    configs: {
      default: {
        serviceName: 'baqyt-agent',
        sampling: { type: SamplingStrategyType.ALWAYS },
        runtimeContextKeys: ['userId', 'threadId', 'customerRequest'],
        processors: [new SensitiveDataFilter()],
        exporters: [new DefaultExporter(), new CloudExporter()],
      },
    },
  },
});
