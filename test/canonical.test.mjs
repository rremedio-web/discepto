import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, sha256Canonical, compareUtf16 } from '../src/canonical.mjs';
import { canonicalMeasurementHash } from '../src/protocol.mjs';

describe('canonical JSON encoding', () => {
  it('sorts object keys by UTF-16 code unit and ignores insertion order', () => {
    const first = canonicalJson({ b: 1, a: 2 });
    const second = canonicalJson({ a: 2, b: 1 });
    assert.equal(first, '{"a":2,"b":1}');
    assert.equal(second, first);
    assert.equal(
      sha256Canonical({ b: 1, a: 2 }),
      'd3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772',
    );
  });

  it('preserves array order', () => {
    assert.equal(canonicalJson(['b', 'a']), '["b","a"]');
    assert.equal(
      sha256Canonical(['b', 'a']),
      '02d8bc3008a9bb0dcc4b86d7fd3428ced792355c733c19756bec5a56dc61b2c5',
    );
    assert.notEqual(sha256Canonical(['b', 'a']), sha256Canonical(['a', 'b']));
  });

  it('encodes Unicode NFC and NFD keys as distinct golden vectors', () => {
    const nfc = { '\u00e9': 'cafe' };
    const nfd = { 'e\u0301': 'cafe' };
    assert.equal(canonicalJson(nfc), '{"é":"cafe"}');
    assert.equal(
      sha256Canonical(nfc),
      'b661807d13a927fd7acb538e0e341c5f9983553c0da9e320816f5087f6607648',
    );
    assert.equal(
      sha256Canonical(nfd),
      'e668216dbe1ffb49305d4a597bf02c8d6863aa99e4aac65282b12a1d750c238c',
    );
    assert.notEqual(sha256Canonical(nfc), sha256Canonical(nfd));
  });

  it('encodes combining characters and emoji with committed hashes', () => {
    assert.equal(
      sha256Canonical({ k: 'e\u0301' }),
      '4cb477ab754099c91e4c79f77deaab085090978b8abbc981c8eefde872575da8',
    );
    assert.equal(
      sha256Canonical({ face: '😀' }),
      '035e057dbf7c66232b0f2b21baa82acf201885e7f250b346084504b4029c099b',
    );
  });

  it('sorts nested object keys and keeps nested array order', () => {
    const nested = { z: { b: true, a: null }, arr: [1, { y: 2, x: 3 }] };
    assert.equal(canonicalJson(nested), '{"arr":[1,{"x":3,"y":2}],"z":{"a":null,"b":true}}');
    assert.equal(
      sha256Canonical(nested),
      '99f478d48eacb86352005f3841a3cb7bbcafe7c685593a6014a1a4434b9c399f',
    );
  });

  it('rejects non-JSON values', () => {
    assert.throws(() => canonicalJson(undefined), /type undefined/);
    assert.throws(() => canonicalJson(Number.NaN), /non-finite/);
    assert.throws(() => canonicalJson({ a: undefined }), /undefined at key a/);
  });

  it('compareUtf16 uses code-unit order rather than locale comparison', () => {
    assert.equal(compareUtf16('A', 'B'), -1);
    assert.equal(compareUtf16('B', 'A'), 1);
    assert.equal(compareUtf16('A', 'A'), 0);
    assert.equal(
      compareUtf16('\u00e9', 'e\u0301') < 0 || compareUtf16('\u00e9', 'e\u0301') > 0,
      true,
    );
  });

  it('measurement hash is stable under observation and artifact property reorder', () => {
    const base = {
      method: 'm',
      observations: [
        { key: 'b', value: '2' },
        { key: 'a', value: '1' },
      ],
      result: 'resolved',
      artifact_identity: { url: 'https://staging.example.test/x', kind: 'staging' },
    };
    const reordered = {
      method: 'm',
      result: 'resolved',
      artifact_identity: { kind: 'staging', url: 'https://staging.example.test/x' },
      observations: [
        { key: 'a', value: '1' },
        { key: 'b', value: '2' },
      ],
    };
    assert.equal(canonicalMeasurementHash(base), canonicalMeasurementHash(reordered));
  });
});
