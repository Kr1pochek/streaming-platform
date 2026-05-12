import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiChevronRight,
  FiClock,
  FiHeart,
  FiLogOut,
  FiMusic,
  FiMoreHorizontal,
  FiRadio,
  FiSearch,
  FiSettings,
  FiUpload,
} from "react-icons/fi";
import styles from "./ProfilePage.module.css";
import PageShell from "../components/PageShell.jsx";
import usePlayer from "../hooks/usePlayer.js";
import useAuth from "../hooks/useAuth.js";
import ResourceState from "../components/ResourceState.jsx";
import SmartRecommendations from "../components/SmartRecommendations.jsx";
import { formatDurationClock } from "../utils/formatters.js";
import ArtistInlineLinks from "../components/ArtistInlineLinks.jsx";
import TrackQueueMenu from "../components/TrackQueueMenu.jsx";
import useTrackQueueMenu from "../hooks/useTrackQueueMenu.js";
import { confirmPasswordReset, requestPasswordReset, uploadTrack } from "../api/musicApi.js";
import ModalDialog from "../components/ModalDialog.jsx";
import ArtistSpotlightCard from "../components/ArtistSpotlightCard.jsx";
import UserAvatar from "../components/UserAvatar.jsx";
import { COMMON_MUSIC_GENRES } from "../../shared/musicGenres.js";

const DEFAULT_UPLOAD_TRACK_COVER = "linear-gradient(135deg, #5f739f 0%, #9ab2ff 50%, #22324d 100%)";
const MAX_TRACK_COVER_FILE_SIZE = 5 * 1024 * 1024;
const TRACK_COVER_MAX_SIDE = 640;
const TRACK_COVER_JPEG_QUALITY = 0.74;
const MAX_TRACK_COVER_BACKGROUND_LENGTH = 900_000;
const EMBEDDED_TRACK_COVER_MAX_SIDE = 420;
const EMBEDDED_TRACK_COVER_JPEG_QUALITY = 0.62;
const MAX_EMBEDDED_TRACK_COVER_BACKGROUND_LENGTH = 1_400_000;
const INITIAL_PROFILE_HISTORY_LIMIT = 6;
const INITIAL_PROFILE_FOLLOWED_ARTISTS_LIMIT = 2;
const UPLOAD_GENRE_DATALIST_ID = "upload-track-genre-suggestions";
const EMPTY_UPLOAD_FORM = {
  audio: null,
  title: "",
  artist: "",
  trackId: "",
  durationSec: "",
  explicit: false,
  genre: "",
  cover: "",
  tags: "",
};
const DASH_SEPARATOR_PATTERN = /\s(?:-|\u2013|\u2014)\s/;
const UPLOAD_METADATA_LOADING_TEXT =
  "\u0421\u0447\u0438\u0442\u044b\u0432\u0430\u0435\u043c \u0442\u0435\u0433\u0438, \u043e\u0431\u043b\u043e\u0436\u043a\u0443 \u0438 \u0434\u043b\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c \u0438\u0437 \u0430\u0443\u0434\u0438\u043e\u0444\u0430\u0439\u043b\u0430...";
const UPLOAD_METADATA_EMBEDDED_COVER_TEXT =
  "\u0412\u0441\u0442\u0440\u043e\u0435\u043d\u043d\u0430\u044f \u043e\u0431\u043b\u043e\u0436\u043a\u0430 \u0438\u0437 \u0430\u0443\u0434\u0438\u043e\u0444\u0430\u0439\u043b\u0430";
const UPLOAD_METADATA_FALLBACK_TEXT =
  "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c \u0432\u0441\u0442\u0440\u043e\u0435\u043d\u043d\u044b\u0435 \u0442\u0435\u0433\u0438. \u041e\u0441\u0442\u0430\u043b\u044c\u043d\u043e\u0435 \u043c\u043e\u0436\u043d\u043e \u0437\u0430\u043f\u043e\u043b\u043d\u0438\u0442\u044c \u0432\u0440\u0443\u0447\u043d\u0443\u044e.";
const UPLOAD_METADATA_SUBMIT_WAIT_TEXT =
  "\u041f\u043e\u0434\u043e\u0436\u0434\u0438, \u043f\u043e\u043a\u0430 \u0434\u043e\u0447\u0438\u0442\u0430\u044e\u0442\u0441\u044f \u043c\u0435\u0442\u0430\u0434\u0430\u043d\u043d\u044b\u0435 \u0444\u0430\u0439\u043b\u0430.";
const UPLOAD_GENRE_HELP_TEXT =
  "\u041c\u043e\u0436\u043d\u043e \u0432\u0432\u0435\u0441\u0442\u0438 \u0441\u0432\u043e\u0439 \u0436\u0430\u043d\u0440 \u0432\u0440\u0443\u0447\u043d\u0443\u044e \u0438\u043b\u0438 \u0431\u044b\u0441\u0442\u0440\u043e \u0432\u044b\u0431\u0440\u0430\u0442\u044c \u043e\u0434\u0438\u043d \u0438\u0437 \u043b\u0435\u043d\u0442\u044b \u043d\u0438\u0436\u0435.";
const UPLOAD_GENRE_ARIA_LABEL = "\u041f\u043e\u0434\u0441\u043a\u0430\u0437\u043a\u0438 \u043f\u043e \u0436\u0430\u043d\u0440\u0430\u043c";

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось обработать изображение."));
    image.src = dataUrl;
  });
}

async function buildTrackCoverFromFile(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("Выбери файл изображения.");
  }
  if (file.size > MAX_TRACK_COVER_FILE_SIZE) {
    throw new Error("Файл слишком большой. Максимум 5 МБ.");
  }

  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);
  const maxSide = Math.max(image.width || 1, image.height || 1);
  const scale = maxSide > TRACK_COVER_MAX_SIDE ? TRACK_COVER_MAX_SIDE / maxSide : 1;
  const width = Math.max(1, Math.round((image.width || 1) * scale));
  const height = Math.max(1, Math.round((image.height || 1) * scale));

  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Не удалось подготовить изображение.");
  }
  context.drawImage(image, 0, 0, width, height);
  const optimizedDataUrl = canvas.toDataURL("image/jpeg", TRACK_COVER_JPEG_QUALITY);
  if (optimizedDataUrl.length > MAX_TRACK_COVER_BACKGROUND_LENGTH) {
    throw new Error("Изображение слишком тяжелое. Попробуй файл меньшего размера.");
  }

  return `url("${optimizedDataUrl}") center / cover no-repeat`;
}

async function buildEmbeddedTrackCoverFromDataUrl(sourceDataUrl) {
  const image = await loadImageElement(sourceDataUrl);
  const maxSide = Math.max(image.width || 1, image.height || 1);
  const scale = maxSide > EMBEDDED_TRACK_COVER_MAX_SIDE ? EMBEDDED_TRACK_COVER_MAX_SIDE / maxSide : 1;
  const width = Math.max(1, Math.round((image.width || 1) * scale));
  const height = Math.max(1, Math.round((image.height || 1) * scale));

  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to process embedded cover.");
  }

  context.drawImage(image, 0, 0, width, height);
  const optimizedDataUrl = canvas.toDataURL("image/jpeg", EMBEDDED_TRACK_COVER_JPEG_QUALITY);
  if (optimizedDataUrl.length > MAX_EMBEDDED_TRACK_COVER_BACKGROUND_LENGTH) {
    return "";
  }

  return `url("${optimizedDataUrl}") center / cover no-repeat`;
}

