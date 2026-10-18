"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Album,
  ArrowLeft,
  ChevronDown,
  Clock,
  Disc3,
  Flame,
  GripVertical,
  Heart,
  Library,
  ListMusic,
  ListPlus,
  LoaderCircle,
  Maximize2,
  Mic2,
  Minimize2,
  Music,
  Pause,
  Play,
  Radio,
  Repeat,
  Repeat1,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Speaker,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { coverArtUrl } from "@/lib/subsonic";
import styles from "./page.module.css";

type Song = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  coverArt?: string;
  created?: string;
  sortName?: string;
};

type AlbumItem = {
  id: string;
  name: string;
  artist?: string;
  coverArt?: string;
  year?: number;
  songCount?: number;
  duration?: number;
  genre?: string;
};

type Artist = {
  id: string;
  name: string;
  coverArt?: string;
  artistImageUrl?: string;
  albumCount?: number;
};

type Playlist = {
  id: string;
  name: string;
  comment?: string;
  owner?: string;
  songCount?: number;
  duration?: number;
  coverArt?: string;
};

type AlbumSort =
  | "alphabeticalByName"
  | "alphabeticalByArtist"
  | "frequent"
  | "recent"
  | "newest"
  | "highest"
  | "starred"
  | "random"
  | "byYear"
  | "byGenre";

type TrackSort = "all" | "title" | "recent" | "starred" | "random";

type ArtistSort = "az" | "za" | "albums";

type View =
  | "albums"
  | "artists"
  | "artistDetail"
  | "albumDetail"
  | "tracks"
  | "starred"
  | "playlists"
  | "playlistDetail";

// Overlays that occupy their own browser history entry
type Layer = "search" | "settings" | "queue" | "sheet" | "kiosk";

// Shape stored in history.state so Back/Forward can rebuild the screen
type NavEntry = {
  rp: true;
  view: View;
  album?: AlbumItem;
  artist?: Artist;
  playlist?: Playlist;
  albumBackView?: View;
  artistBackView?: View;
  albumSort?: AlbumSort;
  layers: Layer[];
  scroll?: number;
  root?: boolean;
};

type SearchResults = {
  artists: Artist[];
  albums: AlbumItem[];
  songs: Song[];
};

// Filter/sort options shared by the library views
const ALBUM_FILTERS: { label: string; sort: AlbumSort }[] = [
  { label: "Title", sort: "alphabeticalByName" },
  { label: "Artist", sort: "alphabeticalByArtist" },
  { label: "Recently Added", sort: "newest" },
  { label: "Recently Played", sort: "recent" },
  { label: "Most Played", sort: "frequent" },
  { label: "Starred", sort: "starred" },
  { label: "Random", sort: "random" },
];

const ARTIST_FILTERS: { label: string; sort: ArtistSort }[] = [
  { label: "Title A–Z", sort: "az" },
  { label: "Title Z–A", sort: "za" },
  { label: "Most Albums", sort: "albums" },
];

const TRACK_FILTERS: { label: string; sort: TrackSort }[] = [
  { label: "All", sort: "all" },
  { label: "Title", sort: "title" },
  { label: "Recently Added", sort: "recent" },
  { label: "Starred", sort: "starred" },
  { label: "Random", sort: "random" },
];

