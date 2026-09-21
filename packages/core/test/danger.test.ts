import { describe, expect, it } from 'vitest';
import { describeDanger, detectDangerous, isDangerous } from '../src/runner/danger';

function ids(command: string): string[] {
  return detectDangerous(command).map((match) => match.id);
}

describe('detectDangerous', () => {
  it('flags recursive forced deletes in any flag spelling', () => {
    expect(ids('rm -rf build')).toContain('rm-recursive-force');
    expect(ids('rm -fr build')).toContain('rm-recursive-force');
    expect(ids('rm -r -f build')).toContain('rm-recursive-force');
    expect(ids('rm -R --force build')).toContain('rm-recursive-force');
    expect(ids('/bin/rm -rf build')).toContain('rm-recursive-force');
  });

  it('does not flag an ordinary delete', () => {
    expect(ids('rm build/output.txt')).toEqual([]);
    expect(ids('rm -i note.txt')).toEqual([]);
  });

  it('flags --force anywhere', () => {
    expect(ids('npm publish --force')).toContain('force-flag');
  });

  it('flags force pushes', () => {
    expect(ids('git push -f origin main')).toContain('git-push-force');
    expect(ids('git push --force-with-lease')).toContain('git-push-force');
    expect(ids('git push origin main')).not.toContain('git-push-force');
    expect(ids('rsync -f rules src dst')).not.toContain('git-push-force');
  });

  it('flags destructive SQL', () => {
    expect(ids('psql -c "DROP DATABASE app"')).toContain('drop-database');
    expect(ids('psql -c "drop table users"')).toContain('drop-database');
    expect(ids('psql -c "select * from users"')).toEqual([]);
  });

  it('flags filesystem and raw-disk operations', () => {
    expect(ids('mkfs.ext4 /dev/sdb1')).toContain('mkfs');
    expect(ids('dd if=/dev/zero of=disk.img')).toContain('dd');
    expect(ids('cat image.iso > /dev/sdb')).toContain('device-write');
  });

  it('flags fork bombs', () => {
    expect(ids(':(){ :|:& };:')).toContain('fork-bomb');
  });

  it('flags world-writable recursive chmod', () => {
    expect(ids('chmod -R 777 .')).toContain('chmod-777');
    expect(ids('chmod 777 file')).not.toContain('chmod-777');
    expect(ids('chmod -R 755 .')).not.toContain('chmod-777');
  });

  it('flags sudo', () => {
    expect(ids('sudo systemctl restart nginx')).toContain('sudo');
    expect(ids('echo sudoku')).not.toContain('sudo');
  });

  it('leaves everyday commands alone', () => {
    for (const command of [
      'npm run build',
      'git status',
      'docker compose up -d',
      'pytest -q tests/',
      'echo "rm is scary"'.replace('rm', 'removal'),
    ]) {
      expect(isDangerous(command)).toBe(false);
    }
  });

  it('reports several reasons at once', () => {
    const matches = detectDangerous('sudo rm -rf /');
    expect(matches.map((match) => match.id)).toEqual(['rm-recursive-force', 'sudo']);
    expect(describeDanger(matches)).toContain('• Runs as root (sudo)');
  });
});
