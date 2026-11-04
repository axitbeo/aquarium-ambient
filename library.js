/* Aquarium media library: the single source of truth for every video and sound.
 *
 * Add a file:      put it in media/ (videos + posters) or sound/ (audio), then add ONE entry here.
 * Replace a file:  keep the same name and increase its `v` (1 -> 2). Devices that cached the old
 *                  copy show "Update available" and keep playing the old copy until updated.
 * Remove a file:   delete its entry. Cached copies are NOT deleted automatically; the player panel
 *                  offers "Remove unused" in its storage section.
 *
 * Fields
 *   id      stable unique key (saved selections + cache); don't change it after publishing
 *   title   display name (safe to change any time)
 *   file    path relative to index.html
 *   v       revision number of the file; bump when the file content changes
 *   poster  (videos, optional) 640x360 JPG thumbnail
 *   type    (sounds) 'music' or 'ambience'
 *   gapless (sounds, optional) true for short loops: decoded in memory for seamless Loop One.
 *           Use only for files under ~60 s (about 10 MB of memory per minute).
 *
 * Loaded by both the page and the service worker, so use `self`, not `window`.
 */
self.AQUARIUM_LIBRARY = {
  videos: [
    { id: 'soft-tropical', title: 'Soft Tropical Aquarium', file: 'media/855798-hd_1920_1080_30fps.mp4',
      poster: 'media/855798-hd_1920_1080_30fps.jpg', v: 1 },
    { id: 'lush-nature', title: 'Lush Nature Aquarium', file: 'media/85674-591865490-1080p.mp4',
      poster: 'media/85674-591865490-1080p.jpg', v: 1 },
    { id: 'deep-blue-reef', title: 'Deep Blue Reef', file: 'media/16011848-1080p.mp4',
      poster: 'media/16011848-1080p.jpg', v: 1 }
  ],
  sounds: [
    { id: 'ambient-piano', type: 'music', title: 'Ambient Piano',
      file: 'sound/atlasaudio-ambient-piano-580084.mp3', v: 1 },
    { id: 'meditation', type: 'music', title: 'Calm Meditation',
      file: 'sound/leberch-babylon-meditation-628053.mp3', v: 1 },
    { id: 'underwater', type: 'ambience', title: 'Underwater Ambience',
      file: 'sound/dragon-studio-underwater-ambience-376890.mp3', v: 1, gapless: true }
  ]
};
