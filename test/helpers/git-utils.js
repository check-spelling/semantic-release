const tempy = require('tempy');
const execa = require('execa');
const fileUrl = require('file-url');
const pEachSeries = require('p-each-series');
const gitLogParser = require('git-log-parser');
const getStream = require('get-stream');
const {GIT_NOTE_REF} = require('../../lib/definitions/constants');

/**
 * Commit message information.
 *
 * @typedef {Object} Commit
 * @property {String} branch The commit branch.
 * @property {String} hash The commit hash.
 * @property {String} message The commit message.
 */

/**
 * Initialize git repository
 * If `withRemote` is `true`, creates a bare repository and initialize it.
 * If `withRemote` is `false`, creates a regular repository and initialize it.
 *
 * @param {Boolean} withRemote `true` to create a shallow clone of a bare repository.
 * @return {String} The path of the repository
 */
async function initGit(withRemote) {
  console.warn(`git-utils.js: initGit\n`);
  const cwd = tempy.directory();
  console.warn(`git-utils.js: initGit cwd: ${cwd}\n`);

  await execa('git', ['init', ...(withRemote ? ['--bare'] : [])], {cwd});
  console.warn(`git-utils.js: initGit git init\n`);
  const repositoryUrl = fileUrl(cwd);
  return {cwd, repositoryUrl};
}

/**
 * Create a temporary git repository.
 * If `withRemote` is `true`, creates a shallow clone. Change the current working directory to the clone root.
 * If `withRemote` is `false`, just change the current working directory to the repository root.
 *
 *
 * @param {Boolean} withRemote `true` to create a shallow clone of a bare repository.
 * @param {String} [branch='master'] The branch to initialize.
 * @return {String} The path of the clone if `withRemote` is `true`, the path of the repository otherwise.
 */
async function gitRepo(withRemote, branch = 'master') {
  console.warn(`git-utils.js: gitRepo (withRemote: ${withRemote}, branch: ${branch})\n`);
  let {cwd, repositoryUrl} = await initGit(withRemote);
  console.warn(`git-utils.js: gitRepo initGit() cwd: ${cwd}, repositoryUrl: ${repositoryUrl}\n`);
  if (withRemote) {
    await initBareRepo(repositoryUrl, branch);
    console.warn(`git-utils.js: gitRepo initBareRepo()\n`);
    cwd = await gitShallowClone(repositoryUrl, branch);
    console.warn(`git-utils.js: gitRepo gitShallowClone(): ${cwd}\n`);
  } else {
    await gitCheckout(branch, true, {cwd});
    console.warn(`git-utils.js: gitRepo gitCheckout()\n`);
  }

  await execa('git', ['config', 'commit.gpgsign', false], {cwd});
  console.warn(`git-utils.js: gitRepo git confi\n`);

  return {cwd, repositoryUrl};
}

/**
 * Initialize an existing bare repository:
 * - Clone the repository
 * - Change the current working directory to the clone root
 * - Create a default branch
 * - Create an initial commits
 * - Push to origin
 *
 * @param {String} repositoryUrl The URL of the bare repository.
 * @param {String} [branch='master'] the branch to initialize.
 */
async function initBareRepo(repositoryUrl, branch = 'master') {
  console.warn(`git-utils.js: initBareRepo (repositoryUrl: ${repositoryUrl}, branch: ${branch})\n`);
  const cwd = tempy.directory();
  console.warn(`git-utils.js: initBareRepo cwd: ${cwd}\n`);
  await execa('git', ['clone', '--no-hardlinks', repositoryUrl, cwd], {cwd});
  console.warn(`git-utils.js: initBareRepo git clone\n`);
  await gitCheckout(branch, true, {cwd});
  console.warn(`git-utils.js: initBareRepo gitCheckout()\n`);
  await gitCommits(['Initial commit'], {cwd});
  console.warn(`git-utils.js: initBareRepo gitCommits()\n`);
  await execa('git', ['push', repositoryUrl, branch], {cwd});
  console.warn(`git-utils.js: initBareRepo git push\n`);
}

/**
 * Create commits on the current git repository.
 *
 * @param {Array<string>} messages Commit messages.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 *
 * @returns {Array<Commit>} The created commits, in reverse order (to match `git log` order).
 */
