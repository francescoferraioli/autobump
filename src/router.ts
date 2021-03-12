import { AutoBumper } from '../src/autobumper';
import { ConfigLoader } from '../src/config-loader';

export class Router {
  eventData: any;
  bumper: AutoBumper;

  constructor(
    config: ConfigLoader,
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    eventData: any,
  ) {
    this.bumper = new AutoBumper(config, eventData);
  }

  /**
   * Route a Github event to a handler.
   *
   * @param eventName
   * @returns {Promise<void>}
   */
  async route(eventName: string | undefined): Promise<void> {
    if (eventName === 'pull_request') {
      await this.bumper.handlePullRequest();
    } else if (eventName === 'push') {
      await this.bumper.handlePush();
    } else {
      throw new Error(
        `Unknown event type '${eventName}', only 'push' and 'pull_request' are supported.`,
      );
    }
  }
}
