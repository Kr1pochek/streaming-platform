import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronRight, FiHeart, FiMoreHorizontal, FiSearch } from "react-icons/fi";
import { BsFillPlayFill, BsHeartFill } from "react-icons/bs";
import { LuHeart } from "react-icons/lu";
import { useRef } from "react";
import { useLocation } from "react-router-dom";
import styles from "./SearchPage.module.css";
import PageShell from "../components/PageShell.jsx";
import useAsyncResource from "../hooks/useAsyncResource.js";
import { fetchSearchFeed, searchCatalog } from "../api/musicApi.js";
import usePlayer from "../hooks/usePlayer.js";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import ArtistSpotlightCard from "../components/ArtistSpotlightCard.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";
import SmartRecommendations from "../components/SmartRecommendations.jsx";
import CardActionMenu from "../components/CardActionMenu.jsx";
import useCardActionMenu from "../hooks/useCardActionMenu.js";
import { COMMON_MUSIC_GENRES } from "../../shared/musicGenres.js";

const tabs = [
  { id: "popular", label: "Популярное" },
  { id: "history", label: "История" },
];

const searchFilters = [
  { id: "all", label: "Все" },
  { id: "tracks", label: "Треки" },
  { id: "artists", label: "Артисты" },
  { id: "playlists", label: "Плейлисты" },
  { id: "albums", label: "Альбомы" },
];

const PAGE_LIMIT = 12;
const SEARCH_HISTORY_STORAGE_KEY = "music.search.history.v1";
const SEARCH_HISTORY_LIMIT = 12;
const defaultPagination = {
  limit: PAGE_LIMIT,
  offset: 0,
  hasMore: false,
  nextOffset: null,
};
const SEARCH_SUGGESTION_LIMIT = 6;

const emptySearchState = {
  status: "idle",
  data: { tracks: [], playlists: [], artists: [], albums: [] },
  error: "",
  pagination: defaultPagination,
  loadingMore: false,
};

function normalizeSuggestionText(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_-]+/g, " ")
    .replace(/(^|\s)т[рp][еэ]п(?=\s|$)/g, "$1trap")
    .replace(/(^|\s)метал+л?(?=\s|$)/g, "$1metal")
    .replace(/(^|\s)рок(?=\s|$)/g, "$1rock")
    .replace(/\s+/g, " ");
}

function editDistance(left = "", right = "") {
  if (!left.length) {
    return right.length;
  }
  if (!right.length) {
    return left.length;
  }

  let previousRow = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const currentRow = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      currentRow[rightIndex] = Math.min(
        currentRow[rightIndex - 1] + 1,
        previousRow[rightIndex] + 1,
        previousRow[rightIndex - 1] + substitutionCost
      );
    }
    previousRow = currentRow;
  }
  return previousRow[right.length];
}

function suggestionSimilarity(left = "", right = "") {
  const maxLength = Math.max(left.length, right.length);
  return maxLength ? 1 - editDistance(left, right) / maxLength : 1;
}

function scoreSearchValue(query = "", value = "", { includeExact = false } = {}) {
  const normalizedQuery = normalizeSuggestionText(query);
  const normalizedValue = normalizeSuggestionText(value);
  if (!normalizedQuery || !normalizedValue) {
    return 0;
  }
  if (normalizedQuery === normalizedValue) {
    return includeExact ? 100 : 0;
  }
  if (normalizedValue.startsWith(normalizedQuery)) {
    return 98;
  }
  if (normalizedValue.includes(normalizedQuery)) {
    return 88;
  }

  const queryTokens = normalizedQuery.split(/\s+/g).filter(Boolean);
  const valueTokens = normalizedValue.split(/\s+/g).filter(Boolean);
  if (!queryTokens.length || !valueTokens.length) {
    return 0;
  }
  if (queryTokens.length === 1 && normalizedQuery.includes(normalizedValue)) {
    return Math.max(62, Math.round((normalizedValue.length / normalizedQuery.length) * 90));
  }

  const tokenScores = queryTokens.map((queryToken) =>
    valueTokens.reduce((currentBest, valueToken) => {
      const shortestTokenLength = Math.min(queryToken.length, valueToken.length);
      if (shortestTokenLength >= 3 && (valueToken.startsWith(queryToken) || queryToken.startsWith(valueToken))) {
        return Math.max(currentBest, 0.9);
      }
      return Math.max(currentBest, suggestionSimilarity(queryToken, valueToken));
    }, 0)
  );
  const weakestTokenScore = Math.min(...tokenScores);
  if (queryTokens.length > 1 && weakestTokenScore < 0.72) {
    return 0;
  }

  const tokenScore = tokenScores.reduce((total, score) => total + score, 0) / queryTokens.length;

  return Math.round(Math.max(suggestionSimilarity(normalizedQuery, normalizedValue), tokenScore) * 100);
}

