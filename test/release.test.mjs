import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function hasGitWorktree(cwd = root) {
  const resolvedCwd = resolve(cwd);
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    cwd: resolvedCwd,
  });
  if (result.error || result.status !== 0) {
    return false;
  }
  const toplevel = result.stdout.trim();
  if (!toplevel) {
    return false;
  }
  return resolve(toplevel) === resolvedCwd;
}

const itRequiresGit = hasGitWorktree() ? it : it.skip;

function runRelease(extraArgs = [], cwd = root) {
  return spawnSync('bash', [join(cwd, 'scripts/release.sh'), ...extraArgs], {
    encoding: 'utf8',
    cwd,
  });
}

function runChecker(extraArgs = []) {
  return spawnSync('python3', [join(root, 'scripts/check_release.py'), ...extraArgs], {
    encoding: 'utf8',
    cwd: root,
  });
}

function seedReleaseScripts(cloneRoot) {
  mkdirSync(join(cloneRoot, 'scripts'), { recursive: true });
  for (const rel of ['scripts/release.sh', 'scripts/check_release.py']) {
    writeFileSync(join(cloneRoot, rel), readFileSync(join(root, rel)));
  }
}

function cloneRepo() {
  const cloneRoot = mkdtempSync(join(tmpdir(), 'discepto-clone-'));
  const result = spawnSync('git', ['clone', '-q', root, cloneRoot], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  seedReleaseScripts(cloneRoot);
  const diff = spawnSync(
    'git',
    ['diff', '--quiet', '--', 'scripts/release.sh', 'scripts/check_release.py'],
    {
      encoding: 'utf8',
      cwd: cloneRoot,
    },
  );
  if (diff.status !== 0) {
    const add = spawnSync('git', ['add', 'scripts/release.sh', 'scripts/check_release.py'], {
      encoding: 'utf8',
      cwd: cloneRoot,
    });
    assert.equal(add.status, 0, add.stderr || add.stdout);
    const commit = spawnSync(
      'git',
      [
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'seed release scripts',
        '--no-gpg-sign',
      ],
      { encoding: 'utf8', cwd: cloneRoot },
    );
    assert.equal(commit.status, 0, commit.stderr || commit.stdout);
  }
  return cloneRoot;
}

describe('release tooling', () => {
  it('nested directory inside unrelated parent git repo is not a worktree root', () => {
    const parent = mkdtempSync(join(tmpdir(), 'discepto-parent-git-'));
    const child = join(parent, 'child-nested');
    mkdirSync(child, { recursive: true });
    try {
      const init = spawnSync('git', ['init', '-q'], { encoding: 'utf8', cwd: parent });
      if (init.error || init.status !== 0) {
        return;
      }
      assert.equal(hasGitWorktree(child), false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  itRequiresGit(
    'structural-only mode produces discepto.zip, receipt.json, and deterministic hash across two builds',
    () => {
      const cloneRoot = cloneRepo();
      const out = join(tmpdir(), `discepto-release-${process.pid}-${Date.now()}`);
      assert.ok(!existsSync(out));
      try {
        const first = runRelease(['--structural-only', out], cloneRoot);
        assert.equal(first.status, 0, first.stderr || first.stdout);

        const entries = readdirSync(out).sort();
        assert.deepEqual(entries, ['discepto.zip', 'receipt.json']);

        const receipt = JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8'));
        assert.equal(receipt.status, 'ok');
        assert.ok(receipt.sha256);
        assert.ok(receipt.head);
        assert.ok(receipt.tree);
        assert.ok(receipt.tracked_count > 0);
        assert.equal(receipt.mode, 'structural-only');
        assert.ok(receipt.tools?.node);
        assert.ok(receipt.tools?.python);
        assert.ok(receipt.tools?.git);

        rmSync(out, { recursive: true, force: true });
        const second = runRelease(['--structural-only', out], cloneRoot);
        assert.equal(second.status, 0, second.stderr || second.stdout);
        const receipt2 = JSON.parse(readFileSync(join(out, 'receipt.json'), 'utf8'));
        assert.equal(receipt.sha256, receipt2.sha256);
      } finally {
        rmSync(cloneRoot, { recursive: true, force: true });
        rmSync(out, { recursive: true, force: true });
      }
    },
  );

  itRequiresGit('rejects untracked files in the worktree', () => {
    const cloneRoot = cloneRepo();
    const out = join(tmpdir(), `discepto-dirty-out-${process.pid}`);
    const untracked = join(cloneRoot, 'untracked-spill.txt');
    try {
      writeFileSync(untracked, 'must block release\n', 'utf8');
      const result = runRelease(['--structural-only', out], cloneRoot);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr + result.stdout, /clean/i);
      assert.ok(!existsSync(out));
    } finally {
      rmSync(cloneRoot, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  itRequiresGit(
    'cloned release ignores local fsmonitor config and omits marker from archive',
    () => {
      const cloneRoot = cloneRepo();
      const out = join(tmpdir(), `discepto-clone-out-${process.pid}`);
      const marker = 'fsmonitor-marker-sentinel-xyzzy';
      try {
        const cfg = spawnSync('git', ['config', 'core.fsmonitor', marker], {
          encoding: 'utf8',
          cwd: cloneRoot,
        });
        assert.equal(cfg.status, 0, cfg.stderr || cfg.stdout);

        const release = runRelease(['--structural-only', out], cloneRoot);
        assert.equal(release.status, 0, release.stderr || release.stdout);

        const inspect = mkdtempSync(join(tmpdir(), 'discepto-unzip-'));
        const unzip = spawnSync('unzip', ['-q', join(out, 'discepto.zip'), '-d', inspect], {
          encoding: 'utf8',
        });
        assert.equal(unzip.status, 0, unzip.stderr || unzip.stdout);

        const zipList = spawnSync('unzip', ['-Z1', join(out, 'discepto.zip')], {
          encoding: 'utf8',
        });
        const combined = zipList.stdout + readFileSync(join(out, 'receipt.json'), 'utf8');
        assert.doesNotMatch(combined, new RegExp(marker));
        assert.doesNotMatch(combined, /fsmonitor/i);
      } finally {
        rmSync(cloneRoot, { recursive: true, force: true });
        rmSync(out, { recursive: true, force: true });
      }
    },
  );

  it('rejects traversal paths in tracked list', () => {
    const out = mkdtempSync(join(tmpdir(), 'discepto-bad-'));
    try {
      writeFileSync(join(out, 'tracked-files.txt'), '../evil.txt\nREADME.md\n', 'utf8');
      writeFileSync(join(out, 'README.md'), 'neutral', 'utf8');
      const result = runChecker(['--structural-only', out]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr + result.stdout, /traversal/i);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('rejects forbidden .git path entries', () => {
    const out = mkdtempSync(join(tmpdir(), 'discepto-forbidden-'));
    try {
      writeFileSync(join(out, 'tracked-files.txt'), '.git/config\nREADME.md\n', 'utf8');
      writeFileSync(join(out, 'README.md'), 'neutral', 'utf8');
      mkdirSync(join(out, '.git'), { recursive: true });
      writeFileSync(join(out, '.git/config'), 'neutral', 'utf8');
      const result = runChecker(['--structural-only', out]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr + result.stdout, /forbidden/i);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('rejects non-example email domains and allows example.invalid', () => {
    const badOut = mkdtempSync(join(tmpdir(), 'discepto-email-bad-'));
    const goodOut = mkdtempSync(join(tmpdir(), 'discepto-email-good-'));
    const badDomain = ['not', 'example', '.com'].join('');
    const badLocal = 'example';
    const badEmail = `${badLocal}@${badDomain}`;
    const goodLocal = 'test';
    const goodDomain = 'example.invalid';
    const goodEmail = `${goodLocal}@${goodDomain}`;
    try {
      writeFileSync(join(badOut, 'tracked-files.txt'), 'README.md\n', 'utf8');
      writeFileSync(join(badOut, 'README.md'), `contact ${badEmail} please\n`, 'utf8');
      const bad = runChecker(['--structural-only', badOut]);
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr + bad.stdout, /email/i);

      writeFileSync(join(goodOut, 'tracked-files.txt'), 'README.md\n', 'utf8');
      writeFileSync(join(goodOut, 'README.md'), `contact ${goodEmail} please\n`, 'utf8');
      const good = runChecker(['--structural-only', goodOut]);
      assert.equal(good.status, 0, good.stderr || good.stdout);
    } finally {
      rmSync(badOut, { recursive: true, force: true });
      rmSync(goodOut, { recursive: true, force: true });
    }
  });

  it('rejects ELF-magic .bin files without echoing payload bytes', () => {
    const out = mkdtempSync(join(tmpdir(), 'discepto-elf-'));
    const elfHeader = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    try {
      writeFileSync(join(out, 'tracked-files.txt'), 'payload.bin\nREADME.md\n', 'utf8');
      writeFileSync(join(out, 'README.md'), 'neutral', 'utf8');
      writeFileSync(join(out, 'payload.bin'), elfHeader);
      const result = runChecker(['--structural-only', out]);
      assert.notEqual(result.status, 0);
      const combined = result.stderr + result.stdout;
      assert.match(combined, /binary|unexpected file type|NUL/i);
      assert.doesNotMatch(combined, /ELF|0x7f|\\x7f/i);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('rejects quoted JSON-style credential assignments without echoing the secret', () => {
    const out = mkdtempSync(join(tmpdir(), 'discepto-quoted-cred-'));
    const fieldName = ['api', '_', 'key'].join('');
    const secretValue = ['sk', '-', 'live', '-', 'adv', 'ersarial', '-', 'needle'].join('');
    const payload = `{\n  "${fieldName}": "${secretValue}"\n}\n`;
    try {
      writeFileSync(join(out, 'tracked-files.txt'), 'README.md\n', 'utf8');
      writeFileSync(join(out, 'README.md'), payload, 'utf8');
      const result = runChecker(['--structural-only', out]);
      assert.notEqual(result.status, 0);
      const combined = result.stderr + result.stdout;
      assert.match(combined, /credential/i);
      assert.doesNotMatch(combined, new RegExp(secretValue));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('rejects NUL bytes and invalid UTF-8 in tracked text files', () => {
    const nulOut = mkdtempSync(join(tmpdir(), 'discepto-nul-'));
    const badUtfOut = mkdtempSync(join(tmpdir(), 'discepto-utf8-'));
    try {
      writeFileSync(join(nulOut, 'tracked-files.txt'), 'README.md\n', 'utf8');
      writeFileSync(join(nulOut, 'README.md'), Buffer.from('before\x00after', 'latin1'));
      const nul = runChecker(['--structural-only', nulOut]);
      assert.notEqual(nul.status, 0);
      assert.match(nul.stderr + nul.stdout, /NUL|UTF-8|binary/i);

      writeFileSync(join(badUtfOut, 'tracked-files.txt'), 'README.md\n', 'utf8');
      writeFileSync(join(badUtfOut, 'README.md'), Buffer.from([0xc3, 0x28]));
      const badUtf = runChecker(['--structural-only', badUtfOut]);
      assert.notEqual(badUtf.status, 0);
      assert.match(badUtf.stderr + badUtf.stdout, /UTF-8|binary/i);
    } finally {
      rmSync(nulOut, { recursive: true, force: true });
      rmSync(badUtfOut, { recursive: true, force: true });
    }
  });

  it('rejects private denylist needles without printing values', () => {
    const out = mkdtempSync(join(tmpdir(), 'discepto-needle-'));
    const deny = mkdtempSync(join(tmpdir(), 'discepto-deny-'));
    try {
      writeFileSync(join(deny, 'needles.txt'), 'SECRET_NEEDLE_XYZ\n', 'utf8');
      writeFileSync(join(out, 'tracked-files.txt'), 'README.md\n', 'utf8');
      writeFileSync(join(out, 'README.md'), 'contains SECRET_NEEDLE_XYZ inside', 'utf8');
      const result = runChecker(['--private-denylist', join(deny, 'needles.txt'), out]);
      assert.notEqual(result.status, 0);
      const combined = result.stderr + result.stdout;
      assert.match(combined, /private needle/i);
      assert.doesNotMatch(combined, /SECRET_NEEDLE_XYZ/);
    } finally {
      rmSync(out, { recursive: true, force: true });
      rmSync(deny, { recursive: true, force: true });
    }
  });
});
