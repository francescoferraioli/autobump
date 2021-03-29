import { SemVer } from 'semver';
import {
  AutoBumpLabel,
  Bump,
  PackageInPullRequest,
  PackageInRepo,
  PackageToBump,
} from './types';

export const BUMP_VALUES = ['major', 'minor', 'patch'] as const;

export const stringifyPackageToBump = ({
  name,
  path,
  bump,
  version,
}: PackageToBump) => [name, path, bump, version].join('|');

export const getNextVersion = (baseVersion: string, bump: string): string => {
  const { major, minor, patch } = new SemVer(baseVersion);
  const versions: [number, Bump][] = [
    [major, 'major'],
    [minor, 'minor'],
    [patch, 'patch'],
  ];
  return versions
    .map(([current, expectedBump]) => bumpIf(current, expectedBump, bump))
    .join('.');
};

export const bumpIf = (
  current: number,
  expectedBump: string,
  actualBump: string,
): number => (expectedBump === actualBump ? current + 1 : current);

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
