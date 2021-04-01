#!/usr/bin/env node
import * as fs from 'fs';
import * as ghCore from '@actions/core';

import { Router } from '../src/router';
import config from '../src/config-loader';
import { stringifyAutoBumpResult } from '../src/utils';

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const eventName = process.env.GITHUB_EVENT_NAME;

  const rawEventData = fs.readFileSync(<any>eventPath, 'utf8');
  const eventData = JSON.parse(rawEventData);

  ghCore.debug(`EVENT NAME: ${eventName}`);
  ghCore.debug(`EVENT DATA: ${rawEventData}`);

  if (config.dryRun()) {
    ghCore.info(
      'Detected DRY_RUN=true, running in dry mode - no merges will be made.',
    );
  }

  const router = new Router(config, eventData);
  const result = await router.route(eventName);
  setOutput('AUTOBUMP_RUN', stringifyAutoBumpResult(result));
}

function setOutput(name: string, value: string) {
  console.log(`::set-output name=${name}::${value}`);
}

if (require.main === module) {
  main().catch((e) => {
    process.exitCode = 1;
    ghCore.setFailed(e.message);
  });
}
