import assert from 'node:assert/strict';
import test from 'node:test';
import { canSaveBrandProfile } from './access-policy';
test('only the active business admin in their own session can save', () => {
    const input = { locationId:'a',activeLocationId:'a',role:'ADMIN',sessionUserId:'user-a',accessUserId:'user-a',impersonating:false };
    assert.equal(canSaveBrandProfile(input),true);
    for (const patch of [{role:'MEMBER'},{activeLocationId:'b'},{accessUserId:'user-b'},{sessionUserId:null},{impersonating:true}]) assert.equal(canSaveBrandProfile({...input,...patch}),false);
});