async function api<T>(method: string, params: Record<string, string> = {}) {
  const response = await fetch(
    `/api/subsonic?${new URLSearchParams({ method, ...params })}`,
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

async function playerApi<T>(body?: Record<string, unknown>) {
  const response = await fetch(
    "/api/player",
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Host playback unavailable");
  return data as T;
}

async function settingsApi<T>(body?: Record<string, unknown>) {
  const response = await fetch(
    "/api/settings",
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to update settings");
  return data as T;
}

const PLATFORM_LABELS: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

function formatPlatform(platform: string) {
  return PLATFORM_LABELS[platform] || platform || "Unknown";
}

function formatTime(seconds = 0) {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatTotalDuration(seconds = 0) {
  if (!seconds || isNaN(seconds)) return "";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours} hr ${remainingMins} min`;
}

// Client-side ordering for the loaded track page
function sortSongs(list: Song[], sort: TrackSort) {
  if (sort === "title") {
    return [...list].sort((a, b) =>
      (a.sortName || a.title).localeCompare(b.sortName || b.title),
    );
  }
  if (sort === "recent") {
    return [...list].sort((a, b) => (b.created || "").localeCompare(a.created || ""));
  }
  return list;
}

// Artwork with a loading spinner until the image resolves, and a graceful fallback on error
function CoverImage({
  src,
  alt,
  fallback,
  spinnerSize = 18,
}: {
  src: string | null;
  alt: string;
  fallback: ReactNode;
  spinnerSize?: number;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    src ? "loading" : "error",
  );

  useEffect(() => {
    setStatus(src ? "loading" : "error");
  }, [src]);

  // Cached images can finish before React binds onLoad, leaving the spinner
  // stuck; sync from the element's own state once it mounts.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete) {
      setStatus(img.naturalWidth > 0 ? "loaded" : "error");
    }
  }, [src]);

  if (!src || status === "error") return <>{fallback}</>;

  return (
    <>
      {status === "loading" && (
        <span className={styles.imgSpinner}>
          <LoaderCircle size={spinnerSize} />
        </span>
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        className={status === "loaded" ? styles.imgReady : styles.imgLoading}
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
      />
    </>
  );
}

function EqualizerBars() {
  return (
    <div className={styles.equalizerWave} aria-hidden="true">
      <span className={`${styles.eqBar} ${styles.eqBar1}`} />
      <span className={`${styles.eqBar} ${styles.eqBar2}`} />
      <span className={`${styles.eqBar} ${styles.eqBar3}`} />
      <span className={`${styles.eqBar} ${styles.eqBar4}`} />
    </div>
  );
}

// Placeholder shapes shown while library data loads
function AlbumGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className={styles.albumGrid} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.albumCard}>
          <div className={`${styles.albumCoverWrapper} ${styles.skeleton}`} />
          <div className={`${styles.skeletonLine} ${styles.skeleton}`} />
          <div
            className={`${styles.skeletonLine} ${styles.skeleton}`}
            style={{ width: "55%" }}
          />
        </div>
      ))}
    </div>
  );
}

function TrackListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className={styles.trackTable} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.skeletonRow}>
          <div className={`${styles.skeletonThumb} ${styles.skeleton}`} />
          <div style={{ flex: 1 }}>
            <div
              className={`${styles.skeletonLine} ${styles.skeleton}`}
              style={{ width: `${70 - (i % 3) * 15}%`, marginTop: 0 }}
            />
            <div
              className={`${styles.skeletonLine} ${styles.skeleton}`}
              style={{ width: "35%" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>{icon}</div>
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Space"], label: "Play / pause" },
  { keys: ["→", "←"], label: "Next / previous track" },
  { keys: ["↑", "↓"], label: "Host volume" },
  { keys: ["M"], label: "Mute" },
  { keys: ["S"], label: "Shuffle" },
  { keys: ["R"], label: "Cycle repeat" },
  { keys: ["Q"], label: "Toggle queue" },
  { keys: ["F"], label: "Kiosk mode" },
  { keys: ["/", "⌘K"], label: "Search" },
  { keys: ["Esc"], label: "Close panel" },
];

const CURATED_SORTS: AlbumSort[] = ["starred", "recent", "frequent", "random"];

// Queue rows have a fixed height so drag offsets map cleanly to indices
const QUEUE_ROW_HEIGHT = 56;

export default function Home() {
  const [view, setView] = useState<View>("albums");
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [songs, setSongs] = useState<Song[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [artistPage, setArtistPage] = useState(1);
  const [albumPage, setAlbumPage] = useState(0);
  const [albumSort, setAlbumSort] = useState<AlbumSort>("alphabeticalByName");
  const [artistSort, setArtistSort] = useState<ArtistSort>("az");
  const [trackOffset, setTrackOffset] = useState(0);
  const [trackSort, setTrackSort] = useState<TrackSort>("all");
  const [hasMoreAlbums, setHasMoreAlbums] = useState(false);
  const [hasMoreTracks, setHasMoreTracks] = useState(false);
  const [loading, setLoading] = useState<
    | "albums"
    | "artists"
    | "tracks"
    | "artistDetail"
    | "albumDetail"
    | "playlists"
    | "playlistDetail"
    | ""
  >("");

  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [artistAlbums, setArtistAlbums] = useState<AlbumItem[]>([]);
  const [artistSongs, setArtistSongs] = useState<Song[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumItem | null>(null);
  const [albumSongs, setAlbumSongs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistSongs, setPlaylistSongs] = useState<Song[]>([]);

  // Queue and Now Playing (Strictly Host Audio)
  const [queue, setQueue] = useState<Song[]>([]);
  const [current, setCurrent] = useState<Song | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [scrubPreview, setScrubPreview] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("off");
  const [likedSongs, setLikedSongs] = useState<Set<string>>(new Set());

  // UI Panels
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [kioskOpen, setKioskOpen] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [sheetClosing, setSheetClosing] = useState(false);
  const [sheetDrag, setSheetDrag] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [clockStr, setClockStr] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [searchIndex, setSearchIndex] = useState(-1);
  const [albumBackView, setAlbumBackView] = useState<View>("albums");
  const [artistBackView, setArtistBackView] = useState<View>("artists");
  const [queueDrag, setQueueDrag] = useState<{
    from: number;
    offset: number;
  } | null>(null);

  const libraryRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const flashTimerRef = useRef<number | undefined>(undefined);
  const sheetTouchRef = useRef<{ y: number; t: number } | null>(null);
  const queueDragStartRef = useRef(0);

  // Hardware Audio Output on Host
  const [audioOutput, setAudioOutput] = useState("auto");
  const [audioOutputs, setAudioOutputs] = useState<{ id: string; name: string }[]>([]);
  const [hostInfo, setHostInfo] = useState<{
    platform: string;
    backend: string | null;
    capabilities: { volume: boolean; outputSelection: boolean };
  }>({
    platform: "",
    backend: null,
    capabilities: { volume: false, outputSelection: false },
  });
  const [navidromeStatus, setNavidromeStatus] = useState<{ connected: boolean; version: string | null }>({
    connected: false,
    version: null,
  });

  // Track host state transitions for auto-advance in queue
  const wasPlayingRef = useRef(false);
  const currentSongIdRef = useRef<string | null>(null);
  currentSongIdRef.current = current?.id || null;

  // Clock for Kiosk mode
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setClockStr(
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      );
    };
    updateTime();
    const interval = window.setInterval(updateTime, 1000);
    return () => window.clearInterval(interval);
  }, []);

  // Track the mobile breakpoint so the expandable Now Playing sheet is wired
  // up only where the compact player bar hides the scrubber and controls
  useEffect(() => {
    const query = window.matchMedia("(max-width: 860px)");
    const sync = () => {
      setIsMobile(query.matches);
      if (!query.matches) setNowPlayingOpen(false);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Brief confirmation toast above the player dock
  function showFlash(message: string) {
    setFlash(message);
    window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlash(null), 2200);
  }

  // Animate the sheet out before unmounting it
  function closeNowPlaying() {
    setSheetClosing(true);
    window.setTimeout(() => {
      setNowPlayingOpen(false);
      setSheetClosing(false);
      setSheetDrag(0);
    }, 220);
  }

  // Browser history integration: views push entries, overlays push layers
  function pushNav(entry: Omit<NavEntry, "rp" | "layers">) {
    const here = window.history.state as NavEntry | null;
    if (here?.rp) {
      window.history.replaceState(
        { ...here, scroll: libraryRef.current?.scrollTop ?? 0 },
        "",
      );
    }
    const next: NavEntry = { rp: true, layers: [], ...entry };
    window.history.pushState(next, "");
  }

  function replaceNav(patch: Partial<NavEntry>) {
    const here = window.history.state as NavEntry | null;
    if (here?.rp) window.history.replaceState({ ...here, ...patch }, "");
  }

  // Load Albums
  async function loadAlbums(page = 0, sort = albumSort) {
    try {
      setLoading("albums");
      setErrorNotice(null);
      const data = await api<{ albumList2?: { album?: AlbumItem[] } }>(
        "getAlbumList2",
        { type: sort, size: "50", offset: String(page * 50) },
      );
      const nextAlbums = data.albumList2?.album || [];
      setAlbums(nextAlbums);
      setAlbumPage(page);
      setHasMoreAlbums(nextAlbums.length === 50);
    } catch (caught) {
      setErrorNotice(
        caught instanceof Error ? caught.message : "Connect Navidrome to begin",
      );
    } finally {
      setLoading("");
    }
  }

  // Load Artists
  async function loadArtists() {
    try {
      setLoading("artists");
      setErrorNotice(null);
      const data = await api<{ artists?: { index?: { artist?: Artist[] }[] } }>(
        "getArtists",
      );
      setArtists(
        data.artists?.index?.flatMap((index) => index.artist || []) || [],
      );
      setArtistPage(1);
    } catch (caught) {
      setErrorNotice(
        caught instanceof Error ? caught.message : "Unable to load artists",
      );
    } finally {
      setLoading("");
    }
  }

  // Load Tracks for the chosen sort. Starred/Random come from dedicated endpoints;
  // "recent" walks albums newest-first (Subsonic has no "newest songs" endpoint);
  // "all"/"title" page through the whole library and sort client-side.
  async function loadTracks(append = false, sort = trackSort) {
    try {
      setLoading("tracks");
      const offset = append ? trackOffset : 0;
      let nextSongs: Song[] = [];
      let nextOffset = offset;
      let hasMore = false;

      if (sort === "starred") {
        const data = await api<{ starred2?: { song?: Song[] } }>("getStarred2");
        nextSongs = data.starred2?.song || [];
      } else if (sort === "random") {
        const data = await api<{ randomSongs?: { song?: Song[] } }>(
          "getRandomSongs",
          { size: "60" },
        );
        nextSongs = data.randomSongs?.song || [];
      } else if (sort === "recent") {
        const albumPageSize = 10;
        const data = await api<{ albumList2?: { album?: AlbumItem[] } }>(
          "getAlbumList2",
          { type: "newest", size: String(albumPageSize), offset: String(offset) },
        );
        const newestAlbums = data.albumList2?.album || [];
        const albumSongs = await Promise.all(
          newestAlbums.map((album) =>
            api<{ album?: { song?: Song[] } }>("getAlbum", { id: album.id }).then(
              (res) => res.album?.song || [],
            ),
          ),
        );
        nextSongs = albumSongs.flat();
        nextOffset = offset + newestAlbums.length;
        hasMore = newestAlbums.length === albumPageSize;
      } else {
        const data = await api<{ searchResult3?: { song?: Song[] } }>("search3", {
          // Navidrome returns all songs for "*"; a bare letter matches nothing
          query: "*",
          songCount: "60",
          songOffset: String(offset),
          albumCount: "0",
          artistCount: "0",
        });
        nextSongs = data.searchResult3?.song || [];
        nextOffset = offset + nextSongs.length;
        hasMore = nextSongs.length === 60;
      }

      const merged = append ? [...songs, ...nextSongs] : nextSongs;
      setSongs(sortSongs(merged, sort));
      setTrackOffset(nextOffset);
      setHasMoreTracks(hasMore);
    } catch (caught) {
      setErrorNotice(
        caught instanceof Error ? caught.message : "Unable to load tracks",
      );
    } finally {
      setLoading("");
    }
  }

  // Apply a track sort chip
  function applyTrackSort(sort: TrackSort) {
    setTrackSort(sort);
    void loadTracks(false, sort);
  }

  // Open Album Detail
  async function openAlbum(album: AlbumItem, push = true) {
    try {
      setLoading("albumDetail");
      setErrorNotice(null);
      if (push) {
        setAlbumBackView(view);
        pushNav({ view: "albumDetail", album, albumBackView: view });
      }
      setSelectedAlbum(album);
      setAlbumSongs([]);
      setView("albumDetail");
      const data = await api<{ album?: { song?: Song[] } }>("getAlbum", {
        id: album.id,
      });
      setAlbumSongs(data.album?.song || []);
    } catch (caught) {
      setErrorNotice(
        caught instanceof Error ? caught.message : "Unable to open album",
      );
    } finally {
      setLoading("");
    }
  }

  // Load Playlists
  async function loadPlaylists() {
    try {
      setLoading("playlists");
      setErrorNotice(null);
      const data = await api<{ playlists?: { playlist?: Playlist[] } }>(
        "getPlaylists",
      );
      setPlaylists(data.playlists?.playlist || []);
    } catch (caught) {
      setErrorNotice(
        caught instanceof Error ? caught.message : "Unable to load playlists",
      );
    } finally {
      setLoading("");
    }
  }

  // Open Playlist Detail
  async function openPlaylist(playlist: Playlist, push = true) {
    try {
      setLoading("playlistDetail");
      setErrorNotice(null);
      if (push) pushNav({ view: "playlistDetail", playlist });
      setSelectedPlaylist(playlist);
      setPlaylistSongs([]);
      setView("playlistDetail");
      const data = await api<{ playlist?: { entry?: Song[] } }>("getPlaylist", {
        id: playlist.id,
      });
      setPlaylistSongs(data.playlist?.entry || []);
    } catch (caught) {
      setErrorNotice(
        caught instanceof Error ? caught.message : "Unable to open playlist",
      );
    } finally {
      setLoading("");
    }
  }

  // Open Artist Detail
  async function openArtist(artist: Artist, push = true) {
    try {
      setLoading("artistDetail");
      setErrorNotice(null);
      if (push) {
        setArtistBackView(view);
        pushNav({ view: "artistDetail", artist, artistBackView: view });
      }
      setSelectedArtist(artist);
      setArtistAlbums([]);
      setArtistSongs([]);
      setView("artistDetail");
      const data = await api<{ artist?: { album?: AlbumItem[] } }>(
        "getArtist",
        { id: artist.id },
      );
      const albums = data.artist?.album || [];
      const albumResults = await Promise.all(
        albums.map(async (alb) => {
          try {
            const albumData = await api<{ album?: { song?: Song[] } }>(
              "getAlbum",
              { id: alb.id },
            );
            return albumData.album?.song || [];
          } catch {
            return [];
          }
        }),
      );
      setArtistAlbums(albums);
      setArtistSongs(albumResults.flat());
    } catch (caught) {
      setErrorNotice(
        caught instanceof Error ? caught.message : "Unable to load artist",
      );
    } finally {
      setLoading("");
    }
  }

  // Play Album Directly on Host
  async function playAlbumImmediately(album: AlbumItem, shuffle = false) {
    try {
      setLoading("albumDetail");
      const data = await api<{ album?: { song?: Song[] } }>("getAlbum", {
        id: album.id,
      });
      const albumTracks = data.album?.song || [];
      if (!albumTracks.length) return;
      const trackList = shuffle
        ? [...albumTracks].sort(() => Math.random() - 0.5)
        : albumTracks;
      void playSong(trackList[0], trackList);
    } catch {
      setErrorNotice("Unable to play album on host");
    } finally {
      setLoading("");
    }
  }

  function dismissError() {
    setDismissedError(errorNotice?.replace(/^Host player: /, "") || null);
    setErrorNotice(null);
    void playerApi({ action: "clearError" }).catch(() => undefined);
  }

  // Sync with Host Server Player
  async function syncPlayer() {
    try {
      const player = await playerApi<{
        current: Song | null;
        playing: boolean;
        position: number;
        volume: number;
        error: string | null;
      }>();

      // Detect natural track completion on host to advance queue
      if (
        wasPlayingRef.current &&
        !player.playing &&
        !player.current &&
        currentSongIdRef.current &&
        !player.error
      ) {
        wasPlayingRef.current = false;
        if (repeatMode === "one" && current) void playSong(current);
        else nextSong();
        return;
      }

      wasPlayingRef.current = player.playing;
      setCurrent(player.current);
      setPlaying(player.playing);
      if (scrubPreview === null) setCurrentTime(player.position);

      if (player.error && player.error !== dismissedError) {
        setErrorNotice(`Host player: ${player.error}`);
      } else if (!player.error) {
        setDismissedError(null);
      }
    } catch {
      /* Keep UI smooth even if host status is briefly polling */
    }
  }

  // Play Track on Host Server
  async function playSong(song: Song, nextQueue = queue) {
    setCurrent(song);
    setCurrentTime(0);
    setQueue(nextQueue);
    try {
      const player = await playerApi<{ playing: boolean; position: number }>({
        action: "play",
        song,
      });
      setPlaying(player.playing);
      wasPlayingRef.current = player.playing;
    } catch (caught) {
      setPlaying(false);
      wasPlayingRef.current = false;
      const msg =
        caught instanceof Error
          ? caught.message
          : "Host player unavailable.";
      setErrorNotice(`Host audio: ${msg}`);
    }
  }

  // Toggle Host Play / Pause
  async function togglePlayPause() {
    if (!current && queue.length > 0) {
      void playSong(queue[0]);
      return;
    }
    if (!current) return;

    try {
      const player = await playerApi<{ playing: boolean; position: number }>({
        action: playing ? "pause" : "resume",
      });
      setPlaying(player.playing);
      wasPlayingRef.current = player.playing;
      setCurrentTime(player.position);
    } catch {
      setErrorNotice("Host player playback command failed");
    }
  }

  // Next Track on Host
  function nextSong() {
    if (!current || !queue.length) return;
    const currentIndex = queue.findIndex((s) => s.id === current.id);
    let nextIndex = currentIndex + 1;

    if (isShuffle) {
      nextIndex = Math.floor(Math.random() * queue.length);
    } else if (nextIndex >= queue.length) {
      if (repeatMode === "all") {
        nextIndex = 0;
      } else {
        return;
      }
    }

    const next = queue[nextIndex];
    if (next) void playSong(next);
  }

  // Previous Track on Host
  function previousSong() {
    if (!current || !queue.length) return;
    const currentIndex = queue.findIndex((s) => s.id === current.id);
    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0) {
      void playSong(queue[prevIndex]);
    } else if (repeatMode === "all") {
      void playSong(queue[queue.length - 1]);
    }
  }

  // Host Volume Change
  function handleVolumeChange(newVol: number) {
    setVolume(newVol);
    setIsMuted(false);
    void playerApi({ action: "volume", volume: newVol }).catch(() => undefined);
  }

  // Scrub to a position on the track progress bar (click or drag)
  function scrubRatioFromEvent(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    return Math.max(0, Math.min(1, ratio));
  }

  function startScrub(event: ReactPointerEvent<HTMLDivElement>) {
    if (!current?.duration) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrubPreview(scrubRatioFromEvent(event) * current.duration);
  }

  function moveScrub(event: ReactPointerEvent<HTMLDivElement>) {
    if (scrubPreview === null || !current?.duration) return;
    setScrubPreview(scrubRatioFromEvent(event) * current.duration);
  }

  function endScrub() {
    if (scrubPreview === null) return;
    const target = scrubPreview;
    setCurrentTime(target);
    void playerApi<{ playing: boolean; position: number }>({
      action: "seek",
      position: target,
    })
      .then((player) => {
        setPlaying(player.playing);
        wasPlayingRef.current = player.playing;
        setCurrentTime(player.position);
      })
      .catch(() => setErrorNotice("Host player seek failed"))
      .finally(() => setScrubPreview(null));
  }

  function cancelScrub() {
    setScrubPreview(null);
  }

  // Host Mute Toggle
  function toggleMute() {
    if (isMuted) {
      setIsMuted(false);
      void playerApi({ action: "volume", volume }).catch(() => undefined);
    } else {
      setIsMuted(true);
      void playerApi({ action: "volume", volume: 0 }).catch(() => undefined);
    }
  }

  // Toggle Favorite optimistically, then persist via star/unstar
  function toggleFavorite(songId: string) {
    const wasLiked = likedSongs.has(songId);
    const apply = (liked: boolean) =>
      setLikedSongs((prev) => {
        const next = new Set(prev);
        if (liked) next.add(songId);
        else next.delete(songId);
        return next;
      });
    apply(!wasLiked);
    void api(wasLiked ? "unstar" : "star", { id: songId }).catch(() => {
      apply(wasLiked);
      showFlash("Couldn't update favorite");
    });
  }

  function addToQueue(tracks: Song[]) {
    if (!tracks.length) return;
    setQueue((q) => [...q, ...tracks]);
    showFlash(
      tracks.length === 1
        ? `Added "${tracks[0].title}" to queue`
        : `Added ${tracks.length} tracks to queue`,
    );
  }

  function moveQueueItem(from: number, to: number) {
    if (from === to) return;
    setQueue((q) => {
      const next = [...q];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  // Pointer-driven reorder so the drag handle works on touch and mouse
  function startQueueDrag(event: ReactPointerEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    queueDragStartRef.current = event.clientY;
    setQueueDrag({ from: index, offset: 0 });
  }

  function moveQueueDrag(event: ReactPointerEvent) {
    if (!queueDrag) return;
    setQueueDrag({
      from: queueDrag.from,
      offset: event.clientY - queueDragStartRef.current,
    });
  }

  function endQueueDrag() {
    if (!queueDrag) return;
    moveQueueItem(queueDrag.from, queueDropIndex(queueDrag));
    setQueueDrag(null);
  }

  function queueDropIndex(drag: { from: number; offset: number }) {
    const target = drag.from + Math.round(drag.offset / QUEUE_ROW_HEIGHT);
    return Math.max(0, Math.min(queue.length - 1, target));
  }

  // Visual shift for rows the dragged item is passing over
  function queueRowShift(index: number) {
    if (!queueDrag) return 0;
    if (index === queueDrag.from) return queueDrag.offset;
    const to = queueDropIndex(queueDrag);
    if (queueDrag.from < to && index > queueDrag.from && index <= to) {
      return -QUEUE_ROW_HEIGHT;
    }
    if (queueDrag.from > to && index < queueDrag.from && index >= to) {
      return QUEUE_ROW_HEIGHT;
    }
    return 0;
  }

  function cycleRepeat() {
    setRepeatMode((prev) =>
      prev === "off" ? "all" : prev === "all" ? "one" : "off",
    );
  }

  // Albums come back already sorted by the chosen server-side filter
  const displayedAlbums = albums;

  // Artist ordering is applied client-side over the full indexed list
  const sortedArtists = useMemo(() => {
    const list = [...artists];
    if (artistSort === "za") {
      list.sort((a, b) => b.name.localeCompare(a.name));
    } else if (artistSort === "albums") {
      list.sort((a, b) => (b.albumCount || 0) - (a.albumCount || 0));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [artists, artistSort]);

  const currentQueueIndex = current
    ? queue.findIndex((s) => s.id === current.id)
    : -1;
  const upNext =
    currentQueueIndex >= 0
      ? queue[currentQueueIndex + 1] ||
        (repeatMode === "all" ? queue[0] : undefined)
      : undefined;

  // Bring the playing track into view when the queue opens or advances
  useEffect(() => {
    if (!queueOpen) return;
    document
      .querySelector("[data-now-playing]")
      ?.scrollIntoView({ block: "nearest" });
  }, [queueOpen, currentQueueIndex]);

  const visibleArtists = sortedArtists.slice(0, artistPage * 50);
  const hasMoreArtists = visibleArtists.length < sortedArtists.length;

  function changeView(nextView: View, push = true) {
    if (push && nextView !== view) pushNav({ view: nextView, albumSort });
    setView(nextView);
    if (nextView === "artists" && !artists.length) void loadArtists();
    if (nextView === "tracks" && !songs.length) void loadTracks();
    if (nextView === "playlists" && !playlists.length) void loadPlaylists();
  }

  // Jump to an album list curated by a server-side sort
  function openAlbumList(sort: AlbumSort) {
    if (view !== "albums" || sort !== albumSort) {
      pushNav({ view: "albums", albumSort: sort });
    }
    setAlbumSort(sort);
    void loadAlbums(0, sort);
    changeView("albums", false);
  }

  function viewLabel(target: View) {
    if (target === "artistDetail") return selectedArtist?.name || "Artist";
    if (target === "artists") return "Artists";
    if (target === "tracks") return "Tracks";
    if (target === "playlistDetail") return selectedPlaylist?.name || "Playlist";
    if (target === "playlists") return "Playlists";
    return "Albums";
  }

  // In-app back buttons reuse browser history so both stay in step
  function goBack(fallback: View) {
    const entry = window.history.state as NavEntry | null;
    if (entry?.rp && !entry.root) window.history.back();
    else changeView(fallback);
  }

  // Each view starts at the top, unless Back/Forward restored a saved offset
  const pendingScrollRef = useRef<number | null>(null);
  useEffect(() => {
    libraryRef.current?.scrollTo({ top: pendingScrollRef.current ?? 0 });
    pendingScrollRef.current = null;
  }, [view, selectedAlbum, selectedArtist]);

  // Search results flattened in display order for arrow-key navigation
  const searchActions: (() => void)[] = searchResults
    ? [
      ...searchResults.artists.map((artist) => () => {
        closeSearch();
        void openArtist(artist);
      }),
      ...searchResults.albums.map((album) => () => {
        closeSearch();
        void openAlbum(album);
      }),
      ...searchResults.songs.map((song) => () => {
        const list = searchResults.songs;
        closeSearch();
        void playSong(song, list);
      }),
    ]
    : [];

  const albumOffset = searchResults?.artists.length || 0;
  const songOffset = albumOffset + (searchResults?.albums.length || 0);

  useEffect(() => {
    if (searchIndex < 0) return;
    document
      .querySelector(`[data-search-index="${searchIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [searchIndex]);

  // Initial Load
  useEffect(() => {
    void loadAlbums();
  }, []);

  // Global search: debounced lookup across artists, albums and songs, shown in an overlay
  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setSearchResults(null);
      setSearchOpen(false);
      setSearching(false);
      return;
    }
    setSearchOpen(true);
    setSearching(true);
    const handle = window.setTimeout(() => {
      void api<{
        searchResult3?: { artist?: Artist[]; album?: AlbumItem[]; song?: Song[] };
      }>("search3", {
        query: term,
        artistCount: "8",
        albumCount: "12",
        songCount: "24",
      })
        .then((data) => {
          setSearchIndex(-1);
          setSearchResults({
            artists: data.searchResult3?.artist || [],
            albums: data.searchResult3?.album || [],
            songs: data.searchResult3?.song || [],
          });
        })
        .catch(() => setSearchResults({ artists: [], albums: [], songs: [] }))
        .finally(() => setSearching(false));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  function closeSearch() {
    setSearch("");
    setSearchOpen(false);
    setSearchResults(null);
  }

  const openLayers: Record<Layer, boolean> = useMemo(
    () => ({
      search: searchOpen,
      settings: settingsOpen,
      queue: queueOpen,
      sheet: nowPlayingOpen,
      kiosk: kioskOpen,
    }),
    [searchOpen, settingsOpen, queueOpen, nowPlayingOpen, kioskOpen],
  );
  const prevLayersRef = useRef(openLayers);
  // Layers closed by Back itself, so the sync effect must not pop again
  const poppedLayersRef = useRef(new Set<Layer>());
  // Set when the app calls history.back() rather than the user
  const expectPopRef = useRef(false);

  function closeLayer(layer: Layer) {
    if (layer === "search") closeSearch();
    else if (layer === "settings") setSettingsOpen(false);
    else if (layer === "queue") setQueueOpen(false);
    else if (layer === "sheet") closeNowPlaying();
    else setKioskOpen(false);
  }

  // Mirror overlay open/close into history so Back dismisses the top one
  useEffect(() => {
    const prev = prevLayersRef.current;
    prevLayersRef.current = openLayers;
    (Object.keys(openLayers) as Layer[]).forEach((layer) => {
      if (openLayers[layer] === prev[layer]) return;
      const here = window.history.state as NavEntry | null;
      if (!here?.rp) return;
      if (openLayers[layer]) {
        window.history.pushState(
          { ...here, root: false, layers: [...here.layers, layer] },
          "",
        );
      } else if (poppedLayersRef.current.has(layer)) {
        poppedLayersRef.current.delete(layer);
      } else if (here.layers[here.layers.length - 1] === layer) {
        expectPopRef.current = true;
        window.history.back();
      } else if (here.layers.includes(layer)) {
        window.history.replaceState(
          { ...here, layers: here.layers.filter((l) => l !== layer) },
          "",
        );
      }
    });
  }, [openLayers]);

  function handlePopState(event: PopStateEvent) {
    const entry = event.state as NavEntry | null;
    if (!entry?.rp) return;
    const expected = expectPopRef.current;
    expectPopRef.current = false;

    const toClose = (Object.keys(openLayers) as Layer[]).filter(
      (layer) => openLayers[layer] && !entry.layers.includes(layer),
    );
    for (const layer of toClose) {
      poppedLayersRef.current.add(layer);
      closeLayer(layer);
    }
    let changed = toClose.length > 0;

    if (!expected) {
      if (entry.view === "albumDetail" && entry.album) {
        if (view !== "albumDetail" || selectedAlbum?.id !== entry.album.id) {
          setAlbumBackView(entry.albumBackView ?? "albums");
          if (selectedAlbum?.id === entry.album.id) setView("albumDetail");
          else void openAlbum(entry.album, false);
          changed = true;
        }
      } else if (entry.view === "artistDetail" && entry.artist) {
        if (view !== "artistDetail" || selectedArtist?.id !== entry.artist.id) {
          setArtistBackView(entry.artistBackView ?? "artists");
          if (selectedArtist?.id === entry.artist.id) setView("artistDetail");
          else void openArtist(entry.artist, false);
          changed = true;
        }
      } else if (entry.view === "playlistDetail" && entry.playlist) {
        if (view !== "playlistDetail" || selectedPlaylist?.id !== entry.playlist.id) {
          if (selectedPlaylist?.id === entry.playlist.id) setView("playlistDetail");
          else void openPlaylist(entry.playlist, false);
          changed = true;
        }
      } else {
        const sortChanged =
          entry.view === "albums" && !!entry.albumSort && entry.albumSort !== albumSort;
        if (sortChanged && entry.albumSort) {
          setAlbumSort(entry.albumSort);
          void loadAlbums(0, entry.albumSort);
        }
        if (entry.view !== view || sortChanged) {
          changeView(entry.view, false);
          changed = true;
        }
      }
      if (changed) pendingScrollRef.current = entry.scroll ?? 0;
    }

    // Skip entries that no longer change anything on screen, such as a layer
    // that was already closed, but never step back past the app's first entry
    const stale =
      entry.layers.length > 0 &&
      entry.layers.every(
        (layer) => !openLayers[layer] || poppedLayersRef.current.has(layer),
      );
    if (!entry.root && (stale || (!expected && !changed))) {
      expectPopRef.current = true;
      window.history.back();
    }
  }

  const popHandlerRef = useRef<(event: PopStateEvent) => void>(() => undefined);
  useEffect(() => {
    popHandlerRef.current = handlePopState;
  });

  useEffect(() => {
    // The app always boots on the album grid, so the current entry becomes its root
    const root: NavEntry = {
      rp: true,
      view: "albums",
      albumSort: "alphabeticalByName",
      layers: [],
      root: true,
    };
    window.history.replaceState(root, "");
    const onPop = (event: PopStateEvent) => popHandlerRef.current(event);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Settings Init
  useEffect(() => {
    void settingsApi<{
      settings: { audioOutput: string };
      outputs: { id: string; name: string }[];
      host: {
        platform: string;
        backend: string | null;
        capabilities: { volume: boolean; outputSelection: boolean };
      };
      navidrome: { connected: boolean; version: string | null };
    }>()
      .then((data) => {
        setAudioOutput(data.settings.audioOutput);
        setAudioOutputs(data.outputs);
        setHostInfo(data.host);
        setNavidromeStatus(data.navidrome);
      })
      .catch(() => undefined);
  }, []);

  // Seed favorites from the server's starred songs
  useEffect(() => {
    void api<{ starred2?: { song?: Song[] } }>("getStarred2")
      .then((data) =>
        setLikedSongs(new Set((data.starred2?.song || []).map((s) => s.id))),
      )
      .catch(() => undefined);
  }, []);

  // Reflect the current track in the browser tab
  useEffect(() => {
    document.title = current
      ? `${playing ? "▶ " : ""}${current.title} · ${current.artist || "RemotePlay"}`
      : "RemotePlay";
  }, [current, playing]);

  // The poll and key handler are bound once, so they call through refs to see
  // the latest queue, current track and repeat mode
  const syncRef = useRef(syncPlayer);
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);

  function handleShortcut(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const typing =
      target?.tagName === "INPUT" ||
      target?.tagName === "SELECT" ||
      target?.tagName === "TEXTAREA";

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      return;
    }

    if (event.key === "Escape") {
      if (searchOpen) closeSearch();
      else if (settingsOpen) setSettingsOpen(false);
      else if (nowPlayingOpen) closeNowPlaying();
      else if (queueOpen) setQueueOpen(false);
      else if (kioskOpen) setKioskOpen(false);
      return;
    }

    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    // Let focused buttons handle their own activation keys
    const onControl = target?.closest("button, [role='button']");

    switch (event.key) {
      case " ":
        if (onControl) return;
        event.preventDefault();
        void togglePlayPause();
        break;
      case "ArrowRight":
        event.preventDefault();
        nextSong();
        break;
      case "ArrowLeft":
        event.preventDefault();
        previousSong();
        break;
      case "ArrowUp":
        event.preventDefault();
        handleVolumeChange(Math.min(1, Math.round((volume + 0.05) * 100) / 100));
        break;
      case "ArrowDown":
        event.preventDefault();
        handleVolumeChange(Math.max(0, Math.round((volume - 0.05) * 100) / 100));
        break;
      case "/":
        event.preventDefault();
        searchInputRef.current?.focus();
        break;
      default:
        switch (event.key.toLowerCase()) {
          case "m":
            toggleMute();
            break;
          case "s":
            showFlash(isShuffle ? "Shuffle off" : "Shuffle on");
            setIsShuffle(!isShuffle);
            break;
          case "r":
            showFlash(
              `Repeat ${repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off"}`,
            );
            cycleRepeat();
            break;
          case "q":
            setQueueOpen((open) => !open);
            break;
          case "f":
            setKioskOpen((open) => !open);
            break;
        }
    }
  }

  useEffect(() => {
    syncRef.current = syncPlayer;
    keyHandlerRef.current = handleShortcut;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Sync Poll with Host Server
  useEffect(() => {
    const start = window.setTimeout(() => void syncRef.current(), 0);
    const timer = window.setInterval(() => void syncRef.current(), 1000);
    const onFocus = () => void syncRef.current();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <main className={styles.shell}>
      {/* TOP HEADER */}
      <header className={styles.header}>
        <div className={styles.brand} onClick={() => changeView("albums")}>
          <div className={styles.brandMark}>
            <Disc3 size={22} />
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandTitle}>
              REMOTE<span>PLAY</span>
            </span>
            <span className={styles.brandSubtitle}>Navidrome Pi Controller</span>
          </div>
        </div>

        {/* Global Search Bar */}
        <label className={styles.search} htmlFor="global-search-input">
          <Search size={16} />
          <input
            ref={searchInputRef}
            id="global-search-input"
            value={search}
            autoComplete="off"
            enterKeyHint="search"
            onChange={(event) => setSearch(event.target.value)}
            onFocus={() => {
              if (searchResults) setSearchOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeSearch();
                event.currentTarget.blur();
              } else if (event.key === "ArrowDown" && searchActions.length) {
                event.preventDefault();
                setSearchIndex((i) => Math.min(searchActions.length - 1, i + 1));
              } else if (event.key === "ArrowUp" && searchActions.length) {
                event.preventDefault();
                setSearchIndex((i) => Math.max(0, i - 1));
              } else if (event.key === "Enter" && searchActions.length) {
                event.preventDefault();
                searchActions[Math.max(0, searchIndex)]();
                event.currentTarget.blur();
              }
            }}
            placeholder="Search albums, artists, or songs..."
          />
          {search ? (
            <button
              className={styles.clearSearchBtn}
              onClick={closeSearch}
              aria-label="Clear search query"
            >
              <X size={14} />
            </button>
          ) : (
            <kbd className={styles.searchKbd}>⌘K</kbd>
          )}
        </label>

        {/* Header Actions */}
        <div className={styles.headerActions}>
          {/* Host Audio Status Pill */}
          <div
            className={styles.hostAudioPill}
            title="Audio is played through the host machine (Raspberry Pi speaker/DAC)"
          >
            <Radio size={13} />
            <span>Host Speaker Active</span>
          </div>

          {/* Kiosk Mode Trigger */}
          <button
            className={styles.iconButton}
            onClick={() => setKioskOpen(true)}
            aria-label="Enter Fullscreen Kiosk Mode"
            title="Fullscreen Pi Kiosk Mode"
          >
            <Maximize2 size={17} />
          </button>

          {/* Settings Trigger */}
          <button
            className={styles.iconButton}
            onClick={() => setSettingsOpen(true)}
            aria-label="Open Settings"
            title="Settings & Audio Sinks"
          >
            <Settings size={17} />
          </button>
        </div>
      </header>

      {/* MAIN SPLIT CONTENT */}
      <section className={styles.content}>
        {/* SIDEBAR NAVIGATION */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarSection}>
            <p className={styles.eyebrow}>LIBRARY</p>
            <nav>
              <button
                className={`${styles.navButton} ${
                  (view === "albums" && !CURATED_SORTS.includes(albumSort)) ||
                  (view === "albumDetail" &&
                    (albumBackView === "albums" || albumBackView === "starred"))
                    ? styles.activeNav
                    : ""
                }`}
                onClick={() => {
                  if (CURATED_SORTS.includes(albumSort)) {
                    openAlbumList("alphabeticalByName");
                  } else {
                    changeView("albums");
                  }
                }}
              >
                <Album size={18} /> Albums
              </button>
              <button
                className={`${styles.navButton} ${
                  view === "artists" ||
                  view === "artistDetail" ||
                  (view === "albumDetail" && albumBackView === "artistDetail")
                    ? styles.activeNav
                    : ""
                }`}
                onClick={() => changeView("artists")}
              >
                <Mic2 size={18} /> Artists
              </button>
              <button
                className={`${styles.navButton} ${
                  view === "tracks" ||
                  (view === "albumDetail" && albumBackView === "tracks")
                    ? styles.activeNav
                    : ""
                }`}
                onClick={() => changeView("tracks")}
              >
                <ListMusic size={18} /> Tracks
              </button>
              <button
                className={`${styles.navButton} ${
                  view === "albums" && albumSort === "starred" ? styles.activeNav : ""
                }`}
                onClick={() => openAlbumList("starred")}
              >
                <Heart size={18} /> Starred Mix
              </button>
              <button
                className={`${styles.navButton} ${
                  view === "playlists" || view === "playlistDetail"
                    ? styles.activeNav
                    : ""
                }`}
                onClick={() => changeView("playlists")}
              >
                <Library size={18} /> Playlists
              </button>
            </nav>
          </div>

          <div className={styles.sidebarSection}>
            <p className={styles.eyebrow}>QUICK CURATION</p>
            <nav>
              {(
                [
                  { sort: "recent", label: "Recently Played", icon: <Clock size={16} /> },
                  { sort: "frequent", label: "Most Played", icon: <Flame size={16} /> },
                  { sort: "random", label: "Surprise Shuffle", icon: <Sparkles size={16} /> },
                ] as const
              ).map((item) => (
                <button
                  key={item.sort}
                  className={`${styles.navButton} ${
                    view === "albums" && albumSort === item.sort ? styles.activeNav : ""
                  }`}
                  onClick={() => openAlbumList(item.sort)}
                >
                  {item.icon} {item.label}
                </button>
              ))}
            </nav>
          </div>

          {/* HARDWARE DEVICE CARD */}
          <button
            className={styles.deviceCard}
            onClick={() => setSettingsOpen(true)}
            title="Click to configure host audio output sink"
          >
            <div className={styles.deviceIconBadge}>
              <Speaker size={18} />
            </div>
            <div className={styles.deviceInfo}>
              <strong>Raspberry Pi Audio</strong>
              <small>
                {audioOutput === "auto" ? "Default Output" : audioOutput} · {hostInfo.backend || "No player"}
              </small>
            </div>
            <span className={styles.liveDot} />
          </button>
        </aside>

        {/* LIBRARY DISPLAY */}
        <section className={styles.library} ref={libraryRef}>
          {/* TOAST NOTICE */}
          {errorNotice && (
            <div className={styles.toastNotice}>
              <div className={styles.toastContent}>
                <Radio size={18} color="var(--coral)" />
                <div>
                  <strong>Notice:</strong> {errorNotice}
                </div>
              </div>
              <button
                className={styles.toastCloseBtn}
                onClick={dismissError}
                aria-label="Dismiss notice"
              >
                <X size={15} />
              </button>
            </div>
          )}

          {/* ALBUMS VIEW */}
          {view === "albums" && (
            <>
              <div className={styles.pageHeading}>
                <div>
                  <p className={styles.eyebrow}>YOUR COLLECTION</p>
                  <h1>Albums</h1>
                </div>
                <span className={styles.countBadge}>
                  {albums.length} albums
                </span>
              </div>

              {/* FILTERS */}
              <div className={styles.toolbar}>
                <div className={styles.filterChips}>
                  {ALBUM_FILTERS.map((filter) => (
                    <button
                      key={filter.sort}
                      className={`${styles.filterChip} ${
                        albumSort === filter.sort ? styles.activeChip : ""
                      }`}
                      onClick={() => {
                        setAlbumSort(filter.sort);
                        replaceNav({ albumSort: filter.sort });
                        void loadAlbums(0, filter.sort);
                      }}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ALBUM CARDS GRID */}
              {loading === "albums" && !albums.length ? (
                <AlbumGridSkeleton />
              ) : !albums.length && !errorNotice ? (
                <EmptyState
                  icon={albumSort === "starred" ? <Heart size={26} /> : <Album size={26} />}
                  title={
                    albumSort === "starred" ? "No starred albums yet" : "No albums here"
                  }
                  hint={
                    albumSort === "starred"
                      ? "Star albums in Navidrome and they will show up here."
                      : "Try a different filter."
                  }
                />
              ) : (
                <div
                  className={`${styles.albumGrid} ${
                    loading === "albums" ? styles.refreshing : ""
                  }`}
                >
                  {displayedAlbums.map((album) => (
                    <div
                      key={album.id}
                      className={styles.albumCard}
                      onClick={() => void openAlbum(album)}
                    >
                      <div className={styles.albumCoverWrapper}>
                        <CoverImage
                          src={coverArtUrl(album.coverArt, "400")}
                          alt={album.name}
                          spinnerSize={22}
                          fallback={
                            <div className={styles.vinylPlaceholder}>
                              <Disc3 size={38} />
                            </div>
                          }
                        />

                        {/* Quick Play Hover Button (Plays on host speaker) */}
                        <div
                          className={styles.cardPlayOverlay}
                          onClick={(e) => {
                            e.stopPropagation();
                            void playAlbumImmediately(album);
                          }}
                        >
                          <button
                            className={styles.quickPlayBtn}
                            aria-label={`Play album ${album.name} on host`}
                          >
                            <Play size={20} fill="currentColor" />
                          </button>
                        </div>
                      </div>

                      <strong>{album.name}</strong>
                      <span>{album.artist || "Unknown Artist"}</span>
                      {album.year && <small>{album.year}</small>}
                    </div>
                  ))}
                </div>
              )}

              {/* PAGINATION */}
              {(albumPage > 0 || hasMoreAlbums) && (
                <div className={styles.pagination}>
                  <button
                    className={styles.paginationBtn}
                    disabled={albumPage === 0 || loading === "albums"}
                    onClick={() => void loadAlbums(albumPage - 1)}
                  >
                    ← Previous
                  </button>
                  <span className={styles.paginationPage}>
                    Page {albumPage + 1}
                  </span>
                  <button
                    className={styles.paginationBtn}
                    disabled={!hasMoreAlbums || loading === "albums"}
                    onClick={() => void loadAlbums(albumPage + 1)}
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          )}

          {/* ARTISTS VIEW */}
          {view === "artists" && (
            <>
              <div className={styles.pageHeading}>
                <div>
                  <p className={styles.eyebrow}>DISCOGRAPHY</p>
                  <h1>Artists</h1>
                </div>
                <span className={styles.countBadge}>
                  {artists.length} artists
                </span>
              </div>

              {/* FILTERS */}
              <div className={styles.toolbar}>
                <div className={styles.filterChips}>
                  {ARTIST_FILTERS.map((filter) => (
                    <button
                      key={filter.sort}
                      className={`${styles.filterChip} ${
                        artistSort === filter.sort ? styles.activeChip : ""
                      }`}
                      onClick={() => {
                        setArtistSort(filter.sort);
                        setArtistPage(1);
                      }}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              {loading === "artists" && !artists.length ? (
                <AlbumGridSkeleton />
              ) : (
                <div className={styles.artistGrid}>
                  {visibleArtists.map((artist) => (
                    <div
                      key={artist.id}
                      className={styles.artistCard}
                      onClick={() => void openArtist(artist)}
                    >
                      <div className={styles.artistAvatar}>
                        <CoverImage
                          src={
                            artist.artistImageUrl ||
                            coverArtUrl(artist.coverArt, "240")
                          }
                          alt={artist.name}
                          spinnerSize={22}
                          fallback={<>{artist.name.slice(0, 1).toUpperCase()}</>}
                        />
                      </div>
                      <strong>{artist.name}</strong>
                      <small>View Discography</small>
                    </div>
                  ))}
                </div>
              )}

              {hasMoreArtists && (
                <div style={{ textAlign: "center", marginTop: "32px" }}>
                  <button
                    className={styles.secondaryActionBtn}
                    style={{ margin: "0 auto" }}
                    onClick={() => setArtistPage((p) => p + 1)}
                  >
                    Load More Artists
                  </button>
                </div>
              )}
            </>
          )}

          {/* ALBUM DETAIL VIEW */}
          {view === "albumDetail" && selectedAlbum && (
            <div>
              <button
                className={styles.backBtn}
                onClick={() => goBack(albumBackView)}
              >
                <ArrowLeft size={14} />
                {viewLabel(albumBackView)}
              </button>

              {/* HERO BANNER WITH AMBIENT BACKDROP */}
              <div className={styles.detailHero}>
                {selectedAlbum.coverArt && (
                  <div
                    className={styles.heroBackdrop}
                    style={{
                      backgroundImage: `url(${coverArtUrl(selectedAlbum.coverArt, "400")})`,
                    }}
                  />
                )}
                <div className={styles.heroContent}>
                  <div className={styles.heroArtwork}>
                    <CoverImage
                      src={coverArtUrl(selectedAlbum.coverArt, "500")}
                      alt={selectedAlbum.name}
                      spinnerSize={28}
                      fallback={<Disc3 size={64} color="var(--accent)" />}
                    />
                  </div>
                  <div className={styles.heroMeta}>
                    <p className={styles.eyebrow}>ALBUM</p>
                    <h2>{selectedAlbum.name}</h2>
                    <div className={styles.heroMetaSubtitle}>
                      <strong>{selectedAlbum.artist || "Unknown Artist"}</strong>
                      {selectedAlbum.year && <span>· {selectedAlbum.year}</span>}
                      {albumSongs.length > 0 && (
                        <span>
                          · {albumSongs.length} tracks (
                          {formatTotalDuration(
                            albumSongs.reduce((sum, s) => sum + (s.duration || 0), 0),
                          )}
                          )
                        </span>
                      )}
                    </div>
                    <div className={styles.heroActions}>
                      <button
                        className={styles.primaryPlayBtn}
                        disabled={!albumSongs.length}
                        onClick={() => {
                          if (albumSongs.length > 0) {
                            void playSong(albumSongs[0], albumSongs);
                          }
                        }}
                      >
                        <Play size={17} fill="currentColor" /> Play on Host Speaker
                      </button>
                      <button
                        className={styles.secondaryActionBtn}
                        disabled={!albumSongs.length}
                        onClick={() => {
                          if (albumSongs.length > 0) {
                            const shuffled = [...albumSongs].sort(() => Math.random() - 0.5);
                            void playSong(shuffled[0], shuffled);
                          }
                        }}
                      >
                        <Shuffle size={15} /> Shuffle
                      </button>
                      <button
                        className={styles.secondaryActionBtn}
                        disabled={!albumSongs.length}
                        onClick={() => addToQueue(albumSongs)}
                      >
                        <ListMusic size={15} /> Add to Queue
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* TRACK LIST TABLE */}
              {loading === "albumDetail" && !albumSongs.length ? (
                <TrackListSkeleton />
              ) : (
                <div className={styles.trackTable}>
                  <div className={styles.trackTableHeader}>
                    <span>#</span>
                    <span>Title</span>
                    <span style={{ textAlign: "right" }}>Duration</span>
                    <span />
                  </div>
                  {albumSongs.map((song, index) => {
                    const isCurrentSong = current?.id === song.id;
                    return (
                      <div
                        key={song.id}
                        className={`${styles.trackRow} ${
                          isCurrentSong ? styles.activeTrack : ""
                        }`}
                        onClick={() => void playSong(song, albumSongs)}
                      >
                        <div className={styles.trackIndex}>
                          {isCurrentSong && playing ? (
                            <EqualizerBars />
                          ) : (
                            <>
                              <span className={styles.trackNumberText}>
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <Play size={14} className={styles.hoverPlayIcon} fill="currentColor" />
                            </>
                          )}
                        </div>
                        <div className={styles.trackMain}>
                          <div className={styles.trackMeta}>
                            <strong>{song.title}</strong>
                            <small>{song.artist || selectedAlbum.artist}</small>
                          </div>
                        </div>
                        <span className={styles.trackDuration}>
                          {formatTime(song.duration)}
                        </span>
                        <div className={styles.trackRowActions}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              addToQueue([song]);
                            }}
                            aria-label="Add to queue"
                            title="Add to queue"
                          >
                            <ListPlus size={16} />
                          </button>
                          <button
                            className={likedSongs.has(song.id) ? styles.liked : ""}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(song.id);
                            }}
                            aria-label={likedSongs.has(song.id) ? "Unfavorite track" : "Favorite track"}
                            aria-pressed={likedSongs.has(song.id)}
                          >
                            <Heart
                              size={15}
                              fill={likedSongs.has(song.id) ? "var(--coral)" : "none"}
                              color={likedSongs.has(song.id) ? "var(--coral)" : "currentColor"}
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ARTIST DETAIL VIEW */}
          {view === "artistDetail" && selectedArtist && (
            <div>
              <button
                className={styles.backBtn}
                onClick={() => goBack(artistBackView)}
              >
                <ArrowLeft size={14} /> {viewLabel(artistBackView)}
              </button>

              <div className={styles.detailHero}>
                {selectedArtist.coverArt && (
                  <div
                    className={styles.heroBackdrop}
                    style={{
                      backgroundImage: `url(${coverArtUrl(selectedArtist.coverArt, "400")})`,
                    }}
                  />
                )}
                <div className={styles.heroContent}>
                  <div
                    className={styles.heroArtwork}
                    style={{ borderRadius: "50%" }}
                  >
                    <CoverImage
                      src={
                        selectedArtist.artistImageUrl ||
                        coverArtUrl(selectedArtist.coverArt, "400")
                      }
                      alt={selectedArtist.name}
                      spinnerSize={28}
                      fallback={<Mic2 size={64} color="var(--accent)" />}
                    />
                  </div>
                  <div className={styles.heroMeta}>
                    <p className={styles.eyebrow}>ARTIST</p>
                    <h2>{selectedArtist.name}</h2>
                    <div className={styles.heroMetaSubtitle}>
                      <span>{artistAlbums.length} albums</span>
                      <span>· {artistSongs.length} tracks</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Discography Albums */}
              <h3 className={styles.sectionTitle}>Albums</h3>
              {loading === "artistDetail" && !artistAlbums.length ? (
                <AlbumGridSkeleton count={6} />
              ) : (
                <div className={styles.albumGrid}>
                  {artistAlbums.map((album) => (
                    <div
                      key={album.id}
                      className={styles.albumCard}
                      onClick={() => void openAlbum(album)}
                    >
                      <div className={styles.albumCoverWrapper}>
                        <CoverImage
                          src={coverArtUrl(album.coverArt, "400")}
                          alt={album.name}
                          spinnerSize={22}
                          fallback={
                            <div className={styles.vinylPlaceholder}>
                              <Disc3 size={38} />
                            </div>
                          }
                        />
                        <div
                          className={styles.cardPlayOverlay}
                          onClick={(e) => {
                            e.stopPropagation();
                            void playAlbumImmediately(album);
                          }}
                        >
                          <button className={styles.quickPlayBtn} aria-label="Play album on host">
                            <Play size={20} fill="currentColor" />
                          </button>
                        </div>
                      </div>
                      <strong>{album.name}</strong>
                      <span>{album.year || ""}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Tracks List */}
              <h3 className={styles.sectionTitle}>All Tracks</h3>
              {loading === "artistDetail" && !artistSongs.length ? (
                <TrackListSkeleton />
              ) : (
                <div className={styles.trackTable}>
                  {artistSongs.map((song, index) => {
                    const isCurrentSong = current?.id === song.id;
                    return (
                      <div
                        key={song.id}
                        className={`${styles.trackRow} ${
                          isCurrentSong ? styles.activeTrack : ""
                        }`}
                        onClick={() => void playSong(song, artistSongs)}
                      >
                        <div className={styles.trackIndex}>
                          {isCurrentSong && playing ? (
                            <EqualizerBars />
                          ) : (
                            <>
                              <span className={styles.trackNumberText}>
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <Play size={14} className={styles.hoverPlayIcon} fill="currentColor" />
                            </>
                          )}
                        </div>
                        <div className={styles.trackMain}>
                          <div className={styles.trackThumb}>
                            <CoverImage
                              src={coverArtUrl(song.coverArt, "120")}
                              alt=""
                              spinnerSize={14}
                              fallback={<Music size={16} />}
                            />
                          </div>
                          <div className={styles.trackMeta}>
                            <strong>{song.title}</strong>
                            <small>{song.album}</small>
                          </div>
                        </div>
                        <span className={styles.trackDuration}>
                          {formatTime(song.duration)}
                        </span>
                        <div className={styles.trackRowActions}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              addToQueue([song]);
                            }}
                            aria-label="Add to queue"
                            title="Add to queue"
                          >
                            <ListPlus size={16} />
                          </button>
                          <button
                            className={likedSongs.has(song.id) ? styles.liked : ""}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(song.id);
                            }}
                            aria-label={likedSongs.has(song.id) ? "Unfavorite track" : "Favorite track"}
                            aria-pressed={likedSongs.has(song.id)}
                          >
                            <Heart
                              size={15}
                              fill={likedSongs.has(song.id) ? "var(--coral)" : "none"}
                              color={likedSongs.has(song.id) ? "var(--coral)" : "currentColor"}
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TRACKS VIEW */}
          {view === "tracks" && (
            <>
              <div className={styles.pageHeading}>
                <div>
                  <p className={styles.eyebrow}>LIBRARY</p>
                  <h1>Tracks</h1>
                </div>
                <span className={styles.countBadge}>{songs.length} tracks</span>
              </div>

              {/* FILTERS */}
              <div className={styles.toolbar}>
                <div className={styles.filterChips}>
                  {TRACK_FILTERS.map((filter) => (
                    <button
                      key={filter.sort}
                      className={`${styles.filterChip} ${
                        trackSort === filter.sort ? styles.activeChip : ""
                      }`}
                      onClick={() => applyTrackSort(filter.sort)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>

              {loading === "tracks" && !songs.length ? (
                <TrackListSkeleton count={10} />
              ) : !songs.length && !errorNotice ? (
                <EmptyState
                  icon={trackSort === "starred" ? <Heart size={26} /> : <Music size={26} />}
                  title={trackSort === "starred" ? "No starred tracks yet" : "No tracks found"}
                  hint={
                    trackSort === "starred"
                      ? "Tap the heart on any track to star it."
                      : undefined
                  }
                />
              ) : (
                <div className={styles.trackTable}>
                  <div className={styles.trackTableHeader}>
                    <span>#</span>
                    <span>Title & Artist</span>
                    <span style={{ textAlign: "right" }}>Duration</span>
                    <span />
                  </div>
                  {songs.map((song, index) => {
                    const isCurrentSong = current?.id === song.id;
                    return (
                      <div
                        key={song.id}
                        className={`${styles.trackRow} ${
                          isCurrentSong ? styles.activeTrack : ""
                        }`}
                        onClick={() => void playSong(song, songs)}
                      >
                        <div className={styles.trackIndex}>
                          {isCurrentSong && playing ? (
                            <EqualizerBars />
                          ) : (
                            <>
                              <span className={styles.trackNumberText}>
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <Play
                                size={14}
                                className={styles.hoverPlayIcon}
                                fill="currentColor"
                              />
                            </>
                          )}
                        </div>
                        <div className={styles.trackMain}>
                          <div className={styles.trackThumb}>
                            <CoverImage
                              src={coverArtUrl(song.coverArt, "120")}
                              alt=""
                              spinnerSize={14}
                              fallback={<Music size={16} />}
                            />
                          </div>
                          <div className={styles.trackMeta}>
                            <strong>{song.title}</strong>
                            <small>
                              {song.artist} · {song.album}
                            </small>
                          </div>
                        </div>
                        <span className={styles.trackDuration}>
                          {formatTime(song.duration)}
                        </span>
                        <div className={styles.trackRowActions}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              addToQueue([song]);
                            }}
                            aria-label="Add to queue"
                            title="Add to queue"
                          >
                            <ListPlus size={16} />
                          </button>
                          <button
                            className={likedSongs.has(song.id) ? styles.liked : ""}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(song.id);
                            }}
                            aria-label={likedSongs.has(song.id) ? "Unfavorite track" : "Favorite track"}
                            aria-pressed={likedSongs.has(song.id)}
                          >
                            <Heart
                              size={15}
                              fill={likedSongs.has(song.id) ? "var(--coral)" : "none"}
                              color={likedSongs.has(song.id) ? "var(--coral)" : "currentColor"}
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {hasMoreTracks && (
                <div style={{ textAlign: "center", marginTop: "32px" }}>
                  <button
                    className={styles.secondaryActionBtn}
                    style={{ margin: "0 auto" }}
                    onClick={() => void loadTracks(true)}
                    disabled={loading === "tracks"}
                  >
                    {loading === "tracks" && (
                      <LoaderCircle
                        size={14}
                        style={{ animation: "remoteplay-spin 1s linear infinite" }}
                      />
                    )}
                    Load More Tracks
                  </button>
                </div>
              )}
            </>
          )}

          {/* PLAYLISTS VIEW */}
          {view === "playlists" && (
            <>
              <div className={styles.pageHeading}>
                <div>
                  <p className={styles.eyebrow}>NAVIDROME</p>
                  <h1>Playlists</h1>
                </div>
                <span className={styles.countBadge}>
                  {playlists.length} playlists
                </span>
              </div>

              {loading === "playlists" && !playlists.length ? (
                <AlbumGridSkeleton count={8} />
              ) : !playlists.length && !errorNotice ? (
                <EmptyState
                  icon={<Library size={26} />}
                  title="No playlists yet"
                  hint="Create a playlist in Navidrome and it will show up here."
                />
              ) : (
                <div className={styles.albumGrid}>
                  {playlists.map((playlist) => (
                    <div
                      key={playlist.id}
                      className={styles.albumCard}
                      onClick={() => void openPlaylist(playlist)}
                    >
                      <div className={styles.albumCoverWrapper}>
                        <CoverImage
                          src={coverArtUrl(playlist.coverArt, "400")}
                          alt={playlist.name}
                          spinnerSize={22}
                          fallback={
                            <div className={styles.vinylPlaceholder}>
                              <Library size={38} />
                            </div>
                          }
                        />
                      </div>
                      <strong>{playlist.name}</strong>
                      <span>
                        {playlist.songCount ?? 0} track
                        {playlist.songCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* PLAYLIST DETAIL VIEW */}
          {view === "playlistDetail" && selectedPlaylist && (
            <div>
              <button className={styles.backBtn} onClick={() => goBack("playlists")}>
                <ArrowLeft size={14} /> {viewLabel("playlists")}
              </button>

              <div className={styles.detailHero}>
                {selectedPlaylist.coverArt && (
                  <div
                    className={styles.heroBackdrop}
                    style={{
                      backgroundImage: `url(${coverArtUrl(selectedPlaylist.coverArt, "400")})`,
                    }}
                  />
                )}
                <div className={styles.heroContent}>
                  <div className={styles.heroArtwork}>
                    <CoverImage
                      src={coverArtUrl(selectedPlaylist.coverArt, "500")}
                      alt={selectedPlaylist.name}
                      spinnerSize={28}
                      fallback={<Library size={64} color="var(--accent)" />}
                    />
                  </div>
                  <div className={styles.heroMeta}>
                    <p className={styles.eyebrow}>PLAYLIST</p>
                    <h2>{selectedPlaylist.name}</h2>
                    <div className={styles.heroMetaSubtitle}>
                      <span>{playlistSongs.length} tracks</span>
                      {playlistSongs.length > 0 && (
                        <span>
                          · {formatTotalDuration(
                            playlistSongs.reduce((sum, s) => sum + (s.duration || 0), 0),
                          )}
                        </span>
                      )}
                    </div>
                    <div className={styles.heroActions}>
                      <button
                        className={styles.primaryPlayBtn}
                        disabled={!playlistSongs.length}
                        onClick={() => {
                          if (playlistSongs.length > 0) {
                            void playSong(playlistSongs[0], playlistSongs);
                          }
                        }}
                      >
                        <Play size={17} fill="currentColor" /> Play on Host Speaker
                      </button>
                      <button
                        className={styles.secondaryActionBtn}
                        disabled={!playlistSongs.length}
                        onClick={() => {
                          if (playlistSongs.length > 0) {
                            const shuffled = [...playlistSongs].sort(
                              () => Math.random() - 0.5,
                            );
                            void playSong(shuffled[0], shuffled);
                          }
                        }}
                      >
                        <Shuffle size={15} /> Shuffle
                      </button>
                      <button
                        className={styles.secondaryActionBtn}
                        disabled={!playlistSongs.length}
                        onClick={() => addToQueue(playlistSongs)}
                      >
                        <ListMusic size={15} /> Add to Queue
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {loading === "playlistDetail" && !playlistSongs.length ? (
                <TrackListSkeleton />
              ) : !playlistSongs.length && !errorNotice ? (
                <EmptyState
                  icon={<Library size={26} />}
                  title="This playlist is empty"
                  hint="Add tracks to it in Navidrome."
                />
              ) : (
                <div className={styles.trackTable}>
                  <div className={styles.trackTableHeader}>
                    <span>#</span>
                    <span>Title & Artist</span>
                    <span style={{ textAlign: "right" }}>Duration</span>
                    <span />
                  </div>
                  {playlistSongs.map((song, index) => {
                    const isCurrentSong = current?.id === song.id;
                    return (
                      <div
                        key={`${song.id}-${index}`}
                        className={`${styles.trackRow} ${
                          isCurrentSong ? styles.activeTrack : ""
                        }`}
                        onClick={() => void playSong(song, playlistSongs)}
                      >
                        <div className={styles.trackIndex}>
                          {isCurrentSong && playing ? (
                            <EqualizerBars />
                          ) : (
                            <>
                              <span className={styles.trackNumberText}>
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <Play size={14} className={styles.hoverPlayIcon} fill="currentColor" />
                            </>
                          )}
                        </div>
                        <div className={styles.trackMain}>
                          <div className={styles.trackThumb}>
                            <CoverImage
                              src={coverArtUrl(song.coverArt, "120")}
                              alt=""
                              spinnerSize={14}
                              fallback={<Music size={16} />}
                            />
                          </div>
                          <div className={styles.trackMeta}>
                            <strong>{song.title}</strong>
                            <small>
                              {song.artist} · {song.album}
                            </small>
                          </div>
                        </div>
                        <span className={styles.trackDuration}>
                          {formatTime(song.duration)}
                        </span>
                        <div className={styles.trackRowActions}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              addToQueue([song]);
                            }}
                            aria-label="Add to queue"
                            title="Add to queue"
                          >
                            <ListPlus size={16} />
                          </button>
                          <button
                            className={likedSongs.has(song.id) ? styles.liked : ""}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(song.id);
                            }}
                            aria-label={likedSongs.has(song.id) ? "Unfavorite track" : "Favorite track"}
                            aria-pressed={likedSongs.has(song.id)}
                          >
                            <Heart
                              size={15}
                              fill={likedSongs.has(song.id) ? "var(--coral)" : "none"}
                              color={likedSongs.has(song.id) ? "var(--coral)" : "currentColor"}
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </section>

      {/* GLOBAL SEARCH OVERLAY */}
      {searchOpen && (
        <div className={styles.searchOverlay}>
          <div className={styles.searchBackdrop} onClick={closeSearch} />
          <div className={styles.searchPanel}>
            <div className={styles.searchPanelHeader}>
              <span>
                Results for <strong>{search.trim()}</strong>
              </span>
              <span className={styles.searchHint}>
                <kbd>↑</kbd>
                <kbd>↓</kbd> to move · <kbd>↵</kbd> to open
              </span>
              <button
                className={styles.toastCloseBtn}
                onClick={closeSearch}
                aria-label="Close search"
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.searchPanelBody}>
              {searching && !searchResults ? (
                <div className={styles.searchStatus}>
                  <LoaderCircle
                    size={22}
                    style={{ animation: "remoteplay-spin 1s linear infinite" }}
                  />
                  <span>Searching…</span>
                </div>
              ) : searchResults &&
                !searchResults.artists.length &&
                !searchResults.albums.length &&
                !searchResults.songs.length ? (
                <div className={styles.searchStatus}>
                  <Search size={22} />
                  <span>No matches found.</span>
                </div>
              ) : (
                searchResults && (
                  <>
                    {searchResults.artists.length > 0 && (
                      <div className={styles.searchSection}>
                        <p className={styles.searchSectionTitle}>Artists</p>
                        <div className={styles.searchArtistRow}>
                          {searchResults.artists.map((artist, i) => (
                            <button
                              key={artist.id}
                              data-search-index={i}
                              className={`${styles.searchArtistCard} ${
                                searchIndex === i ? styles.searchActive : ""
                              }`}
                              onClick={searchActions[i]}
                            >
                              <div className={styles.searchArtistAvatar}>
                                <CoverImage
                                  src={
                                    artist.artistImageUrl ||
                                    coverArtUrl(artist.coverArt, "160")
                                  }
                                  alt={artist.name}
                                  spinnerSize={16}
                                  fallback={
                                    <>{artist.name.slice(0, 1).toUpperCase()}</>
                                  }
                                />
                              </div>
                              <span>{artist.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {searchResults.albums.length > 0 && (
                      <div className={styles.searchSection}>
                        <p className={styles.searchSectionTitle}>Albums</p>
                        <div className={styles.searchResultList}>
                          {searchResults.albums.map((album, i) => (
                            <button
                              key={album.id}
                              data-search-index={albumOffset + i}
                              className={`${styles.searchResultItem} ${
                                searchIndex === albumOffset + i ? styles.searchActive : ""
                              }`}
                              onClick={searchActions[albumOffset + i]}
                            >
                              <div className={styles.searchResultThumb}>
                                <CoverImage
                                  src={coverArtUrl(album.coverArt, "120")}
                                  alt={album.name}
                                  spinnerSize={14}
                                  fallback={<Disc3 size={18} />}
                                />
                              </div>
                              <div className={styles.searchResultMeta}>
                                <strong>{album.name}</strong>
                                <small>{album.artist || "Unknown Artist"}</small>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {searchResults.songs.length > 0 && (
                      <div className={styles.searchSection}>
                        <p className={styles.searchSectionTitle}>Songs</p>
                        <div className={styles.searchResultList}>
                          {searchResults.songs.map((song, i) => (
                            <button
                              key={song.id}
                              data-search-index={songOffset + i}
                              className={`${styles.searchResultItem} ${
                                searchIndex === songOffset + i ? styles.searchActive : ""
                              }`}
                              onClick={searchActions[songOffset + i]}
                            >
                              <div className={styles.searchResultThumb}>
                                <CoverImage
                                  src={coverArtUrl(song.coverArt, "120")}
                                  alt=""
                                  spinnerSize={14}
                                  fallback={<Music size={18} />}
                                />
                              </div>
                              <div className={styles.searchResultMeta}>
                                <strong>{song.title}</strong>
                                <small>
                                  {song.artist || "Unknown Artist"}
                                  {song.album ? ` · ${song.album}` : ""}
                                </small>
                              </div>
                              <span className={styles.searchResultDuration}>
                                {formatTime(song.duration)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* NOW PLAYING FLOATING DOCK */}
      <footer className={styles.player}>
        {/* Mobile-only progress line pinned to the top edge of the dock */}
        <div
          className={styles.miniProgress}
          style={{
            transform: `scaleX(${
              current?.duration
                ? Math.min(1, currentTime / current.duration)
                : 0
            })`,
          }}
        />

        {/* Left: Track Details (tap to expand Now Playing on mobile) */}
        <div
          className={styles.nowPlayingInfo}
          role={isMobile && current ? "button" : undefined}
          tabIndex={isMobile && current ? 0 : undefined}
          aria-label={isMobile && current ? "Open now playing" : undefined}
          onClick={() => {
            if (isMobile && current) setNowPlayingOpen(true);
          }}
          onTouchStart={(event) => {
            sheetTouchRef.current = { y: event.touches[0].clientY, t: Date.now() };
          }}
          onTouchEnd={(event) => {
            const start = sheetTouchRef.current;
            sheetTouchRef.current = null;
            if (!start || !isMobile || !current) return;
            if (start.y - event.changedTouches[0].clientY > 30) {
              setNowPlayingOpen(true);
            }
          }}
          onKeyDown={(event) => {
            if (
              isMobile &&
              current &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              setNowPlayingOpen(true);
            }
          }}
        >
          {current ? (
            <>
              <div className={styles.playerThumb}>
                <CoverImage
                  src={coverArtUrl(current.coverArt, "200")}
                  alt={current.title}
                  spinnerSize={16}
                  fallback={
                    <Disc3
                      size={26}
                      style={{
                        animation: playing
                          ? "remoteplay-spin 15s linear infinite"
                          : "none",
                      }}
                    />
                  }
                />
              </div>
              <div className={styles.playerDetails}>
                <strong>{current.title}</strong>
                <span>{current.artist || "Unknown Artist"}</span>
              </div>
              <button
                className={`${styles.playerFavBtn} ${
                  likedSongs.has(current.id) ? styles.liked : ""
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(current.id);
                }}
                aria-label="Favorite now playing track"
                aria-pressed={likedSongs.has(current.id)}
              >
                <Heart
                  size={16}
                  fill={likedSongs.has(current.id) ? "var(--coral)" : "none"}
                  color={likedSongs.has(current.id) ? "var(--coral)" : "currentColor"}
                />
              </button>
            </>
          ) : (
            <div className={styles.waitingPlayer}>
              <Disc3 size={20} />
              <span>Select an album or track to play on host speaker</span>
            </div>
          )}
        </div>

        {/* Center: Controls & Scrubber */}
        <div className={styles.controls}>
          <div className={styles.transport}>
            <button
              className={`${styles.transportBtn} ${isShuffle ? styles.activeToggle : ""}`}
              onClick={() => setIsShuffle(!isShuffle)}
              aria-label="Toggle Shuffle"
              aria-pressed={isShuffle}
              title="Shuffle"
            >
              <Shuffle size={16} />
            </button>
            <button
              className={styles.transportBtn}
              onClick={previousSong}
              aria-label="Previous Track"
            >
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button
              className={styles.mainPlayBtn}
              onClick={() => void togglePlayPause()}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={20} fill="currentColor" style={{ marginLeft: "2px" }} />
              )}
            </button>
            <button
              className={styles.transportBtn}
              onClick={nextSong}
              aria-label="Next Track"
            >
              <SkipForward size={18} fill="currentColor" />
            </button>
            <button
              className={`${styles.transportBtn} ${
                repeatMode !== "off" ? styles.activeToggle : ""
              }`}
              onClick={cycleRepeat}
              aria-label={`Repeat: ${repeatMode}`}
              title={`Repeat: ${repeatMode}`}
            >
              {repeatMode === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
            </button>
          </div>

          {/* Scrubber Progress Bar */}
          <div className={styles.progressScrubber}>
            <span>{formatTime(scrubPreview ?? currentTime)}</span>
            <div
              className={`${styles.scrubBarTrack} ${styles.scrubBarInteractive}`}
              onPointerDown={startScrub}
              onPointerMove={moveScrub}
              onPointerUp={endScrub}
              onPointerCancel={cancelScrub}
            >
              <div
                className={styles.scrubBarFill}
                style={{
                  width: `${
                    current?.duration
                      ? Math.min(100, ((scrubPreview ?? currentTime) / current.duration) * 100)
                      : 0
                  }%`,
                  transition: scrubPreview === null ? undefined : "none",
                }}
              >
                <div className={styles.scrubThumb} />
              </div>
            </div>
            <span>{formatTime(current?.duration)}</span>
          </div>
        </div>

        {/* Right: Audio Visualizer & Utilities */}
        <div className={styles.playerUtilities}>
          {/* Animated soundwave bars when playing */}
          {playing && <EqualizerBars />}

          {/* Volume Control */}
          <div className={styles.volumeControl}>
            <button onClick={toggleMute} aria-label={isMuted ? "Unmute" : "Mute"}>
              {isMuted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className={styles.volumeSlider}
              aria-label="Host volume slider"
            />
          </div>

          {/* Queue Drawer Trigger */}
          <button
            className={`${styles.queueBadgeBtn} ${queueOpen ? styles.activeDrawer : ""}`}
            onClick={() => setQueueOpen(!queueOpen)}
            aria-label="Open queue drawer"
            title="Queue"
          >
            <ListMusic size={18} />
            {queue.length > 0 && (
              <span className={styles.queueCount}>{queue.length}</span>
            )}
          </button>

          {/* Fullscreen / Kiosk Mode */}
          <button
            className={styles.iconButton}
            style={{ width: "34px", height: "34px" }}
            onClick={() => setKioskOpen(true)}
            aria-label="Fullscreen Kiosk"
            title="Fullscreen Display"
          >
            <Maximize2 size={16} />
          </button>
        </div>
      </footer>

      {/* MOBILE NOW PLAYING SHEET (recovers the controls the compact bar hides) */}
      {isMobile && nowPlayingOpen && current && (
        <div
          className={`${styles.nowPlayingSheet} ${
            sheetClosing ? styles.sheetClosing : ""
          } ${sheetDrag ? styles.sheetDragging : ""}`}
          style={sheetDrag ? { transform: `translateY(${sheetDrag}px)` } : undefined}
          role="dialog"
          aria-modal="true"
          aria-label="Now playing"
          onTouchStart={(event) => {
            // Only begin a dismiss gesture when the sheet is scrolled to the top
            if (event.currentTarget.scrollTop > 0) return;
            if ((event.target as HTMLElement).closest("input")) return;
            sheetTouchRef.current = { y: event.touches[0].clientY, t: Date.now() };
          }}
          onTouchMove={(event) => {
            const start = sheetTouchRef.current;
            if (!start) return;
            setSheetDrag(Math.max(0, event.touches[0].clientY - start.y));
          }}
          onTouchEnd={() => {
            const start = sheetTouchRef.current;
            sheetTouchRef.current = null;
            if (!start) return;
            const velocity = sheetDrag / Math.max(1, Date.now() - start.t);
            if (sheetDrag > 140 || (sheetDrag > 40 && velocity > 0.6)) {
              closeNowPlaying();
            } else {
              setSheetDrag(0);
            }
          }}
        >
          <div className={styles.sheetHandle} aria-hidden="true" />
          {current.coverArt && (
            <div
              className={styles.sheetBackdrop}
              style={{
                backgroundImage: `url(${coverArtUrl(current.coverArt, "640")})`,
              }}
            />
          )}

          <div className={styles.sheetHeader}>
            <button
              className={styles.iconButton}
              onClick={closeNowPlaying}
              aria-label="Close now playing"
            >
              <ChevronDown size={20} />
            </button>
            <span className={styles.sheetEyebrow}>Now Playing</span>
            <button
              className={`${styles.iconButton} ${styles.sheetQueueBtn}`}
              onClick={() => {
                closeNowPlaying();
                setQueueOpen(true);
              }}
              aria-label="Open queue"
            >
              <ListMusic size={18} />
              {queue.length > 0 && (
                <span className={styles.queueCount}>{queue.length}</span>
              )}
            </button>
          </div>

          <div className={styles.sheetArtwork}>
            <CoverImage
              src={coverArtUrl(current.coverArt, "640")}
              alt={current.title}
              spinnerSize={40}
              fallback={
                <Disc3
                  size={96}
                  color="var(--accent)"
                  style={{
                    animation: playing
                      ? "remoteplay-spin 15s linear infinite"
                      : "none",
                  }}
                />
              }
            />
          </div>

          <div className={styles.sheetMeta}>
            <div className={styles.sheetTitleRow}>
              <div style={{ minWidth: 0 }}>
                <h2 className={styles.sheetTitle}>{current.title}</h2>
                <p className={styles.sheetArtist}>
                  {current.artist || "Unknown Artist"}
                </p>
                {current.album && (
                  <p className={styles.sheetAlbum}>{current.album}</p>
                )}
              </div>
              <button
                className={styles.sheetFavoriteBtn}
                onClick={() => toggleFavorite(current.id)}
                aria-label="Favorite track"
              >
                <Heart
                  size={22}
                  fill={likedSongs.has(current.id) ? "var(--coral)" : "none"}
                  color={
                    likedSongs.has(current.id) ? "var(--coral)" : "currentColor"
                  }
                />
              </button>
            </div>
          </div>

          {/* Progress */}
          <div className={styles.progressScrubber} style={{ maxWidth: "none" }}>
            <span>{formatTime(scrubPreview ?? currentTime)}</span>
            <div
              className={`${styles.scrubBarTrack} ${styles.scrubBarInteractive}`}
              style={{ height: "6px" }}
              onPointerDown={startScrub}
              onPointerMove={moveScrub}
              onPointerUp={endScrub}
              onPointerCancel={cancelScrub}
            >
              <div
                className={styles.scrubBarFill}
                style={{
                  width: `${
                    current.duration
                      ? Math.min(100, ((scrubPreview ?? currentTime) / current.duration) * 100)
                      : 0
                  }%`,
                  transition: scrubPreview === null ? undefined : "none",
                }}
              />
            </div>
            <span>{formatTime(current.duration)}</span>
          </div>

          {/* Full transport */}
          <div className={styles.sheetTransport}>
            <button
              className={`${styles.transportBtn} ${
                isShuffle ? styles.activeToggle : ""
              }`}
              onClick={() => setIsShuffle(!isShuffle)}
              aria-label="Toggle shuffle"
              aria-pressed={isShuffle}
            >
              <Shuffle size={20} />
            </button>
            <button
              className={styles.transportBtn}
              onClick={previousSong}
              aria-label="Previous track"
            >
              <SkipBack size={26} fill="currentColor" />
            </button>
            <button
              className={styles.sheetPlayBtn}
              onClick={() => void togglePlayPause()}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? (
                <Pause size={28} fill="currentColor" />
              ) : (
                <Play size={28} fill="currentColor" style={{ marginLeft: "3px" }} />
              )}
            </button>
            <button
              className={styles.transportBtn}
              onClick={nextSong}
              aria-label="Next track"
            >
              <SkipForward size={26} fill="currentColor" />
            </button>
            <button
              className={`${styles.transportBtn} ${
                repeatMode !== "off" ? styles.activeToggle : ""
              }`}
              onClick={cycleRepeat}
              aria-label={`Repeat: ${repeatMode}`}
              title={`Repeat: ${repeatMode}`}
            >
              {repeatMode === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}
            </button>
          </div>

          {/* Host volume */}
          <div className={styles.sheetVolume}>
            <button onClick={toggleMute} aria-label={isMuted ? "Unmute" : "Mute"}>
              {isMuted || volume === 0 ? (
                <VolumeX size={18} />
              ) : (
                <Volume2 size={18} />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className={styles.volumeSlider}
              aria-label="Host volume slider"
            />
          </div>

          {upNext && !isShuffle && (
            <button
              className={styles.sheetUpNext}
              onClick={() => {
                closeNowPlaying();
                setQueueOpen(true);
              }}
            >
              <small>Up next</small>
              <span>
                {upNext.title}
                {upNext.artist ? ` · ${upNext.artist}` : ""}
              </span>
            </button>
          )}
        </div>
      )}

      {/* QUEUE DRAWER */}
      {queueOpen && (
        <aside className={styles.queueDrawer} aria-label="Playback queue">
          <div className={styles.queueHeader}>
            <div>
              <h3>Queue</h3>
              <small className={styles.queueSummary}>
                {queue.length} tracks
                {queue.length > 0 &&
                  ` · ${formatTotalDuration(
                    queue.reduce((sum, s) => sum + (s.duration || 0), 0),
                  )}`}
              </small>
            </div>
            <div className={styles.queueActions}>
              {queue.length > 0 && (
                <button
                  className={styles.chipBtn}
                  onClick={() => {
                    setQueue([]);
                    showFlash("Queue cleared");
                  }}
                >
                  Clear
                </button>
              )}
              <button
                className={styles.toastCloseBtn}
                onClick={() => setQueueOpen(false)}
                aria-label="Close queue drawer"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          {queue.length === 0 ? (
            <EmptyState
              icon={<ListMusic size={26} />}
              title="Your queue is empty"
              hint="Use the + on any track, or Add to Queue on an album."
            />
          ) : (
            <div className={styles.queueList}>
              {queue.map((song, idx) => {
                const isNow = idx === currentQueueIndex;
                const isDragging = queueDrag?.from === idx;
                const shift = queueRowShift(idx);
                return (
                  <div
                    key={`${song.id}-${idx}`}
                    data-now-playing={isNow || undefined}
                    className={`${styles.queueItem} ${
                      isNow ? styles.nowPlayingItem : ""
                    } ${isDragging ? styles.queueItemDragging : ""} ${
                      queueDrag && !isDragging ? styles.queueItemShifting : ""
                    }`}
                    style={shift ? { transform: `translateY(${shift}px)` } : undefined}
                    onClick={() => void playSong(song)}
                  >
                    <span
                      className={styles.dragHandle}
                      onPointerDown={(e) => startQueueDrag(e, idx)}
                      onPointerMove={moveQueueDrag}
                      onPointerUp={endQueueDrag}
                      onPointerCancel={() => setQueueDrag(null)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Drag to reorder"
                      title="Drag to reorder"
                    >
                      <GripVertical size={14} />
                    </span>
                    <div className={styles.queueItemThumb}>
                      {isNow && playing ? (
                        <EqualizerBars />
                      ) : (
                        <CoverImage
                          src={coverArtUrl(song.coverArt, "100")}
                          alt=""
                          spinnerSize={14}
                          fallback={<Music size={16} />}
                        />
                      )}
                    </div>
                    <div className={styles.queueItemInfo}>
                      <strong>{song.title}</strong>
                      <small>
                        {song.artist} · {formatTime(song.duration)}
                      </small>
                    </div>
                    <button
                      className={styles.removeQueueBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setQueue((q) => q.filter((_, i) => i !== idx));
                      }}
                      aria-label="Remove from queue"
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      )}

      {/* SETTINGS MODAL */}
      {settingsOpen && (
        <div
          className={styles.modalBackdrop}
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className={styles.settingsCard}
            role="dialog"
            aria-modal="true"
            aria-label="Host audio settings"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h3>Host Audio Settings</h3>
              <button
                className={styles.toastCloseBtn}
                onClick={() => setSettingsOpen(false)}
                aria-label="Close settings"
              >
                <X size={18} />
              </button>
            </div>

            {/* Hardware Output Sink Selection */}
            <div className={styles.settingGroup}>
              <label className={styles.settingLabel} htmlFor="audio-output-select">
                HOST AUDIO OUTPUT
              </label>
              <select
                id="audio-output-select"
                className={styles.selectDropdown}
                value={audioOutput}
                disabled={!hostInfo.capabilities.outputSelection}
                onChange={(event) => {
                  const val = event.target.value;
                  setAudioOutput(val);
                  void settingsApi({ audioOutput: val });
                }}
              >
                <option value="auto">System Default Output</option>
                {audioOutputs.map((output) => (
                  <option key={output.id} value={output.id}>
                    {output.name}
                  </option>
                ))}
              </select>
              <small className={styles.settingHint}>
                {hostInfo.capabilities.outputSelection
                  ? "Choose a detected output. The setting is applied to the next track."
                  : hostInfo.backend
                    ? `Install mpv on ${formatPlatform(hostInfo.platform)} to select outputs and change volume while playing.`
                    : "Install mpv, ffplay, or mpg123 on the host to enable server playback."}
              </small>
            </div>

            {/* Status Information */}
            <dl className={styles.statusList}>
              <div>
                <dt>Host environment</dt>
                <dd>{formatPlatform(hostInfo.platform)}</dd>
              </div>
              <div>
                <dt>Playback device</dt>
                <dd>{hostInfo.backend ? `${hostInfo.backend}${hostInfo.capabilities.volume ? " · live volume" : " · volume fixed per track"}` : "No backend found"}</dd>
              </div>
              <div>
                <dt>Navidrome</dt>
                <dd>{navidromeStatus.connected ? `Subsonic API ${navidromeStatus.version}` : "Not connected"}</dd>
              </div>
            </dl>

            {/* Keyboard shortcuts (hidden on touch layouts) */}
            <div className={`${styles.settingGroup} ${styles.shortcutGroup}`}>
              <span className={styles.settingLabel}>Keyboard shortcuts</span>
              <ul className={styles.shortcutList}>
                {SHORTCUTS.map((shortcut) => (
                  <li key={shortcut.label}>
                    <span>{shortcut.label}</span>
                    <span className={styles.shortcutKeys}>
                      {shortcut.keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN KIOSK MODE (PERFECT FOR RASPBERRY PI TOUCHSCREEN) */}
      {kioskOpen && (
        <div className={styles.kioskOverlay}>
          {current?.coverArt && (
            <div
              className={styles.kioskBackdrop}
              style={{
                backgroundImage: `url(${coverArtUrl(current.coverArt, "640")})`,
              }}
            />
          )}

          {/* Kiosk Header */}
          <div className={styles.kioskHeader}>
            <div className={styles.brand}>
              <div className={styles.brandMark}>
                <Disc3 size={20} />
              </div>
              <span className={styles.brandTitle}>
                REMOTE<span>PLAY</span>
              </span>
            </div>
            <div className={styles.kioskClock}>{clockStr}</div>
            <button
              className={styles.iconButton}
              onClick={() => setKioskOpen(false)}
              aria-label="Exit Kiosk Mode"
              title="Exit Fullscreen (Esc)"
            >
              <Minimize2 size={18} />
            </button>
          </div>

          {/* Kiosk Body */}
          <div className={styles.kioskBody}>
            <div className={styles.kioskArtwork}>
              <CoverImage
                src={coverArtUrl(current?.coverArt, "640")}
                alt={current?.title || "Now playing"}
                spinnerSize={40}
                fallback={
                  <Disc3
                    size={120}
                    color="var(--accent)"
                    style={{
                      animation: playing
                        ? "remoteplay-spin 15s linear infinite"
                        : "none",
                    }}
                  />
                }
              />
            </div>

            <div className={styles.kioskMeta}>
              <h1 className={styles.kioskTitle}>
                {current?.title || "Nothing Playing"}
              </h1>
              <div className={styles.kioskArtist}>
                {current?.artist || "Select music from library"}
              </div>
              <div className={styles.kioskAlbum}>{current?.album || ""}</div>

              {/* Spectrum Equalizer in Kiosk */}
              {playing && (
                <div
                  className={styles.equalizerWave}
                  style={{ height: "28px", gap: "5px" }}
                >
                  <span
                    className={`${styles.eqBar} ${styles.eqBar1}`}
                    style={{ width: "5px", height: "18px" }}
                  />
                  <span
                    className={`${styles.eqBar} ${styles.eqBar2}`}
                    style={{ width: "5px", height: "24px" }}
                  />
                  <span
                    className={`${styles.eqBar} ${styles.eqBar3}`}
                    style={{ width: "5px", height: "14px" }}
                  />
                  <span
                    className={`${styles.eqBar} ${styles.eqBar4}`}
                    style={{ width: "5px", height: "26px" }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Kiosk Big Touch Controls */}
          <div className={styles.kioskControls}>
            {/* Scrubber */}
            <div className={styles.progressScrubber} style={{ maxWidth: "700px" }}>
              <span>{formatTime(scrubPreview ?? currentTime)}</span>
              <div
                className={`${styles.scrubBarTrack} ${styles.scrubBarInteractive}`}
                style={{ height: "8px" }}
                onPointerDown={startScrub}
                onPointerMove={moveScrub}
                onPointerUp={endScrub}
                onPointerCancel={cancelScrub}
              >
                <div
                  className={styles.scrubBarFill}
                  style={{
                    width: `${
                      current?.duration
                        ? Math.min(100, ((scrubPreview ?? currentTime) / current.duration) * 100)
                        : 0
                    }%`,
                    transition: scrubPreview === null ? undefined : "none",
                  }}
                />
              </div>
              <span>{formatTime(current?.duration)}</span>
            </div>

            {/* Huge Playback Buttons */}
            <div className={styles.transport} style={{ gap: "32px" }}>
              <button
                className={styles.transportBtn}
                style={{ padding: "14px" }}
                onClick={previousSong}
                aria-label="Previous Track"
              >
                <SkipBack size={28} fill="currentColor" />
              </button>
              <button
                className={styles.kioskBigPlayBtn}
                onClick={() => void togglePlayPause()}
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? (
                  <Pause size={32} fill="currentColor" />
                ) : (
                  <Play size={32} fill="currentColor" style={{ marginLeft: "4px" }} />
                )}
              </button>
              <button
                className={styles.transportBtn}
                style={{ padding: "14px" }}
                onClick={nextSong}
                aria-label="Next Track"
              >
                <SkipForward size={28} fill="currentColor" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ACTION CONFIRMATION */}
      <div className={styles.flashRegion} role="status" aria-live="polite">
        {flash && (
          <div key={flash} className={styles.flash}>
            {flash}
          </div>
        )}
      </div>
    </main>
  );
}
