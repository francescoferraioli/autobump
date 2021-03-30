import { ConfigLoader } from '../src/config-loader';
import { PackageInRepo } from '../src/types';

const tests = [
  {
    name: 'githubToken',
    envVar: 'GITHUB_TOKEN',
    required: true,
    default: null,
    type: 'string',
  },
  {
    name: 'dryRun',
    envVar: 'DRY_RUN',
    required: false,
    default: false,
    type: 'bool',
  },
  {
    name: 'packagesInRepo',
    envVar: 'PACKAGES_IN_REPO',
    required: true,
    type: 'package-list',
  },
];

for (const testDef of tests) {
  test(`test that '${testDef.name}' returns the correct environment value`, () => {
    // All environment variables are technically strings.
    let dummyValue: string;
    let expectedValue: string | number | boolean | string[] | PackageInRepo[];
    switch (testDef.type) {
      case 'string':
        dummyValue = 'some-dummy-value';
        expectedValue = dummyValue;
        break;

      case 'int':
        dummyValue = '42';
        expectedValue = 42;
        break;

      case 'bool':
        dummyValue = 'true';
        expectedValue = true;
        break;

      case 'list':
        dummyValue = ' one,two ,three';
        expectedValue = ['one', 'two', 'three'];
        break;

      case 'package-list':
        dummyValue =
          'default|;domain|packages/domain;contracts|packages/contracts';
        expectedValue = [
          {
            name: 'default',
            path: '',
          },
          {
            name: 'domain',
            path: 'packages/domain',
          },
          {
            name: 'contracts',
            path: 'packages/contracts',
          },
        ];
        break;

      default:
        fail(
          `Unknown config test '${testDef.type}' for function '${testDef.name}'`,
        );
    }

    process.env[testDef.envVar] = dummyValue;
    const config = new ConfigLoader();
    // Ignore noImplicitAny so we can invoke the function by string index.
    // @ts-ignore
    const value = config[testDef.name]();
    expect(value).toEqual(expectedValue);

    // Restore environment.
    delete process.env[testDef.envVar];
  });

  if (testDef.required) {
    test(`test that '${testDef.name}' throws an error if an env var is not defined`, () => {
      const config = new ConfigLoader();
      expect(() => {
        // Ignore noImplicitAny so we can invoke the function by string index.
        // @ts-ignore
        config[testDef.name]();
      }).toThrowError(
        `Environment variable '${testDef.envVar}' was not provided, please define it and try again.`,
      );
    });
  } else {
    test(`test that '${testDef.name}' returns its default value if an env var is not defined`, () => {
      const config = new ConfigLoader();
      // Ignore noImplicitAny so we can invoke the function by string index.
      // @ts-ignore
      const value = config[testDef.name]();
      expect(value).toEqual(testDef.default);
    });
  }
}
