import * as github from '@actions/github';
import { GitHub } from '@actions/github/lib/utils';
import * as ghCore from '@actions/core';
import * as octokit from '@octokit/types';
import { ConfigLoader } from './config-loader';
import { lte } from 'semver';
import {
  AutoBumperResult,
  AutoBumpLabel,
  PackageInPullRequest,
  PackageToBump,
} from './types';
import {
  choose,
  filterUndefined,
  getNextVersion,
  parseAutoBumpLabel,
  mapToPackageInPullRequest,
  mapToPackageToBump,
  stringifyPackageToBump,
} from './utils';

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
    ghCore.info(`Event Data'${JSON.stringify(this.eventData)}'`);
  }

  async handlePush(): Promise<AutoBumperResult> {
    let result: AutoBumperResult = {};

    const { ref, repository } = this.eventData;

    ghCore.info(`Handling push event on ref '${ref}'`);

    if (!ref.startsWith('refs/heads/')) {
      ghCore.warning('Push event was not on a branch, skipping.');
      return result;
    }

    const baseBranch = ref.replace('refs/heads/', '');

    const paginatorOpts = this.octokit.pulls.list.endpoint.merge({
      owner: repository.owner.login,
      repo: repository.name,
      base: baseBranch,
      state: 'open',
      sort: 'updated',
      direction: 'desc',
    });

    ghCore.info(
      `Getting pull requests for Owner: '${repository.owner.login}' Repo: '${repository.name}' Base: '${baseBranch}'`,
    );

    let pullsPage: octokit.OctokitResponse<any>;
    for await (pullsPage of this.octokit.paginate.iterator(paginatorOpts)) {
      let pull: octokit.PullsUpdateResponseData;
      for (pull of pullsPage.data) {
        const branchName = pull.head.ref;
        ghCore.startGroup(`PR-${pull.number}: ${branchName}`);
        const packagesToBump = await this.getPackagesToBump(pull);
        if (packagesToBump.length) {
          result = { ...result, [branchName]: packagesToBump };
        }
        ghCore.endGroup();
      }
    }

    return result;
  }

  async handlePullRequest(): Promise<AutoBumperResult> {
    const { action } = this.eventData;

    ghCore.info(`Handling pull_request event triggered by action '${action}'`);

    const packagesToBump = await this.getPackagesToBump(
      this.eventData.pull_request,
    );

    return packagesToBump.length
      ? { [this.eventData.pull_request.head.ref]: packagesToBump }
      : {};
  }

  async getPackagesToBump(
    pull: octokit.PullsUpdateResponseData,
  ): Promise<PackageToBump[]> {
    const baseBranchName = pull.base.ref;
    const branchName = pull.head.ref;

    const labels = this.config.filterLabels();
    if (
      labels.length !== 0 &&
      pull.labels.filter(({ name }) => labels.includes(name)).length !==
        labels.length
    ) {
      ghCore.warning(
        `Skipping branch '${branchName}' because it didn't include labels '${labels.join(
          ',',
        )}'`,
      );
      return [];
    }

    ghCore.info(`Evaluating pull request #${pull.number}...`);

    ghCore.info(`START: Getting packages in pull request`);
    const packagesInPullRequest = await this.getPackagesInPullRequest(pull);
    ghCore.info(`FINISH: getting packages in pull request`);

    ghCore.info(`START: Check if bump is needed`);
    const packagesToBump = filterUndefined(
      await Promise.all(
        packagesInPullRequest.map(
          this.checkIfBumpIsNeeded(baseBranchName, branchName),
        ),
      ),
    );
    ghCore.info(`END: Check if bump is needed`);

    if (this.config.dryRun()) {
      ghCore.warning(
        `Would have bumped packages ${packagesToBump.map(
          stringifyPackageToBump,
        )} for branch ${branchName}`,
      );
      return [];
    }

    ghCore.info(
      `Pull request has the following packages to bump: ${packagesToBump
        .map(stringifyPackageToBump)
        .join('|')}`,
    );
    return packagesToBump;
  }

  async getPackagesInPullRequest(
    pull: octokit.PullsUpdateResponseData,
  ): Promise<PackageInPullRequest[]> {
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

    ghCore.info(
      `Pull request has the following labels: ${pull.labels
        .map(({ name }) => name)
        .join('|')}`,
    );
    const autoBumpLabels: AutoBumpLabel[] = choose(
      pull.labels.map(({ name }) => name),
      parseAutoBumpLabel,
    );

    ghCore.info(
      `Pull request has the following auto bump labels: ${autoBumpLabels
        .map(({ packageName, bump }) => `${packageName}-${bump}`)
        .join('|')}`,
    );
    const packagesInRepo = this.config.packagesInRepo();

    const packagesInPullRequest = choose(
      packagesInRepo,
      mapToPackageInPullRequest(autoBumpLabels),
    );
    ghCore.info(
      `Pull request has the following packages in pull request: ${packagesInPullRequest
        .map(({ name, bump, path }) => `${name}-${bump}-${path}`)
        .join('|')}`,
    );
    return packagesInPullRequest;
  }

  checkIfBumpIsNeeded(baseBranch: string, prBranch: string) {
    return async (
      packageInPullRequest: PackageInPullRequest,
    ): Promise<PackageToBump | undefined> => {
      const path = `${packageInPullRequest.path}/package.json`;
      const baseVersion = await this.getPackageVersion(baseBranch, path);
      const prVersion = await this.getPackageVersion(prBranch, path);

      ghCore.info(packageInPullRequest.name);

      if (!baseVersion) {
        ghCore.error(`${baseBranch}: Package version is undefined`);
        return undefined;
      }
      if (!prVersion) {
        ghCore.error(`${prBranch}: Package version is undefined`);
        return undefined;
      }

      const nextVersion = getNextVersion(
        baseVersion,
        packageInPullRequest.bump,
      );

      ghCore.info(`${baseBranch}: ${baseVersion}`);
      ghCore.info(`${prBranch}: ${prVersion}`);
      ghCore.info(`Next Version: ${nextVersion}`);

      if (lte(nextVersion, prVersion)) {
        return undefined;
      }

      return mapToPackageToBump(packageInPullRequest, nextVersion);
    };
  }

  getPackageVersion(ref: string, path: string): Promise<string | undefined> {
    return this.getFileContents(ref, path)
      .then(JSON.parse)
      .then(({ version }) => version)
      .catch((e) => {
        ghCore.error(
          `Error occurred getting version for Ref: '${ref}' Path: '${path}' Owner: '${this.eventData.repository.owner.login}' Repo: '${this.eventData.repository.name}'`,
        );
        ghCore.error(e);
        throw e;
      });
  }

  getFileContents(ref: string, path: string): Promise<string> {
    return this.octokit.repos
      .getContent({
        owner: this.eventData.repository.owner.login,
        repo: this.eventData.repository.name,
        ref,
        path,
      })
      .then((result) => Buffer.from(result.data.content, 'base64').toString());
  }
}
