# Testing Checklist

Before marking any task as complete, verify ALL of the following:

## Playlists Screen
- [ ] Standard LMS playlists appear
- [ ] Qobuz playlists appear (check for "My Playlists" in Qobuz menu)
- [ ] SoundCloud playlists appear (if applicable)
- [ ] Playlist images load (4-image mosaic)
- [ ] Playlist images are cached and load quickly on subsequent visits
- [ ] Source icons (Qobuz/SoundCloud) appear in bottom left corner
- [ ] Play and shuffle buttons work
- [ ] Clicking playlist opens detail screen

## Albums Screen
- [ ] Local albums appear
- [ ] Qobuz albums appear
- [ ] Source badges appear in bottom left corner
- [ ] Filtering works (Local vs Qobuz)
- [ ] Sorting works

## Browse Screen
- [ ] Recently Played section works
- [ ] Qobuz Bestsellers section displays albums
- [ ] "In the Press" section displays albums
- [ ] Artists section works

## Regression Tests
After ANY change to `lmsClient.ts`:
- [ ] Playlists still load (all sources)
- [ ] Albums still load (all sources)
- [ ] Tracks still load
- [ ] Search still works
- [ ] Playback still works

## How to Test
1. Open the app
2. Navigate to each screen mentioned above
3. Verify functionality works
4. Check browser console for errors
5. Test with actual LMS server connected













