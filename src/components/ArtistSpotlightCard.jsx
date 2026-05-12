import { FiExternalLink, FiHeadphones, FiUserMinus, FiUserPlus, FiUsers } from "react-icons/fi";
import styles from "./ArtistSpotlightCard.module.css";

const audienceForms = {
  listeners: ["слушатель", "слушателя", "слушателей"],
  followers: ["подписчик", "подписчика", "подписчиков"],
};

function pluralizeRu(value, one, few, many) {
  const normalized = Math.abs(Math.trunc(Number(value) || 0));
  const mod100 = normalized % 100;
  if (mod100 >= 11 && mod100 <= 19) {
    return many;
  }

  const mod10 = normalized % 10;
  if (mod10 === 1) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }
  return many;
}

function formatAudience(value, audience) {
  const forms = audienceForms[audience] ?? audienceForms.listeners;
  const rawValue = String(value ?? "").trim();
  const normalizedValue = rawValue.replace(",", ".");
  const shorthandPattern = /^\d+(?:\.\d+)?\s*[KMB]$/i;

  if (shorthandPattern.test(normalizedValue)) {
    return `${normalizedValue.toUpperCase()} ${forms[2]}`;
  }

  const safeValue = Math.max(0, Math.trunc(Number(normalizedValue) || 0));
  return `${safeValue.toLocaleString("ru-RU")} ${pluralizeRu(safeValue, ...forms)}`;
}

function parseAudienceCount(value) {
  const rawValue = String(value ?? "").trim().replace(",", ".");
  const shorthandMatch = rawValue.match(/^(\d+(?:\.\d+)?)\s*([KMB])$/i);
  if (shorthandMatch) {
    const [, amount, suffix] = shorthandMatch;
    const multipliers = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
    return Math.max(0, Math.trunc(Number(amount) * multipliers[suffix.toUpperCase()]));
  }
  return Math.max(0, Math.trunc(Number(rawValue) || 0));
}

function getArtistInitials(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "?";
  }

  if (parts.length === 1) {
    return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
  }

  return `${Array.from(parts[0])[0] ?? ""}${Array.from(parts[1])[0] ?? ""}`.toUpperCase();
}

function createArtistTheme(name, followers) {
  let seed = 19;
  for (const symbol of Array.from(String(name ?? ""))) {
    seed = (seed * 31 + (symbol.codePointAt(0) ?? 0)) % 360;
  }

  const hue = seed % 360;
  const followerSeed = Math.max(0, Number(followers) || 0);
  const secondaryHue = (hue + 42 + (followerSeed % 54)) % 360;

  return {
    "--artist-card-glow": `hsla(${hue} 84% 68% / 0.26)`,
    "--artist-card-glow-soft": `hsla(${secondaryHue} 76% 62% / 0.18)`,
    "--artist-card-accent": `hsl(${hue} 84% 66%)`,
    "--artist-card-accent-strong": `hsl(${secondaryHue} 88% 72%)`,
    "--artist-card-border": `hsla(${hue} 82% 70% / 0.24)`,
  };
}

function resolveAvatarBackground(artist) {
  return String(artist?.avatar ?? artist?.avatarUrl ?? artist?.cover ?? "").trim();
}

export default function ArtistSpotlightCard({
  artist,
  audience = "listeners",
  className = "",
  contextLabel = "",
  description = "",
  followLabel = "",
  isFollowed = false,
  onOpen,
  onToggleFollow = null,
  openLabel = "Открыть",
}) {
  const name = String(artist?.name ?? "").trim() || "Неизвестный артист";
  const followers = Math.max(parseAudienceCount(artist?.followers), isFollowed ? 1 : 0);
  const listeners = parseAudienceCount(artist?.listeners ?? artist?.listenerCount);
  const avatarBackground = resolveAvatarBackground(artist);
  const initials = getArtistInitials(name);
  const resolvedFollowLabel = String(followLabel ?? "").trim() || (isFollowed ? "Отписаться" : "Подписаться");
  const orderedMetrics =
    audience === "followers"
      ? [
          { key: "followers", icon: <FiUsers />, value: followers },
          { key: "listeners", icon: <FiHeadphones />, value: listeners },
        ]
      : [
          { key: "listeners", icon: <FiHeadphones />, value: listeners },
          { key: "followers", icon: <FiUsers />, value: followers },
        ];

  return (
    <article className={`${styles.card} ${className}`.trim()} style={createArtistTheme(name, followers)}>
      <button
        type="button"
        className={styles.mainButton}
        aria-label={`Открыть страницу артиста ${name}`}
        onClick={onOpen}
      >
        <span
          className={`${styles.avatar} ${avatarBackground ? styles.avatarWithImage : ""}`.trim()}
          style={avatarBackground ? { background: avatarBackground } : undefined}
        >
          <span className={styles.avatarGlow} aria-hidden="true" />
          <span className={styles.avatarText}>{initials}</span>
        </span>

        <span className={styles.content}>
          <span className={styles.kickerRow}>
            <span className={styles.kicker}>Исполнитель</span>
            {contextLabel ? <span className={styles.contextBadge}>{contextLabel}</span> : null}
          </span>

          <span className={styles.name}>{name}</span>

          {description ? <span className={styles.description}>{description}</span> : null}

          <span className={styles.metrics}>
            {orderedMetrics.map((metric) => (
              <span key={metric.key} className={styles.metric}>
                {metric.icon}
                {formatAudience(metric.value, metric.key)}
              </span>
            ))}
            {isFollowed ? <span className={`${styles.metric} ${styles.metricActive}`.trim()}>В моей музыке</span> : null}
          </span>
        </span>
      </button>

      <div className={styles.actions}>
        <button type="button" className={`${styles.actionButton} ${styles.openButton}`.trim()} onClick={onOpen}>
          <FiExternalLink />
          {openLabel}
        </button>

        {onToggleFollow ? (
          <button
            type="button"
            className={`${styles.actionButton} ${isFollowed ? styles.followButtonActive : styles.followButton}`.trim()}
            onClick={onToggleFollow}
          >
            {isFollowed ? <FiUserMinus /> : <FiUserPlus />}
            {resolvedFollowLabel}
          </button>
        ) : null}
      </div>
    </article>
  );
}
