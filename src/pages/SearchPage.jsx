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

const emptySearchState = {
  status: "idle",
  data: { tracks: [], playlists: [], artists: [], albums: [] },
  error: "",
  pagination: defaultPagination,
  loadingMore: false,
};

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

  const resetSearch = () => {
    setQuery("");
    setResultFilter("all");
    setSearchOffset(0);
    setSearchState(emptySearchState);
  };

  const handleQueryChange = (value) => {
    setQuery(value);
    setSearchOffset(0);
    if (!value.trim()) {
      setResultFilter("all");
      setSearchState(emptySearchState);
      return;
    }
    setSearchState((prev) => ({
      ...prev,
      status: "loading",
      error: "",
      loadingMore: false,
      pagination: defaultPagination,
    }));
  };

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

  const popularColumns = useMemo(() => nonEmptyColumns(popularTracks), [popularTracks]);
  const collections = Array.isArray(data?.collections) ? data.collections : [];
  const morePlaylists = Array.isArray(data?.morePlaylists) ? data.morePlaylists : [];
  const isSparseCatalog = Boolean(data?.catalogState?.sparseCatalog);

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

  const handleSearchHistorySelect = useCallback((value) => {
    setActiveTab("popular");
    setResultFilter("all");
    handleQueryChange(value);
  }, []);

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
          isArtistFollowed={isArtistFollowed}
          likedIds={likedIds}
          currentTrackId={currentTrackId}
          recommendationTracks={recommendations}
          pagination={searchState.pagination}
          loadingMore={searchState.loadingMore}
          onPlay={playTrack}
          onToggleArtistFollow={toggleArtistFollow}
          onToggleLike={toggleLikeTrack}
          onOpenPlaylist={(id) => navigate(`/playlist/${id}`)}
          onOpenArtist={(id) => navigate(`/artist/${id}`)}
          onOpenRelease={(id) => navigate(`/release/${id}`)}
          onClearQuery={resetSearch}
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

function SearchResults({
  query,
  searchState,
  searchResults,
  searchEmpty,
  isArtistFollowed,
  likedIds,
  currentTrackId,
  recommendationTracks,
  pagination,
  loadingMore,
  onPlay,
  onToggleArtistFollow,
  onToggleLike,
  onOpenPlaylist,
  onOpenArtist,
  onOpenRelease,
  onClearQuery,
  onLoadMore,
  onOpenTrackMenu,
  onOpenPlaylistMenu,
}) {
  if (searchState.status === "loading") {
    return (
      <section className={styles.section}>
        <ResourceState loading title="Ищем совпадения" description={`По запросу "${query}"`} />
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
        <SmartRecommendations
          title="Пока нет совпадений, можно включить"
          tracks={recommendationTracks}
          onPlayTrack={onPlay}
          onLikeTrack={onToggleLike}
          onOpenTrackMenu={onOpenTrackMenu}
        />
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
  onOpenPlaylist,
  onPlay,
  onToggleLike,
  onOpenMenu,
}) {
  const firstTrackId = playlist.trackIds?.[0] ?? null;
  const isFirstTrackLiked = firstTrackId ? likedIds.includes(firstTrackId) : false;

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
  onPlay,
  onOpenArtist,
  onOpenTrackMenu,
}) {
  return (
    <ul className={styles.trackList}>
      {tracks.map((track) => {
        const liked = likedIds.includes(track.id);
        const isActive = currentTrackId === track.id;
        return (
          <li key={track.id} className={`${styles.trackRow} ${isActive ? styles.trackRowActive : ""}`.trim()}>
            <button
              type="button"
              className={styles.trackMainButton}
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
