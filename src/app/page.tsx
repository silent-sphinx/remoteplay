"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Album,
  ArrowLeft,
  Clock,
  Disc3,
  Flame,
  Heart,
  ListMusic,
  LoaderCircle,
  Maximize2,
  Mic2,
  Minimize2,
  Music,
  Pause,
  Play,
  Radio,
  Repeat,
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

export default function Home() {
  const [view, setView] = useState<
    "albums" | "artists" | "artistDetail" | "albumDetail" | "tracks" | "starred"
  >("albums");
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
    "albums" | "artists" | "tracks" | "artistDetail" | "albumDetail" | ""
  >("");

  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [artistAlbums, setArtistAlbums] = useState<AlbumItem[]>([]);
  const [artistSongs, setArtistSongs] = useState<Song[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumItem | null>(null);
  const [albumSongs, setAlbumSongs] = useState<Song[]>([]);

  // Queue and Now Playing (Strictly Host Audio)
  const [queue, setQueue] = useState<Song[]>([]);
  const [current, setCurrent] = useState<Song | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
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
  const [clockStr, setClockStr] = useState("");

  // Hardware Audio Output on Host
  const [audioOutput, setAudioOutput] = useState("auto");
  const [audioOutputs, setAudioOutputs] = useState<{ id: string; name: string }[]>([]);

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
  // "all"/"title"/"recent" page through the whole library and sort client-side.
  async function loadTracks(append = false, sort = trackSort) {
    try {
      setLoading("tracks");
      const offset = append ? trackOffset : 0;
      let nextSongs: Song[] = [];
      let paginated = true;

      if (sort === "starred") {
        const data = await api<{ starred2?: { song?: Song[] } }>("getStarred2");
        nextSongs = data.starred2?.song || [];
        paginated = false; // getStarred2 returns the whole set at once
      } else if (sort === "random") {
        const data = await api<{ randomSongs?: { song?: Song[] } }>(
          "getRandomSongs",
          { size: "60" },
        );
        nextSongs = data.randomSongs?.song || [];
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
      }

      const merged = append ? [...songs, ...nextSongs] : nextSongs;
      setSongs(sortSongs(merged, sort));
      setTrackOffset(offset + nextSongs.length);
      setHasMoreTracks(paginated && nextSongs.length === 60);
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
  async function openAlbum(album: AlbumItem) {
    try {
      setLoading("albumDetail");
      setErrorNotice(null);
      setSelectedAlbum(album);
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

  // Open Artist Detail
  async function openArtist(artist: Artist) {
    try {
      setLoading("artistDetail");
      setErrorNotice(null);
      setSelectedArtist(artist);
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
        nextSong();
        return;
      }

      wasPlayingRef.current = player.playing;
      setCurrent(player.current);
      setPlaying(player.playing);
      setCurrentTime(player.position);

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

  // Toggle Favorite
  function toggleFavorite(songId: string) {
    setLikedSongs((prev) => {
      const next = new Set(prev);
      if (next.has(songId)) next.delete(songId);
      else next.add(songId);
      return next;
    });
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

  const visibleArtists = sortedArtists.slice(0, artistPage * 50);
  const hasMoreArtists = visibleArtists.length < sortedArtists.length;

  function changeView(
    nextView: "albums" | "artists" | "artistDetail" | "albumDetail" | "tracks" | "starred",
  ) {
    setView(nextView);
    if (nextView === "artists" && !artists.length) void loadArtists();
    if (nextView === "tracks" && !songs.length) void loadTracks();
  }

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

  // Settings Init
  useEffect(() => {
    void settingsApi<{
      settings: { audioOutput: string };
      outputs: { id: string; name: string }[];
    }>()
      .then((data) => {
        setAudioOutput(data.settings.audioOutput);
        setAudioOutputs(data.outputs);
      })
      .catch(() => undefined);
  }, []);

  // Sync Poll with Host Server
  useEffect(() => {
    const start = window.setTimeout(() => void syncPlayer(), 0);
    const timer = window.setInterval(() => void syncPlayer(), 1000);
    const onFocus = () => void syncPlayer();
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
            id="global-search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onFocus={() => {
              if (searchResults) setSearchOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeSearch();
            }}
            placeholder="Search albums, artists, or songs..."
          />
          {search && (
            <button
              className={styles.clearSearchBtn}
              onClick={closeSearch}
              aria-label="Clear search query"
            >
              <X size={14} />
            </button>
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
                className={`${styles.navButton} ${view === "albums" ? styles.activeNav : ""}`}
                onClick={() => changeView("albums")}
              >
                <Album size={18} /> Albums
              </button>
              <button
                className={`${styles.navButton} ${view === "artists" ? styles.activeNav : ""}`}
                onClick={() => changeView("artists")}
              >
                <Mic2 size={18} /> Artists
              </button>
              <button
                className={`${styles.navButton} ${view === "tracks" ? styles.activeNav : ""}`}
                onClick={() => changeView("tracks")}
              >
                <ListMusic size={18} /> Tracks
              </button>
              <button
                className={`${styles.navButton} ${view === "starred" ? styles.activeNav : ""}`}
                onClick={() => {
                  setAlbumSort("starred");
                  void loadAlbums(0, "starred");
                  changeView("albums");
                }}
              >
                <Heart size={18} /> Starred Mix
              </button>
            </nav>
          </div>

          <div className={styles.sidebarSection}>
            <p className={styles.eyebrow}>QUICK CURATION</p>
            <nav>
              <button
                className={styles.navButton}
                onClick={() => {
                  setAlbumSort("recent");
                  void loadAlbums(0, "recent");
                  changeView("albums");
                }}
              >
                <Clock size={16} /> Recently Played
              </button>
              <button
                className={styles.navButton}
                onClick={() => {
                  setAlbumSort("frequent");
                  void loadAlbums(0, "frequent");
                  changeView("albums");
                }}
              >
                <Flame size={16} /> Most Played
              </button>
              <button
                className={styles.navButton}
                onClick={() => {
                  setAlbumSort("random");
                  void loadAlbums(0, "random");
                  changeView("albums");
                }}
              >
                <Sparkles size={16} /> Surprise Shuffle
              </button>
            </nav>
          </div>

          {/* HARDWARE DEVICE CARD */}
          <div
            className={styles.deviceCard}
            onClick={() => setSettingsOpen(true)}
            style={{ cursor: "pointer" }}
            title="Click to configure host audio output sink"
          >
            <div className={styles.deviceIconBadge}>
              <Speaker size={18} />
            </div>
            <div className={styles.deviceInfo}>
              <strong>Raspberry Pi Audio</strong>
              <small>
                {audioOutput === "auto" ? "Default Output" : audioOutput} · mpv
              </small>
            </div>
            <span className={styles.liveDot} />
          </div>
        </aside>

        {/* LIBRARY DISPLAY */}
        <section className={styles.library}>
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "12px",
                    padding: "80px 0",
                    color: "var(--muted)",
                  }}
                >
                  <LoaderCircle
                    size={24}
                    style={{ animation: "remoteplay-spin 1s linear infinite" }}
                  />
                  <span>Loading album library...</span>
                </div>
              ) : (
                <div className={styles.albumGrid}>
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "12px",
                    padding: "80px 0",
                    color: "var(--muted)",
                  }}
                >
                  <LoaderCircle
                    size={24}
                    style={{ animation: "remoteplay-spin 1s linear infinite" }}
                  />
                  <span>Loading artists...</span>
                </div>
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
                className={styles.secondaryActionBtn}
                style={{ marginBottom: "20px", padding: "6px 14px", fontSize: "12px" }}
                onClick={() => changeView("albums")}
              >
                <ArrowLeft size={14} /> Back to Albums
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
                        onClick={() => {
                          setQueue((q) => [...q, ...albumSongs]);
                          setQueueOpen(true);
                        }}
                      >
                        <ListMusic size={15} /> Add to Queue
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* TRACK LIST TABLE */}
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
                          <div className={styles.equalizerWave}>
                            <span className={`${styles.eqBar} ${styles.eqBar1}`} />
                            <span className={`${styles.eqBar} ${styles.eqBar2}`} />
                            <span className={`${styles.eqBar} ${styles.eqBar3}`} />
                            <span className={`${styles.eqBar} ${styles.eqBar4}`} />
                          </div>
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
                            toggleFavorite(song.id);
                          }}
                          aria-label="Favorite track"
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
            </div>
          )}

          {/* ARTIST DETAIL VIEW */}
          {view === "artistDetail" && selectedArtist && (
            <div>
              <button
                className={styles.secondaryActionBtn}
                style={{ marginBottom: "20px", padding: "6px 14px", fontSize: "12px" }}
                onClick={() => changeView("artists")}
              >
                <ArrowLeft size={14} /> Back to Artists
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
              <h3 style={{ margin: "28px 0 16px", fontFamily: "var(--font-display)" }}>
                Albums
              </h3>
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

              {/* Tracks List */}
              <h3 style={{ margin: "38px 0 16px", fontFamily: "var(--font-display)" }}>
                All Tracks
              </h3>
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
                        <span className={styles.trackNumberText}>
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <Play size={14} className={styles.hoverPlayIcon} fill="currentColor" />
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
                            toggleFavorite(song.id);
                          }}
                          aria-label="Favorite"
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "12px",
                    padding: "80px 0",
                    color: "var(--muted)",
                  }}
                >
                  <LoaderCircle
                    size={24}
                    style={{ animation: "remoteplay-spin 1s linear infinite" }}
                  />
                  <span>Loading tracks...</span>
                </div>
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
                            <div className={styles.equalizerWave}>
                              <span className={`${styles.eqBar} ${styles.eqBar1}`} />
                              <span className={`${styles.eqBar} ${styles.eqBar2}`} />
                              <span className={`${styles.eqBar} ${styles.eqBar3}`} />
                              <span className={`${styles.eqBar} ${styles.eqBar4}`} />
                            </div>
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
                              toggleFavorite(song.id);
                            }}
                            aria-label="Favorite track"
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
                          {searchResults.artists.map((artist) => (
                            <button
                              key={artist.id}
                              className={styles.searchArtistCard}
                              onClick={() => {
                                closeSearch();
                                void openArtist(artist);
                              }}
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
                          {searchResults.albums.map((album) => (
                            <button
                              key={album.id}
                              className={styles.searchResultItem}
                              onClick={() => {
                                closeSearch();
                                void openAlbum(album);
                              }}
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
                          {searchResults.songs.map((song) => (
                            <button
                              key={song.id}
                              className={styles.searchResultItem}
                              onClick={() => {
                                const list = searchResults.songs;
                                closeSearch();
                                void playSong(song, list);
                              }}
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
        {/* Left: Track Details */}
        <div className={styles.nowPlayingInfo}>
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
                onClick={() => toggleFavorite(current.id)}
                style={{ padding: "6px", color: "var(--muted)" }}
                aria-label="Favorite now playing track"
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
              onClick={() => {
                setRepeatMode((prev) =>
                  prev === "off" ? "all" : prev === "all" ? "one" : "off",
                );
              }}
              aria-label="Toggle Repeat"
              title={`Repeat: ${repeatMode}`}
            >
              <Repeat size={16} />
            </button>
          </div>

          {/* Scrubber Progress Bar */}
          <div className={styles.progressScrubber}>
            <span>{formatTime(currentTime)}</span>
            <div className={styles.scrubBarTrack}>
              <div
                className={styles.scrubBarFill}
                style={{
                  width: `${
                    current?.duration
                      ? Math.min(100, (currentTime / current.duration) * 100)
                      : 0
                  }%`,
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
          {playing && (
            <div className={styles.equalizerWave} style={{ marginRight: "4px" }}>
              <span className={`${styles.eqBar} ${styles.eqBar1}`} />
              <span className={`${styles.eqBar} ${styles.eqBar2}`} />
              <span className={`${styles.eqBar} ${styles.eqBar3}`} />
              <span className={`${styles.eqBar} ${styles.eqBar4}`} />
            </div>
          )}

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

      {/* QUEUE DRAWER */}
      {queueOpen && (
        <aside className={styles.queueDrawer}>
          <div className={styles.queueHeader}>
            <div>
              <h3>Host Playback Queue</h3>
              <small style={{ color: "var(--muted)", font: "11px var(--mono)" }}>
                {queue.length} tracks ·{" "}
                {formatTotalDuration(
                  queue.reduce((sum, s) => sum + (s.duration || 0), 0),
                )}
              </small>
            </div>
            <div className={styles.queueActions}>
              <button
                className={styles.secondaryActionBtn}
                style={{ padding: "4px 10px", fontSize: "11px" }}
                onClick={() => setQueue([])}
              >
                Clear
              </button>
              <button
                className={styles.toastCloseBtn}
                onClick={() => setQueueOpen(false)}
                aria-label="Close queue drawer"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          <div className={styles.queueList}>
            {queue.map((song, idx) => {
              const isNow = current?.id === song.id;
              return (
                <div
                  key={`${song.id}-${idx}`}
                  className={`${styles.queueItem} ${
                    isNow ? styles.nowPlayingItem : ""
                  }`}
                  onClick={() => void playSong(song)}
                >
                  <div className={styles.queueItemThumb}>
                    <CoverImage
                      src={coverArtUrl(song.coverArt, "100")}
                      alt=""
                      spinnerSize={14}
                      fallback={<Music size={16} />}
                    />
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
                RASPBERRY PI AUDIO OUTPUT SINK
              </label>
              <select
                id="audio-output-select"
                className={styles.selectDropdown}
                value={audioOutput}
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
              <small style={{ color: "var(--muted)", fontSize: "11px" }}>
                Select physical audio output on the Raspberry Pi (DAC, HDMI, or 3.5mm Headphone Jack).
              </small>
            </div>

            {/* Status Information */}
            <div
              style={{
                padding: "14px",
                borderRadius: "10px",
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid var(--line)",
                fontSize: "12px",
                color: "var(--muted)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div>
                <strong style={{ color: "var(--ink)" }}>Host Environment: </strong>
                Raspberry Pi / Linux Audio Server
              </div>
              <div>
                <strong style={{ color: "var(--ink)" }}>Playback Device: </strong>
                Host Speaker Output Only
              </div>
              <div>
                <strong style={{ color: "var(--ink)" }}>Navidrome Connection: </strong>
                Online · Subsonic API 1.16.1
              </div>
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
              <span>{formatTime(currentTime)}</span>
              <div className={styles.scrubBarTrack} style={{ height: "8px" }}>
                <div
                  className={styles.scrubBarFill}
                  style={{
                    width: `${
                      current?.duration
                        ? Math.min(100, (currentTime / current.duration) * 100)
                        : 0
                    }%`,
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
    </main>
  );
}
