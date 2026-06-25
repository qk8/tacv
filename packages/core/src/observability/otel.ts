import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let sdk: NodeSDK | null = null;

export function initOtel(): void {
  if (!process.env['OTEL_EXPORTER_OTLP_ENDPOINT']) return;
  sdk = new NodeSDK({
    resource: new Resource({ [SEMRESATTRS_SERVICE_NAME]: 'tacv' }),
    traceExporter: new OTLPTraceExporter({ url: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  process.on('SIGTERM', () => void sdk?.shutdown());
  process.on('SIGINT',  () => void sdk?.shutdown());
}