async function gitCommits(messages, execaOptions) {
  await pEachSeries(
    messages,
    async (message) =>
      (await execa('git', ['commit', '-m', message, '--allow-empty', '--no-gpg-sign'], execaOptions)).stdout
  );
  return (await gitGetCommits(undefined, execaOptions)).slice(0, messages.length);
}

/**
 * Get the list of parsed commits since a git reference.
 *
 * @param {String} [from] Git reference from which to seach commits.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 *
 * @return {Array<Object>} The list of parsed commits.
 */
async function gitGetCommits(from, execaOptions) {
  Object.assign(gitLogParser.fields, {hash: 'H', message: 'B', gitTags: 'd', committerDate: {key: 'ci', type: Date}});
  return (
    await getStream.array(
      gitLogParser.parse(
        {_: `${from ? from + '..' : ''}HEAD`},
        {...execaOptions, env: {...process.env, ...execaOptions.env}}
      )
    )
  ).map((commit) => {
    commit.message = commit.message.trim();
    commit.gitTags = commit.gitTags.trim();
    return commit;
  });
}

/**
 * Checkout a branch on the current git repository.
 *
 * @param {String} branch Branch name.
 * @param {Boolean} create to create the branch, `false` to checkout an existing branch.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 */
async function gitCheckout(branch, create, execaOptions) {
  console.warn(`gitbox.js: gitCheckout(branch: ${branch}, create: ${create}, execaOptions: ${execaOptions})\n`);
  await execa('git', create ? ['checkout', '-b', branch] : ['checkout', branch], execaOptions);
  console.warn(`gitbox.js: gitCheckout git create\n`);
}

/**
 * Fetch current git repository.
 *
 * @param {String} repositoryUrl The repository remote URL.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 */
async function gitFetch(repositoryUrl, execaOptions) {
  console.warn(`gitbox.js: gitFetch(repositoryUrl: ${repositoryUrl}, execaOptions: ${execaOptions})\n`);
  await execa('git', ['fetch', repositoryUrl], execaOptions);
  console.warn(`gitbox.js: gitFetch git fetch\n`);
}

/**
 * Get the HEAD sha.
 *
 * @param {Object} [execaOpts] Options to pass to `execa`.
 *
 * @return {String} The sha of the head commit in the current git repository.
 */
async function gitHead(execaOptions) {
  console.warn(`gitbox.js: gitHead(execaOptions: ${execaOptions})\n`);
  return (await execa('git', ['rev-parse', 'HEAD'], execaOptions)).stdout;
}

/**
 * Create a tag on the head commit in the current git repository.
 *
 * @param {String} tagName The tag name to create.
 * @param {String} [sha] The commit on which to create the tag. If undefined the tag is created on the last commit.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 */
async function gitTagVersion(tagName, sha, execaOptions) {
  console.warn(`gitbox.js: gitTagVersion(tagName: ${tagName}, sha: ${sha}, execaOptions: ${execaOptions})\n`);
  await execa('git', sha ? ['tag', '-f', tagName, sha] : ['tag', tagName], execaOptions);
  console.warn(`gitbox.js: gitTagVersion tag ...\n`);
}

/**
 * Create a shallow clone of a git repository and change the current working directory to the cloned repository root.
 * The shallow will contain a limited number of commit and no tags.
 *
 * @param {String} repositoryUrl The path of the repository to clone.
 * @param {String} [branch='master'] the branch to clone.
 * @param {Number} [depth=1] The number of commit to clone.
 * @return {String} The path of the cloned repository.
 */
async function gitShallowClone(repositoryUrl, branch = 'master', depth = 1) {
  console.warn(`gitbox.js: gitShallowClone(repositoryUrl: ${repositoryUrl}, branch: ${branch}, depth: ${depth})\n`);
  const cwd = tempy.directory();
  console.warn(`gitbox.js: gitShallowClone cwd: ${cwd}\n`);

  await execa('git', ['clone', '--no-hardlinks', '--no-tags', '-b', branch, '--depth', depth, repositoryUrl, cwd], {
    cwd,
  });
  console.warn(`gitbox.js: gitShallowClone git clone\n`);
  return cwd;
}

