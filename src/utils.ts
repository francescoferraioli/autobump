import { SemVer } from 'semver';
import {
  AutoBumperResult,
  AutoBumpLabel,
  Bump,
  PackageInPullRequest,
  PackageInRepo,
  PackageToBump,
} from './types';

export const BUMP_VALUES = ['major', 'minor', 'patch'] as const;

export const stringifyAutoBumpResult = (result: AutoBumperResult) => {
  const branches = Object.keys(result);
  return branches.length
    ? branches
        .map(
          (branch) =>
            `${branch}:${result[branch].map(stringifyPackageToBump).join(';')}`,
        )
        .join('#')
    : '';
};

export const stringifyPackageToBump = ({
  name,
  path,
  bump,
  version,
}: PackageToBump) => [name, path, bump, version].join('|');

export const getNextVersion = (baseVersion: string, bump: Bump): string => {
  const constructSemVer = (
    major: number,
    minor: number,
    patch: number,
  ): string => [major, minor, patch].join('.');

  const { major, minor, patch } = new SemVer(baseVersion);
  switch (bump) {
    case 'major':
      return constructSemVer(major + 1, 0, 0);
    case 'minor':
      return constructSemVer(major, minor + 1, 0);
    case 'patch':
      return constructSemVer(major, minor, patch + 1);
    default:
      return assertUnreachable(bump);
  }
};

export const mapToPackageToBump = (
  { bump, path, name }: PackageInPullRequest,
  version: string,
): PackageToBump => ({
  bump,
  name,
  path,
  version,
});

export const mapToPackageInPullRequest = (autoBumpLabels: AutoBumpLabel[]) => (
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

export const parseAutoBumpLabel = (
  label: string,
): AutoBumpLabel | undefined => {
  let labelParts = label.split('-');
  if (labelParts.length !== 2 && labelParts.length !== 3) {
    return undefined;
  }

  if (labelParts.length === 2) {
    labelParts = [labelParts[0], 'default', labelParts[1]];
  }

  const [autoBump, packageName, bump] = labelParts;

  if (autoBump !== 'autobump') {
    return undefined;
  }

  if (!BUMP_VALUES.includes(bump as any)) {
    return undefined;
  }

  return {
    packageName,
    bump: bump as Bump,
  };
};

export const filterUndefined = <T>(items: (T | undefined)[]): T[] =>
  items.filter((x) => x !== undefined).map((x) => x!);

export const choose = <T, R>(items: T[], fn: (t: T) => R | undefined): R[] =>
  filterUndefined(items.map(fn));

export const assertUnreachable = (_: never): never => {
  throw new Error("Didn't expect to get here");
};
