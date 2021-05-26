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
      login: owner,
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

const defaultLabels = [
  {
    id: 1,
    name: 'autobump',
  },
  {
    id: 2,
    name: 'autobump-major',
  },
  {
    id: 3,
    name: 'autobump-domain-minor',
  },
  {
    id: 4,
    name: 'autobump-contracts-patch',
  },
];

const createPull = (
  overrides: Partial<PullsUpdateResponseData>,
  skipAutoBump: boolean = false,
): PullsUpdateResponseData => {
  const defaultPull: PullsUpdateResponseData = ({
    number: 1,
    merged: false,
    state: 'open',
    labels: defaultLabels.filter(
      skipAutoBump ? ({ name }) => name !== 'autobump' : () => true,
    ),
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

const createLabels = (
  labels: string[],
  skipAutoBump: boolean = false,
): PullsUpdateResponseData['labels'] =>
  labels.concat(skipAutoBump ? [] : 'autobump').map(
    (name, id) =>
      (({
        id,
        name,
      } as any) as PullsUpdateResponseData['labels'][number]),
  );

const createPullWithLabels = (
  labels: string[],
  skipAutoBump: boolean = false,
): PullsUpdateResponseData =>
  createPull({
    labels: createLabels(labels, skipAutoBump),
  });

const createPullForRefWithLabels = (
  ref: string,
  labels: string[],
  skipAutoBump: boolean = false,
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
    labels: createLabels(labels, skipAutoBump),
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
  jest.spyOn(config, 'filterLabels').mockImplementation(() => ['autobump']);
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
  test('head package behind base', async () => {
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

  test('head package ahead of base but behind next version', async () => {
    const basePackage = defaultPackage.withVersion(new SemVer('1.2.3'));
    basePackage.registerInGithub();
    const headPackage = defaultPackage
      .withVersion(new SemVer('1.3.0'))
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

  test('head package ahead of base', async () => {
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
  const register = (
    p: TestPackage,
    baseVersion: string,
    headVersion: string,
  ) => {
    p.withVersion(new SemVer(baseVersion)).withRef(base).registerInGithub();
    p.withVersion(new SemVer(headVersion)).withRef(head).registerInGithub();
  };

  beforeEach(() => {
    register(defaultPackage, '1.2.0', '1.2.0');
    register(domainPackage, '1.2.0', '1.3.0');
    register(contractsPackage, '3.2.0', '2.2.1');
  });

  const correctPackages = [
    defaultPackage.toPackageToBump('major', '2.0.0'),
    contractsPackage.toPackageToBump('patch', '3.2.1'),
  ];

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

  test('Skips if PR does not contain filter labels', async () => {
    const bumper = new AutoBumper(config, dummyEvent);
    const packages = await bumper.getPackagesToBump(createPull({}, true));
    expect(packages).toStrictEqual([]);
  });

  test('Get correct packages', async () => {
    const bumper = new AutoBumper(config, dummyEvent);
    const packages = await bumper.getPackagesToBump(createPull({}));
    expect(packages).toStrictEqual(correctPackages);
  });

  describe('No filter labels', () => {
    beforeEach(() => {
      jest.spyOn(config, 'filterLabels').mockImplementation(() => []);
    });

    test('Does not skips if we do not have the label', async () => {
      const bumper = new AutoBumper(config, dummyEvent);
      const packages = await bumper.getPackagesToBump(createPull({}, true));
      expect(packages).toStrictEqual(correctPackages);
    });
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
    p.withVersion(new SemVer(baseVersion)).withRef(base).registerInGithub();
    p.withVersion(new SemVer(featureTwoVersion))
      .withRef('feature-two-without-autobump-label')
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
        createPullForRefWithLabels(
          'feature-two-without-autobump-label',
          ['autobump-minor', 'autobump-contracts-major'],
          true,
        ),
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
