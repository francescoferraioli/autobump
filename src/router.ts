import { AutoBumperResult } from './types';
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
   * @returns {Promise<AutoBumperResult>}
   */
  async route(eventName: string | undefined): Promise<AutoBumperResult> {
    if (eventName === 'push') {
      return await this.bumper.handlePush();
    } else {
      throw new Error(
        `Unknown event type '${eventName}', only 'push' is supported.`,
      );
    }
  }
}
