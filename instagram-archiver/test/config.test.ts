import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig — byparrUrl', () => {
  it('sets byparrUrl to the trimmed value when IA_BYPARR_URL is non-empty', () => {
    // Arrange
    const env = { IA_BYPARR_URL: '  http://byparr:8191  ' };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.byparrUrl).toBe('http://byparr:8191');
  });

  it('leaves byparrUrl undefined when IA_BYPARR_URL is unset or empty', () => {
    // Arrange
    const unset = loadConfig({});
    const empty = loadConfig({ IA_BYPARR_URL: '   ' });

    // Act / Assert
    expect(unset.byparrUrl).toBeUndefined();
    expect(empty.byparrUrl).toBeUndefined();
  });
});

describe('loadConfig — accounts resolution', () => {
  let dir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ia-config-'));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  it('uses the accounts file over IA_ACCOUNTS when it is set and non-empty', () => {
    // Arrange
    const file = join(dir, 'accounts.txt');
    writeFileSync(file, 'nasa\nnatgeo\n', 'utf8');
    const env = { IA_ACCOUNTS_FILE: file, IA_ACCOUNTS: 'other,again' };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.accounts).toEqual(['nasa', 'natgeo']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('strips comments and blank lines from the accounts file', () => {
    // Arrange
    const file = join(dir, 'accounts.txt');
    writeFileSync(
      file,
      '# full-line comment\n\nnasa\nnatgeo   # inline comment\n   \n#another\n',
      'utf8',
    );
    const env = { IA_ACCOUNTS_FILE: file };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.accounts).toEqual(['nasa', 'natgeo']);
  });

  it('falls back to IA_ACCOUNTS and warns when the file does not exist', () => {
    // Arrange
    const env = {
      IA_ACCOUNTS_FILE: join(dir, 'missing.txt'),
      IA_ACCOUNTS: 'alpha,beta',
    };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.accounts).toEqual(['alpha', 'beta']);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('falls back to IA_ACCOUNTS and warns when the file is empty', () => {
    // Arrange
    const file = join(dir, 'accounts.txt');
    writeFileSync(file, '# only comments\n\n   \n', 'utf8');
    const env = { IA_ACCOUNTS_FILE: file, IA_ACCOUNTS: 'gamma' };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.accounts).toEqual(['gamma']);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('parses IA_ACCOUNTS when IA_ACCOUNTS_FILE is unset', () => {
    // Arrange
    const env = { IA_ACCOUNTS: '["one","two"]' };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.accounts).toEqual(['one', 'two']);
  });

  it('returns an empty list when neither source is set', () => {
    // Arrange / Act
    const config = loadConfig({});

    // Assert
    expect(config.accounts).toEqual([]);
  });
});
