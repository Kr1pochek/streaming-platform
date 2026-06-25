import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiChevronRight,
  FiExternalLink,
  FiHeart,
  FiList,
  FiPlusSquare,
  FiShare2,
  FiUser,
} from "react-icons/fi";
import { BsFillPlayFill } from "react-icons/bs";
import { LuHeartOff } from "react-icons/lu";
import {
  addTrackToUserPlaylist,
  fetchTrackPage,
  removeTrackFromUserPlaylist,
} from "../api/musicApi.js";
import useAuth from "../hooks/useAuth.js";
import usePlayer from "../hooks/usePlayer.js";
import styles from "./TrackQueueMenu.module.css";

const EMPTY_STATE = {
  status: "idle",
  data: null,
  error: "",
};

function clampToViewport(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function TrackQueueMenu({ menuState, onAddTrackNext, onOpenTrack, onClose }) {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const {
    likedIds,
    toggleLikeTrack,
    addTrackNext,
    addTrackLast,
    playTrackTrailer,
    notify,
  } = usePlayer();

  const [trackState, setTrackState] = useState(EMPTY_STATE);
  const [loadingPlaylistId, setLoadingPlaylistId] = useState("");
  const [playlistSubmenuOpen, setPlaylistSubmenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({
    left: 0,
    top: 0,
    submenuSide: "right",
  });

  const cacheRef = useRef(new Map());
  const menuRef = useRef(null);
  const playlistSubmenuCloseTimerRef = useRef(null);
  const trackId = String(menuState?.trackId ?? "");

  useEffect(() => {
    if (playlistSubmenuCloseTimerRef.current) {
      clearTimeout(playlistSubmenuCloseTimerRef.current);
      playlistSubmenuCloseTimerRef.current = null;
    }
    setPlaylistSubmenuOpen(false);
  }, [trackId]);

  useEffect(
    () => () => {
      if (playlistSubmenuCloseTimerRef.current) {
        clearTimeout(playlistSubmenuCloseTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!trackId) {
      setTrackState(EMPTY_STATE);
      return;
    }

    const cached = cacheRef.current.get(trackId);
    if (cached) {
      setTrackState({
        status: "success",
        data: cached,
        error: "",
      });
      return;
    }

    let cancelled = false;
    setTrackState({
      status: "loading",
      data: null,
      error: "",
    });

    const loadTrackMeta = async () => {
      try {
        const payload = await fetchTrackPage(trackId);
        if (cancelled) {
          return;
        }
        cacheRef.current.set(trackId, payload);
        setTrackState({
          status: "success",
          data: payload,
          error: "",
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setTrackState({
          status: "error",
          data: null,
          error: error instanceof Error ? error.message : "Не удалось загрузить действия для трека.",
        });
      }
    };

    void loadTrackMeta();

    return () => {
      cancelled = true;
    };
  }, [trackId]);

  useEffect(() => {
    if (!menuState || !menuRef.current || typeof window === "undefined") {
      return;
    }

    const updatePosition = () => {
      const bounds = menuRef.current?.getBoundingClientRect();
      if (!bounds) {
        return;
      }

      const viewportPadding = 12;
      const nextLeft = clampToViewport(
        menuState.x,
        viewportPadding,
        window.innerWidth - bounds.width - viewportPadding
      );
      const nextTop = clampToViewport(
        menuState.y,
        viewportPadding,
        window.innerHeight - bounds.height - viewportPadding
      );
      const submenuSide =
        nextLeft + bounds.width + 240 > window.innerWidth - viewportPadding ? "left" : "right";

      setMenuPosition({
        left: nextLeft,
        top: nextTop,
        submenuSide,
      });
    };

    const frameId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updatePosition);
    };
  }, [menuState, trackState.status, trackState.data, playlistSubmenuOpen]);

  const isLiked = likedIds.includes(trackId);
  const playlistToggles = Array.isArray(trackState.data?.playlistToggles)
    ? trackState.data.playlistToggles
    : [];
  const artist = trackState.data?.artist ?? null;

  const clearPlaylistSubmenuCloseTimer = () => {
    if (!playlistSubmenuCloseTimerRef.current) {
      return;
    }
    clearTimeout(playlistSubmenuCloseTimerRef.current);
    playlistSubmenuCloseTimerRef.current = null;
  };

  const openPlaylistSubmenu = () => {
    clearPlaylistSubmenuCloseTimer();
    setPlaylistSubmenuOpen(true);
  };

  const schedulePlaylistSubmenuClose = () => {
    clearPlaylistSubmenuCloseTimer();
    playlistSubmenuCloseTimerRef.current = setTimeout(() => {
      setPlaylistSubmenuOpen(false);
      playlistSubmenuCloseTimerRef.current = null;
    }, 300);
  };

  const handleClose = () => {
    clearPlaylistSubmenuCloseTimer();
    setPlaylistSubmenuOpen(false);
    onClose?.();
  };

  const handleToggleLike = () => {
    if (!trackId) {
      return;
    }
    toggleLikeTrack(trackId);
    handleClose();
  };

  const handlePlayTrailer = () => {
    if (!trackId) {
      return;
    }
    playTrackTrailer(trackId, 18);
    handleClose();
  };

  const handleAddNext = () => {
    if (!trackId) {
      return;
    }
    if (typeof onAddTrackNext === "function") {
      onAddTrackNext(trackId);
    } else {
      addTrackNext(trackId);
    }
    handleClose();
  };

  const handleAddLast = () => {
    if (!trackId) {
      return;
    }
    addTrackLast(trackId);
    handleClose();
  };

  const handleShareTrack = async () => {
    if (!trackId || typeof window === "undefined") {
      return;
    }

    const absoluteUrl = `${window.location.origin}/track/${trackId}`;
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(absoluteUrl);
      notify("Ссылка на трек скопирована.");
    } catch {
      window.prompt("Скопируй ссылку на трек:", absoluteUrl);
    }
    handleClose();
  };

  const handleOpenTrack = () => {
    if (!trackId) {
      return;
    }
    if (typeof onOpenTrack === "function") {
      onOpenTrack();
    } else {
      navigate(`/track/${trackId}`);
    }
    handleClose();
  };

  const handleOpenArtist = () => {
    if (!artist?.id) {
      return;
    }
    navigate(`/artist/${artist.id}`);
    handleClose();
  };

  const handleCreatePlaylist = () => {
    if (!isAuthenticated) {
      notify("Войди в аккаунт, чтобы создавать плейлисты.");
      navigate("/profile");
      handleClose();
      return;
    }
    navigate("/library?createPlaylist=1");
    handleClose();
  };

  const updateCachedTrackState = (updater) => {
    setTrackState((prev) => {
      if (!prev?.data) {
        return prev;
      }
      const nextData = updater(prev.data);
      cacheRef.current.set(trackId, nextData);
      return {
        ...prev,
        data: nextData,
      };
    });
  };

  const handleTogglePlaylist = async (playlist) => {
    if (!trackId || !playlist?.id) {
      return;
    }
    if (!isAuthenticated) {
      notify("Войди в аккаунт, чтобы управлять плейлистами.");
      navigate("/profile");
      handleClose();
      return;
    }

    setLoadingPlaylistId(playlist.id);
    try {
      if (playlist.hasTrack) {
        await removeTrackFromUserPlaylist(playlist.id, trackId);
      } else {
        await addTrackToUserPlaylist(playlist.id, trackId);
      }

      updateCachedTrackState((currentData) => ({
        ...currentData,
        playlistToggles: (currentData.playlistToggles ?? []).map((item) => {
          if (item.id !== playlist.id) {
            return item;
          }
          const currentTrackIds = Array.isArray(item.trackIds) ? item.trackIds : [];
          const nextTrackIds = item.hasTrack
            ? currentTrackIds.filter((id) => id !== trackId)
            : [...currentTrackIds, trackId];
          return {
            ...item,
            hasTrack: !item.hasTrack,
            trackIds: nextTrackIds,
          };
        }),
      }));

      notify(playlist.hasTrack ? "Трек убран из плейлиста." : "Трек добавлен в плейлист.");
      handleClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Не удалось обновить плейлист.");
    } finally {
      setLoadingPlaylistId("");
    }
  };

  const playlistPanel = (() => {
    if (!isAuthenticated) {
      return (
        <div className={styles.submenuPanel}>
          <p className={styles.submenuHint}>Войди в аккаунт, чтобы добавлять треки в свои плейлисты.</p>
          <button type="button" className={styles.submenuPrimaryButton} onClick={handleCreatePlaylist}>
            Перейти к плейлистам
          </button>
        </div>
      );
    }

    if (trackState.status === "loading") {
      return (
        <div className={styles.submenuPanel}>
          <p className={styles.submenuHint}>Загружаю твои плейлисты...</p>
        </div>
      );
    }

    if (!playlistToggles.length) {
      return (
        <div className={styles.submenuPanel}>
          <p className={styles.submenuHint}>Пока нет пользовательских плейлистов. Можно создать первый прямо сейчас.</p>
          <button type="button" className={styles.submenuPrimaryButton} onClick={handleCreatePlaylist}>
            Создать плейлист
          </button>
        </div>
      );
    }

    return (
      <div className={styles.submenuPanel}>
        <div className={styles.submenuList}>
          {playlistToggles.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              className={`${styles.submenuButton} ${
                playlist.hasTrack ? styles.submenuButtonActive : ""
              }`.trim()}
              onClick={() => handleTogglePlaylist(playlist)}
              disabled={loadingPlaylistId === playlist.id}
            >
              <span className={styles.submenuMeta}>
                <span className={styles.submenuTitle}>{playlist.title}</span>
                <span className={styles.submenuSubtitle}>{playlist.trackIds?.length ?? 0} треков</span>
              </span>
              <span className={styles.submenuState}>
                {loadingPlaylistId === playlist.id ? "..." : playlist.hasTrack ? "Есть" : "Добавить"}
              </span>
            </button>
          ))}
        </div>
        <button type="button" className={styles.submenuPrimaryButton} onClick={handleCreatePlaylist}>
          Создать плейлист
        </button>
      </div>
    );
  })();

  if (!menuState || !trackId) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ top: menuPosition.top, left: menuPosition.left }}
      data-submenu-side={menuPosition.submenuSide}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className={styles.menuHeader}>
        <p className={styles.menuTitle}>{trackState.data?.track?.title ?? "Действия с треком"}</p>
        <p className={styles.menuSubtitle}>
          {trackState.data?.track?.artist ?? (trackState.status === "loading" ? "Подготавливаю меню..." : "Трек")}
        </p>
      </div>

      <div className={styles.menuList}>
        <button type="button" className={styles.menuButton} onClick={handleToggleLike}>
          <span className={styles.menuIcon}>{isLiked ? <FiHeart /> : <LuHeartOff />}</span>
          <span className={styles.menuLabel}>{isLiked ? "Убрать лайк" : "Нравится"}</span>
        </button>

        <button type="button" className={styles.menuButton} onClick={handlePlayTrailer}>
          <span className={styles.menuIcon}>
            <BsFillPlayFill />
          </span>
          <span className={styles.menuLabel}>Трейлер 18 секунд</span>
        </button>

        <button type="button" className={styles.menuButton} onClick={handleAddNext}>
          <span className={styles.menuIcon}>
            <FiList />
          </span>
          <span className={styles.menuLabel}>Играть следующим</span>
        </button>

        <button type="button" className={styles.menuButton} onClick={handleAddLast}>
          <span className={styles.menuIcon}>
            <FiList />
          </span>
          <span className={styles.menuLabel}>Добавить в конец очереди</span>
        </button>

        <div
          className={styles.submenuHost}
          onMouseEnter={openPlaylistSubmenu}
          onMouseLeave={schedulePlaylistSubmenuClose}
          onFocus={openPlaylistSubmenu}
          onBlur={(event) => {
            if (event.currentTarget.contains(event.relatedTarget)) {
              return;
            }
            schedulePlaylistSubmenuClose();
          }}
        >
          <button
            type="button"
            className={`${styles.menuButton} ${styles.menuButtonWithArrow}`.trim()}
            onClick={() => {
              clearPlaylistSubmenuCloseTimer();
              setPlaylistSubmenuOpen((current) => !current);
            }}
          >
            <span className={styles.menuIcon}>
              <FiPlusSquare />
            </span>
            <span className={styles.menuLabel}>Добавить в плейлист</span>
            <FiChevronRight className={styles.menuArrow} />
          </button>

          <div
            className={`${styles.submenu} ${playlistSubmenuOpen ? styles.submenuOpen : ""}`.trim()}
            onMouseEnter={openPlaylistSubmenu}
            onMouseLeave={schedulePlaylistSubmenuClose}
          >
            {playlistPanel}
          </div>
        </div>

        <button type="button" className={styles.menuButton} onClick={handleShareTrack}>
          <span className={styles.menuIcon}>
            <FiShare2 />
          </span>
          <span className={styles.menuLabel}>Поделиться</span>
        </button>

        {artist?.id ? (
          <button type="button" className={styles.menuButton} onClick={handleOpenArtist}>
            <span className={styles.menuIcon}>
              <FiUser />
            </span>
            <span className={styles.menuLabel}>Перейти к исполнителю</span>
          </button>
        ) : null}

        <button type="button" className={styles.menuButton} onClick={handleOpenTrack}>
          <span className={styles.menuIcon}>
            <FiExternalLink />
          </span>
          <span className={styles.menuLabel}>Открыть трек</span>
        </button>
      </div>

      {trackState.status === "error" ? (
        <p className={styles.menuFooter}>{trackState.error || "Не все дополнительные действия удалось загрузить."}</p>
      ) : null}
    </div>
  );
}
