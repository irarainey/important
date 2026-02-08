import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { CATEGORY_ORDER } from '../../src/types';

describe('types', () => {
    describe('CATEGORY_ORDER', () => {
        it('has exactly 5 categories', () => {
            assert.equal(CATEGORY_ORDER.length, 5);
        });

        it('follows Google style + first-party ordering', () => {
            assert.deepEqual([...CATEGORY_ORDER], [
                'future',
                'stdlib',
                'third-party',
                'first-party',
                'local',
            ]);
        });

        it('puts future first', () => {
            assert.equal(CATEGORY_ORDER[0], 'future');
        });

        it('puts local last', () => {
            assert.equal(CATEGORY_ORDER[CATEGORY_ORDER.length - 1], 'local');
        });
    });
});
