import * as github from '@actions/github';
import { GitHub } from '@actions/github/lib/utils';
import * as ghCore from '@actions/core';
import * as octokit from '@octokit/types';
import { ConfigLoader, PackageInRepo as PackageInRepo } from './config-loader';
import { lt, SemVer } from 'semver';

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

    const packagesToBump = (
      await Promise.all(
        packagesInPullRequest.map(
          this.checkIfBumpIsNeeded(baseBranchName, branchName),
        ),
      )
    )
      .filter((x) => x !== undefined)
      .map((x) => x!);

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

    const packagesToRepo = this.config.packagesInRepo();

    const autoBumpLabels: AutoBumpLabel[] = pull.labels
      .map(({ name }) => name)
      .filter((label) => label.startsWith('autobump'))
      .map(mapToAutoBumpLabel)
      .filter((x) => x !== undefined)
      .map((x) => x!);

    return packagesToRepo
      .map(mapToPackageInPullRequest(autoBumpLabels))
      .filter((x) => x !== undefined)
      .map((x) => x!);
  }
}

function getNextVersion(baseVersion: string, bump: string): string {
  const { major, minor, patch } = new SemVer(baseVersion);
  const versions: [number, string][] = [
    [major, 'major'],
    [minor, 'minor'],
    [patch, 'patch'],
  ];
  return versions
    .map(([current, expectedBump]) => bumpIf(current, expectedBump, bump))
    .join('.');
}

function bumpIf(
  current: number,
  expectedBump: string,
  actualBump: string,
): number {
  return expectedBump === actualBump ? current + 1 : current;
}

function mapToPackageToBump(
  branch: string,
  { bump, path, name }: PackageInPullRequest,
  version: string,
): PackageToBump {
  return {
    branch,
    bump,
    name,
    path,
    version,
  };
}

const mapToPackageInPullRequest = (autoBumpLabels: AutoBumpLabel[]) => (
  packageInRepo: PackageInRepo,
) => {
  const autoBumpLabel = autoBumpLabels.find(
    ({ packageName }) => packageName === packageInRepo.name,
  );
  if (!autoBumpLabel) {
    return undefined;
  }

  return {
    ...packageInRepo,
    bump: autoBumpLabel.bump,
  };
};

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

export type PackageInPullRequest = PackageInRepo & {
  bump: string;
};
