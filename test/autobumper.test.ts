// Workaround for tests attempting to hit the GH API if running in an env where
// this variable is automatically set.
if ('GITHUB_TOKEN' in process.env) {
  delete process.env.GITHUB_TOKEN;
}

import nock from 'nock';
import config from '../src/config-loader';
import { AutoBumper } from '../src/autobumper';
import { PullsUpdateResponseData } from '@octokit/types';
import { SemVer } from 'semver';
import {
  Bump,
  PackageInPullRequest,
  PackageInRepo,
  PackageToBump,
} from '../src/types';

jest.mock('../src/config-loader');

class TestPackage {
  readonly name: string;
  readonly path: string;
  readonly ref: string;
  readonly version: SemVer;

  constructor(name: string, path: string, ref: string, version: SemVer) {
    this.name = name;
    this.path = path;
    this.ref = ref;
    this.version = version;
  }

  withVersion(version: SemVer): TestPackage {
    return new TestPackage(this.name, this.path, this.ref, version);
  }

  withRef(ref: string): TestPackage {
    return new TestPackage(this.name, this.path, ref, this.version);
  }

  toPackageJson(): string {
    return `
    {
      "name": "${this.name}",
      "version": "${this.version.major}.${this.version.minor}.${this.version.patch}"
    }
    `;
  }

