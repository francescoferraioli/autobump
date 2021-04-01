# autobump

Inspired and originally based off [chinthakagodawita/autoupdate](https://github.com/chinthakagodawita/autoupdate) but for the purposes of bumping npm packages.

For a sample repo please see [francescoferraioli/autobump-test](https://github.com/francescoferraioli/autobump-test)

The autobump is undertaken in 3 steps:
1. Auto Bump Check: 
2. Checkout Code
3. Auto Bump Run

This repo contains the code for steps 1 [( "Auto Bump Check" )](#auto-bump-check) and 3 [( "Auto Bump Run" )](#auto-bump-run). Step 2 ( "Checkout Code" ) is solved by [actions/checkout@v2](https://github.com/actions/checkout).

## Auto Bump Check

Will run a docker image that uses github api to work out which branches need updating and which packages and to what version.

The starting point for this is [Dockerfile](Dockerfile).

The code path from there is then:
- [bin/cli.ts](bin/cli.ts)
- [src/router.ts](src/router.ts)
- [src/autobumper.ts](src/autobumper.ts)

The output of the step is the `AUTOBUMP_RUN` which will contain a magic string to be consumed by the "Auto Bump Run" step.

The format of `AUTOBUMP_RUN` is the following for each branch (seperated by `#`):
```
{{BRANCH_NAME}}:{{BRANCH_DATA}}
```

The format of `BRANCH_DATA` is the following for each package that needs to be bumped (seperated by `;`):
```
{{PACKAGE_NAME}}|{{PACKAGE_PATH}}|{{(major|minor|patch)}}|{{NEXT_VERSION}}
```

Example `AUTOBUMP_RUN`:
```
first-feature:default||major|3.0.0;contracts|/packages/contracts|patch|1.2.3#second-feature:default||major|3.0.0;domain|/packages/domain|minor|3.2.0
```

### Test

You can run tests with:
```
yarn test
```

### Deploy

The deployment of this step is by simply deploying the docker image.

#### Unstable:

Run:
```
scripts/build-test.sh
```

Deploys to: `francescoferraioli/autobump-action-unstable`

#### stable:

Run:
```
scripts/build-prod.sh
```

Deploys to: `francescoferraioli/autobump-action-stable`

## Auto Bump Run

This is a "composite" action declared in [action.yml](action.yml).

It has three steps:
1. Setup npm
2. Run Auto Bump Script

The important step is 2 ( "Run Auto Bump Script" ) which will take the `AUTOBUMP_RUN` variable as an input and actually undertake the version bumps, commit and push. The code for this is in [auto-bump-script.sh](auto-bump-script.sh).

### Test

It is just a declaration of a "composite" action and a script, there are no tests.

### Deploy

The deployment of the "composite" action is done via git tags.

```
git tag -a -m "Description of this release" v{{RELEASE_NUMBER}}
git push --follow-tags
```

## Usage

Lets say you have a mono repo set up like the following:
```
- package.json
|- packages/
 |- domain/
  |- package.json
 |- contracts/
  |- package.json
```

You can create a workflow like the one below:

```
name: autobump
on:
  push:
     branches:
       - main
  pull_request:
     types: [opened, labeled]
     branches:
       - main
jobs:
  autobump:
    name: autobump
    runs-on: ubuntu-18.04
    steps:
      - name: Auto Bump Check
        id: autobump-check
        uses: docker://francescoferraioli/autobump-action:v1
        env:
          GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}"
          PACKAGES_IN_REPO: "default|;domain|packages/domain;contracts|packages/contracts"

      - name: Checkout Code
        uses: actions/checkout@v2
        with:
          fetch-depth: 0
          token: "${{ secrets.GITHUB_TOKEN }}"

      - name: Auto Bump Run
        uses: francescoferraioli/autobump@v3
        with:
          AUTOBUMP_RUN: ${{ steps.autobump-check.outputs.AUTOBUMP_RUN }}
```

The format of `PACKAGES_IN_REPO` is a the following for each package (seperated by `;`)
```
{{PACKAGE_NAME}}|{{PACKAGE_PATH}}
```

You now just have to simply label the PR with labels with the following format:
```
autobump-{{package-name}}-{{major|minor|patch}}
```

Now if in your PR you need to bump `major` on the root (`default`) package, `minor` on `domain` and `patch` on `contracts` you label them with:
- `autobump-major`
- `autobump-domain-minor`
- `autobump-contracts-patch`

Note: The `default` package is the one used when the package name is omitted.