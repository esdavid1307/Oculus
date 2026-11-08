// The one rule for "Skip the ad". Shared so the intents module and Intent History agree on what counts as skipping an ad.
const SKIP_AD = /\bskip\b.*\bads?\b/i;

export const isSkipAd = (intent: string) => SKIP_AD.test(intent);