function stripAudioFileExtension(fileName) {
  return String(fileName ?? "").replace(/\.[^.]+$/, "").trim();
}

function inferTrackFieldsFromUploadFileName(fileName) {
  const normalized = stripAudioFileExtension(fileName).replace(/[_]+/g, " ").trim();
  if (!normalized) {
    return { title: "", artist: "" };
  }

  const separatorMatch = normalized.match(DASH_SEPARATOR_PATTERN);
  if (!separatorMatch) {
    return { title: normalized, artist: "" };
  }

  const [artist = "", title = ""] = normalized.split(DASH_SEPARATOR_PATTERN, 2);
  return {
    title: String(title ?? "").trim() || normalized,
    artist: String(artist ?? "").trim(),
  };
}

function normalizeEmbeddedPictureMimeType(format) {
  const normalized = String(format ?? "").trim().toLowerCase();
  if (!normalized) {
    return "image/jpeg";
  }
  if (normalized === "jpg" || normalized === "jpeg" || normalized === "image/jpg") {
    return "image/jpeg";
  }
  if (normalized === "png") {
    return "image/png";
  }
  if (normalized === "webp") {
    return "image/webp";
  }
  if (normalized === "gif") {
    return "image/gif";
  }
  if (normalized.startsWith("image/")) {
    return normalized;
  }

  return `image/${normalized.replace(/^\./, "")}`;
}

async function buildTrackCoverFromMetadataPicture(picture) {
  if (!picture?.data?.length) {
    return "";
  }

  const pictureType = normalizeEmbeddedPictureMimeType(picture.format);
  const pictureBlob = new Blob([picture.data], { type: pictureType });
  const pictureDataUrl = await readFileAsDataUrl(pictureBlob);
  return buildEmbeddedTrackCoverFromDataUrl(pictureDataUrl);
}

async function extractTrackMetadataFromAudioFile(file) {
  const { parseBlob, selectCover } = await import("music-metadata");
  let metadata;
  try {
    metadata = await parseBlob(file);
  } catch {
    metadata = await parseBlob(file, { skipCovers: true });
  }
  const fallbackFromName = inferTrackFieldsFromUploadFileName(file?.name);
  const genres = Array.isArray(metadata?.common?.genre)
    ? metadata.common.genre.map((genre) => String(genre ?? "").trim()).filter(Boolean)
    : [];
  const coverPicture = selectCover(metadata?.common?.picture ?? []);
  let embeddedCover = "";
  if (coverPicture) {
    try {
      embeddedCover = await buildTrackCoverFromMetadataPicture(coverPicture);
    } catch {
      embeddedCover = "";
    }
  }
  const artistNames = Array.isArray(metadata?.common?.artists)
    ? metadata.common.artists.map((artist) => String(artist ?? "").trim()).filter(Boolean)
    : [];
  const primaryArtist =
    String(metadata?.common?.artist ?? "").trim() ||
    artistNames.join(", ") ||
    fallbackFromName.artist;
  const title = String(metadata?.common?.title ?? "").trim() || fallbackFromName.title;
  const durationSec = Number.isFinite(metadata?.format?.duration) ? Math.round(metadata.format.duration) : null;

  return {
    title,
    artist: primaryArtist,
    genre: genres[0] ?? "",
    tags: genres.slice(1),
    durationSec,
    cover: embeddedCover,
  };
}

