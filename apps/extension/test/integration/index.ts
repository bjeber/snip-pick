import * as fs from 'node:fs';
import * as path from 'node:path';
import Mocha from 'mocha';

/** Entry point for the "Extension Tests" launch configuration (F5). */
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60_000 });
  const testsRoot = __dirname;
  for (const file of fs.readdirSync(testsRoot)) {
    if (file.endsWith('.test.js')) mocha.addFile(path.join(testsRoot, file));
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${failures} test(s) failed.`));
      else resolve();
    });
  });
}
