import { AutoBumpLabel } from '../src/types';
import { choose, filterUndefined, parseAutoBumpLabel } from '../src/utils';

describe('filterUndefined', () => {
  test('does not remove any if there are none', async () => {
    const input = [1, 2, 3];
    const output = filterUndefined(input);
    expect(output).toStrictEqual(input);
  });

  test('does remove the undefined values if there are some', async () => {
    const input = [1, undefined, 2, undefined, 3, undefined];
    const output = filterUndefined(input);
    expect(output).toStrictEqual([1, 2, 3]);
  });

  test('does remove them all if they are all undefined', async () => {
    const input = [undefined, undefined, undefined];
    const output = filterUndefined(input);
    expect(output).toStrictEqual([]);
  });
});

describe('choose', () => {
  test('it maps correctly and removes the undefined', async () => {
    const input = [1, 2, 3];
    const output = choose(input, (x) => (x > 1 ? x * 10 : undefined));
    expect(output).toStrictEqual([20, 30]);
  });
});

describe('parseAutoBumpLabel', () => {
  const invalid: string[] = [
    'test',
    'minor',
    'major',
    'test-major',
    'autobump-test',
    'autobump-test-not',
    'autobumpy-patch',
    'autobumpy-test-patch',
  ];

  invalid.forEach((input) => {
    test(`it returns undefined if not correct format: ${input}`, async () => {
      const output = parseAutoBumpLabel(input);
      expect(output).toBeUndefined();
    });
  });

  const valid: { input: string; expected: AutoBumpLabel }[] = [
    {
      input: 'autobump-patch',
      expected: {
        packageName: 'default',
        bump: 'patch',
      },
    },
    {
      input: 'autobump-minor',
      expected: {
        packageName: 'default',
        bump: 'minor',
      },
    },
    {
      input: 'autobump-major',
      expected: {
        packageName: 'default',
        bump: 'major',
      },
    },
    {
      input: 'autobump-domain-patch',
      expected: {
        packageName: 'domain',
        bump: 'patch',
      },
    },
    {
      input: 'autobump-domain-minor',
      expected: {
        packageName: 'domain',
        bump: 'minor',
      },
    },
    {
      input: 'autobump-domain-major',
      expected: {
        packageName: 'domain',
        bump: 'major',
      },
    },
  ];

  valid.forEach(({ input, expected }) => {
    test(`it parsers the label correctly: ${input}`, async () => {
      const output = parseAutoBumpLabel(input);
      expect(output).toStrictEqual(expected);
    });
  });
});
