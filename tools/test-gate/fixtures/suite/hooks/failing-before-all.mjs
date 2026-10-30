// Loaded only by the runHook profile of generate.cucumber.mjs: a run hook (BeforeAll) that fails.
import { BeforeAll } from '@cucumber/cucumber';

BeforeAll(() => {
  throw new Error('fixture run hook failure');
});
