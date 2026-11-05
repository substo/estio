import { test } from 'node:test';
import assert from 'node:assert/strict';
import { libraryImportTarget, fetchLibraryImportMetadata } from './library-import-metadata';
test('canonical video identity retains short format; handles require disambiguation', () => {
  const target = libraryImportTarget('https://youtube.com/shorts/dQw4w9WgXcQ?si=tracking');
  assert.equal(target.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'); assert.equal(target.format,'short');
  assert.throws(() => libraryImportTarget('@creator')); assert.equal(libraryImportTarget('@creator','youtube').kind,'channel');
  assert.equal(libraryImportTarget('https://instagram.com/reel/example/').format,'reel');
  assert.equal(libraryImportTarget('https://fb.watch/example/').platform,'facebook');
});
test('rejects unsafe URLs and platform mismatch', () => {
  for (const value of ['file:///etc/passwd','http://127.0.0.1/a','https://user:pass@example.com','https://example.com:8080/']) assert.throws(() => libraryImportTarget(value));
  assert.throws(() => libraryImportTarget('https://youtube.com/@creator','instagram'));
});
test('actual oembed fields retained and description is never a generated summary', async () => {
  const data = await fetchLibraryImportMetadata(libraryImportTarget('https://youtu.be/dQw4w9WgXcQ'), {
    fetcher: async () => Response.json({ title: 'Actual title', author_name: 'Actual creator', thumbnail_url: 'http://localhost/image' }),
    page: async () => ({url:'', finalUrl:'https://youtube.com/watch?v=dQw4w9WgXcQ',status:200,contentType:'text/html',title:null,description:'Publisher description',ogTitle:null,ogDescription:null,ogImage:null,text:'',truncated:false})
  });
  assert.equal(data.title,'Actual title'); assert.equal(data.payload.channelName,'Actual creator'); assert.equal(data.payload.thumbnailUrl,'');
  assert.equal(data.payload.description,'Publisher description'); assert.equal(data.payload.summaryStatus,'not_generated'); assert.equal('summary' in data.payload,false);
});
test('unavailable pages do not fabricate titles', async () => {
  await assert.rejects(fetchLibraryImportMetadata(libraryImportTarget('https://example.com/post'), {fetcher:fetch,page:async()=>{throw Error('blocked');}}));
});
test('connected YouTube description takes precedence over page text', async () => {
  const result = await fetchLibraryImportMetadata(libraryImportTarget('https://youtube.com/@creator'), {fetcher:async()=>{throw Error('unexpected oembed');},page:async()=>{throw Error('page unavailable');}}, {title:'Channel title',channelName:'Creator',description:'Actual channel description',thumbnailUrl:'https://yt3.ggpht.com/image'});
  assert.equal(result.kind,'channel'); assert.equal(result.payload.description,'Actual channel description');
  assert.equal(result.payload.importEvidence.method,'youtube_data_api');
});

test('selected Facebook and LinkedIn handles resolve public profile URLs',()=>{
  assert.equal(libraryImportTarget('@creator','facebook').kind,'channel');
  assert.equal(libraryImportTarget('@creator','linkedin').kind,'channel');
  assert.equal(libraryImportTarget('https://www.linkedin.com/in/creator').kind,'channel');
  assert.equal(libraryImportTarget('https://facebook.com/creator/posts/123').kind,'reference');
  assert.equal(libraryImportTarget('@creator','facebook').url,'https://www.facebook.com/creator');
  assert.equal(libraryImportTarget('@creator','linkedin').url,'https://www.linkedin.com/in/creator');
});
