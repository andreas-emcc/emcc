/**
 * Setup for every shell test. Testing Library's `findBy…` and `waitFor` wait 5 s instead of 1 s:
 * on a loaded machine (a full `tools/test.mjs` run builds and tests the server at the same time)
 * the first render of a large form took just over 1 s.
 */
import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 5_000 });
