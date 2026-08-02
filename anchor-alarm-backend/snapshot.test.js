const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, describe, it } = require('node:test');

const {
  parseSnapshot,
  readSnapshotSync,
  resolveDataDir,
  serializeSessions,
  snapshotPath,
  writeSnapshotSync
} = require('./snapshot');

// Restarts are the whole point of the snapshot, so the round-trip is what
// has to be true: a session written before a restart comes back with its
// anchor, zone and track, and a damaged file never stops the server booting.

const tmpDirs = [];
const makeDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-snapshot-'));
  tmpDirs.push(dir);
  return dir;
};

after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const HOUR = 60 * 60 * 1000;

const sampleSession = (overrides = {}) => ({
  zone: [
    [43.083, 6.158],
    [43.0835, 6.158],
    [43.0835, 6.1585],
    [43.083, 6.1585]
  ],
  locations: { 'device-a': { latitude: 43.0831, longitude: 6.1581 } },
  deviceSockets: { 'device-a': 'socket-xyz' },
  alarmed: false,
  acknowledged: false,
  anchor: { latitude: 43.083, longitude: 6.158, accuracy: 4 },
  track: [
    [43.083, 6.158, 1000],
    [43.0831, 6.1581, 2000]
  ],
  createdAt: 1000,
  lastActivity: 2000,
  ...overrides
});

describe('snapshot round-trip', () => {
  it('restores zone, anchor, track and timestamps unchanged', () => {
    const dir = makeDir();
    const before = new Map([['ABCD12345', sampleSession()]]);

    writeSnapshotSync(dir, before);
    const { sessions: after_, error } = readSnapshotSync(dir);

    assert.equal(error, null);
    assert.equal(after_.size, 1);

    const restored = after_.get('ABCD12345');
    const original = before.get('ABCD12345');
    assert.deepEqual(restored.zone, original.zone);
    assert.deepEqual(restored.anchor, original.anchor);
    assert.deepEqual(restored.track, original.track);
    assert.equal(restored.createdAt, original.createdAt);
    assert.equal(restored.lastActivity, original.lastActivity);
  });

  it('never restores live positions or sockets from the dead process', () => {
    const dir = makeDir();
    writeSnapshotSync(dir, new Map([['ABCD12345', sampleSession()]]));

    const restored = readSnapshotSync(dir).sessions.get('ABCD12345');
    // These belonged to sockets that died with the process; restoring them
    // would show remote monitors a phantom boat that never moves again.
    assert.deepEqual(restored.locations, {});
    assert.deepEqual(restored.deviceSockets, {});
    assert.ok(!serializeSessions(new Map([['ABCD12345', sampleSession()]])).includes('socket-xyz'));
  });

  it('preserves an alarming session across the restart', () => {
    const dir = makeDir();
    writeSnapshotSync(
      dir,
      new Map([['ALARMING1', sampleSession({ alarmed: true, acknowledged: true })]])
    );

    const restored = readSnapshotSync(dir).sessions.get('ALARMING1');
    assert.equal(restored.alarmed, true);
    assert.equal(restored.acknowledged, true);
  });

  it('writes atomically and leaves no tmp file behind', () => {
    const dir = makeDir();
    writeSnapshotSync(dir, new Map([['ABCD12345', sampleSession()]]));

    assert.ok(fs.existsSync(snapshotPath(dir)));
    assert.ok(!fs.existsSync(`${snapshotPath(dir)}.tmp`));
    // Whatever is at the final path always parses: the rename is the only
    // thing that ever publishes it.
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(snapshotPath(dir), 'utf8')));
  });

  it('overwrites a previous snapshot rather than appending to it', () => {
    const dir = makeDir();
    writeSnapshotSync(dir, new Map([['FIRSTONE1', sampleSession()]]));
    writeSnapshotSync(dir, new Map([['SECONDID1', sampleSession()]]));

    const { sessions } = readSnapshotSync(dir);
    assert.deepEqual([...sessions.keys()], ['SECONDID1']);
  });
});

describe('snapshot loading is never fatal', () => {
  it('starts clean when the file is missing', () => {
    const result = readSnapshotSync(makeDir());
    assert.equal(result.missing, true);
    assert.equal(result.error, null);
    assert.equal(result.sessions.size, 0);
  });

  it('starts clean on a truncated file, reporting why', () => {
    const dir = makeDir();
    fs.writeFileSync(snapshotPath(dir), '{"version":1,"sessions":{"AB');

    const result = readSnapshotSync(dir);
    assert.match(result.error, /unparseable/);
    assert.equal(result.sessions.size, 0);
  });

  it('starts clean on an empty file and on an unexpected shape', () => {
    assert.equal(parseSnapshot('').sessions.size, 0);
    assert.equal(parseSnapshot('   ').error, null);
    assert.match(parseSnapshot('[1,2,3]').error, /shape/);
    assert.match(parseSnapshot('"nope"').error, /shape/);
  });

  it('drops individual malformed sessions but keeps the good ones', () => {
    const raw = JSON.stringify({
      version: 1,
      sessions: {
        GOOD12345: sampleSession(),
        BAD123456: 'not an object'
      }
    });

    const { sessions, dropped } = parseSnapshot(raw);
    assert.deepEqual([...sessions.keys()], ['GOOD12345']);
    assert.equal(dropped, 1);
  });

  it('discards a corrupt anchor and non-numeric points instead of the session', () => {
    const raw = JSON.stringify({
      version: 1,
      sessions: {
        MESSY1234: {
          ...sampleSession(),
          anchor: { latitude: 'north', longitude: 6.158 },
          zone: [[43.083, 6.158], ['x', 'y']],
          track: [[43.083, 6.158, 1000], [null, null, null]]
        }
      }
    });

    const session = parseSnapshot(raw).sessions.get('MESSY1234');
    assert.equal(session.anchor, null);
    assert.equal(session.zone.length, 1);
    assert.equal(session.track.length, 1);
  });
});

describe('idle expiry on load', () => {
  it('drops sessions already past the TTL and keeps the rest', () => {
    const now = 100 * HOUR;
    const raw = serializeSessions(
      new Map([
        ['FRESH1234', sampleSession({ lastActivity: now - HOUR })],
        ['STALE1234', sampleSession({ lastActivity: now - 30 * HOUR })]
      ]),
      now
    );

    const { sessions, dropped } = parseSnapshot(raw, { now, idleTtlMs: 24 * HOUR });
    assert.deepEqual([...sessions.keys()], ['FRESH1234']);
    assert.equal(dropped, 1);
  });

  it('keeps everything when no TTL is supplied', () => {
    const raw = serializeSessions(new Map([['OLD123456', sampleSession({ lastActivity: 0 })]]));
    assert.equal(parseSnapshot(raw).sessions.size, 1);
  });
});

describe('data dir resolution', () => {
  it('honours DATA_DIR', () => {
    assert.equal(resolveDataDir({ DATA_DIR: '/somewhere/else' }), '/somewhere/else');
  });

  it('falls back to a temp dir when there is no volume, so dev needs no setup', () => {
    const dir = resolveDataDir({});
    assert.ok(dir === '/data' || dir.startsWith(os.tmpdir()));
  });
});
