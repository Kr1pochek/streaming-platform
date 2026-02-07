import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiArrowRight,
  FiChevronRight,
  FiHeadphones,
  FiHeart,
  FiMusic,
  FiPlay,
  FiRadio,
  FiTrendingUp,
  FiZap,
} from "react-icons/fi";
import styles from "./HomePage.module.css";
import useScrollingVisibility from "../hooks/useScrollingVisibility.js";
import useAsyncResource from "../hooks/useAsyncResource.js";
import { fetchHomeFeed } from "../api/musicApi.js";
import { usePlayer } from "../context/PlayerContext.jsx";
import ResourceState from "../components/ResourceState.jsx";
import { formatDurationClock } from "../utils/formatters.js";

const actionIcons = {
  wave: FiRadio,
  liked: FiHeart,
  new: FiTrendingUp,
  energy: FiZap,
};

export default function HomePage() {
  const navigate = useNavigate();
  const { isScrolling, setScrollElement } = useScrollingVisibility();
  const { status, data, error, reload } = useAsyncResource(fetchHomeFeed, []);

  const { trackMap, currentTrack, progressSec, durationLabel, playTrack, togglePlay, likedIds, isPlaying } =
    usePlayer();

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 6) return "Доброй ночи";
    if (hour < 12) return "Доброе утро";
    if (hour < 18) return "Добрый день";
    return "Добрый вечер";
  }, []);

  const freshTracks = useMemo(
    () => (data?.freshTrackIds ?? []).map((id) => trackMap[id]).filter(Boolean),
    [data?.freshTrackIds, trackMap]
  );

  const sectionsEmpty = status === "success" && !data?.showcases?.length && !freshTracks.length;

  return (
    <div className={styles.page}>
      <section
        ref={setScrollElement}
        className={`${styles.shell} ${isScrolling ? styles.shellScrolling : ""}`.trim()}
      >
        <header className={styles.hero}>
          <div className={styles.heroMain}>
            <p className={styles.kicker}>
              <FiHeadphones />
              <span>{greeting}, Роман</span>
            </p>

            <h1 className={styles.heroTitle}>Музыка, которая попадает в настроение.</h1>
            <p className={styles.heroSubtitle}>
              Сегодня в фокусе подборки, быстрые действия и свежие релизы, синхронизированные с плеером.
            </p>

            <div className={styles.heroActions}>
              <button type="button" className={styles.primaryButton} onClick={togglePlay}>
                <FiPlay />
                {isPlaying ? "Пауза" : "Слушать волну"}
              </button>
              <button type="button" className={styles.secondaryButton} onClick={() => navigate("/library")}>
                Открыть библиотеку
                <FiArrowRight />
              </button>
            </div>

            <div className={styles.vibeRow}>
              {(data?.vibeTags ?? []).map((tag) => (
                <button key={tag} type="button" className={styles.vibeTag} onClick={() => navigate("/search")}>
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <aside className={styles.nowCard}>
            <div className={styles.nowCover} style={{ background: currentTrack?.cover }} />
            <div className={styles.nowMeta}>
              <p className={styles.nowLabel}>Сейчас играет</p>
              <h2 className={styles.nowTitle}>{currentTrack?.title ?? "Выбери трек"}</h2>
              <p className={styles.nowArtist}>{currentTrack?.artist ?? "Начни с поиска"}</p>
            </div>
            <div className={styles.progressWrap}>
              <span>{formatDurationClock(progressSec)}</span>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{
                    width:
                      currentTrack?.durationSec && progressSec
                        ? `${Math.min((progressSec / currentTrack.durationSec) * 100, 100)}%`
                        : "0%",
                  }}
                />
              </div>
              <span>{durationLabel}</span>
            </div>
          </aside>
        </header>

        {status === "loading" ? (
          <ResourceState
            loading
            title="Загружаем главную"
            description="Подтягиваем подборки, быстрые действия и персональные треки."
          />
        ) : null}

        {status === "error" ? (
          <ResourceState title="Не удалось загрузить главную" description={error} actionLabel="Повторить" onAction={reload} />
        ) : null}

        {sectionsEmpty ? (
          <ResourceState
            title="Пока пусто"
            description="Добавь треки в очередь или лайки, чтобы наполнять главную автоматически."
            actionLabel="Перейти в поиск"
            onAction={() => navigate("/search")}
          />
        ) : null}

        {status === "success" && !sectionsEmpty ? (
          <>
            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>Быстрый старт</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div className={styles.actionGrid}>
                {data.quickActions.map((item) => {
                  const Icon = actionIcons[item.id] ?? FiMusic;
                  const onClick =
                    item.id === "liked"
                      ? () => navigate("/liked")
                      : item.id === "new"
                        ? () => navigate("/search")
                        : item.id === "energy"
                          ? () => freshTracks[0] && playTrack(freshTracks[0].id)
                          : togglePlay;

                  return (
                    <button key={item.id} className={styles.actionCard} type="button" onClick={onClick}>
                      <span className={styles.actionIcon} style={{ background: item.accent }}>
                        <Icon />
                      </span>
                      <span className={styles.actionMeta}>
                        <span className={styles.actionTitle}>{item.title}</span>
                        <span className={styles.actionSubtitle}>{item.subtitle}</span>
                      </span>
                      <FiArrowRight className={styles.actionArrow} />
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>Свежие подборки</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div className={styles.showcaseGrid}>
                {data.showcases.map((item) => (
                  <button key={item.id} className={styles.showcaseCard} type="button" onClick={() => navigate("/search")}>
                    <span className={styles.showcaseCover} style={{ background: item.cover }} />
                    <span className={styles.showcaseTitle}>{item.title}</span>
                    <span className={styles.showcaseSubtitle}>{item.subtitle}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionHeading}>На волне</h2>
                <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
              </div>
              <div className={styles.trackGrid}>
                <TrackColumn
                  tracks={freshTracks.slice(0, Math.ceil(freshTracks.length / 2))}
                  likedIds={likedIds}
                  onPlay={playTrack}
                />
                <TrackColumn
                  tracks={freshTracks.slice(Math.ceil(freshTracks.length / 2))}
                  likedIds={likedIds}
                  onPlay={playTrack}
                />
              </div>
            </section>
          </>
        ) : null}
      </section>
    </div>
  );
}

function TrackColumn({ tracks, likedIds, onPlay }) {
  return (
    <ul className={styles.trackList}>
      {tracks.map((track) => (
        <li key={track.id}>
          <button type="button" className={styles.trackRow} onClick={() => onPlay(track.id)}>
            <span className={styles.trackIcon}>
              <FiMusic />
            </span>
            <span className={styles.trackMeta}>
              <span className={styles.trackTitle}>
                {track.title}
                {likedIds.includes(track.id) ? <span className={styles.trackLikedDot} aria-hidden="true" /> : null}
              </span>
              <span className={styles.trackArtist}>{track.artist}</span>
            </span>
            <span className={styles.trackTime}>{formatDurationClock(track.durationSec)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
