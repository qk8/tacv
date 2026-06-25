import type { z } from 'zod';

export interface ExtractOptions {
  readonly model?:      string;
  readonly maxRetries?: number;
  readonly system?:     string;
}

export interface IStructuredExtractor {
  extract<T extends z.ZodType>(
    prompt:  string,
    schema:  T,
    options: ExtractOptions,
  ): Promise<z.infer<T>>;
}
