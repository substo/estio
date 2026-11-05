import test from 'node:test';
import assert from 'node:assert/strict';
import { createYoutubeApi } from '../google/youtube-api';
test('YouTube video API retains description and thumbnail source fields', async()=>{
  const videos = await createYoutubeApi({accessToken:'fixture'},async()=>Response.json({items:[{id:'dQw4w9WgXcQ',status:{privacyStatus:'public'},snippet:{title:'Video',channelId:`UC${'a'.repeat(22)}`,channelTitle:'Creator',description:'Source description',thumbnails:{high:{url:'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'}}}}]})).videos(['dQw4w9WgXcQ']);
  assert.equal(videos[0].description,'Source description'); assert.ok(videos[0].thumbnailUrl?.startsWith('https://i.ytimg.com/'));
});
