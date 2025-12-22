# Music Player App - Design Guidelines

## Architecture Decisions

### Authentication
**Auth Required** - Qobuz integration necessitates user authentication.

**Implementation:**
- Use SSO with Apple Sign-In (iOS requirement) and Google Sign-In
- Mock auth flow in prototype with local state
- Include login/signup screens with:
  - Qobuz account connection (separate from app login)
  - Privacy policy & terms links (placeholder URLs)
- Account screen features:
  - User avatar (generate 3 music-themed preset avatars: vinyl record, headphones, waveform)
  - Display name field
  - Connected services (Qobuz connection status)
  - Log out (with confirmation alert)
  - Delete account (Settings > Account > Delete, double confirmation)

### Navigation
**Tab Navigation** - App has 4 distinct feature areas with floating action button for Now Playing.

**Structure:**
1. **Browse Tab** - Library browsing (UPNP/LMS servers, Qobuz)
2. **Queue Tab** - Current playback queue
3. **Floating Action Button** - Minimized Now Playing (expands to full screen)
4. **Search Tab** - Global search across all sources
5. **Settings Tab** - Server connections, playback settings, account

**Navigation Stacks:**
- Browse Stack: Library > Artists > Albums > Tracks
- Queue Stack: Queue (single screen)
- Search Stack: Search > Results > Details
- Settings Stack: Settings > Server Management > Account

### Screen Specifications

#### 1. Browse Screen
**Purpose:** Navigate music library from connected servers and Qobuz

**Layout:**
- Custom transparent header with:
  - Left: Server selector dropdown
  - Right: Filter/sort icon
  - No search bar (use dedicated Search tab)
- Scrollable main content with sections:
  - Recently Played (horizontal scroll)
  - Artists (grid view, 2 columns)
  - Albums (grid view, 2 columns)
  - Playlists (vertical list)
- Safe area insets: top: headerHeight + 24, bottom: tabBarHeight + 24

**Components:**
- Large album art cards (square, rounded corners)
- Artist tiles with circular images
- Section headers with "View All" links
- Pull-to-refresh

#### 2. Now Playing Screen (Modal)
**Purpose:** Full-screen playback control and track information

**Layout:**
- Custom header (transparent):
  - Left: Minimize chevron
  - Right: Three-dot menu (add to playlist, go to artist)
- Non-scrollable centered content:
  - Large album artwork (80% screen width, centered)
  - Track title (large, bold)
  - Artist name (medium, muted)
  - Playback timeline slider
  - Playback controls (previous, play/pause, next)
  - Volume slider
  - Output device selector
- Safe area insets: top: headerHeight + 40, bottom: insets.bottom + 40

**Components:**
- High-resolution album art with subtle shadow
- Custom slider with scrubbing support
- Large circular play/pause button (60dp)
- Device picker modal sheet

#### 3. Queue Screen
**Purpose:** View and manage playback queue

**Layout:**
- Default navigation header:
  - Title: "Queue"
  - Right: Clear queue button
- Scrollable list of tracks with:
  - Drag handles for reordering
  - Currently playing track highlighted
  - Upcoming tracks below
  - Swipe-to-remove gesture
- Safe area insets: top: 24, bottom: tabBarHeight + 24

**Components:**
- Reorderable list items with album thumbnails
- "Now Playing" separator
- Empty state for cleared queue

#### 4. Search Screen
**Purpose:** Global search across all music sources

**Layout:**
- Custom header with search bar (always visible)
- Scrollable content with tabbed results:
  - Tabs: All, Artists, Albums, Tracks, Qobuz
  - Results list with mixed content types
- Safe area insets: top: headerHeight + 24, bottom: tabBarHeight + 24

**Components:**
- Search bar with cancel button
- Segmented control for result filtering
- Mixed result cards (artist, album, track formats)

#### 5. Settings Screen
**Purpose:** Configure servers, playback, and account

**Layout:**
- Default navigation header: "Settings"
- Scrollable form with grouped sections:
  - Servers (UPNP/LMS connections)
  - Playback (gapless, crossfade, normalization)
  - Streaming Quality (Qobuz settings)
  - Account (profile, connected services)
- Safe area insets: top: 24, bottom: tabBarHeight + 24

**Components:**
- Grouped list with disclosure indicators
- Toggle switches for features
- Quality selector (Low/High/Hi-Res)

## Design System

### Color Palette (Roon-Inspired Dark Theme)
- **Background Primary:** #0A0A0C (deep black)
- **Background Secondary:** #1C1C1E (elevated surfaces)
- **Background Tertiary:** #2C2C2E (cards, inputs)
- **Accent Primary:** #4A9EFF (bright blue, for actions)
- **Accent Secondary:** #7C7CFF (purple, for Now Playing)
- **Text Primary:** #FFFFFF (100% white)
- **Text Secondary:** #A8A8B0 (70% white, muted info)
- **Text Tertiary:** #5E5E63 (40% white, disabled)
- **Border:** #38383A (subtle dividers)
- **Success:** #34C759 (connected status)
- **Warning:** #FF9F0A (quality indicators)

### Typography
- **Display:** SF Pro Display, 32pt, Bold (screen titles, artist names on Now Playing)
- **Title:** SF Pro Text, 22pt, Semibold (section headers)
- **Headline:** SF Pro Text, 17pt, Semibold (track titles)
- **Body:** SF Pro Text, 15pt, Regular (metadata, descriptions)
- **Caption:** SF Pro Text, 13pt, Regular (timestamps, subtitles)
- **Label:** SF Pro Text, 11pt, Medium (tags, badges)

### Visual Design
- **Icons:** Feather icons from @expo/vector-icons, 24dp default
- **Album Art:** Rounded corners (8dp), subtle shadow on Now Playing
- **Floating Now Playing Button:**
  - Position: Bottom center, 16dp above tab bar
  - Drop shadow: offset (0, 2), opacity 0.10, radius 2
  - Gradient background from album art dominant color
- **Cards:** Background Secondary, 12dp radius, no shadow
- **Buttons:** 
  - Primary: Accent Primary fill, 8dp radius, 48dp height
  - Secondary: Border only, 8dp radius
  - Icon-only: No background, press feedback only
- **All touchables:** Opacity feedback (0.6 when pressed)
- **Transitions:** 300ms ease-in-out for screen changes, 200ms for interactions

### Critical Assets
**Generate these assets:**
1. **3 User Avatars** (music-themed):
   - Vinyl record design (concentric circles, label)
   - Headphones design (over-ear style)
   - Waveform design (audio visualization)
2. **Placeholder Album Art** (1 generic):
   - Musical note on gradient background
3. **Empty State Illustrations:**
   - No queue: Musical notes floating
   - No servers: Network icon with plug

**Standard Icons:** Use Feather icons for navigation, playback controls, and settings.