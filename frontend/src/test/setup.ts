import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// RTL's auto-cleanup relies on detecting a global `afterEach`, which Vitest
// only provides when `test.globals` is enabled. We deliberately keep
// `globals` off (explicit `import { ... } from 'vitest'` in every test file
// avoids touching tsconfig's `types` array), so cleanup is wired up by hand.
afterEach(() => {
  cleanup();
});
