import config from '../src/config-loader';
import { AutoBumper } from '../src/autobumper';
import { Router } from '../src/router';

jest.mock('../src/config-loader');
jest.mock('../src/autobumper');

beforeEach(() => {
  jest.resetAllMocks();
});

test('invalid event name', async () => {
  const router = new Router(config, {});
  expect(AutoBumper).toHaveBeenCalledTimes(1);

  const eventName = 'not-a-real-event';
  await expect(router.route(eventName)).rejects.toThrowError(
    `Unknown event type '${eventName}', only 'push' and 'pull_request' are supported.`,
  );

  const autoBumpInstance = (AutoBumper as jest.Mock).mock.instances[0];
  expect(autoBumpInstance.handlePush).toHaveBeenCalledTimes(0);
  expect(autoBumpInstance.handlePullRequest).toHaveBeenCalledTimes(0);
});

test('"push" events', async () => {
  const router = new Router(config, {});
  expect(AutoBumper).toHaveBeenCalledTimes(1);

  await router.route('push');

  const autoBumpInstance = (AutoBumper as jest.Mock).mock.instances[0];
  expect(autoBumpInstance.handlePush).toHaveBeenCalledTimes(1);
});

test('"pull_request" events', async () => {
  const router = new Router(config, {});
  expect(AutoBumper).toHaveBeenCalledTimes(1);

  await router.route('pull_request');

  const autoBumpInstance = (AutoBumper as jest.Mock).mock.instances[0];
  expect(autoBumpInstance.handlePullRequest).toHaveBeenCalledTimes(1);
});
