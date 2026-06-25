import Anthropic from '@anthropic-ai/sdk';
import Instructor from '@instructor-ai/instructor';
import type { IStructuredExtractor, ExtractOptions } from '@tacv/core/interfaces';
import type { z } from 'zod';

export class ClaudeStructuredExtractor implements IStructuredExtractor {
  private readonly instructor: ReturnType<typeof Instructor>;
  private readonly defaultModel: string;

  constructor(config: { apiKey: string; defaultModel?: string }) {
    const client = new Anthropic({ apiKey: config.apiKey });
    this.instructor   = Instructor({ client, mode: 'TOOLS' });
    this.defaultModel = config.defaultModel ?? 'claude-haiku-4-5-20251001';
  }

  async extract<T extends z.ZodType>(prompt: string, schema: T, options: ExtractOptions): Promise<z.infer<T>> {
    return this.instructor.chat.completions.create({
      model:          options.model ?? this.defaultModel,
      max_retries:    options.maxRetries ?? 3,
      messages:       [{ role: 'user', content: prompt }],
      ...(options.system ? { system: options.system } : {}),
      response_model: { schema, name: 'output' },
    } as never);
  }
}
