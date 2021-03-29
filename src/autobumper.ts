import * as github from '@actions/github';
import { GitHub } from '@actions/github/lib/utils';
import * as ghCore from '@actions/core';
import * as octokit from '@octokit/types';
import { ConfigLoader } from './config-loader';
import { lt } from 'semver';
import {
  AutoBumperResult,
  AutoBumpLabel,
  PackageInPullRequest,
  PackageToBump,
} from 'types';
import {
  createRunResult,
  createSkipResult,
  filterUndefined,
  getNextVersion,
  mapToAutoBumpLabel,
  mapToPackageInPullRequest,
  mapToPackageToBump,
  stringifyPackageToBump,
} from 'utils';

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

    return results.length === 0 ? createSkipResult() : createRunResult(results);
  }

  async getPackagesToBump(
    pull: octokit.PullsUpdateResponseData,
  ): Promise<PackageToBump[]> {
    const { ref } = pull.head;
    ghCore.info(`Evaluating pull request #${pull.number}...`);

    const packagesInPullRequest = await this.getPackagesInPullRequest(pull);

    const baseBranchName = pull.base.ref;
    const branchName = pull.head.ref;

    const packagesToBump = filterUndefined(
      await Promise.all(
        packagesInPullRequest.map(
          this.checkIfBumpIsNeeded(baseBranchName, branchName),
        ),
      ),
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

    const autoBumpLabels: AutoBumpLabel[] = filterUndefined(
      pull.labels
        .map(({ name }) => name)
        .filter((label) => label.startsWith('autobump'))
        .map(mapToAutoBumpLabel),
    );

    const packagesInRepo = this.config.packagesInRepo();

    return filterUndefined(
      packagesInRepo.map(mapToPackageInPullRequest(autoBumpLabels)),
    );
  }

  checkIfBumpIsNeeded(baseBranch: string, prBranch: string) {
    return async (
      packageInPullRequest: PackageInPullRequest,
    ): Promise<PackageToBump | undefined> => {
      const path = `${packageInPullRequest.path}/package.json`;
      const baseVersion = await this.getPackageVersion(baseBranch, path);
      const prVersion = await this.getPackageVersion(prBranch, path);
      ghCore.info(packageInPullRequest.name);
      ghCore.info(`${baseBranch}: ${baseVersion}`);
      ghCore.info(`${prBranch}: ${prVersion}`);

      if (lt(baseVersion, prVersion)) {
        return undefined;
      }

      return mapToPackageToBump(
        prBranch,
        packageInPullRequest,
        getNextVersion(baseVersion, packageInPullRequest.bump),
      );
    };
  }

  getPackageVersion(ref: string, path: string): Promise<string> {
    return this.getFileContents(ref, path)
      .then(JSON.parse)
      .then(({ version }) => version);
  }

  getFileContents(ref: string, path: string): Promise<string> {
    return this.octokit.repos
      .getContent({
        owner: this.eventData.repository.owner.name,
        repo: this.eventData.repository.name,
        ref,
        path,
      })
      .then((result) => Buffer.from(result.data.content, 'base64').toString());
  }
}
