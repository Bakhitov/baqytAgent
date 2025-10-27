
import 'dotenv/config';

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

export const mastra = new Mastra({
  agents: { baqytAgent },
  scorers: baqytScorers,
  storage: postgresStore,
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
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
