import { memo } from 'react';

/**
 * Design v3 (clean): the aurora ambient layer is retired. This renders
 * nothing; call sites can keep mounting it harmlessly until they're removed.
 */
export const AuroraBackground = memo(function AuroraBackground() {
  return null;
});
