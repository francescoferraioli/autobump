import * as github from '@actions/github';
import { GitHub } from '@actions/github/lib/utils';
import * as ghCore from '@actions/core';
import * as octokit from '@octokit/types';
import {
  ConfigLoader,
  PackageToCheckInRepo as PackageToCheckInRepo,
} from './config-loader';

interface MergeOpts {
  owner: string;
  repo: string;
  base: string;
  head: string;
  commit_message?: string;
}

export interface AutoBumperResult {
  run?: PackageToBump[];
}

export interface PackageToBump {
  branch: string;
  name: string;
  path: string;
  bump: string;
  version: string;
}

export function stringifyPackageToBump({
  branch,
  name,
  path,
  bump,
  version,
}: PackageToBump) {
  return [branch, name, path, bump, version].join('|');
}

export function createSkipResult(): AutoBumperResult {
  return {};
}

export function createRunResult(run: PackageToBump[]): AutoBumperResult {
  return {
    run,
  };
}

export class AutoBumper {
  eventData: any;
  config: ConfigLoader;
  octokit: InstanceType<typeof GitHub>;

  constructor(
    config: ConfigLoader,
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    eventData: any,
  ) {
    this.eventData = eventData;
    this.config = config;
    this.octokit = github.getOctokit(this.config.githubToken());
  }

  async handlePush(): Promise<AutoBumperResult> {
    const { ref, repository } = this.eventData;

    ghCore.info(`Handling push event on ref '${ref}'`);

    if (!ref.startsWith('refs/heads/')) {
      ghCore.warning('Push event was not on a branch, skipping.');
      return createSkipResult();
    }

    const baseBranch = ref.replace('refs/heads/', '');

    let results: PackageToBump[] = [];
    const paginatorOpts = this.octokit.pulls.list.endpoint.merge({
      owner: repository.owner.name,
      repo: repository.name,
      base: baseBranch,
      state: 'open',
      sort: 'updated',
      direction: 'desc',
    });

    let pullsPage: octokit.OctokitResponse<any>;
    for await (pullsPage of this.octokit.paginate.iterator(paginatorOpts)) {
      let pull: octokit.PullsUpdateResponseData;
      for (pull of pullsPage.data) {
        ghCore.startGroup(`PR-${pull.number}`);
        results = [...results, ...(await this.getPackagesToBump(pull))];
        ghCore.endGroup();
      }
    }

    ghCore.info(
      `Auto bump complete, ${results.length} pull request(s) that point to base branch '${baseBranch}' were updated.`,
    );

    return results.length === 0 ? createSkipResult() : createRunResult(results);
  }

  async getPackagesToBump(
    pull: octokit.PullsUpdateResponseData,
  ): Promise<PackageToBump[]> {
    const { ref } = pull.head;
    ghCore.info(`Evaluating pull request #${pull.number}...`);

    const packagesToCheckInPullRequest = await this.getPackagesToCheckInPullRequest(
      pull,
    );

    const branchName = pull.head.ref;

    // TODO: Get the content of the package json and see if it needs to be bumped

    const packagesToBump = packagesToCheckInPullRequest.map(
      this.mapToPackageToBump(branchName),
    );

    if (this.config.dryRun()) {
      ghCore.warning(
        `Would have bumped packages ${packagesToBump.map(
          stringifyPackageToBump,
        )} for branch ${branchName}`,
      );
      return [];
    }

    return packagesToBump;
  }

  mapToPackageToBump(branch: string) {
    return ({
      bump,
      path,
      name,
    }: PackageToCheckInPullRequest): PackageToBump => {
      return {
        branch,
        bump,
        name,
        path,
        version: '1.0.0',
      };
    };
  }

  async getPackagesToCheckInPullRequest(
    pull: octokit.PullsUpdateResponseData,
  ): Promise<PackageToCheckInPullRequest[]> {
    if (pull.merged === true) {
      ghCore.warning('Skipping pull request, already merged.');
      return [];
    }
    if (pull.state !== 'open') {
      ghCore.warning(
        `Skipping pull request, no longer open (current state: ${pull.state}).`,
      );
      return [];
    }
    if (!pull.head.repo) {
      ghCore.warning(
        `Skipping pull request, fork appears to have been deleted.`,
      );
      return [];
    }

    const packagesToCheck = this.config.packagesToCheckInRepo();

    const autoBumpLabels: AutoBumpLabel[] = pull.labels
      .map(({ name }) => name)
      .filter((label) => label.startsWith('autobump'))
      .map(mapToAutoBumpLabel)
      .filter((x) => x !== undefined)
      .map((x) => x!);

    return packagesToCheck
      .map((packageToCheck) => {
        const autoBumpLabel = autoBumpLabels.find(
          ({ packageName }) => packageName === packageToCheck.name,
        );
        if (!autoBumpLabel) {
          return undefined;
        }

        return {
          ...packageToCheck,
          bump: autoBumpLabel.bump,
        };
      })
      .filter((x) => x !== undefined)
      .map((x) => x!);
  }
}

function mapToAutoBumpLabel(label: string): AutoBumpLabel | undefined {
  let labelParts = label.split('-');
  if (labelParts.length !== 2 && labelParts.length !== 3) {
    return undefined;
  }

  if (labelParts.length === 2) {
    labelParts = [labelParts[0], 'default', labelParts[1]];
  }

  const [, packageName, bump] = labelParts;

  if (!['major', 'minor', 'patch'].includes(bump)) {
    return undefined;
  }

  return {
    packageName,
    bump,
  };
}

export interface AutoBumpLabel {
  packageName: string;
  bump: string;
}

export type PackageToCheckInPullRequest = PackageToCheckInRepo & {
  bump: string;
};