function scoreSearchSuggestion(query = "", value = "") {
  return scoreSearchValue(query, value);
}

function scoreTrackForSearchQuery(query = "", track = {}) {
  const fields = [
    track?.title,
    track?.artist,
    track?.album,
    track?.albumTitle,
    track?.releaseTitle,
    track?.genre,
    ...(Array.isArray(track?.tags) ? track.tags : []),
  ];

  return fields.reduce(
    (bestScore, field) => Math.max(bestScore, scoreSearchValue(query, field, { includeExact: true })),
    0
  );
}

function buildSearchSuggestions(query = "", searchHistory = [], collections = []) {
  const candidates = [
    ...COMMON_MUSIC_GENRES,
    ...searchHistory,
    ...collections.flatMap((item) => [item?.query, item?.title, item?.subtitle]),
  ];
  const seen = new Set();

  return candidates
    .map((candidate) => String(candidate ?? "").trim())
    .filter(Boolean)
    .map((candidate) => {
      const normalizedCandidate = normalizeSuggestionText(candidate);
      if (!normalizedCandidate || seen.has(normalizedCandidate)) {
        return null;
      }
      seen.add(normalizedCandidate);
      return {
        value: candidate,
        score: scoreSearchSuggestion(query, candidate),
      };
    })
    .filter((item) => item && item.score >= 55)
    .sort((first, second) => second.score - first.score || first.value.localeCompare(second.value, "ru"))
    .slice(0, SEARCH_SUGGESTION_LIMIT)
    .map((item) => item.value);
}

function splitColumns(items) {
  const splitPoint = Math.ceil(items.length / 2);
  return [items.slice(0, splitPoint), items.slice(splitPoint)];
}

function nonEmptyColumns(items) {
  return splitColumns(items).filter((column) => column.length);
}

function mergeById(currentItems = [], nextItems = []) {
  const result = [...currentItems];
  const seen = new Set(currentItems.map((item) => item?.id).filter(Boolean));
  for (const item of nextItems) {
    const id = item?.id;
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(item);
  }
  return result;
}

