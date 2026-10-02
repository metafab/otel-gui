import { defineEnvVars } from '@sveltejs/kit/env'

export const variables = defineEnvVars({
  OTEL_GUI_CORS_ALLOWED_ORIGINS: { schema: (input) => input ?? '' },
  OTEL_GUI_MAX_TRACES: { schema: (input) => input ?? '' },
  OTEL_GUI_MAX_LOGS: { schema: (input) => input ?? '' },
  OTEL_GUI_MAX_METRICS: { schema: (input) => input ?? '' },
  OTEL_GUI_MAX_METRIC_POINTS: { schema: (input) => input ?? '' },
  OTEL_GUI_PERSISTENCE_MODE: { schema: (input) => input ?? '' },
  OTEL_GUI_PERSISTENCE_PATH: { schema: (input) => input ?? '' },
  OTEL_GUI_PERSISTENCE_FLUSH_MS: { schema: (input) => input ?? '' },
  OTEL_GUI_PERSISTENCE_BACKEND_MODULE: { schema: (input) => input ?? '' },
  OTEL_GUI_LICENSE_KEY: { schema: (input) => input ?? '' },
  OTEL_GUI_LICENSE_PUBLIC_KEY_PEM: { schema: (input) => input ?? '' },
  OTEL_GUI_LICENSE_PUBLIC_KEY_PATH: { schema: (input) => input ?? '' },
  OTEL_GUI_LICENSE_CLOCK_SKEW_SEC: { schema: (input) => input ?? '' },
})
