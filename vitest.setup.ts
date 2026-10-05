// Global test setup for component tests (they opt in to jsdom with a per-file environment comment).
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