function normalizeSearchHistoryEntry(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function readSearchHistory() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw.map(normalizeSearchHistoryEntry).filter(Boolean).slice(0, SEARCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export default function SearchPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const loadSearchFeed = useCallback(() => fetchSearchFeed(), []);
  const { status, data, error, reload } = useAsyncResource(loadSearchFeed);

  const {
    trackMap,
    likedIds,
    currentTrackId,
    playTrack,
    isArtistFollowed,
    toggleArtistFollow,
    toggleLikeTrack,
    notify,
  } = usePlayer();

  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();
  const {
    menuState: cardMenuState,
    openCardMenu,
    closeCardMenu,
  } = useCardActionMenu();
  const initialQueryFromNavigation =
    typeof location.state?.initialQuery === "string" ? location.state.initialQuery.trim() : "";
  const appliedInitialQueryRef = useRef("");

  const [activeTab, setActiveTab] = useState("popular");
  const [query, setQuery] = useState(initialQueryFromNavigation);
  const [resultFilter, setResultFilter] = useState("all");
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchState, setSearchState] = useState(emptySearchState);
  const [searchHistory, setSearchHistory] = useState(() => readSearchHistory());

  const normalizedQuery = query.trim();
  const canPlayTrack = useCallback((trackId) => Boolean(trackMap?.[trackId]), [trackMap]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(searchHistory));
  }, [searchHistory]);

  const rememberSearchQuery = useCallback((value) => {
    const normalizedValue = normalizeSearchHistoryEntry(value);
    if (!normalizedValue) {
      return;
    }

    setSearchHistory((prev) => {
      const normalizedValueLower = normalizedValue.toLocaleLowerCase();
      const filtered = prev.filter((item) => item.toLocaleLowerCase() !== normalizedValueLower);
      return [normalizedValue, ...filtered].slice(0, SEARCH_HISTORY_LIMIT);
    });
  }, []);

  const clearSearchHistory = useCallback(() => {
    setSearchHistory([]);
  }, []);

  useEffect(() => {
    if (!initialQueryFromNavigation || appliedInitialQueryRef.current === initialQueryFromNavigation) {
      return;
    }

    appliedInitialQueryRef.current = initialQueryFromNavigation;
    setActiveTab("popular");
    setQuery(initialQueryFromNavigation);
    setResultFilter("all");
    setSearchOffset(0);
    setSearchState({
      status: "loading",
      data: { tracks: [], playlists: [], artists: [], albums: [] },
      error: "",
      pagination: defaultPagination,
      loadingMore: false,
    });
  }, [initialQueryFromNavigation]);

  const resetSearch = useCallback(() => {
    setQuery("");
    setResultFilter("all");
    setSearchOffset(0);
    setSearchState(emptySearchState);
  }, []);

  const handleQueryChange = useCallback((value) => {
    const nextNormalizedQuery = value.trim();
    setQuery(value);
    setSearchOffset(0);
    if (!nextNormalizedQuery) {
      setResultFilter("all");
      setSearchState(emptySearchState);
      return;
    }
    if (nextNormalizedQuery === normalizedQuery && searchOffset === 0) {
      return;
    }
    setSearchState((prev) => ({
      ...prev,
      status: "loading",
      error: "",
      loadingMore: false,
      pagination: defaultPagination,
    }));
  }, [normalizedQuery, searchOffset]);

  const handleFilterChange = (nextFilterId) => {
    setResultFilter(nextFilterId);
    setSearchOffset(0);
    setSearchState((prev) => ({
      ...prev,
      status: normalizedQuery ? "loading" : "idle",
      error: "",
      loadingMore: false,
      pagination: defaultPagination,
      data:
        normalizedQuery && prev.status === "success"
          ? { tracks: [], playlists: [], artists: [], albums: [] }
          : prev.data,
    }));
  };

  useEffect(() => {
    if (!normalizedQuery) {
      return;
    }

    let cancelled = false;

    const timeoutId = setTimeout(async () => {
      try {
        if (searchOffset > 0) {
          setSearchState((prev) => ({ ...prev, loadingMore: true, error: "" }));
        }
        const result = await searchCatalog(normalizedQuery, {
          filter: resultFilter,
          limit: PAGE_LIMIT,
          offset: searchOffset,
        });
        if (cancelled) return;
        setSearchState((prev) => {
          if (searchOffset <= 0) {
            return {
              status: "success",
              data: {
                tracks: result?.tracks ?? [],
                playlists: result?.playlists ?? [],
                artists: result?.artists ?? [],
                albums: result?.albums ?? [],
              },
              error: "",
              loadingMore: false,
              pagination: result?.pagination ?? defaultPagination,
            };
          }

          return {
            status: "success",
            data: {
              tracks: mergeById(prev.data?.tracks ?? [], result?.tracks ?? []),
              playlists: mergeById(prev.data?.playlists ?? [], result?.playlists ?? []),
              artists: mergeById(prev.data?.artists ?? [], result?.artists ?? []),
              albums: mergeById(prev.data?.albums ?? [], result?.albums ?? []),
            },
            error: "",
            loadingMore: false,
            pagination: result?.pagination ?? defaultPagination,
          };
        });
      } catch (err) {
        if (cancelled) return;
        setSearchState((prev) => ({
          status: searchOffset > 0 ? "success" : "error",
          data: searchOffset > 0 ? prev.data : { tracks: [], playlists: [], artists: [], albums: [] },
          error: err instanceof Error ? err.message : "Не удалось выполнить поиск.",
          loadingMore: false,
          pagination: searchOffset > 0 ? prev.pagination : defaultPagination,
        }));
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [normalizedQuery, resultFilter, searchOffset]);

  useEffect(() => {
    if (searchState.status === "success" && normalizedQuery) {
      rememberSearchQuery(normalizedQuery);
    }
  }, [normalizedQuery, rememberSearchQuery, searchState.status]);

  const popularTracks = useMemo(
    () => (data?.newTrackIds ?? []).map((id) => trackMap[id]).filter(Boolean),
    [data?.newTrackIds, trackMap]
  );

  const recommendations = useMemo(() => {
    const source = popularTracks.length ? popularTracks : Object.values(trackMap);
    return source.slice(0, 4);
  }, [popularTracks, trackMap]);

  const emptySearchRecommendations = useMemo(() => {
    if (!normalizedQuery) {
      return [];
    }

    return Object.values(trackMap)
      .map((track) => ({
        track,
        score: scoreTrackForSearchQuery(normalizedQuery, track),
      }))
      .filter(({ score }) => score >= 72)
      .sort((first, second) => {
        if (second.score !== first.score) {
          return second.score - first.score;
        }
        return String(first.track?.title ?? "").localeCompare(String(second.track?.title ?? ""), "ru");
      })
      .slice(0, 4)
      .map(({ track }) => track);
  }, [normalizedQuery, trackMap]);

  const popularColumns = useMemo(() => nonEmptyColumns(popularTracks), [popularTracks]);
  const collections = useMemo(
    () => (Array.isArray(data?.collections) ? data.collections : []),
    [data?.collections]
  );
  const morePlaylists = useMemo(
    () => (Array.isArray(data?.morePlaylists) ? data.morePlaylists : []),
    [data?.morePlaylists]
  );
  const isSparseCatalog = Boolean(data?.catalogState?.sparseCatalog);
  const searchSuggestions = useMemo(
    () => (normalizedQuery ? buildSearchSuggestions(normalizedQuery, searchHistory, collections) : []),
    [collections, normalizedQuery, searchHistory]
  );

  const hasSearchQuery = normalizedQuery.length > 0;
  const searchResults = searchState.data;
  const searchEmpty =
    searchState.status === "success" &&
    !searchResults.tracks.length &&
    !searchResults.playlists.length &&
    !searchResults.artists.length &&
    !searchResults.albums.length;

  const handleOpenCollection = (item) => {
    if (!item) {
      return;
    }
    if (item.type === "playlist" && item.targetId) {
      navigate(`/playlist/${item.targetId}`);
      return;
    }
    if (item.type === "artist" && item.targetId) {
      navigate(`/artist/${item.targetId}`);
      return;
    }
    if (item.type === "search" && item.query) {
      handleQueryChange(item.query);
      return;
    }
    navigate("/search");
  };

  const copyPlaylistLink = useCallback(
    async (playlistId) => {
      if (!playlistId || typeof window === "undefined") {
        return;
      }

      const absoluteUrl = new URL(`/playlist/${playlistId}`, window.location.origin).toString();
      try {
        if (!navigator?.clipboard?.writeText) {
          throw new Error("clipboard-unavailable");
        }
        await navigator.clipboard.writeText(absoluteUrl);
        notify("Ссылка на плейлист скопирована.");
      } catch {
        window.prompt("Скопируй ссылку на плейлист:", absoluteUrl);
      }
    },
    [notify]
  );

  const openPlaylistCardMenu = useCallback(
    (event, playlist) => {
      if (!playlist?.id) {
        return;
      }

      openCardMenu(event, {
        title: playlist.title ?? "Плейлист",
        subtitle: `${playlist.trackIds?.length ?? 0} треков`,
        actions: [
          {
            id: `open-playlist-${playlist.id}`,
            icon: "open",
            label: "Открыть плейлист",
            onSelect: () => navigate(`/playlist/${playlist.id}`),
          },
          {
            id: `share-playlist-${playlist.id}`,
            icon: "share",
            label: "Поделиться",
            onSelect: () => copyPlaylistLink(playlist.id),
          },
        ],
      });
    },
    [copyPlaylistLink, navigate, openCardMenu]
  );

  const handleSearchHistorySelect = useCallback(
    (value) => {
      setActiveTab("popular");
      setResultFilter("all");
      handleQueryChange(value);
    },
    [handleQueryChange]
  );

  const handleSearchSuggestionSelect = useCallback(
    (value) => {
      setActiveTab("popular");
      setResultFilter("all");
      handleQueryChange(value);
    },
    [handleQueryChange]
  );

  return (
    <PageShell>
      <div className={styles.searchBlock}>
        <label htmlFor="global-search" className={styles.searchLabel}>
          Поиск по трекам, альбомам и артистам
        </label>
        <div className={styles.searchInputWrap}>
          <FiSearch className={styles.searchIcon} aria-hidden="true" />
          <input
            id="global-search"
            className={styles.searchInput}
            data-testid="search-input"
            type="search"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder="Трек, альбом, исполнитель или жанр"
            autoComplete="off"
          />
        </div>

        {!hasSearchQuery ? (
          <div className={styles.tabs}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`${styles.tabButton} ${activeTab === tab.id ? styles.tabButtonActive : ""}`.trim()}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}

        {hasSearchQuery ? (
          <div className={styles.searchFilters}>
            {searchFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={`${styles.filterButton} ${resultFilter === filter.id ? styles.filterButtonActive : ""}`.trim()}
                onClick={() => handleFilterChange(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        ) : null}

        {hasSearchQuery && searchSuggestions.length ? (
          <SearchSuggestionChips suggestions={searchSuggestions} onSelect={handleSearchSuggestionSelect} />
        ) : null}
      </div>

      {status === "success" && !hasSearchQuery && isSparseCatalog ? (
        <p className={styles.catalogHint}>
          Каталог сейчас компактный, поэтому раздел показывает живые переходы по тем артистам и подборкам,
          которые уже доступны для прослушивания.
        </p>
      ) : null}

      {status === "loading" ? (
        <ResourceState loading title="Загружаем поиск" description="Подготавливаем подборки и списки треков." />
      ) : null}

      {status === "error" ? (
        <ResourceState
          title="Не удалось загрузить раздел поиска"
          description={error}
          actionLabel="Повторить"
          onAction={reload}
        />
      ) : null}

      {status === "success" && hasSearchQuery ? (
        <SearchResults
          query={normalizedQuery}
          searchState={searchState}
          searchResults={searchResults}
          searchEmpty={searchEmpty}
          suggestions={searchSuggestions}
          isArtistFollowed={isArtistFollowed}
          likedIds={likedIds}
          currentTrackId={currentTrackId}
          emptyRecommendationTracks={emptySearchRecommendations}
          pagination={searchState.pagination}
          loadingMore={searchState.loadingMore}
          canPlayTrack={canPlayTrack}
          onPlay={playTrack}
          onToggleArtistFollow={toggleArtistFollow}
          onToggleLike={toggleLikeTrack}
          onOpenPlaylist={(id) => navigate(`/playlist/${id}`)}
          onOpenArtist={(id) => navigate(`/artist/${id}`)}
          onOpenRelease={(id) => navigate(`/release/${id}`)}
          onClearQuery={resetSearch}
          onSelectSuggestion={handleSearchSuggestionSelect}
          onLoadMore={() =>
            setSearchOffset((prev) =>
              Number.isFinite(searchState.pagination?.nextOffset)
                ? searchState.pagination.nextOffset
                : prev + PAGE_LIMIT
            )
          }
          onOpenTrackMenu={openTrackMenu}
          onOpenPlaylistMenu={openPlaylistCardMenu}
        />
      ) : null}

      {status === "success" && !hasSearchQuery && activeTab === "popular" ? (
        <>
          {collections.length ? (
            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>Быстрые переходы</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div className={styles.collectionsGrid}>
                {collections.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.collectionCard}
                    onClick={() => handleOpenCollection(item)}
                  >
                    <span className={styles.collectionCover} style={{ background: item.gradient }} />
                    <span className={styles.collectionMeta}>
                      <span className={styles.collectionTitle}>{item.title}</span>
                      <span className={styles.collectionSubtitle}>{item.subtitle}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionHeading}>{isSparseCatalog ? "Доступные треки" : "Новинки"}</h2>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            <div
              className={`${styles.tracksGrid} ${popularColumns.length === 1 ? styles.tracksGridSingle : ""}`.trim()}
            >
              {popularColumns.map((column, index) => (
                <TrackListColumn
                  key={`popular-column-${index}`}
                  tracks={column}
                  likedIds={likedIds}
                  currentTrackId={currentTrackId}
                  canPlayTrack={canPlayTrack}
                  onPlay={playTrack}
                  onOpenArtist={(id) => navigate(`/artist/${id}`)}
                  onOpenTrackMenu={openTrackMenu}
                />
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionTitleRow}>
              <h2 className={styles.sectionHeading}>{isSparseCatalog ? "Плейлисты каталога" : "Больше новой музыки"}</h2>
              <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
            </div>
            <div className={styles.moreGrid}>
              {morePlaylists.map((playlist) => (
                <PlaylistCard
                  key={playlist.id}
                  playlist={playlist}
                  subtitle={playlist.artist}
                  likedIds={likedIds}
                  canPlayTrack={canPlayTrack}
                  onOpenPlaylist={(playlistId) => navigate(`/playlist/${playlistId}`)}
                  onPlay={playTrack}
                  onToggleLike={toggleLikeTrack}
                  onOpenMenu={openPlaylistCardMenu}
                />
              ))}
            </div>
          </section>
        </>
      ) : null}

      {status === "success" && !hasSearchQuery && activeTab === "history" ? (
        <section className={`${styles.section} ${styles.historySection}`}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionHeading}>История поиска</h2>
          </div>

          {searchHistory.length ? (
            <>
              <div className={styles.searchHistoryList}>
                {searchHistory.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    className={styles.searchHistoryButton}
                    onClick={() => handleSearchHistorySelect(entry)}
                  >
                    <FiSearch aria-hidden="true" />
                    <span>{entry}</span>
                  </button>
                ))}
              </div>
              <button type="button" className={styles.clearHistoryButton} onClick={clearSearchHistory}>
                Очистить запросы
              </button>
            </>
          ) : (
            <>
              <ResourceState
                title="История пока пустая"
                description="Выполняй поисковые запросы, и последние из них появятся здесь."
                actionLabel="Перейти в популярное"
                onAction={() => setActiveTab("popular")}
              />
              <SmartRecommendations
                title="Пока история пустая, попробуй это"
                tracks={recommendations}
                onPlayTrack={playTrack}
                onLikeTrack={toggleLikeTrack}
                onOpenTrackMenu={openTrackMenu}
              />
            </>
          )}
        </section>
      ) : null}

      <CardActionMenu menuState={cardMenuState} onClose={closeCardMenu} />
      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}

function SearchSuggestionChips({ suggestions = [], onSelect }) {
  if (!suggestions.length) {
    return null;
  }

  return (
    <div className={styles.searchSuggestions} aria-label="Похожие запросы">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          type="button"
          className={styles.searchSuggestionButton}
          onClick={() => onSelect(suggestion)}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

function SearchResults({
  query,
  searchState,
  searchResults,
  searchEmpty,
  suggestions,
  isArtistFollowed,
  likedIds,
  currentTrackId,
  emptyRecommendationTracks = [],
  pagination,
  loadingMore,
  canPlayTrack,
  onPlay,
  onToggleArtistFollow,
  onToggleLike,
  onOpenPlaylist,
  onOpenArtist,
  onOpenRelease,
  onClearQuery,
  onSelectSuggestion,
  onLoadMore,
  onOpenTrackMenu,
  onOpenPlaylistMenu,
}) {
  if (searchState.status === "loading") {
    return (
      <section className={styles.section}>
        <ResourceState loading title="Ищем совпадения" description={`По запросу "${query}"`} />
        {emptyRecommendationTracks.length ? (
          <SmartRecommendations
            title="Пока ищем, можно включить"
            tracks={emptyRecommendationTracks}
            onPlayTrack={onPlay}
            onLikeTrack={onToggleLike}
            onOpenTrackMenu={onOpenTrackMenu}
          />
        ) : null}
      </section>
    );
  }

  if (searchState.status === "error") {
    return (
      <section className={styles.section}>
        <ResourceState
          title="Поиск недоступен"
          description={searchState.error}
          actionLabel="Очистить"
          onAction={onClearQuery}
        />
      </section>
    );
  }

  if (searchEmpty) {
    return (
      <section className={styles.section}>
        <ResourceState
          title="Ничего не найдено"
          description={`По запросу "${query}" пока нет результатов. Попробуй другие ключевые слова.`}
          actionLabel="Сбросить"
          onAction={onClearQuery}
        />
        <SearchSuggestionChips suggestions={suggestions} onSelect={onSelectSuggestion} />
        {emptyRecommendationTracks.length ? (
          <SmartRecommendations
            title="Может, попробуете это"
            tracks={emptyRecommendationTracks}
            onPlayTrack={onPlay}
            onLikeTrack={onToggleLike}
            onOpenTrackMenu={onOpenTrackMenu}
          />
        ) : null}
      </section>
    );
  }

  const resultColumns = nonEmptyColumns(searchResults.tracks);

  return (
    <>
      {!!searchResults.tracks.length && (
        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionHeading}>Треки</h2>
            <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
          </div>
          <div
            className={`${styles.tracksGrid} ${resultColumns.length === 1 ? styles.tracksGridSingle : ""}`.trim()}
          >
            {resultColumns.map((column, index) => (
              <TrackListColumn
                key={`result-column-${index}`}
                tracks={column}
                likedIds={likedIds}
                currentTrackId={currentTrackId}
                canPlayTrack={canPlayTrack}
                onPlay={onPlay}
                onOpenArtist={onOpenArtist}
                onOpenTrackMenu={onOpenTrackMenu}
              />
            ))}
          </div>
        </section>
      )}

      {!!searchResults.playlists.length && (
        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionHeading}>Плейлисты</h2>
          </div>
          <div className={styles.moreGrid}>
            {searchResults.playlists.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                subtitle={playlist.subtitle}
                likedIds={likedIds}
                onOpenPlaylist={onOpenPlaylist}
                onPlay={onPlay}
                onToggleLike={onToggleLike}
                onOpenMenu={onOpenPlaylistMenu}
              />
            ))}
          </div>
        </section>
      )}

      {!!searchResults.albums.length && (
        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionHeading}>Альбомы</h2>
          </div>
          <div className={styles.moreGrid}>
            {searchResults.albums.map((album) => (
              <button key={album.id} type="button" className={styles.moreCard} onClick={() => onOpenRelease(album.id)}>
                <span className={styles.moreCover} style={{ background: album.cover }} />
                <span className={styles.moreMeta}>
                  <span className={styles.moreTitle}>{album.title}</span>
                  <span className={styles.moreArtist}>
                    {album.artistName} • {album.year}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!!searchResults.artists.length && (
        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionHeading}>Исполнители</h2>
          </div>
          <div className={styles.artistResultsGrid}>
            {searchResults.artists.map((artist) => (
              <ArtistSpotlightCard
                key={artist.id}
                artist={artist}
                audience="followers"
                contextLabel="Найдено"
                description="Треки, релизы и быстрый переход на страницу артиста."
                isFollowed={isArtistFollowed(artist.id)}
                onOpen={() => onOpenArtist(artist.id)}
                onToggleFollow={() => onToggleArtistFollow(artist.id)}
              />
            ))}
          </div>
        </section>
      )}

      {pagination?.hasMore ? (
        <section className={styles.section}>
          <button
            type="button"
            className={styles.loadMoreButton}
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Загружаем..." : "Показать еще"}
          </button>
        </section>
      ) : null}
    </>
  );
}

function PlaylistCard({
  playlist,
  subtitle,
  likedIds,
  canPlayTrack = () => true,
  onOpenPlaylist,
  onPlay,
  onToggleLike,
  onOpenMenu,
}) {
  const firstTrackId = playlist.trackIds?.[0] ?? null;
  const isFirstTrackLiked = firstTrackId ? likedIds.includes(firstTrackId) : false;
  const canPlayFirstTrack = firstTrackId ? canPlayTrack(firstTrackId) : false;

  return (
    <article className={styles.moreCard}>
      <button type="button" className={styles.moreMainButton} onClick={() => onOpenPlaylist(playlist.id)}>
        <span className={styles.moreCover} style={{ background: playlist.cover }} />
        <span className={styles.moreMeta}>
          <span className={styles.moreTitle}>{playlist.title}</span>
          <span className={styles.moreArtist}>{subtitle}</span>
        </span>
      </button>
      <span className={styles.cardActions}>
        {firstTrackId ? (
          <>
            <button
              type="button"
              className={styles.cardActionButton}
              aria-label="Слушать"
              disabled={!canPlayFirstTrack}
              onClick={() => onPlay(firstTrackId)}
            >
              <BsFillPlayFill />
            </button>
            <button
              type="button"
              className={`${styles.cardActionButton} ${styles.cardActionButtonLike} ${isFirstTrackLiked ? styles.cardActionButtonLiked : ""}`.trim()}
              aria-label={isFirstTrackLiked ? "Убрать из избранного" : "Добавить в избранное"}
              aria-pressed={isFirstTrackLiked}
              onClick={() => onToggleLike(firstTrackId)}
            >
              <span className={styles.cardActionHeartOutline} aria-hidden="true">
                <LuHeart />
              </span>
              <span className={styles.cardActionHeartFilled} aria-hidden="true">
                <BsHeartFill />
              </span>
            </button>
          </>
        ) : null}
        <button
          type="button"
          className={styles.cardActionButton}
          aria-label="Меню плейлиста"
          onClick={(event) => onOpenMenu(event, playlist)}
        >
          <FiMoreHorizontal />
        </button>
      </span>
    </article>
  );
}

function TrackListColumn({
  tracks,
  likedIds,
  currentTrackId,
  canPlayTrack = () => true,
  onPlay,
  onOpenArtist,
  onOpenTrackMenu,
}) {
  return (
    <ul className={styles.trackList}>
      {tracks.map((track) => {
        const liked = likedIds.includes(track.id);
        const isActive = currentTrackId === track.id;
        const canPlay = canPlayTrack(track.id);
        return (
          <li key={track.id} className={`${styles.trackRow} ${isActive ? styles.trackRowActive : ""}`.trim()}>
            <button
              type="button"
              className={styles.trackMainButton}
              disabled={!canPlay}
              onClick={() => onPlay(track.id)}
              onContextMenu={(event) => onOpenTrackMenu(event, track.id)}
            >
              <span className={styles.trackCover} style={{ background: track.cover }} />
              <span className={styles.trackMeta}>
                <span className={styles.trackTitle}>
                  {track.title}
                  {liked ? <FiHeart className={styles.trackLikedHeart} aria-hidden="true" /> : null}
                  {track.explicit ? <span className={styles.explicitTag}>E</span> : null}
                </span>
                <ArtistInlineLinks
                  artistLine={track.artist}
                  className={styles.trackArtist}
                  linkClassName={styles.trackArtistButton}
                  textClassName={styles.trackArtist}
                  onOpenArtist={onOpenArtist}
                  stopPropagation
                />
              </span>
            </button>
            <button
              type="button"
              className={styles.queueButton}
              aria-label="Открыть меню трека"
              onClick={(event) => onOpenTrackMenu(event, track.id)}
            >
              <FiMoreHorizontal />
            </button>
            <span className={styles.trackDuration}>{formatDurationClock(track.durationSec)}</span>
          </li>
        );
      })}
    </ul>
  );
}
