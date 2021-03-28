export interface PackageInRepo {
  name: string;
  path: string;
}
export class ConfigLoader {
  env: NodeJS.ProcessEnv;

  constructor() {
    this.env = process.env;
  }

  githubToken(): string {
    return this.getValue('GITHUB_TOKEN', true);
  }

  dryRun(): boolean {
    const val = this.getValue('DRY_RUN', false, 'false');
    return val === 'true';
  }

  packagesInRepo(): PackageInRepo[] {
    const packages: string = this.getValue('PACKAGES_IN_REPO', true)
      .toString()
      .trim();
    if (packages === '') {
      return [];
    }
    return packages.split(';').map((p: string) => {
      const [name, path] = p.trim().split('|');
      return {
        name,
        path,
      };
    });
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  getValue(key: string, required = false, defaultVal?: any): any {
    if (
      key in this.env &&
      this.env[key] !== null &&
      this.env[key] !== undefined
    ) {
      return this.env[key];
    }

    if (required) {
      throw new Error(
        `Environment variable '${key}' was not provided, please define it and try again.`,
      );
    }

    return defaultVal;
  }
}

export default new ConfigLoader();
