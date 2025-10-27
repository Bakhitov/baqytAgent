
import 'dotenv/config';

import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import {
  CloudExporter,
  DefaultExporter,
  SensitiveDataFilter,
  SamplingStrategyType,
} from '@mastra/core/ai-tracing';
import { baqytAgent } from './agents/baqyt-agent';
import { scorers as baqytScorers } from './scorers/baqyt-scorer';

export const mastra = new Mastra({
  agents: { baqytAgent },
  scorers: baqytScorers,
  storage: new LibSQLStore({
    // stores observability, scores, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
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
