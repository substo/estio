import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatedYoutubeCreator } from './library-import-metadata';
test('creator identity requires an actual YouTube channel URL', () => {
  assert.equal(validatedYoutubeCreator('Creator Name'), null);
  assert.equal(validatedYoutubeCreator('https://youtube.com.evil.test/@creator'), null);
  assert.equal(validatedYoutubeCreator('https://youtube.com/watch?v=abcdefghijk'), null);
  assert.deepEqual(validatedYoutubeCreator('https://youtube.com/channel/UCabcdefghijklmnopqrstuv'), {channelUrl:'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',channelId:'UCabcdefghijklmnopqrstuv'});
});
import { fetchLibraryImportMetadata, libraryImportTarget } from './library-import-metadata';
test('native creator identity is retained with description evidence', async () => {
  const result = await fetchLibraryImportMetadata(libraryImportTarget('https://youtu.be/abcdefghijk'), {page:async()=>{throw Error('unavailable');},fetcher:async()=>{throw Error('unexpected');}}, {title:'Source',channelName:'Creator',description:'Evidence',thumbnailUrl:'',channelUrl:'https://youtube.com/channel/UCabcdefghijklmnopqrstuv'});
  assert.equal(result.payload.channelId,'UCabcdefghijklmnopqrstuv');
  assert.equal(result.payload.description,'Evidence');
});
