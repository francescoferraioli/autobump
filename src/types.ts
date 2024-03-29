import { BUMP_VALUES } from './utils';

export interface PackageInRepo {
  name: string;
  path: string;
}

export type Bump = typeof BUMP_VALUES[number];

export interface AutoBumperResult {
  [branch: string]: PackageToBump[];
}

export interface PackageToBump {
  name: string;
  path: string;
  bump: Bump;
  version: string;
}

export interface AutoBumpLabel {
  packageName: string;
  bump: Bump;
}

export type PackageInPullRequest = PackageInRepo & {
  bump: Bump;
};
