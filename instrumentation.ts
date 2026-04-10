import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');

    // Startup log: legacy self-hosted auth cookie migration window
    if (process.env.TAXHACKER_SELF_HOSTED === 'true') {
      const { LEGACY_AUTH_CUTOFF } = await import('./lib/self-hosted-auth');
      const now = Date.now();
      const cutoff = LEGACY_AUTH_CUTOFF.getTime();
      if (now < cutoff) {
        const daysUntilCutoff = Math.ceil((cutoff - now) / (1000 * 60 * 60 * 24));
        console.log(
          `[TaxHacker] Legacy auth cookie migration window: ${daysUntilCutoff} days remaining. ` +
          `After ${LEGACY_AUTH_CUTOFF.toISOString().split('T')[0]}, old SHA-256 cookies will be rejected.`
        );
      } else {
        console.log('[TaxHacker] Legacy auth cookie cutoff date has passed. Only new HMAC tokens accepted.');
      }
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