function buildUploadMetadataSummary(metadata) {
  const resolvedFields = [];
  if (metadata.title) {
    resolvedFields.push("\u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435");
  }
  if (metadata.artist) {
    resolvedFields.push("\u0438\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044f");
  }
  if (metadata.genre) {
    resolvedFields.push("\u0436\u0430\u043d\u0440");
  }
  if (metadata.durationSec) {
    resolvedFields.push("\u0434\u043b\u0438\u0442\u0435\u043b\u044c\u043d\u043e\u0441\u0442\u044c");
  }
  if (metadata.cover) {
    resolvedFields.push("\u043e\u0431\u043b\u043e\u0436\u043a\u0443");
  }

  if (!resolvedFields.length) {
    return "\u0412\u0441\u0442\u0440\u043e\u0435\u043d\u043d\u044b\u0435 \u0442\u0435\u0433\u0438 \u043d\u0435 \u043d\u0430\u0448\u043b\u0438\u0441\u044c. \u0414\u0430\u043d\u043d\u044b\u0435 \u043c\u043e\u0436\u043d\u043e \u0437\u0430\u043f\u043e\u043b\u043d\u0438\u0442\u044c \u0432\u0440\u0443\u0447\u043d\u0443\u044e.";
  }

  return `\u0418\u0437 \u0444\u0430\u0439\u043b\u0430 \u043f\u043e\u0434\u0442\u044f\u043d\u0443\u043b\u0438: ${resolvedFields.join(", ")}. \u041f\u0440\u0438 \u0436\u0435\u043b\u0430\u043d\u0438\u0438 \u0432\u0441\u0451 \u043c\u043e\u0436\u043d\u043e \u043f\u043e\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0432\u0440\u0443\u0447\u043d\u0443\u044e.`;
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const {
    status: authStatus,
    user,
    isAuthenticated,
    signIn,
    signUp,
    signOut,
    updateProfile,
    uploadAvatar,
    removeAvatar,
    changePassword,
  } = useAuth();
  const {
    artists,
    trackMap,
    likedIds,
    historyIds,
    followedArtistIds,
    currentTrackId,
    playTrack,
    toggleLikeTrack,
    toggleArtistFollow,
    notify,
    refreshCatalog,
  } = usePlayer();
  const { menuState, openTrackMenu, closeTrackMenu, addTrackToQueueNext } = useTrackQueueMenu();

  const [authMode, setAuthMode] = useState("login");
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
    displayName: "",
  });
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [showResetForm, setShowResetForm] = useState(false);
  const [resetUsername, setResetUsername] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetInfo, setResetInfo] = useState("");
  const [devResetToken, setDevResetToken] = useState("");

  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const uploadAvatarInputRef = useRef(null);
  const uploadAudioInputRef = useRef(null);
  const uploadCoverInputRef = useRef(null);
  const [avatarSubmitting, setAvatarSubmitting] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({ ...EMPTY_UPLOAD_FORM });
  const [uploadSubmitting, setUploadSubmitting] = useState(false);
  const [uploadCoverProcessing, setUploadCoverProcessing] = useState(false);
  const [uploadMetadataProcessing, setUploadMetadataProcessing] = useState(false);
  const [uploadMetadataStatus, setUploadMetadataStatus] = useState("");
  const [uploadCoverFileName, setUploadCoverFileName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadedTrackId, setUploadedTrackId] = useState("");
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [showAllFollowedArtists, setShowAllFollowedArtists] = useState(false);
  const uploadAudioMetadataRequestRef = useRef(0);
  useEffect(() => {
    setProfileDisplayName(user?.displayName ?? user?.username ?? "");
  }, [user?.displayName, user?.username]);

  const historyTracks = useMemo(() => historyIds.map((id) => trackMap[id]).filter(Boolean), [historyIds, trackMap]);

  const followedArtists = useMemo(() => {
    const followedSet = new Set(followedArtistIds);
    return (artists ?? []).filter((artist) => followedSet.has(artist.id));
  }, [artists, followedArtistIds]);
  const canToggleFollowedArtists = followedArtists.length > INITIAL_PROFILE_FOLLOWED_ARTISTS_LIMIT;
  const visibleFollowedArtists =
    canToggleFollowedArtists && !showAllFollowedArtists
      ? followedArtists.slice(0, INITIAL_PROFILE_FOLLOWED_ARTISTS_LIMIT)
      : followedArtists;

  const recommendations = useMemo(() => {
    const excluded = new Set([...likedIds, ...historyIds]);
    return Object.values(trackMap).filter((track) => !excluded.has(track.id)).slice(0, 4);
  }, [trackMap, likedIds, historyIds]);
  const guestPreviewTracks = useMemo(() => recommendations.slice(0, 3), [recommendations]);
  const catalogTrackCount = useMemo(
    () => Object.values(trackMap).filter((track) => track?.id).length,
    [trackMap]
  );
  const guestCurrentTrack = useMemo(
    () => (currentTrackId ? trackMap[currentTrackId] ?? null : null),
    [currentTrackId, trackMap]
  );

  const totalHistoryDuration = useMemo(
    () => historyTracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0),
    [historyTracks]
  );
  const accountName = user?.displayName ?? user?.username ?? "Пользователь";
  const canToggleHistory = historyTracks.length > INITIAL_PROFILE_HISTORY_LIMIT;
  const visibleHistoryTracks =
    canToggleHistory && !showAllHistory ? historyTracks.slice(0, INITIAL_PROFILE_HISTORY_LIMIT) : historyTracks;
  const accountHandle = user?.username ? `@${user.username}` : "";
  const hasAvatar = Boolean(user?.avatarUrl);
  const normalizedUploadGenre = uploadForm.genre.trim().toLowerCase();
  const visibleUploadGenres = useMemo(() => {
    if (!normalizedUploadGenre) {
      return COMMON_MUSIC_GENRES;
    }

    const startsWithMatches = [];
    const containsMatches = [];

    COMMON_MUSIC_GENRES.forEach((genre) => {
      const normalizedGenre = genre.toLowerCase();
      if (normalizedGenre.startsWith(normalizedUploadGenre)) {
        startsWithMatches.push(genre);
        return;
      }
      if (normalizedGenre.includes(normalizedUploadGenre)) {
        containsMatches.push(genre);
      }
    });

    const matchedGenres = [...startsWithMatches, ...containsMatches];
    return matchedGenres.length ? matchedGenres : COMMON_MUSIC_GENRES;
  }, [normalizedUploadGenre]);

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    if (authSubmitting) {
      return;
    }

    setAuthError("");
    setAuthSubmitting(true);
    try {
      if (authMode === "register") {
        await signUp({
          username: credentials.username,
          password: credentials.password,
          displayName: credentials.displayName,
        });
      } else {
        await signIn({
          username: credentials.username,
          password: credentials.password,
        });
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Не удалось выполнить авторизацию.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleRequestResetToken = async () => {
    if (resetSubmitting) {
      return;
    }

    const username = resetUsername.trim();
    if (!username) {
      setResetError("Укажи логин.");
      return;
    }

    setResetSubmitting(true);
    setResetError("");
    setResetInfo("");
    setDevResetToken("");
    try {
      const response = await requestPasswordReset({ username });
      const nextToken = String(response?.resetToken ?? "").trim();
      setResetInfo("Если аккаунт существует, токен восстановления создан.");
      if (nextToken) {
        setDevResetToken(nextToken);
        setResetToken(nextToken);
      }
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "Не удалось запросить сброс пароля.");
    } finally {
      setResetSubmitting(false);
    }
  };

  const handleConfirmReset = async () => {
    if (resetSubmitting) {
      return;
    }

    const username = resetUsername.trim();
    const token = resetToken.trim();
    if (!username || !token || !resetPassword) {
      setResetError("Заполни логин, токен и новый пароль.");
      return;
    }

    setResetSubmitting(true);
    setResetError("");
    setResetInfo("");
    try {
      await confirmPasswordReset({
        username,
        token,
        newPassword: resetPassword,
      });
      notify("Пароль изменен. Теперь войди с новым паролем.");
      setShowResetForm(false);
      setAuthMode("login");
      setCredentials((prev) => ({ ...prev, username, password: "", displayName: "" }));
      setResetUsername("");
      setResetToken("");
      setResetPassword("");
      setDevResetToken("");
      setResetInfo("");
    } catch (error) {
      setResetError(error instanceof Error ? error.message : "Не удалось обновить пароль.");
    } finally {
      setResetSubmitting(false);
    }
  };

  const handleUpdateProfile = async (event) => {
    event.preventDefault();
    if (!isAuthenticated || profileSubmitting || avatarSubmitting) {
      return;
    }

    const displayName = profileDisplayName.trim();
    if (!displayName) {
      setProfileError("Имя профиля не может быть пустым.");
      return;
    }

    setProfileSubmitting(true);
    setProfileError("");
    try {
      await updateProfile({ displayName });
      notify("Профиль обновлен.");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Не удалось обновить профиль.");
    } finally {
      setProfileSubmitting(false);
    }
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    if (!isAuthenticated || passwordSubmitting || avatarSubmitting) {
      return;
    }

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordError("Заполни все поля пароля.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("Новый пароль и подтверждение не совпадают.");
      return;
    }

    setPasswordSubmitting(true);
    setPasswordError("");
    try {
      await changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      notify("Пароль обновлен.");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Не удалось изменить пароль.");
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const handleOpenAccountDialog = () => {
    setProfileError("");
    setPasswordError("");
    setAvatarError("");
    setAccountDialogOpen(true);
  };

  const handleCloseAccountDialog = () => {
    setProfileError("");
    setPasswordError("");
    setAvatarError("");
    setAccountDialogOpen(false);
  };

  const handleSelectAvatarFile = () => {
    uploadAvatarInputRef.current?.click();
  };

  const handleAvatarFileChange = async (event) => {
    const nextFile = event.target.files?.[0] ?? null;
    if (!nextFile || !isAuthenticated || avatarSubmitting) {
      return;
    }

    setAvatarSubmitting(true);
    setAvatarError("");
    try {
      await uploadAvatar(nextFile);
      notify("Аватар обновлен.");
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Не удалось обновить аватар.");
    } finally {
      if (uploadAvatarInputRef.current) {
        uploadAvatarInputRef.current.value = "";
      }
      setAvatarSubmitting(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!isAuthenticated || !hasAvatar || avatarSubmitting) {
      return;
    }

    setAvatarSubmitting(true);
    setAvatarError("");
    try {
      await removeAvatar();
      notify("Аватар удален.");
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Не удалось удалить аватар.");
    } finally {
      setAvatarSubmitting(false);
    }
  };

  const handleOpenUploadDialog = () => {
    setUploadError("");
    setUploadedTrackId("");
    setUploadMetadataStatus("");
    setUploadDialogOpen(true);
  };

  const handleCloseUploadDialog = () => {
    if (uploadSubmitting || uploadCoverProcessing || uploadMetadataProcessing) {
      return;
    }
    setUploadError("");
    setUploadDialogOpen(false);
  };

  const handleUploadFieldChange = (field, value) => {
    setUploadForm((prev) => ({ ...prev, [field]: value }));
  };

  const resetUploadFormState = () => {
    uploadAudioMetadataRequestRef.current += 1;
    setUploadForm({ ...EMPTY_UPLOAD_FORM });
    setUploadCoverFileName("");
    setUploadMetadataStatus("");
    setUploadMetadataProcessing(false);
    if (uploadAudioInputRef.current) {
      uploadAudioInputRef.current.value = "";
    }
    if (uploadCoverInputRef.current) {
      uploadCoverInputRef.current.value = "";
    }
  };

  const handleSelectUploadAudioFile = () => {
    uploadAudioInputRef.current?.click();
  };

  const handleSelectUploadCoverFile = () => {
    uploadCoverInputRef.current?.click();
  };

  const handleSelectUploadGenre = (genre) => {
    handleUploadFieldChange("genre", genre);
  };

  const handleUploadAudioFileChange = async (event) => {
    const nextFile = event.target.files?.[0] ?? null;
    uploadAudioMetadataRequestRef.current += 1;
    const requestId = uploadAudioMetadataRequestRef.current;

    if (!nextFile) {
      setUploadMetadataProcessing(false);
      setUploadMetadataStatus("");
      setUploadForm((prev) => ({ ...prev, audio: null }));
      setUploadCoverFileName("");
      return;
    }

    const fallbackFields = inferTrackFieldsFromUploadFileName(nextFile.name);
    setUploadError("");
    setUploadedTrackId("");
    setUploadMetadataProcessing(true);
    setUploadMetadataStatus(UPLOAD_METADATA_LOADING_TEXT);
    setUploadMetadataStatus("Считываем теги, обложку и длительность из аудиофайла...");
    setUploadCoverFileName("");
    setUploadForm((prev) => ({
      ...prev,
      audio: nextFile,
      title: fallbackFields.title,
      artist: fallbackFields.artist,
      trackId: "",
      durationSec: "",
      genre: "",
      cover: "",
      tags: "",
    }));
    setUploadMetadataStatus(UPLOAD_METADATA_LOADING_TEXT);

    try {
      const metadata = await extractTrackMetadataFromAudioFile(nextFile);
      if (uploadAudioMetadataRequestRef.current !== requestId) {
        return;
      }

      setUploadForm((prev) => ({
        ...prev,
        audio: nextFile,
        title: metadata.title || fallbackFields.title,
        artist: metadata.artist || fallbackFields.artist,
        trackId: "",
        durationSec: metadata.durationSec ? String(metadata.durationSec) : "",
        genre: metadata.genre || "",
        cover: metadata.cover || "",
        tags: metadata.tags.join(", "),
      }));
      setUploadCoverFileName(metadata.cover ? "Встроенная обложка из аудиофайла" : "");
      if (metadata.cover) {
        setUploadCoverFileName(UPLOAD_METADATA_EMBEDDED_COVER_TEXT);
      }
      setUploadMetadataStatus(buildUploadMetadataSummary(metadata));
    } catch {
      if (uploadAudioMetadataRequestRef.current !== requestId) {
        return;
      }

      setUploadForm((prev) => ({
        ...prev,
        audio: nextFile,
        title: fallbackFields.title,
        artist: fallbackFields.artist,
        trackId: "",
        durationSec: "",
        genre: "",
        cover: "",
        tags: "",
      }));
      setUploadCoverFileName("");
      setUploadMetadataStatus(UPLOAD_METADATA_FALLBACK_TEXT);
      window.setTimeout(() => {
        if (uploadAudioMetadataRequestRef.current === requestId) {
          setUploadMetadataStatus(UPLOAD_METADATA_FALLBACK_TEXT);
        }
      }, 0);
      setUploadMetadataStatus("Не удалось прочитать встроенные теги. Остальное можно заполнить вручную.");
    } finally {
      if (uploadAudioMetadataRequestRef.current === requestId) {
        setUploadMetadataProcessing(false);
      }
    }
  };

  const handleUploadCoverFileChange = async (event) => {
    const nextFile = event.target.files?.[0] ?? null;
    if (!nextFile) {
      return;
    }

    setUploadError("");
    setUploadCoverProcessing(true);
    try {
      const nextCover = await buildTrackCoverFromFile(nextFile);
      handleUploadFieldChange("cover", nextCover);
      setUploadCoverFileName(nextFile.name);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Не удалось обработать изображение.");
      if (uploadCoverInputRef.current) {
        uploadCoverInputRef.current.value = "";
      }
    } finally {
      setUploadCoverProcessing(false);
    }
  };

  const handleClearUploadCover = () => {
    if (uploadSubmitting || uploadCoverProcessing || uploadMetadataProcessing) {
      return;
    }
    handleUploadFieldChange("cover", "");
    setUploadCoverFileName("");
    if (uploadCoverInputRef.current) {
      uploadCoverInputRef.current.value = "";
    }
  };

  const handleUploadTrack = async (event) => {
    event.preventDefault();
    if (!isAuthenticated || uploadSubmitting) {
      return;
    }

    const title = uploadForm.title.trim();
    const artist = uploadForm.artist.trim();
    const genre = uploadForm.genre.trim();

    if (!uploadForm.audio) {
      setUploadError("Выбери аудиофайл.");
      return;
    }
    if (!title || !artist) {
      setUploadError("Название и исполнители обязательны.");
      return;
    }
    if (!genre) {
      setUploadError("Жанр обязателен.");
      return;
    }
    if (uploadCoverProcessing) {
      setUploadError("Дождись завершения обработки обложки.");
      return;
    }

    if (uploadMetadataProcessing) {
      setUploadError(UPLOAD_METADATA_SUBMIT_WAIT_TEXT);
      return;
    }

    setUploadSubmitting(true);
    setUploadError("");
    setUploadedTrackId("");

    try {
      const duration = Number.parseInt(String(uploadForm.durationSec ?? "").trim(), 10);
      const normalizedGenre = genre.toLowerCase();
      const customTags = String(uploadForm.tags ?? "")
        .split(/[,\n]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      const tags = Array.from(new Set([normalizedGenre, ...customTags]));

      const response = await uploadTrack({
        audio: uploadForm.audio,
        title,
        artist,
        trackId: uploadForm.trackId.trim() || undefined,
        durationSec: Number.isFinite(duration) ? duration : undefined,
        explicit: uploadForm.explicit,
        cover: uploadForm.cover.trim() || undefined,
        tags: tags.join(","),
      });

      const nextTrackId = String(response?.track?.id ?? "").trim();
      resetUploadFormState();

      if (nextTrackId) {
        setUploadedTrackId(nextTrackId);
      }
      notify("Трек успешно загружен.");
      try {
        await refreshCatalog({ silent: true });
      } catch {
        // keep successful upload result even if catalog refresh fails
      }
      setUploadDialogOpen(false);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Не удалось загрузить трек.");
    } finally {
      setUploadSubmitting(false);
    }
  };

  const changeCredentials = (field, value) => {
    setCredentials((prev) => ({ ...prev, [field]: value }));
  };

  const authErrorLooksBlocked = /заблок|blocked|banned/i.test(authError);

  const renderGuestProfile = () => (
    <PageShell>
      <header className={styles.guestHeader}>
        <p className={styles.guestKicker}>Гостевой режим</p>
        <h1 className={styles.title}>Аккаунт, который не теряет твою музыку</h1>
        <p className={styles.subtitle}>
          Войди или создай профиль, чтобы закрепить лайки, историю, подписки и рекомендации за собой и
          продолжать прослушивание без потерь.
        </p>
      </header>

      <div className={styles.guestShell}>
        <section className={`${styles.section} ${styles.guestAuthSection}`.trim()}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionTitle}>Авторизация</h2>
          </div>

          {!showResetForm ? (
            <form className={styles.authForm} onSubmit={handleAuthSubmit}>
              <p className={styles.subtitle}>
                {authMode === "register"
                  ? "Создай аккаунт, чтобы синхронизировать лайки, подписки и историю."
                  : "Войди, чтобы продолжить прослушивание с теми же лайками и плейлистами."}
              </p>

              <label className={styles.authLabel}>
                Логин
                <input
                  className={styles.authInput}
                  value={credentials.username}
                  onChange={(event) => changeCredentials("username", event.target.value)}
                  minLength={3}
                  maxLength={32}
                  required
                />
              </label>

              <label className={styles.authLabel}>
                Пароль
                <input
                  className={styles.authInput}
                  type="password"
                  value={credentials.password}
                  onChange={(event) => changeCredentials("password", event.target.value)}
                  minLength={6}
                  maxLength={128}
                  required
                />
              </label>

              {authMode === "register" ? (
                <label className={styles.authLabel}>
                  Отображаемое имя
                  <input
                    className={styles.authInput}
                    value={credentials.displayName}
                    onChange={(event) => changeCredentials("displayName", event.target.value)}
                    maxLength={48}
                  />
                </label>
              ) : null}

              {authError ? (
                <div
                  className={`${styles.authErrorPanel} ${authErrorLooksBlocked ? styles.authErrorPanelBlocked : ""}`.trim()}
                  role="alert"
                >
                  <p className={styles.authError}>{authError}</p>
                  {authErrorLooksBlocked ? (
                    <p className={styles.authErrorHint}>
                      Если это произошло по ошибке, свяжись с администратором платформы.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className={styles.authActions}>
                <button type="submit" className={styles.authPrimaryButton} disabled={authSubmitting}>
                  {authSubmitting ? "Подключаем..." : authMode === "register" ? "Создать аккаунт" : "Войти"}
                </button>

                <button
                  type="button"
                  className={styles.authSecondaryButton}
                  onClick={() => {
                    setAuthMode((prev) => (prev === "register" ? "login" : "register"));
                    setAuthError("");
                  }}
                >
                  {authMode === "register" ? "У меня уже есть аккаунт" : "Создать новый аккаунт"}
                </button>

                <button
                  type="button"
                  className={styles.authSecondaryButton}
                  onClick={() => {
                    setShowResetForm(true);
                    setResetError("");
                    setResetInfo("");
                    setDevResetToken("");
                  }}
                >
                  Забыли пароль?
                </button>
              </div>
            </form>
          ) : (
            <div className={styles.authForm}>
              <p className={styles.subtitle}>
                Запроси токен восстановления, затем введи его и новый пароль.
              </p>

              <label className={styles.authLabel}>
                Логин
                <input
                  className={styles.authInput}
                  value={resetUsername}
                  onChange={(event) => setResetUsername(event.target.value)}
                  minLength={3}
                  maxLength={32}
                />
              </label>

              <label className={styles.authLabel}>
                Токен восстановления
                <input
                  className={styles.authInput}
                  value={resetToken}
                  onChange={(event) => setResetToken(event.target.value)}
                />
              </label>

              <label className={styles.authLabel}>
                Новый пароль
                <input
                  className={styles.authInput}
                  type="password"
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  minLength={6}
                  maxLength={128}
                />
              </label>

              {devResetToken ? <p className={styles.authError}>Dev token: {devResetToken}</p> : null}
              {resetInfo ? <p className={styles.subtitle}>{resetInfo}</p> : null}
              {resetError ? <p className={styles.authError}>{resetError}</p> : null}

              <div className={styles.authActions}>
                <button
                  type="button"
                  className={styles.authPrimaryButton}
                  disabled={resetSubmitting}
                  onClick={handleRequestResetToken}
                >
                  {resetSubmitting ? "Запрашиваем..." : "Получить токен"}
                </button>

                <button
                  type="button"
                  className={styles.authPrimaryButton}
                  disabled={resetSubmitting}
                  onClick={handleConfirmReset}
                >
                  {resetSubmitting ? "Сохраняем..." : "Сменить пароль"}
                </button>

                <button
                  type="button"
                  className={styles.authSecondaryButton}
                  onClick={() => {
                    setShowResetForm(false);
                    setResetError("");
                    setResetInfo("");
                    setDevResetToken("");
                  }}
                >
                  Назад ко входу
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className={styles.guestAside}>
          <article className={styles.guestHeroCard}>
            <p className={styles.guestCardEyebrow}>Что получишь с аккаунтом</p>
            <h2 className={styles.guestCardTitle}>Сессия уже живая, аккаунт просто закрепит её за тобой.</h2>
            <p className={styles.guestCardText}>
              После входа музыка перестанет быть временной: лайки, подписки, история и загруженные треки
              останутся в профиле и будут доступны в следующих сессиях.
            </p>

            <div className={styles.guestStatGrid}>
              <article className={styles.guestStatCard}>
                <span className={styles.guestStatValue}>{likedIds.length}</span>
                <span className={styles.guestStatLabel}>лайков уже собрано</span>
              </article>
              <article className={styles.guestStatCard}>
                <span className={styles.guestStatValue}>{historyTracks.length}</span>
                <span className={styles.guestStatLabel}>треков в истории</span>
              </article>
              <article className={styles.guestStatCard}>
                <span className={styles.guestStatValue}>{followedArtists.length}</span>
                <span className={styles.guestStatLabel}>подписок на артистов</span>
              </article>
              <article className={styles.guestStatCard}>
                <span className={styles.guestStatValue}>{catalogTrackCount}</span>
                <span className={styles.guestStatLabel}>треков доступно сейчас</span>
              </article>
            </div>
          </article>

          <div className={styles.guestFeatureGrid}>
            <article className={styles.guestFeatureCard}>
              <span className={styles.guestFeatureIcon}>
                <FiHeart />
              </span>
              <div className={styles.guestFeatureBody}>
                <h3 className={styles.guestFeatureTitle}>Синхронизация лайков</h3>
                <p className={styles.guestFeatureText}>
                  Любимые треки и подборки останутся с тобой после входа и будут доступны на следующих устройствах.
                </p>
              </div>
            </article>

            <article className={styles.guestFeatureCard}>
              <span className={styles.guestFeatureIcon}>
                <FiRadio />
              </span>
              <div className={styles.guestFeatureBody}>
                <h3 className={styles.guestFeatureTitle}>Более точная волна</h3>
                <p className={styles.guestFeatureText}>
                  Рекомендации подстраиваются под любимые жанры, историю запуска и сохранённые треки.
                </p>
              </div>
            </article>

            <article className={styles.guestFeatureCard}>
              <span className={styles.guestFeatureIcon}>
                <FiUpload />
              </span>
              <div className={styles.guestFeatureBody}>
                <h3 className={styles.guestFeatureTitle}>Свой каталог и профиль</h3>
                <p className={styles.guestFeatureText}>
                  Можно загружать треки, оформлять профиль и собирать библиотеку без потери текущей сессии.
                </p>
              </div>
            </article>
          </div>

          <article className={styles.guestSessionCard}>
            <div className={styles.guestSessionHeader}>
              <p className={styles.guestCardEyebrow}>Сейчас в гостевой сессии</p>
              <h3 className={styles.guestSessionTitle}>
                {guestCurrentTrack ? "Музыка уже играет" : "Можно начать прямо сейчас"}
              </h3>
            </div>

            {guestCurrentTrack ? (
              <button
                type="button"
                className={styles.guestNowPlaying}
                onClick={() => navigate(`/track/${guestCurrentTrack.id}`)}
              >
                <span className={styles.guestNowCover} style={{ background: guestCurrentTrack.cover }} />
                <span className={styles.guestNowMeta}>
                  <span className={styles.guestNowLabel}>Сейчас играет</span>
                  <span className={styles.guestNowTitle}>{guestCurrentTrack.title}</span>
                  <span className={styles.guestNowSubtitle}>{guestCurrentTrack.artist}</span>
                </span>
                <FiChevronRight className={styles.guestNowChevron} />
              </button>
            ) : (
              <div className={styles.guestNowEmpty}>
                Включи трек с главной или из поиска, и он сразу появится здесь как часть твоей текущей сессии.
              </div>
            )}

            <div className={styles.guestActionRow}>
              <button
                type="button"
                className={`${styles.guestActionButton} ${styles.guestActionButtonPrimary}`.trim()}
                onClick={() => navigate("/search")}
              >
                <FiSearch />
                Открыть поиск
              </button>
              <button type="button" className={styles.guestActionButton} onClick={() => navigate("/")}>
                <FiMusic />
                На главную
              </button>
            </div>

            {guestPreviewTracks.length ? (
              <div className={styles.guestPreviewBlock}>
                <p className={styles.guestPreviewTitle}>Можно включить сразу</p>
                <div className={styles.guestPreviewList}>
                  {guestPreviewTracks.map((track) => (
                    <button
                      key={track.id}
                      type="button"
                      className={styles.guestPreviewButton}
                      onClick={() => playTrack(track.id)}
                    >
                      <span className={styles.guestPreviewCover} style={{ background: track.cover }} />
                      <span className={styles.guestPreviewMeta}>
                        <span className={styles.guestPreviewTrack}>{track.title}</span>
                        <span className={styles.guestPreviewArtist}>{track.artist}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </article>
        </aside>
      </div>
    </PageShell>
  );

  if (authStatus === "loading" && !isAuthenticated) {
    return (
      <PageShell>
        <ResourceState loading title="Проверяем сессию" description="Подключаем профиль и предпочтения." />
      </PageShell>
    );
  }

  if (!isAuthenticated) {
    return renderGuestProfile();
  }

  if (isAuthenticated && authStatus === "__legacy_guest__") {
    return (
      <PageShell>
        <section className={styles.section}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionTitle}>Авторизация</h2>
          </div>

          {!showResetForm ? (
            <form className={styles.authForm} onSubmit={handleAuthSubmit}>
              <p className={styles.subtitle}>
                {authMode === "register"
                  ? "Создай аккаунт, чтобы синхронизировать лайки, подписки и историю."
                  : "Войди, чтобы продолжить прослушивание с теми же лайками и плейлистами."}
              </p>

              <label className={styles.authLabel}>
                Логин
                <input
                  className={styles.authInput}
                  value={credentials.username}
                  onChange={(event) => changeCredentials("username", event.target.value)}
                  minLength={3}
                  maxLength={32}
                  required
                />
              </label>

              <label className={styles.authLabel}>
                Пароль
                <input
                  className={styles.authInput}
                  type="password"
                  value={credentials.password}
                  onChange={(event) => changeCredentials("password", event.target.value)}
                  minLength={6}
                  maxLength={128}
                  required
                />
              </label>

              {authMode === "register" ? (
                <label className={styles.authLabel}>
                  Отображаемое имя
                  <input
                    className={styles.authInput}
                    value={credentials.displayName}
                    onChange={(event) => changeCredentials("displayName", event.target.value)}
                    maxLength={48}
                  />
                </label>
              ) : null}

              {authError ? (
                <div
                  className={`${styles.authErrorPanel} ${authErrorLooksBlocked ? styles.authErrorPanelBlocked : ""}`.trim()}
                  role="alert"
                >
                  <p className={styles.authError}>{authError}</p>
                  {authErrorLooksBlocked ? (
                    <p className={styles.authErrorHint}>
                      Если это произошло по ошибке, свяжись с администратором платформы.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className={styles.authActions}>
                <button type="submit" className={styles.authPrimaryButton} disabled={authSubmitting}>
                  {authSubmitting ? "Подключаем..." : authMode === "register" ? "Создать аккаунт" : "Войти"}
                </button>

                <button
                  type="button"
                  className={styles.authSecondaryButton}
                  onClick={() => {
                    setAuthMode((prev) => (prev === "register" ? "login" : "register"));
                    setAuthError("");
                  }}
                >
                  {authMode === "register" ? "У меня уже есть аккаунт" : "Создать новый аккаунт"}
                </button>

                <button
                  type="button"
                  className={styles.authSecondaryButton}
                  onClick={() => {
                    setShowResetForm(true);
                    setResetError("");
                    setResetInfo("");
                    setDevResetToken("");
                  }}
                >
                  Забыли пароль?
                </button>
              </div>
            </form>
          ) : (
            <div className={styles.authForm}>
              <p className={styles.subtitle}>
                Запроси токен восстановления, затем введи его и новый пароль.
              </p>

              <label className={styles.authLabel}>
                Логин
                <input
                  className={styles.authInput}
                  value={resetUsername}
                  onChange={(event) => setResetUsername(event.target.value)}
                  minLength={3}
                  maxLength={32}
                />
              </label>

              <label className={styles.authLabel}>
                Токен восстановления
                <input
                  className={styles.authInput}
                  value={resetToken}
                  onChange={(event) => setResetToken(event.target.value)}
                />
              </label>

              <label className={styles.authLabel}>
                Новый пароль
                <input
                  className={styles.authInput}
                  type="password"
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  minLength={6}
                  maxLength={128}
                />
              </label>

              {devResetToken ? <p className={styles.authError}>Dev token: {devResetToken}</p> : null}
              {resetInfo ? <p className={styles.subtitle}>{resetInfo}</p> : null}
              {resetError ? <p className={styles.authError}>{resetError}</p> : null}

              <div className={styles.authActions}>
                <button
                  type="button"
                  className={styles.authPrimaryButton}
                  disabled={resetSubmitting}
                  onClick={handleRequestResetToken}
                >
                  {resetSubmitting ? "Запрашиваем..." : "Получить токен"}
                </button>

                <button
                  type="button"
                  className={styles.authPrimaryButton}
                  disabled={resetSubmitting}
                  onClick={handleConfirmReset}
                >
                  {resetSubmitting ? "Сохраняем..." : "Сменить пароль"}
                </button>

                <button
                  type="button"
                  className={styles.authSecondaryButton}
                  onClick={() => {
                    setShowResetForm(false);
                    setResetError("");
                    setResetInfo("");
                    setDevResetToken("");
                  }}
                >
                  Назад ко входу
                </button>
              </div>
            </div>
          )}
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <header className={styles.header}>
        <div className={styles.headerIdentity}>
          <UserAvatar avatarUrl={user?.avatarUrl} name={accountName} className={styles.profileAvatar} />
          <div className={styles.headerCopy}>
            {accountHandle ? <p className={styles.profileHandle}>{accountHandle}</p> : null}
            <h1 className={styles.title}>Профиль</h1>
            <p className={styles.subtitle}>{accountName}: подписки, история и музыкальные предпочтения.</p>
          </div>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.statsRow}>
            <article className={styles.statCard}>
              <span className={styles.statLabel}>Подписок</span>
              <strong className={styles.statValue}>{followedArtists.length}</strong>
            </article>
            <article className={styles.statCard}>
              <span className={styles.statLabel}>История</span>
              <strong className={styles.statValue}>{historyTracks.length}</strong>
            </article>
            <article className={styles.statCard}>
              <span className={styles.statLabel}>Время прослушивания</span>
              <strong className={styles.statValue}>{formatDurationClock(totalHistoryDuration)}</strong>
            </article>
          </div>
          <div className={styles.controlRow}>
            <button type="button" className={styles.actionButton} onClick={handleOpenAccountDialog}>
              <FiSettings />
              Настройки аккаунта
            </button>
            <button
              type="button"
              className={`${styles.actionButton} ${styles.uploadActionButton}`.trim()}
              onClick={handleOpenUploadDialog}
            >
              <FiUpload />
              Загрузить трек
            </button>
            <button type="button" className={styles.logoutButton} onClick={signOut}>
              <FiLogOut />
              Выйти
            </button>
          </div>
        </div>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionTitleRow}>
          <h2 className={styles.sectionTitle}>Подписки</h2>
          <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
        </div>
        {followedArtists.length ? (
          <>
            <div className={styles.artistGrid}>
            {visibleFollowedArtists.map((artist) => (
              <ArtistSpotlightCard
                key={artist.id}
                artist={artist}
                audience="followers"
                contextLabel="Подписка"
                description="Быстрый доступ к странице артиста, новым релизам и трекам в вашей коллекции."
                followLabel="Отписаться"
                isFollowed
                onOpen={() => navigate(`/artist/${artist.id}`)}
                onToggleFollow={() => toggleArtistFollow(artist.id)}
                openLabel="Открыть"
              />
            ))}
          </div>
            {canToggleFollowedArtists ? (
              <button
                type="button"
                className={styles.sectionToggleButton}
                onClick={() => setShowAllFollowedArtists((value) => !value)}
              >
                {showAllFollowedArtists ? "Свернуть" : "Показать все"}
              </button>
            ) : null}
          </>
        ) : (
          <div className={styles.subscriptionsEmpty}>
            <ResourceState
              title="Пока нет подписок"
              description="Открой страницу исполнителя и нажми «Подписаться»."
              actionLabel="Перейти в поиск"
              onAction={() => navigate("/search")}
            />
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionTitleRow}>
          <h2 className={styles.sectionTitle}>История</h2>
          <FiChevronRight className={styles.sectionArrow} aria-hidden="true" />
        </div>
        {historyTracks.length ? (
          <>
            <ul className={styles.trackList}>
              {visibleHistoryTracks.map((track) => {
              const isActive = currentTrackId === track.id;
              const liked = likedIds.includes(track.id);
              return (
                <li key={track.id} className={`${styles.trackRow} ${isActive ? styles.trackRowActive : ""}`.trim()}>
                  <button
                    type="button"
                    className={styles.trackMain}
                    onClick={() => playTrack(track.id)}
                    onContextMenu={(event) => openTrackMenu(event, track.id)}
                  >
                    <span className={styles.trackCover} style={{ background: track.cover }} />
                    <span className={styles.trackMeta}>
                      <span className={styles.trackTitle}>
                        {track.title}
                        {liked ? <FiHeart className={styles.trackLikedHeart} aria-hidden="true" /> : null}
                      </span>
                      <ArtistInlineLinks
                        artistLine={track.artist}
                        className={styles.trackArtist}
                        linkClassName={styles.trackArtistButton}
                        textClassName={styles.trackArtist}
                        onOpenArtist={(artistId) => navigate(`/artist/${artistId}`)}
                        stopPropagation
                      />
                    </span>
                    <span className={styles.trackDuration}>
                      <FiClock />
                      {formatDurationClock(track.durationSec)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconButton} ${liked ? styles.iconButtonActive : ""}`.trim()}
                    onClick={() => toggleLikeTrack(track.id)}
                    aria-label={liked ? "Убрать из избранного" : "Добавить в избранное"}
                  >
                    <FiHeart />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={(event) => openTrackMenu(event, track.id)}
                    aria-label="Открыть меню трека"
                  >
                    <FiMoreHorizontal />
                  </button>
                </li>
              );
              })}
            </ul>
            {canToggleHistory ? (
              <button
                type="button"
                className={styles.sectionToggleButton}
                onClick={() => setShowAllHistory((value) => !value)}
              >
                {showAllHistory ? "Свернуть" : "Показать все"}
              </button>
            ) : null}
          </>
        ) : (
          <ResourceState
            title="История пуста"
            description="Запусти несколько треков из поиска или плейлистов."
            actionLabel="Открыть поиск"
            onAction={() => navigate("/search")}
          />
        )}
      </section>

      {!followedArtists.length && !historyTracks.length ? (
        <SmartRecommendations
          title="Для старта профиля"
          tracks={recommendations}
          onPlayTrack={playTrack}
          onLikeTrack={toggleLikeTrack}
          onOpenTrackMenu={openTrackMenu}
        />
      ) : null}

      <TrackQueueMenu menuState={menuState} onAddTrackNext={addTrackToQueueNext} onClose={closeTrackMenu} />

      <ModalDialog
        open={accountDialogOpen}
        title="Настройки аккаунта"
        description="Аватар, отображаемое имя и безопасность аккаунта."
        onClose={handleCloseAccountDialog}
      >
        <form className={`${styles.authForm} ${styles.modalForm}`.trim()} onSubmit={handleUpdateProfile}>
          <input
            ref={uploadAvatarInputRef}
            className={styles.fileInputHidden}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleAvatarFileChange}
          />
          <div className={styles.accountAvatarCard}>
            <UserAvatar avatarUrl={user?.avatarUrl} name={accountName} className={styles.accountAvatarPreview} />
            <div className={styles.accountAvatarMeta}>
              <div>
                <p className={styles.accountAvatarTitle}>Аватар профиля</p>
                <p className={styles.accountAvatarHint}>JPG, PNG, WebP или GIF, до 5 МБ.</p>
              </div>
              <div className={styles.authActions}>
                <button
                  type="button"
                  className={styles.filePickerButton}
                  disabled={avatarSubmitting}
                  onClick={handleSelectAvatarFile}
                >
                  {avatarSubmitting ? "Загружаем..." : hasAvatar ? "Сменить аватар" : "Добавить аватар"}
                </button>
                <button
                  type="button"
                  className={styles.authSecondaryButton}
                  disabled={!hasAvatar || avatarSubmitting}
                  onClick={handleRemoveAvatar}
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>

          <label className={styles.authLabel}>
            Отображаемое имя
            <input
              className={styles.authInput}
              value={profileDisplayName}
              onChange={(event) => setProfileDisplayName(event.target.value)}
              maxLength={48}
            />
          </label>
          {avatarError ? <p className={styles.authError}>{avatarError}</p> : null}
          {profileError ? <p className={styles.authError}>{profileError}</p> : null}
          <div className={styles.authActions}>
            <button type="submit" className={styles.authPrimaryButton} disabled={profileSubmitting || avatarSubmitting}>
              {profileSubmitting ? "Сохраняем..." : "Сохранить профиль"}
            </button>
          </div>
        </form>

        <form className={`${styles.authForm} ${styles.modalForm}`.trim()} onSubmit={handleChangePassword}>
          <label className={styles.authLabel}>
            Текущий пароль
            <input
              className={styles.authInput}
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) =>
                setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))
              }
              minLength={6}
              maxLength={128}
            />
          </label>
          <label className={styles.authLabel}>
            Новый пароль
            <input
              className={styles.authInput}
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
              minLength={6}
              maxLength={128}
            />
          </label>
          <label className={styles.authLabel}>
            Подтверждение нового пароля
            <input
              className={styles.authInput}
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(event) =>
                setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))
              }
              minLength={6}
              maxLength={128}
            />
          </label>
          {passwordError ? <p className={styles.authError}>{passwordError}</p> : null}
          <div className={styles.authActions}>
            <button
              type="submit"
              className={styles.authPrimaryButton}
              disabled={passwordSubmitting || avatarSubmitting}
            >
              {passwordSubmitting ? "Сохраняем..." : "Изменить пароль"}
            </button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog
        open={uploadDialogOpen}
        title="Загрузка трека"
        description="Заполни данные трека и укажи жанр. Этот жанр попадет в любимые жанры профиля."
        onClose={handleCloseUploadDialog}
      >
        <form className={`${styles.authForm} ${styles.modalForm}`.trim()} onSubmit={handleUploadTrack}>
          <label className={styles.authLabel}>
            Аудиофайл
            <input
              ref={uploadAudioInputRef}
              className={styles.fileInputHidden}
              type="file"
              accept="audio/*"
              onChange={handleUploadAudioFileChange}
            />
            <div className={styles.filePickerRow}>
              <button type="button" className={styles.filePickerButton} onClick={handleSelectUploadAudioFile}>
                Выбрать файл
              </button>
              <span className={styles.filePickerText}>
                {uploadForm.audio ? uploadForm.audio.name : "Файл не выбран"}
              </span>
            </div>
            {uploadMetadataStatus ? <p className={styles.uploadMetaStatus}>{uploadMetadataStatus}</p> : null}
          </label>

          <div className={styles.uploadGrid}>
            <label className={styles.authLabel}>
              Название
              <input
                className={styles.authInput}
                value={uploadForm.title}
                maxLength={120}
                required
                onChange={(event) => handleUploadFieldChange("title", event.target.value)}
              />
            </label>

            <label className={styles.authLabel}>
              Исполнитель
              <input
                className={styles.authInput}
                value={uploadForm.artist}
                maxLength={220}
                required
                placeholder="Например: Miyagi, Andy Panda или Miyagi feat. Andy Panda"
                onChange={(event) => handleUploadFieldChange("artist", event.target.value)}
              />
            </label>

            <p className={styles.uploadHint}>Несколько артистов можно указывать через запятую или `feat./ft.`.</p>

            <label className={styles.authLabel}>
              Жанр
              <input
                className={styles.authInput}
                value={uploadForm.genre}
                maxLength={40}
                required
                list={UPLOAD_GENRE_DATALIST_ID}
                placeholder="Например, synthwave"
                onChange={(event) => handleUploadFieldChange("genre", event.target.value)}
              />
            </label>
            <datalist id={UPLOAD_GENRE_DATALIST_ID}>
              {COMMON_MUSIC_GENRES.map((genre) => (
                <option key={genre} value={genre} />
              ))}
            </datalist>
            <p className={styles.genreHelperText}>{UPLOAD_GENRE_HELP_TEXT}</p>
            <div className={styles.genreRail} role="list" aria-label={UPLOAD_GENRE_ARIA_LABEL}>
              {visibleUploadGenres.map((genre) => {
                const isActive = genre.toLowerCase() === normalizedUploadGenre;
                return (
                  <button
                    key={genre}
                    type="button"
                    className={`${styles.genreChip} ${isActive ? styles.genreChipActive : ""}`.trim()}
                    onClick={() => handleSelectUploadGenre(genre)}
                  >
                    {genre}
                  </button>
                );
              })}
            </div>

            <label className={styles.authLabel}>
              Track ID (опционально)
              <input
                className={styles.authInput}
                value={uploadForm.trackId}
                maxLength={80}
                onChange={(event) => handleUploadFieldChange("trackId", event.target.value)}
              />
            </label>

            <label className={styles.authLabel}>
              Длительность, сек (опционально)
              <input
                className={styles.authInput}
                type="number"
                min={1}
                step={1}
                value={uploadForm.durationSec}
                onChange={(event) => handleUploadFieldChange("durationSec", event.target.value)}
              />
            </label>

            <div className={styles.coverUploadBlock}>
              <p className={styles.coverUploadTitle}>Обложка (опционально)</p>
              <div className={styles.coverUploadLayout}>
                <span
                  className={styles.coverPreview}
                  style={{ background: uploadForm.cover || DEFAULT_UPLOAD_TRACK_COVER }}
                />
                <div className={styles.coverUploadControls}>
                  <input
                    ref={uploadCoverInputRef}
                    className={styles.fileInputHidden}
                    type="file"
                    accept="image/*"
                    onChange={handleUploadCoverFileChange}
                  />
                  <div className={styles.coverUploadButtons}>
                    <button
                      type="button"
                      className={styles.filePickerButton}
                      disabled={uploadCoverProcessing || uploadMetadataProcessing}
                      onClick={handleSelectUploadCoverFile}
                    >
                      {uploadCoverProcessing ? "Обрабатываем..." : "Загрузить обложку"}
                    </button>
                    <button
                      type="button"
                      className={styles.authSecondaryButton}
                      disabled={!uploadForm.cover || uploadCoverProcessing || uploadMetadataProcessing}
                      onClick={handleClearUploadCover}
                    >
                      Удалить
                    </button>
                  </div>
                  <p className={styles.filePickerText}>{uploadCoverFileName || "JPG/PNG/WebP, до 5 МБ"}</p>
                </div>
              </div>
            </div>
          </div>

          <label className={styles.authLabel}>
            Доп. теги (через запятую, опционально)
            <input
              className={styles.authInput}
              value={uploadForm.tags}
              maxLength={240}
              placeholder="night, driving"
              onChange={(event) => handleUploadFieldChange("tags", event.target.value)}
            />
          </label>

          <label className={styles.uploadCheckbox}>
            <input
              type="checkbox"
              checked={uploadForm.explicit}
              onChange={(event) => handleUploadFieldChange("explicit", event.target.checked)}
            />
            Explicit
          </label>

          <p className={styles.uploadHint}>Трек появится в каталоге после загрузки и обновления данных плеера.</p>

          {uploadError ? <p className={styles.authError}>{uploadError}</p> : null}
          {uploadedTrackId ? <p className={styles.uploadSuccess}>Загружено: {uploadedTrackId}</p> : null}

          <div className={styles.authActions}>
            <button
              type="submit"
              className={styles.authPrimaryButton}
              disabled={uploadSubmitting || uploadCoverProcessing || uploadMetadataProcessing}
            >
              {uploadSubmitting ? "Загружаем..." : "Загрузить трек"}
            </button>
            <button
              type="button"
              className={styles.authSecondaryButton}
              disabled={uploadSubmitting || uploadCoverProcessing || uploadMetadataProcessing}
              onClick={handleCloseUploadDialog}
            >
              Закрыть
            </button>
          </div>
        </form>
      </ModalDialog>
    </PageShell>
  );
}
