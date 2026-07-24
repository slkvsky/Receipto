import * as Sentry from '@sentry/react-native'

const PII_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // email
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // card number
  /\bIBAN\s*:\s*[A-Z]{2}\d{2}[A-Z0-9]{4,}\b/gi, // IBAN
]

function redactPii(value: unknown): string {
  let str = typeof value === 'string' ? value : JSON.stringify(value)
  for (const pattern of PII_PATTERNS) str = str.replace(pattern, '[REDACTED]')
  return str
}

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    enableNative: true,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip any request body that might contain receipt OCR or financial data
      if (event.request) {
        delete event.request.data
        delete event.request.cookies
      }
      return event
    },
  })
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (dsn) {
    Sentry.captureException(error, { extra: context })
  } else {
    // Dev-only fallback; never logs PII in production because dsn is always set there
    const safe = context ? redactPii(context) : undefined
    console.error('[dev]', error, safe)
  }
}

export function captureMessage(message: string, context?: Record<string, unknown>): void {
  if (dsn) {
    Sentry.captureMessage(message, { extra: context })
  } else {
    // Dev-only fallback; redact PII the same way captureException does.
    const safe = context ? redactPii(context) : undefined
    console.warn('[dev]', message, safe)
  }
}
