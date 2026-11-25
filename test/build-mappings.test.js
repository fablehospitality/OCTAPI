import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMappings, unitName } from '../scripts/build-mappings.js';
import { findMapping, mapUnits } from '../src/forwarder.js';

const mine = [
  { id: 'mine-arl', internalName: 'Arlington Cemetery', options: [{ id: 'DEFAULT', units: [{ id: 'm-a', internalName: 'Adult' }, { id: 'm-c', internalName: 'Child' }] }] },
  { id: 'mine-lin', internalName: 'Lincoln Assassination', options: [{ id: 'DEFAULT', units: [{ id: 'm-a2', internalName: 'Adult' }, { id: 'm-c2', internalName: 'Child' }, { id: 'm-i2', internalName: 'Infant' }] }] },
  { id: 'mine-own', internalName: 'San Diego Gaslamp Ghosts', options: [{ id: 'DEFAULT', units: [] }] },
];
const partner = [
  { id: 'av_7j78j', internalName: 'Arlington', options: [{ id: 'DEFAULT', default: true, units: [{ id: 'p-a', internalName: 'Adult (13-64)' }, { id: 'p-c', internalName: 'Child (0-3)' }] }] },
  { id: 'av_vvgw4', internalName: 'Lincoln', options: [{ id: 'DEFAULT', default: true, units: [{ id: 'p-a2', internalName: 'Adult' }, { id: 'p-c2', internalName: 'Child' }] }] },
];
const tours = [
  { name: 'Arlington Cemetery', partnerProductId: 'av_7j78j' },
  { name: 'Lincoln Assassination', partnerProductId: 'av_vvgw4' },
  { name: 'National Archives', partnerProductId: 'av_55bwn' },
];

test('unit names ignore age ranges and case', () => {
  assert.equal(unitName({ internalName: 'Adult (13-64)' }), 'adult');
  assert.equal(unitName({ title: ' CHILD ' }), 'child');
});

test('builds mappings the forwarder can use, keeping unrelated entries', () => {
  const existing = { products: [{ name: 'Other', mine: { productId: 'x' }, partner: { productId: 'y' }, units: {} }] };
  const r = buildMappings({ mine, partner, existing, tours });

  const arl = findMapping(r, 'mine-arl');
  assert.equal(arl.partner.productId, 'av_7j78j');
  assert.deepEqual(mapUnits(arl, [{ unitId: 'm-a', quantity: 2 }, { unitId: 'Child', quantity: 1 }]).units,
    [{ id: 'p-a', quantity: 2 }, { id: 'p-c', quantity: 1 }]);

  // Lincoln: Infant has no Cornerstone match -> flagged, others still mapped
  const lin = findMapping(r, 'mine-lin');
  assert.equal(lin.units['m-c2'], 'p-c2');
  assert.equal(lin.units['m-i2'], undefined);
  assert.ok(r.report.some((l) => l.startsWith('✗ Lincoln') && l.includes('"infant"')));

  // Missing mirror product reported, unrelated mapping kept
  assert.ok(r.report.some((l) => l.startsWith('✗ National Archives')));
  assert.ok(findMapping(r, 'x'));
  assert.equal(r.problems, 2);
});

test('re-running replaces its own entries instead of duplicating', () => {
  const first = buildMappings({ mine, partner, tours });
  const second = buildMappings({ mine, partner, existing: first, tours });
  assert.equal(second.products.length, first.products.length);
});
