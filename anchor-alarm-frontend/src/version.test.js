/* eslint-env jest */
import fs from 'fs';
import path from 'path';
import { APP_VERSION } from './version';

// Checklist 1.5: `versionName` identical in build.gradle and src/version.js.
//
// The version on the session screen is how a tester answers "are both phones
// on the same build?", and the checklist opens by saying a mismatch
// invalidates every result in it. Two places holding the same string by hand
// is exactly the thing that drifts, so it is asserted rather than eyeballed.

const gradlePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');

describe('build integrity', () => {
  it('has the same versionName in build.gradle as APP_VERSION', () => {
    const gradle = fs.readFileSync(gradlePath, 'utf8');
    const match = /versionName\s+"([^"]+)"/.exec(gradle);

    expect(match).not.toBeNull();
    const versionName = match[1];

    expect(APP_VERSION).toBe(versionName);
  });

  it('uses a plain semver string testers can compare at a glance', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('derives versionCode from the commit count rather than hardcoding it', () => {
    // A hardcoded versionCode is how two different builds end up claiming to
    // be the same one in Firebase App Tester.
    const gradle = fs.readFileSync(gradlePath, 'utf8');
    expect(gradle).toMatch(/versionCode\s+gitVersionCode\(\)/);
  });
});