/**
 * Create a git repo with a detached head from another git repository and change the current working directory to the new repository root.
 *
 * @param {String} repositoryUrl The path of the repository to clone.
 * @param {Number} head A commit sha of the remote repo that will become the detached head of the new one.
 * @return {String} The path of the new repository.
 */
async function gitDetachedHead(repositoryUrl, head) {
  console.warn(`gitbox.js: gitDetachedHead(repositoryUrl: ${repositoryUrl}, head: ${head})\n`);
  const cwd = tempy.directory();
  console.warn(`gitbox.js: gitDetachedHead cwd: ${cwd}\n`);

  await execa('git', ['init'], {cwd});
  console.warn(`gitbox.js: gitDetachedHead init\n`);
  await execa('git', ['remote', 'add', 'origin', repositoryUrl], {cwd});
  console.warn(`gitbox.js: gitDetachedHead remote add origin\n`);
  await execa('git', ['fetch', repositoryUrl], {cwd});
  console.warn(`gitbox.js: gitDetachedHead fetch\n`);
  await execa('git', ['checkout', head], {cwd});
  console.warn(`gitbox.js: gitDetachedHead checkout\n`);
  return cwd;
}

async function gitDetachedHeadFromBranch(repositoryUrl, branch, head) {
  console.warn(`gitbox.js: gitDetachedHeadFromBranch(repositoryUrl: ${repositoryUrl}, branch: ${branch}, head: ${head})\n`);
  const cwd = tempy.directory();
  console.warn(`gitbox.js: gitDetachedHeadFromBranch cwd: ${cwd}\n`);

  await execa('git', ['init'], {cwd});
  console.warn(`gitbox.js: gitDetachedHeadFromBranch init\n`);
  await execa('git', ['remote', 'add', 'origin', repositoryUrl], {cwd});
  console.warn(`gitbox.js: gitDetachedHeadFromBranch remote add origin\n`);
  await execa('git', ['fetch', '--force', repositoryUrl, `${branch}:remotes/origin/${branch}`], {cwd});
  console.warn(`gitbox.js: gitDetachedHeadFromBranch fetch\n`);
  await execa('git', ['reset', '--hard', head], {cwd});
  console.warn(`gitbox.js: gitDetachedHeadFromBranch reset\n`);
  await execa('git', ['checkout', '-q', '-B', branch], {cwd});
  console.warn(`gitbox.js: gitDetachedHeadFromBranch checkout\n`);
  return cwd;
}

/**
 * Add a new Git configuration.
 *
 * @param {String} name Config name.
 * @param {String} value Config value.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 */
async function gitAddConfig(name, value, execaOptions) {
  console.warn(`gitbox.js: gitAddConfig(name: ${name}, value: ${value}, execaOptions: ${execaOptions})\n`);
  await execa('git', ['config', '--add', name, value], execaOptions);
  console.warn(`gitbox.js: gitAddConfig git config add\n`);
}

/**
 * Get the first commit sha referenced by the tag `tagName` in the local repository.
 *
 * @param {String} tagName Tag name for which to retrieve the commit sha.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 *
 * @return {String} The sha of the commit associated with `tagName` on the local repository.
 */
async function gitTagHead(tagName, execaOptions) {
  console.warn(`gitbox.js: gitTagHead(tagName: ${tagName}, execaOptions: ${execaOptions})\n`);
  return (await execa('git', ['rev-list', '-1', tagName], execaOptions)).stdout;
}

/**
 * Get the first commit sha referenced by the tag `tagName` in the remote repository.
 *
 * @param {String} repositoryUrl The repository remote URL.
 * @param {String} tagName The tag name to seach for.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 *
 * @return {String} The sha of the commit associated with `tagName` on the remote repository.
 */
async function gitRemoteTagHead(repositoryUrl, tagName, execaOptions) {
  console.warn(`gitbox.js: gitRemoteTagHead(repositoryUrl: ${repositoryUrl}, tagName: ${tagName}, execaOptions: ${execaOptions})\n`);
  return (await execa('git', ['ls-remote', '--tags', repositoryUrl, tagName], execaOptions)).stdout
    .split('\n')
    .filter((tag) => Boolean(tag))
    .map((tag) => tag.match(/^(?<tag>\S+)/)[1])[0];
}

