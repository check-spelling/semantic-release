const path = require('path');
const test = require('ava');
const proxyquire = require('proxyquire');
const {escapeRegExp} = require('lodash');
const {writeJson, readJson} = require('fs-extra');
const execa = require('execa');
const {WritableStreamBuffer} = require('stream-buffers');
const delay = require('delay');
const getAuthUrl = require('../lib/get-git-auth-url');
const {SECRET_REPLACEMENT} = require('../lib/definitions/constants');
const {
  gitHead,
  gitTagHead,
  gitRepo,
  gitCommits,
  gitRemoteTagHead,
  gitPush,
  gitCheckout,
  merge,
  gitGetNote,
} = require('./helpers/git-utils');
const {npmView} = require('./helpers/npm-utils');
const gitbox = require('./helpers/gitbox');
const mockServer = require('./helpers/mockserver');
const npmRegistry = require('./helpers/npm-registry');
const envCi = require('env-ci');

envCi.branch = function(options)
{
  console.warn(`envCi.branch => master!\n`);
  return 'master';
}

/* eslint camelcase: ["error", {properties: "never"}] */

const requireNoCache = proxyquire.noPreserveCache();

// Environment variables used with semantic-release cli (similar to what a user would setup)
const env = {
  ...npmRegistry.authEnv,
  GH_TOKEN: gitbox.gitCredential,
  GITHUB_URL: mockServer.url,
  TRAVIS: 'true',
  CI: 'true',
  TRAVIS_BRANCH: 'master',
  TRAVIS_PULL_REQUEST: 'false',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_EVENT_PATH: null,
  GITHUB_ACTION: null,
};
// Environment variables used only for the local npm command used to do verification
const testEnv = {
  ...process.env,
  ...npmRegistry.authEnv,
  npm_config_registry: npmRegistry.url,
  LEGACY_TOKEN: Buffer.from(`${env.NPM_USERNAME}:${env.NPM_PASSWORD}`, 'utf8').toString('base64'),
};

const cli = require.resolve('../bin/semantic-release');
const pluginError = require.resolve('./fixtures/plugin-error');
const pluginInheritedError = require.resolve('./fixtures/plugin-error-inherited');
const pluginLogEnv = require.resolve('./fixtures/plugin-log-env');

test.before(async () => {
  await Promise.all([gitbox.start(), npmRegistry.start(), mockServer.start()]);
});

test.after.always(async () => {
  await Promise.all([gitbox.stop(), npmRegistry.stop(), mockServer.stop()]);
});

test('Allow local releases with "noCi" option', async (t) => {
  const envNoCi = {...env};
  delete envNoCi.TRAVIS;
  delete envNoCi.CI;
  const packageName = 'test-no-ci';
  const owner = 'git';
  // Create a git repository, set the current working directory at the root of the repo
  t.log('Create git repository and package.json');
  const {cwd, repositoryUrl, authUrl} = await gitbox.createRepo(packageName);
  // Create package.json in repository root
  await writeJson(path.resolve(cwd, 'package.json'), {
    name: packageName,
    version: '0.0.0-dev',
    repository: {url: repositoryUrl},
    publishConfig: {registry: npmRegistry.url},
    release: {success: false, fail: false},
  });

  /* Initial release */
  const version = '1.0.0';
  const verifyMock = await mockServer.mock(
    `/repos/${owner}/${packageName}`,
    {headers: [{name: 'Authorization', values: [`token ${env.GH_TOKEN}`]}]},
    {body: {permissions: {push: true}}, method: 'GET'}
  );
  const createReleaseMock = await mockServer.mock(
    `/repos/${owner}/${packageName}/releases`,
    {
      body: {tag_name: `v${version}`, name: `v${version}`},
      headers: [{name: 'Authorization', values: [`token ${env.GH_TOKEN}`]}],
    },
    {body: {html_url: `release-url/${version}`}}
  );

  t.log('Commit a feature');
  await gitCommits(['feat: Initial commit'], {cwd});
  t.log('$ semantic-release --no-ci');
  const {stdout, exitCode} = await execa(cli, ['--no-ci'], {env: envNoCi, cwd});
  t.regex(stdout, new RegExp(`Published GitHub release: release-url/${version}`));
  t.regex(stdout, new RegExp(`Publishing version ${version} to npm registry`));
  t.is(exitCode, 0);

  // Verify package.json and has been updated
  t.is((await readJson(path.resolve(cwd, 'package.json'))).version, version);

  // Retrieve the published package from the registry and check version and gitHead
  const {version: releasedVersion, gitHead: releasedGitHead} = await npmView(packageName, testEnv);

  const head = await gitHead({cwd});
  t.is(releasedVersion, version);
  t.is(releasedGitHead, head);
  t.is(await gitTagHead(`v${version}`, {cwd}), head);
  t.is(await gitRemoteTagHead(authUrl, `v${version}`, {cwd}), head);
  t.log(`+ released ${releasedVersion} with head ${releasedGitHead}`);

  await mockServer.verify(verifyMock);
  await mockServer.verify(createReleaseMock);
});
