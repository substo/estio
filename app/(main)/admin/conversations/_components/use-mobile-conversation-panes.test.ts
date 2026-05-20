import assert from 'node:assert/strict';
import test from 'node:test';

import { getNextMobilePaneForSwipe } from './use-mobile-conversation-panes';

test('mobile pane swipe transitions move forward on left edge swipes', () => {
    assert.equal(getNextMobilePaneForSwipe('list', 'left'), 'window');
    assert.equal(getNextMobilePaneForSwipe('window', 'left'), 'mission');
    assert.equal(getNextMobilePaneForSwipe('mission', 'left'), 'mission');
});

test('mobile pane swipe transitions move backward on right edge swipes', () => {
    assert.equal(getNextMobilePaneForSwipe('mission', 'right'), 'window');
    assert.equal(getNextMobilePaneForSwipe('window', 'right'), 'list');
    assert.equal(getNextMobilePaneForSwipe('list', 'right'), 'list');
});