/**
 * Get the tag associated with a commit sha.
 *
 * @param {String} gitHead The commit sha for which to retrieve the associated tag.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 *
 * @return {String} The tag associatedwith the sha in parameter or `null`.
 */
async function gitCommitTag(gitHead, execaOptions) {
  console.warn(`gitbox.js: gitCommitTag(gitHead: ${gitHead}, execaOptions: ${execaOptions})\n`);
  return (await execa('git', ['describe', '--tags', '--exact-match', gitHead], execaOptions)).stdout;
}

/**
 * Push to the remote repository.
 *
 * @param {String} repositoryUrl The remote repository URL.
 * @param {String} branch The branch to push.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 *
 * @throws {Error} if the push failed.
 */
async function gitPush(repositoryUrl, branch, execaOptions) {
  console.warn(`gitbox.js: gitPush(repositoryUrl: ${repositoryUrl}, branch: ${branch}, execaOptions: ${execaOptions})\n`);
  await execa('git', ['push', '--tags', repositoryUrl, `HEAD:${branch}`], execaOptions);
  console.warn(`gitbox.js: gitPush git push tags\n`);
}

/**
 * Merge a branch into the current one with `git merge`.
 *
 * @param {String} ref The ref to merge.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 */
async function merge(ref, execaOptions) {
  console.warn(`gitbox.js: merge(ref: ${ref}, execaOptions: ${execaOptions})\n`);
  await execa('git', ['merge', '--no-ff', ref], execaOptions);
  console.warn(`gitbox.js: merge git merge --no-ff\n`);
}

/**
 * Merge a branch into the current one with `git merge --ff`.
 *
 * @param {String} ref The ref to merge.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 */
async function mergeFf(ref, execaOptions) {
  console.warn(`gitbox.js: mergeFf(ref: ${ref}, execaOptions: ${execaOptions})\n`);
  await execa('git', ['merge', '--ff', ref], execaOptions);
  console.warn(`gitbox.js: mergeFf git merge --ff\n`);
}

/**
 * Merge a branch into the current one with `git rebase`.
 *
 * @param {String} ref The ref to merge.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 */
async function rebase(ref, execaOptions) {
  console.warn(`gitbox.js: rebase(ref: ${ref}, execaOptions: ${execaOptions})\n`);
  await execa('git', ['rebase', ref], execaOptions);
  console.warn(`gitbox.js: rebase git rebase --ff\n`);
}

/**
 * Add a note to a Git reference.
 *
 * @param {String} note The note to add.
 * @param {String} ref The ref to add the note to.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 */
async function gitAddNote(note, ref, execaOptions) {
  console.warn(`gitbox.js: gitAddNote(note: ${note}, ref: ${ref}, execaOptions: ${execaOptions})\n`);
  await execa('git', ['notes', '--ref', GIT_NOTE_REF, 'add', '-m', note, ref], execaOptions);
  console.warn(`gitbox.js: gitAddNote notes --ref\n`);
}

/**
 * Get the note associated with a Git reference.
 *
 * @param {String} ref The ref to get the note from.
 * @param {Object} [execaOpts] Options to pass to `execa`.
 */
async function gitGetNote(ref, execaOptions) {
  console.warn(`gitbox.js: gitGetNote(ref: ${ref}, execaOptions: ${execaOptions})\n`);
  return (await execa('git', ['notes', '--ref', GIT_NOTE_REF, 'show', ref], execaOptions)).stdout;
}

module.exports = {
  initGit,
  gitRepo,
  initBareRepo,
  gitCommits,
  gitGetCommits,
  gitCheckout,
  gitFetch,
  gitHead,
  gitTagVersion,
  gitShallowClone,
  gitDetachedHead,
  gitDetachedHeadFromBranch,
  gitAddConfig,
  gitTagHead,
  gitRemoteTagHead,
  gitCommitTag,
  gitPush,
  merge,
  mergeFf,
  rebase,
  gitAddNote,
  gitGetNote,
};
