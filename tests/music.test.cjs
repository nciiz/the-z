const test = require("node:test");
const assert = require("node:assert/strict");

const { isSpotifyUrl } = require("../bot/dist/modules/music/spotify.js");

test("music: Spotify URL detection supports tracks, albums, playlists and short links", () => {
  assert.equal(isSpotifyUrl("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"), true);
  assert.equal(isSpotifyUrl("https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy?si=abc"), true);
  assert.equal(isSpotifyUrl("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"), true);
  assert.equal(isSpotifyUrl("https://spotify.link/abc123"), true);
  assert.equal(isSpotifyUrl("http://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"), false);
  assert.equal(isSpotifyUrl("https://example.com/track/4cOdK2wGLETKBW3PvgPWqT"), false);
  assert.equal(isSpotifyUrl("not a url"), false);
});