  registerInGithub(): void {
    nock('https://api.github.com:443')
      .get(
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(
          this.path + '/package.json',
        )}?ref=${this.ref}`,
      )
      .reply(200, {
        content: new Buffer(this.toPackageJson()).toString('base64'),
      });
  }

  toPackageInRepo(): PackageInRepo {
    return {
      name: this.name,
      path: this.path,
    };
  }

  toPackageInPullRequest(bump: Bump): PackageInPullRequest {
    return {
      ...this.toPackageInRepo(),
      bump,
    };
  }

  toPackageToBump(bump: Bump, version: string): PackageToBump {
    return {
      ...this.toPackageInRepo(),
      bump,
      version,
    };
  }
}

const owner = 'francescoferraioli';
const repo = 'not-a-real-repo';
const base = 'master';
const head = 'develop';
const dummyEvent = {
  ref: `refs/heads/${base}`,
  repository: {
    owner: {
      name: owner,
    },
    name: repo,
  },
};

const defaultPackage: TestPackage = new TestPackage(
  'default',
  '',
  base,
  new SemVer('1.0.0'),
);

const domainPackage: TestPackage = new TestPackage(
  'domain',
  '/packages/domain',
  base,
  new SemVer('1.0.0'),
);

const contractsPackage: TestPackage = new TestPackage(
  'contracts',
  '/packages/contracts',
  base,
  new SemVer('1.0.0'),
);

const createPull = (
  overrides: Partial<PullsUpdateResponseData>,
): PullsUpdateResponseData => {
  const defaultPull: PullsUpdateResponseData = ({
    number: 1,
    merged: false,
    state: 'open',
    labels: [
      {
        id: 1,
        name: 'autobump-major',
      },
      {
        id: 2,
        name: 'autobump-domain-minor',
      },
      {
        id: 2,
        name: 'autobump-contracts-patch',
      },
    ],
    base: {
      ref: base,
      label: base,
    },
    head: {
      label: head,
      ref: head,
      repo: {
        name: repo,
        owner: {
          login: owner,
        },
      },
    },
  } as unknown) as PullsUpdateResponseData;

  return {
    ...defaultPull,
    ...overrides,
  };
};

const createPullWithLabels = (labels: string[]): PullsUpdateResponseData =>
  createPull({
    labels: labels.map(
      (name, id) =>
        (({
          id,
          name,
        } as any) as PullsUpdateResponseData['labels'][number]),
    ),
  });

const createPullForRefWithLabels = (
  ref: string,
  labels: string[],
): PullsUpdateResponseData =>
  createPull({
    head: {
      label: ref,
      ref: ref,
      repo: {
        name: repo,
        owner: {
          login: owner,
        },
      },
    } as any,
    labels: labels.map(
      (name, id) =>
        (({
          id,
          name,
        } as any) as PullsUpdateResponseData['labels'][number]),
    ),
  });

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(config, 'githubToken').mockImplementation(() => 'test-token');
  jest
    .spyOn(config, 'packagesInRepo')
    .mockImplementation(() => [
      defaultPackage.toPackageInRepo(),
      domainPackage.toPackageInRepo(),
      contractsPackage.toPackageInRepo(),
    ]);
});

afterEach(() => {
  nock.cleanAll();
});

describe('test `getPackageVersion`', () => {
  test('default package', async () => {
    const testPackage = defaultPackage.withVersion(new SemVer('1.2.3'));
    testPackage.registerInGithub();

    const bumper = new AutoBumper(config, dummyEvent);
    const version = await bumper.getPackageVersion(
      testPackage.ref,
      testPackage.path + '/package.json',
    );
    expect(version).toBe('1.2.3');
  });

  test('domain package', async () => {
    const testPackage = domainPackage.withVersion(new SemVer('3.2.1'));
    testPackage.registerInGithub();

    const bumper = new AutoBumper(config, dummyEvent);
    const version = await bumper.getPackageVersion(
      testPackage.ref,
      testPackage.path + '/package.json',
    );
    expect(version).toBe('3.2.1');
  });
});

describe('test `checkIfBumpIsNeeded`', () => {
  test('head package behind', async () => {
    const basePackage = defaultPackage.withVersion(new SemVer('1.2.3'));
    basePackage.registerInGithub();
    const headPackage = defaultPackage
      .withVersion(new SemVer('1.2.2'))
      .withRef(head);
    headPackage.registerInGithub();

    const bumper = new AutoBumper(config, dummyEvent);
    const packageToBump = await bumper.checkIfBumpIsNeeded(
      base,
      head,
    )(defaultPackage.toPackageInPullRequest('major'));
    expect(packageToBump).toBeDefined();
    expect(packageToBump).toStrictEqual(
      defaultPackage.toPackageToBump('major', '2.0.0'),
    );
  });

  test('head package ahead', async () => {
    const basePackage = defaultPackage.withVersion(new SemVer('1.2.3'));
    basePackage.registerInGithub();
    const headPackage = defaultPackage
      .withVersion(new SemVer('2.0.0'))
      .withRef(head);
    headPackage.registerInGithub();

    const bumper = new AutoBumper(config, dummyEvent);
    const packageToBump = await bumper.checkIfBumpIsNeeded(
      base,
      head,
    )(defaultPackage.toPackageInPullRequest('major'));
    expect(packageToBump).toBeUndefined();
  });

  test('head package same as base', async () => {
    const basePackage = defaultPackage.withVersion(new SemVer('2.0.0'));
    basePackage.registerInGithub();
    const headPackage = defaultPackage
      .withVersion(new SemVer('2.0.0'))
      .withRef(head);
    headPackage.registerInGithub();

    const bumper = new AutoBumper(config, dummyEvent);
    const packageToBump = await bumper.checkIfBumpIsNeeded(
      base,
      head,
    )(defaultPackage.toPackageInPullRequest('major'));
    expect(packageToBump).toBeDefined();
    expect(packageToBump).toStrictEqual(
      defaultPackage.toPackageToBump('major', '3.0.0'),
    );
  });
});

describe('test `getPackagesInPullRequest`', () => {
  test('Skips merged', async () => {
    const bumper = new AutoBumper(config, dummyEvent);
    const packages = await bumper.getPackagesInPullRequest(
      createPull({ merged: true }),
    );
    expect(packages).toStrictEqual([]);
  });

  test('Skips closed', async () => {
    const bumper = new AutoBumper(config, dummyEvent);
    const packages = await bumper.getPackagesInPullRequest(
      createPull({ state: 'closed' }),
    );
    expect(packages).toStrictEqual([]);
  });

  test('Get correct packages with default labels', async () => {
    const bumper = new AutoBumper(config, dummyEvent);
    const packages = await bumper.getPackagesInPullRequest(createPull({}));
    expect(packages).toStrictEqual([
      defaultPackage.toPackageInPullRequest('major'),
      domainPackage.toPackageInPullRequest('minor'),
      contractsPackage.toPackageInPullRequest('patch'),
    ]);
  });

  const tests: { labels: string[]; packages: PackageInPullRequest[] }[] = [
    {
      labels: ['autobump'],
      packages: [],
    },
    {
      labels: ['autobump-patch'],
      packages: [defaultPackage.toPackageInPullRequest('patch')],
    },
    {
      labels: ['autobump-default-minor'],
      packages: [defaultPackage.toPackageInPullRequest('minor')],
    },
    {
      labels: ['autobump-domain-major'],
      packages: [domainPackage.toPackageInPullRequest('major')],
    },
    {
      labels: [
        'autobump-minor',
        'autobump-domain-patch',
        'autobump-contracts-major',
      ],
      packages: [
        defaultPackage.toPackageInPullRequest('minor'),
        domainPackage.toPackageInPullRequest('patch'),
        contractsPackage.toPackageInPullRequest('major'),
      ],
    },
  ];

  tests.forEach(({ labels, packages }) => {
    test(`Get correct packages with labels (${labels.join('|')})`, async () => {
      const bumper = new AutoBumper(config, dummyEvent);
      const actual = await bumper.getPackagesInPullRequest(
        createPullWithLabels(labels),
      );
      expect(actual).toStrictEqual(packages);
    });
  });
});

describe('test `getPackagesToBump`', () => {
  test('Skips merged', async () => {
    const bumper = new AutoBumper(config, dummyEvent);
    const packages = await bumper.getPackagesToBump(
      createPull({ merged: true }),
    );
    expect(packages).toStrictEqual([]);
  });

  test('Skips closed', async () => {
    const bumper = new AutoBumper(config, dummyEvent);
    const packages = await bumper.getPackagesToBump(
      createPull({ state: 'closed' }),
    );
    expect(packages).toStrictEqual([]);
  });

  const register = (
    p: TestPackage,
    baseVersion: string,
    headVersion: string,
  ) => {
    p.withVersion(new SemVer(baseVersion)).withRef(base).registerInGithub();
    p.withVersion(new SemVer(headVersion)).withRef(head).registerInGithub();
  };

  test('Get correct packages', async () => {
    register(defaultPackage, '1.2.0', '1.2.0');
    register(domainPackage, '1.2.0', '2.0.0');
    register(contractsPackage, '3.2.0', '2.2.1');
    const bumper = new AutoBumper(config, dummyEvent);
    const packages = await bumper.getPackagesToBump(
      createPullWithLabels([
        'autobump-minor',
        'autobump-domain-major',
        'autobump-contracts-patch',
      ]),
    );
    expect(packages).toStrictEqual([
      defaultPackage.toPackageToBump('minor', '1.3.0'),
      contractsPackage.toPackageToBump('patch', '3.2.1'),
    ]);
  });
});

describe('test `handlePush`', () => {
  const register = (
    p: TestPackage,
    baseVersion: string,
    featureOneVersion: string,
    featureTwoVersion: string,
  ) => {
    p.withVersion(new SemVer(baseVersion)).withRef(base).registerInGithub();
    p.withVersion(new SemVer(featureOneVersion))
      .withRef('feature-one')
      .registerInGithub();
    p.withVersion(new SemVer(baseVersion)).withRef(base).registerInGithub();
    p.withVersion(new SemVer(featureTwoVersion))
      .withRef('feature-two')
      .registerInGithub();
  };

  test('Get correct packages', async () => {
    register(defaultPackage, '1.2.0', '1.2.0', '1.2.0');
    register(domainPackage, '1.2.0', '2.1.0', '1.2.0');
    register(contractsPackage, '3.2.0', '2.2.1', '3.0.0');
    nock('https://api.github.com:443')
      .get(
        `/repos/${owner}/${repo}/pulls?base=${base}&state=open&sort=updated&direction=desc`,
      )
      .reply(200, [
        createPullForRefWithLabels('feature-one', [
          'autobump-minor',
          'autobump-domain-patch',
        ]),
        createPullForRefWithLabels('feature-two', [
          'autobump-minor',
          'autobump-contracts-major',
        ]),
      ]);
    defaultPackage.registerInGithub();
    const bumper = new AutoBumper(config, dummyEvent);
    const result = await bumper.handlePush();

    expect(result).toStrictEqual({
      'feature-one': [defaultPackage.toPackageToBump('minor', '1.3.0')],
      'feature-two': [
        defaultPackage.toPackageToBump('minor', '1.3.0'),
        contractsPackage.toPackageToBump('major', '4.0.0'),
      ],
    });
  });
});

describe('test `handlePullRequest`', () => {
  const register = (
    p: TestPackage,
    baseVersion: string,
    headVersion: string,
  ) => {
    p.withVersion(new SemVer(baseVersion)).withRef(base).registerInGithub();
    p.withVersion(new SemVer(headVersion)).withRef(head).registerInGithub();
  };

  test('Get correct packages', async () => {
    register(defaultPackage, '1.2.0', '1.2.0');
    register(domainPackage, '1.2.0', '2.0.0');
    register(contractsPackage, '3.2.0', '2.2.1');
    const bumper = new AutoBumper(config, {
      ...dummyEvent,
      action: 'opened',
      pull_request: createPullWithLabels([
        'autobump-minor',
        'autobump-domain-major',
        'autobump-contracts-patch',
      ]),
    });
    const result = await bumper.handlePullRequest();
    expect(result).toStrictEqual({
      [head]: [
        defaultPackage.toPackageToBump('minor', '1.3.0'),
        contractsPackage.toPackageToBump('patch', '3.2.1'),
      ],
    });
  });
});
