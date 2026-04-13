import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiChevronRight, FiHeart, FiMoreHorizontal, FiPlay, FiSearch } from "react-icons/fi";
import styles from "./SearchPage.module.css";
import PageShell from "../components/PageShell.jsx";
import useAsyncResource from "../hooks/useAsyncResource.js";
import { fetchSearchFeed, searchCatalog } from "../api/musicApi.js";
import usePlayer from "../hooks/usePlayer.js";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";
import SmartRecommendations from "../components/SmartRecommendations.jsx";

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

export default function SearchPage() {
  const navigate = useNavigate();
  const loadSearchFeed = useCallback(() => fetchSearchFeed(), []);
  const { status, data, error, reload } = useAsyncResource(loadSearchFeed);

  const {
    trackMap,
    likedIds,
    historyIds,
    currentTrackId,
    playTrack,
    toggleLikeTrack,
    clearHistory,
  } = usePlayer();

  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const [activeTab, setActiveTab] = useState("popular");
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("all");
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchState, setSearchState] = useState(emptySearchState);

  const normalizedQuery = query.trim();

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

  const popularTracks = useMemo(
    () => (data?.newTrackIds ?? []).map((id) => trackMap[id]).filter(Boolean),
    [data?.newTrackIds, trackMap]
  );

  const historyTracks = useMemo(() => {
    return historyIds.map((id) => trackMap[id]).filter(Boolean);
  }, [historyIds, trackMap]);

  const recommendations = useMemo(() => {
    const source = popularTracks.length ? popularTracks : Object.values(trackMap);
    return source.slice(0, 4);
  }, [popularTracks, trackMap]);

  const popularColumns = useMemo(() => nonEmptyColumns(popularTracks), [popularTracks]);
  const historyColumns = useMemo(() => nonEmptyColumns(historyTracks), [historyTracks]);
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
          likedIds={likedIds}
          currentTrackId={currentTrackId}
          recommendationTracks={recommendations}
          pagination={searchState.pagination}
          loadingMore={searchState.loadingMore}
          onPlay={playTrack}
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
              {morePlaylists.map((playlist) => {
                const firstTrackId = playlist.trackIds?.[0] ?? null;
                return (
                  <article key={playlist.id} className={styles.moreCard}>
                    <button
                      type="button"
                      className={styles.moreMainButton}
                      onClick={() => navigate(`/playlist/${playlist.id}`)}
                    >
                      <span className={styles.moreCover} style={{ background: playlist.cover }} />
                      <span className={styles.moreMeta}>
                        <span className={styles.moreTitle}>{playlist.title}</span>
                        <span className={styles.moreArtist}>{playlist.artist}</span>
                      </span>
                    </button>
                    {firstTrackId ? (
                      <span className={styles.cardActions}>
                        <button
                          type="button"
                          className={styles.cardActionButton}
                          aria-label="Слушать"
                          onClick={() => playTrack(firstTrackId)}
                        >
                          <FiPlay />
                        </button>
                        <button
                          type="button"
                          className={styles.cardActionButton}
                          aria-label="Лайк"
                          onClick={() => toggleLikeTrack(firstTrackId)}
                        >
                          <FiHeart />
                        </button>
                        <button
                          type="button"
                          className={styles.cardActionButton}
                          aria-label="Открыть меню трека"
                          onClick={(event) => openTrackMenu(event, firstTrackId)}
                        >
                          <FiMoreHorizontal />
                        </button>
                      </span>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </>
      ) : null}

      {status === "success" && !hasSearchQuery && activeTab === "history" ? (
        <section className={`${styles.section} ${styles.historySection}`}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionHeading}>История поиска</h2>
          </div>

          {historyTracks.length ? (
            <>
              <div
                className={`${styles.historyGrid} ${historyColumns.length === 1 ? styles.historyGridSingle : ""}`.trim()}
              >
                {historyColumns.map((column, index) => (
                  <HistoryColumn
                    key={`history-column-${index}`}
                    tracks={column}
                    likedIds={likedIds}
                    currentTrackId={currentTrackId}
                    onPlay={playTrack}
                    onOpenArtist={(id) => navigate(`/artist/${id}`)}
                    onOpenTrackMenu={openTrackMenu}
                  />
                ))}
              </div>
              <button type="button" className={styles.clearHistoryButton} onClick={clearHistory}>
                Очистить историю
              </button>
            </>
          ) : (
            <>
              <ResourceState
                title="История пока пустая"
                description="Запускай треки из поиска, и они появятся здесь автоматически."
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

      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />
    </PageShell>
  );
}

function SearchResults({
  query,
  searchState,
  searchResults,
  searchEmpty,
  likedIds,
  currentTrackId,
  recommendationTracks,
  pagination,
  loadingMore,
  onPlay,
  onToggleLike,
  onOpenPlaylist,
  onOpenArtist,
  onOpenRelease,
  onClearQuery,
  onLoadMore,
  onOpenTrackMenu,
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
            {searchResults.playlists.map((playlist) => {
              const firstTrackId = playlist.trackIds?.[0] ?? null;
              return (
                <article key={playlist.id} className={styles.moreCard}>
                  <button
                    type="button"
                    className={styles.moreMainButton}
                    onClick={() => onOpenPlaylist(playlist.id)}
                  >
                    <span className={styles.moreCover} style={{ background: playlist.cover }} />
                    <span className={styles.moreMeta}>
                      <span className={styles.moreTitle}>{playlist.title}</span>
                      <span className={styles.moreArtist}>{playlist.subtitle}</span>
                    </span>
                  </button>
                  {firstTrackId ? (
                    <span className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.cardActionButton}
                        aria-label="Слушать"
                        onClick={() => onPlay(firstTrackId)}
                      >
                        <FiPlay />
                      </button>
                      <button
                        type="button"
                        className={styles.cardActionButton}
                        aria-label="Лайк"
                        onClick={() => onToggleLike(firstTrackId)}
                      >
                        <FiHeart />
                      </button>
                      <button
                        type="button"
                        className={styles.cardActionButton}
                        aria-label="Открыть меню трека"
                        onClick={(event) => onOpenTrackMenu(event, firstTrackId)}
                      >
                        <FiMoreHorizontal />
                      </button>
                    </span>
                  ) : null}
                </article>
              );
            })}
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
              <button
                key={artist.id}
                type="button"
                className={styles.artistResultCard}
                onClick={() => onOpenArtist(artist.id)}
              >
                <span className={styles.artistResultAvatar}>{artist.name.slice(0, 1).toUpperCase()}</span>
                <span className={styles.artistResultMeta}>
                  <span className={styles.artistResultName}>{artist.name}</span>
                  <span className={styles.artistResultFollowers}>{artist.followers} подписчиков</span>
                </span>
              </button>
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

function HistoryColumn({
  tracks,
  likedIds,
  currentTrackId,
  onPlay,
  onOpenArtist,
  onOpenTrackMenu,
}) {
  return (
    <ul className={styles.historyTrackList}>
      {tracks.map((track) => {
        const liked = likedIds.includes(track.id);
        const isActive = currentTrackId === track.id;
        return (
          <li
            key={track.id}
            className={`${styles.historyTrackRow} ${isActive ? styles.historyTrackRowActive : ""}`.trim()}
          >
            <button
              type="button"
              className={styles.historyMainButton}
              onClick={() => onPlay(track.id)}
              onContextMenu={(event) => onOpenTrackMenu(event, track.id)}
            >
              <span className={styles.historyCover} style={{ background: track.cover }} />
              <span className={styles.historyMeta}>
                <span className={styles.historyTitle}>
                  {track.title}
                  {liked ? <FiHeart className={styles.trackLikedHeart} aria-hidden="true" /> : null}
                  {track.explicit ? <span className={styles.explicitTag}>E</span> : null}
                </span>
                <ArtistInlineLinks
                  artistLine={track.artist}
                  className={styles.historySubtitle}
                  linkClassName={styles.historyArtistButton}
                  textClassName={styles.historySubtitle}
                  onOpenArtist={onOpenArtist}
                  stopPropagation
                />
              </span>
            </button>
            <button
              type="button"
              className={styles.historyQueueButton}
              aria-label="Открыть меню трека"
              onClick={(event) => onOpenTrackMenu(event, track.id)}
            >
              <FiMoreHorizontal />
            </button>
            <span className={styles.historyDuration}>{formatDurationClock(track.durationSec)}</span>
          </li>
        );
      })}
    </ul>
  );
}
