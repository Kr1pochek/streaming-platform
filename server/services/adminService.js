import {
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  HttpError,
  createReleaseId,
  fetchCatalog,
  fetchArtists,
  hasHlsManifestForTrack,
  isTrackAudioAvailable,
  isSystemPlaylist,
  mediaDirectory,
  normalizeTitle,
  pool,
  resolveMediaFilePath,
  sanitizeTrackTags,
  validateCatalogAudioFiles,
  withTransaction,
} from "./catalogService.js";
import { isElevatedAdminRole, isSuperAdminRole, normalizeAdminRole } from "./authService.js";

const RELEASE_TYPES = new Set(["album", "ep", "single"]);
const RELEASE_STATUSES = new Set(["draft", "published"]);
const AVATAR_FILE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const LOCAL_MEDIA_ROUTE_PREFIX = "/api/media/";

function encodeMediaRelativePath(relativePath = "") {
  return String(relativePath ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function findLocalAvatarUrl(userId = "") {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) {
    return "";
  }

  const avatarRoot = path.resolve(mediaDirectory, "avatars");
  const avatarDirectory = path.resolve(avatarRoot, normalizedUserId);
  if (!avatarDirectory.startsWith(`${avatarRoot}${path.sep}`) || !existsSync(avatarDirectory)) {
    return "";
  }

  let avatarEntries = [];
  try {
    avatarEntries = readdirSync(avatarDirectory, { withFileTypes: true });
  } catch {
    return "";
  }

  const avatarFiles = avatarEntries
    .filter((entry) => entry.isFile() && AVATAR_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const absolutePath = path.join(avatarDirectory, entry.name);
      try {
        return {
          absolutePath,
          modifiedAt: statSync(absolutePath).mtimeMs,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((first, second) => second.modifiedAt - first.modifiedAt);

  const latestAvatar = avatarFiles[0];
  if (!latestAvatar) {
    return "";
  }

  const relativePath = path.relative(mediaDirectory, latestAvatar.absolutePath);
  return `${LOCAL_MEDIA_ROUTE_PREFIX}${encodeMediaRelativePath(relativePath)}`;
}

function resolveAdminUserAvatarUrl(row = {}) {
  const avatarUrl = String(row.avatarUrl ?? row.avatar_url ?? "").trim();
  return avatarUrl || findLocalAvatarUrl(row.id);
}

function normalizeAdminQuery(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

function resolveAdminRoleSql(alias = "u") {
  return `coalesce(nullif(${alias}.admin_role, ''), case when coalesce(${alias}.is_admin, false) = true then 'super_admin' else 'user' end)`;
}

function mapAdminUserRow(row = {}) {
  const adminRole = normalizeAdminRole(
    row.adminRole ?? row.admin_role,
    row.isAdmin || row.is_admin ? "super_admin" : "user"
  );
  const avatarUrl = resolveAdminUserAvatarUrl(row);

  return {
    ...row,
    avatarUrl,
    avatar_url: avatarUrl,
    adminRole,
    isAdmin: isElevatedAdminRole(adminRole),
    isSuperAdmin: isSuperAdminRole(adminRole),
    isBanned: Boolean(row.isBanned ?? row.is_banned),
    createdAt: Number(row.createdAt ?? row.created_at ?? 0),
    uploadedTracksCount: Number(row.uploadedTracksCount ?? row.uploaded_tracks_count ?? 0),
    uploaded_tracks_count: Number(row.uploaded_tracks_count ?? row.uploadedTracksCount ?? 0),
  };
}

function buildTrackFilters({ query = "", status = "all" } = {}) {
  const conditions = [];
  const values = [];

  const normalizedQuery = normalizeAdminQuery(query);
  if (normalizedQuery) {
    values.push(`%${normalizedQuery}%`);
    const parameter = `$${values.length}`;
    conditions.push(`
      (
        lower(t.id) like ${parameter}
        or lower(t.title) like ${parameter}
        or lower(coalesce(uploader.username, '')) like ${parameter}
        or exists (
          select 1
          from track_artists ta
          join artists a on a.id = ta.artist_id
          where ta.track_id = t.id
            and lower(a.name) like ${parameter}
        )
      )
    `);
  }

  const normalizedStatus = String(status ?? "all").trim().toLowerCase();
  if (normalizedStatus === "hidden") {
    conditions.push("coalesce(t.is_hidden, false) = true");
  } else if (normalizedStatus === "visible") {
    conditions.push("coalesce(t.is_hidden, false) = false");
  } else if (normalizedStatus === "local") {
    conditions.push("t.audio_url like '/api/media/%'");
  } else if (normalizedStatus === "remote") {
    conditions.push("(t.audio_url is not null and t.audio_url not like '/api/media/%')");
  }

  const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";
  return { whereClause, values };
}

function buildUserFilters({ query = "", status = "all" } = {}) {
  const conditions = [];
  const values = [];
  const adminRoleExpr = resolveAdminRoleSql("u");

  const normalizedQuery = normalizeAdminQuery(query);
  if (normalizedQuery) {
    values.push(`%${normalizedQuery}%`);
    const parameter = `$${values.length}`;
    conditions.push(`
      (
        lower(u.id) like ${parameter}
        or lower(u.username) like ${parameter}
        or lower(coalesce(u.display_name, '')) like ${parameter}
      )
    `);
  }

  const normalizedStatus = String(status ?? "all").trim().toLowerCase();
  if (normalizedStatus === "banned") {
    conditions.push("coalesce(u.is_banned, false) = true");
  } else if (normalizedStatus === "active") {
    conditions.push(`coalesce(u.is_banned, false) = false and ${adminRoleExpr} = 'user'`);
  } else if (normalizedStatus === "admin") {
    conditions.push(`${adminRoleExpr} in ('moderator', 'super_admin')`);
  } else if (normalizedStatus === "moderator") {
    conditions.push(`${adminRoleExpr} = 'moderator'`);
  } else if (normalizedStatus === "super_admin") {
    conditions.push(`${adminRoleExpr} = 'super_admin'`);
  }

  const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";
  return { whereClause, values };
}

function buildReleaseFilters({ query = "", status = "all" } = {}) {
  const conditions = [];
  const values = [];

  const normalizedQuery = normalizeAdminQuery(query);
  if (normalizedQuery) {
    values.push(`%${normalizedQuery}%`);
    const parameter = `$${values.length}`;
    conditions.push(`
      (
        lower(r.id) like ${parameter}
        or lower(r.title) like ${parameter}
        or lower(a.name) like ${parameter}
      )
    `);
  }

  const normalizedStatus = String(status ?? "all").trim().toLowerCase();
  if (normalizedStatus === "draft" || normalizedStatus === "published") {
    values.push(normalizedStatus);
    conditions.push(`coalesce(nullif(r.status, ''), 'published') = $${values.length}`);
  }

  const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";
  return { whereClause, values };
}

function compareText(left = "", right = "") {
  return String(left ?? "").localeCompare(String(right ?? ""), "ru");
}

function normalizeReleaseType(value = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  return RELEASE_TYPES.has(normalized) ? normalized : "";
}

function normalizeReleaseStatus(value = "", fallback = "draft") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (RELEASE_STATUSES.has(normalized)) {
    return normalized;
  }
  return RELEASE_STATUSES.has(fallback) ? fallback : "draft";
}

function normalizeReleaseYear(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(parsed)) {
    return currentYear;
  }
  return Math.min(Math.max(parsed, 1900), currentYear + 2);
}

function uniqueReleaseTrackIds(trackIds = []) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(trackIds) ? trackIds : []) {
    const normalized = String(item ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function assertReleaseTrackCount(type, trackIds = []) {
  const count = Array.isArray(trackIds) ? trackIds.length : 0;

  if (type === "single" && count !== 1) {
    throw new HttpError(400, "Single must contain exactly one track.");
  }

  if ((type === "ep" || type === "album") && count < 2) {
    throw new HttpError(400, "EP and album must contain at least two tracks.");
  }
}

function mapAdminReleaseRow(row = {}) {
  const status = normalizeReleaseStatus(row.status, "published");
  const trackIds = Array.isArray(row.trackIds) ? row.trackIds : [];
  return {
    id: row.id,
    artistId: row.artistId,
    artistName: row.artistName ?? "",
    title: row.title,
    type: row.type,
    year: Number(row.year ?? 0),
    cover: row.cover ?? "",
    description: row.description ?? "",
    status,
    isPublished: status === "published",
    createdAt: Number(row.createdAt ?? 0),
    publishedAt: Number(row.publishedAt ?? 0),
    createdByUsername: row.createdByUsername ?? "",
    trackIds,
    trackCount: Number(row.trackCount ?? trackIds.length),
  };
}

function compareTracksByAdminRecency(first, second) {
  const createdDelta = Number(second?.createdAt ?? 0) - Number(first?.createdAt ?? 0);
  if (createdDelta !== 0) {
    return createdDelta;
  }
  return compareText(first?.title, second?.title);
}

function summarizePlaylistPreview(playlist) {
  return {
    id: playlist.id,
    title: playlist.title,
    subtitle: playlist.subtitle,
    cover: playlist.cover,
    trackCount: Array.isArray(playlist.trackIds) ? playlist.trackIds.length : 0,
    isSystem: isSystemPlaylist(playlist),
  };
}

function summarizeTrackPreview(track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    durationSec: Number(track.durationSec ?? 0),
    createdAt: Number(track.createdAt ?? 0),
    isLocalAudio: Boolean(track.isLocalAudio),
    hasHls: Boolean(track.hlsUrl),
  };
}

export async function getAdminStats() {
  const result = await pool.query(
    `
    select
      (select count(*) from users) as total_users,
      (select count(*) from users where is_banned = true) as banned_users,
      (select count(*) from users where admin_role in ('moderator', 'super_admin')) as admin_users,
      (select count(*) from users where admin_role = 'moderator') as moderator_users,
      (select count(*) from users where admin_role = 'super_admin') as super_admin_users,
      (select count(*) from tracks) as total_tracks,
      (select count(*) from tracks where is_hidden = true) as hidden_tracks,
      (select count(*) from artists) as total_artists,
      (select count(*) from playlists) as total_playlists,
      (select count(*) from playlists where is_custom = true or id like 'upl-%') as custom_playlists,
      (select count(*) from releases) as total_releases,
      (select count(distinct user_id) from user_sessions where expires_at > extract(epoch from now()) * 1000) as active_sessions
    `
  );
  const [catalog, validation, topUploadersResult, recentUsersResult] = await Promise.all([
    fetchCatalog(),
    validateCatalogAudioFiles(),
    pool.query(
      `
      select
        u.id,
        u.username,
        u.display_name as "displayName",
        ${resolveAdminRoleSql("u")} as "adminRole",
        coalesce(u.is_banned, false) as "isBanned",
        count(t.id)::int as "uploadedTracksCount"
      from users u
      join tracks t on t.uploaded_by = u.id
      group by u.id, u.username, u.display_name, u.admin_role, u.is_admin, u.is_banned
      order by count(t.id) desc, max(coalesce(t.created_at, 0)) desc, u.username asc
      limit 5;
      `
    ),
    pool.query(
      `
      select
        u.id,
        u.username,
        u.display_name as "displayName",
        ${resolveAdminRoleSql("u")} as "adminRole",
        coalesce(u.is_banned, false) as "isBanned",
        coalesce(u.created_at, 0) as "createdAt",
        coalesce(track_counts.uploaded_tracks_count, 0) as "uploadedTracksCount"
      from users u
      left join (
        select uploaded_by, count(*)::int as uploaded_tracks_count
        from tracks
        where uploaded_by is not null
        group by uploaded_by
      ) track_counts on track_counts.uploaded_by = u.id
      order by u.created_at desc, u.username asc
      limit 5;
      `
    ),
  ]);
  const visibleTracks = catalog.tracks;
  const playablePublicPlaylists = catalog.playlists.filter(
    (playlist) => !playlist.isCustom && !isSystemPlaylist(playlist)
  );
  const systemPlaylists = catalog.playlists.filter((playlist) => isSystemPlaylist(playlist));
  const localTracks = visibleTracks.filter((track) => track.isLocalAudio).length;
  const hlsTracks = visibleTracks.filter((track) => Boolean(track.hlsUrl)).length;
  const base = result.rows[0] ?? {};

  return {
    totals: {
      users: Number(base.total_users ?? 0),
      bannedUsers: Number(base.banned_users ?? 0),
      adminUsers: Number(base.admin_users ?? 0),
      moderatorUsers: Number(base.moderator_users ?? 0),
      superAdminUsers: Number(base.super_admin_users ?? 0),
      tracks: Number(base.total_tracks ?? 0),
      hiddenTracks: Number(base.hidden_tracks ?? 0),
      artists: Number(base.total_artists ?? 0),
      playlists: Number(base.total_playlists ?? 0),
      customPlaylists: Number(base.custom_playlists ?? 0),
      releases: Number(base.total_releases ?? 0),
      activeSessions: Number(base.active_sessions ?? 0),
    },
    catalogHealth: {
      visibleTracks: visibleTracks.length,
      sparseCatalog: visibleTracks.length < 6,
      publicPlaylistsVisible: playablePublicPlaylists.length,
      publicPlaylistsEmpty: Math.max(
        Number(base.total_playlists ?? 0) - Number(base.custom_playlists ?? 0) - playablePublicPlaylists.length,
        0
      ),
      systemPlaylists: systemPlaylists.length,
      releasesVisible: catalog.releases.length,
      releasesEmpty: Math.max(Number(base.total_releases ?? 0) - catalog.releases.length, 0),
    },
    mediaHealth: {
      localTracks,
      remoteTracks: Math.max(visibleTracks.length - localTracks, 0),
      hlsTracks,
      missingAudioUrl: validation.missingAudioUrl.length,
      missingLocalFiles: validation.missingFiles.length,
      invalidLocalUrls: validation.invalidLocalUrls.length,
    },
    catalogPreview: {
      featuredPlaylists: catalog.playlists
        .filter((playlist) => !playlist.isCustom)
        .slice(0, 6)
        .map((playlist) => summarizePlaylistPreview(playlist)),
      latestTracks: [...visibleTracks]
        .sort(compareTracksByAdminRecency)
        .slice(0, 6)
        .map((track) => summarizeTrackPreview(track)),
    },
    userHighlights: {
      topUploaders: topUploadersResult.rows.map((row) => mapAdminUserRow(row)),
      recentUsers: recentUsersResult.rows.map((row) => mapAdminUserRow(row)),
    },
  };
}

export async function getUploadedTracks({ limit = 20, offset = 0, query = "", status = "all" } = {}) {
  const { whereClause, values } = buildTrackFilters({ query, status });
  values.push(limit, offset);
  const result = await pool.query(
    `
    select
      t.id,
      t.title,
      t.duration_sec as "durationSec",
      coalesce(t.is_hidden, false) as "isHidden",
      t.hidden_reason as "hiddenReason",
      t.hidden_at as "hiddenAt",
      (select coalesce(display_name, username, '') from users where id = t.hidden_by) as "hiddenByName",
      coalesce(uploader.username, '') as "uploaderUsername",
      coalesce(t.audio_url, '') as "audioUrl",
      coalesce(t.cover, '') as cover,
      coalesce(t.created_at, 0) as "createdAt",
      t.explicit,
      (select string_agg(a.name, ', ')
       from track_artists ta
       join artists a on a.id = ta.artist_id
       where ta.track_id = t.id) as artists,
      coalesce(
        (
          select array_agg(tt.tag order by tt.tag)
          from track_tags tt
          where tt.track_id = t.id
        ),
        array[]::text[]
      ) as tags
    from tracks t
    left join users uploader on uploader.id = t.uploaded_by
    ${whereClause}
    order by coalesce(t.created_at, 0) desc, t.id asc
    limit $${values.length - 1} offset $${values.length}
    `,
    values
  );

  return result.rows.map((row) => {
    const audioUrl = String(row.audioUrl ?? "").trim();
    return {
      ...row,
      artists: row.artists || "Unknown",
      uploaderUsername: row.uploaderUsername || "system",
      hiddenByName: row.hiddenByName || "",
      isLocalAudio: Boolean(resolveMediaFilePath(audioUrl)),
      hasHls: hasHlsManifestForTrack(row.id),
      isStreamable:
        Boolean(audioUrl) &&
        (Boolean(resolveMediaFilePath(audioUrl)) || hasHlsManifestForTrack(row.id) || !audioUrl.startsWith("/api/media/")),
      tags: sanitizeTrackTags(row.tags),
    };
  });
}

export async function getUploadedTracksCount({ query = "", status = "all" } = {}) {
  const { whereClause, values } = buildTrackFilters({ query, status });
  const result = await pool.query(
    `
    select count(*)::int as count
    from tracks t
    left join users uploader on uploader.id = t.uploaded_by
    ${whereClause}
    `,
    values
  );
  return result.rows[0]?.count || 0;
}

async function getAdminReleaseById(client, releaseId) {
  const { rows } = await client.query(
    `
    select
      r.id,
      r.artist_id as "artistId",
      a.name as "artistName",
      r.title,
      r.type,
      r.year,
      r.cover,
      coalesce(r.description, '') as description,
      coalesce(nullif(r.status, ''), 'published') as status,
      coalesce(r.created_at, 0) as "createdAt",
      coalesce(r.published_at, 0) as "publishedAt",
      coalesce(creator.username, '') as "createdByUsername",
      coalesce(
        (
          select array_agg(rt.track_id order by rt.position)
          from release_tracks rt
          where rt.release_id = r.id
        ),
        array[]::text[]
      ) as "trackIds",
      coalesce(
        (
          select count(*)::int
          from release_tracks rt
          where rt.release_id = r.id
        ),
        0
      ) as "trackCount"
    from releases r
    join artists a on a.id = r.artist_id
    left join users creator on creator.id = r.created_by
    where r.id = $1
    limit 1;
    `,
    [releaseId]
  );

  return rows[0] ? mapAdminReleaseRow(rows[0]) : null;
}

async function resolveReleaseTracks(client, trackIds, artistId) {
  const normalizedTrackIds = uniqueReleaseTrackIds(trackIds);
  if (!normalizedTrackIds.length) {
    throw new HttpError(400, "Add at least one track to the release.");
  }

  const { rows } = await client.query(
    `
    select
      t.id,
      t.cover,
      coalesce(t.is_hidden, false) as "isHidden"
    from tracks t
    where t.id = any($1::text[])
      and exists (
        select 1
        from track_artists ta
        where ta.track_id = t.id
          and ta.artist_id = $2
      );
    `,
    [normalizedTrackIds, artistId]
  );

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const orderedRows = normalizedTrackIds.map((trackId) => rowById.get(trackId)).filter(Boolean);

  if (orderedRows.length !== normalizedTrackIds.length) {
    throw new HttpError(400, "Some selected tracks do not belong to the chosen artist.");
  }

  const hiddenTrack = orderedRows.find((row) => row.isHidden);
  if (hiddenTrack) {
    throw new HttpError(400, "Hidden tracks cannot be added to a release.");
  }

  return orderedRows;
}

async function validateReleasePayload(client, payload = {}) {
  const title = normalizeTitle(payload.title);
  if (!title) {
    throw new HttpError(400, "Release title is required.");
  }

  const artistId = String(payload.artistId ?? "").trim();
  if (!artistId) {
    throw new HttpError(400, "Artist is required.");
  }

  const { rows: artistRows } = await client.query(
    `
    select id, name
    from artists
    where id = $1
    limit 1;
    `,
    [artistId]
  );
  const artist = artistRows[0];
  if (!artist) {
    throw new HttpError(404, "Artist not found.");
  }

  const type = normalizeReleaseType(payload.type);
  if (!type) {
    throw new HttpError(400, "Release type must be single, ep or album.");
  }

  const status = normalizeReleaseStatus(payload.status, "draft");
  const year = normalizeReleaseYear(payload.year);
  const description = normalizeTitle(payload.description);
  const trackRows = await resolveReleaseTracks(client, payload.trackIds, artistId);
  assertReleaseTrackCount(type, trackRows);
  const cover = normalizeTitle(payload.cover) || trackRows[0]?.cover || "";

  if (!cover) {
    throw new HttpError(400, "Release cover is required.");
  }

  return {
    artist,
    artistId,
    title,
    type,
    year,
    cover,
    description,
    status,
    trackIds: trackRows.map((row) => row.id),
  };
}

export async function getAdminReleases({ limit = 20, offset = 0, query = "", status = "all" } = {}) {
  const { whereClause, values } = buildReleaseFilters({ query, status });
  values.push(limit, offset);
  const result = await pool.query(
    `
    select
      r.id,
      r.artist_id as "artistId",
      a.name as "artistName",
      r.title,
      r.type,
      r.year,
      r.cover,
      coalesce(r.description, '') as description,
      coalesce(nullif(r.status, ''), 'published') as status,
      coalesce(r.created_at, 0) as "createdAt",
      coalesce(r.published_at, 0) as "publishedAt",
      coalesce(creator.username, '') as "createdByUsername",
      coalesce(
        (
          select array_agg(rt.track_id order by rt.position)
          from release_tracks rt
          where rt.release_id = r.id
        ),
        array[]::text[]
      ) as "trackIds",
      coalesce(
        (
          select count(*)::int
          from release_tracks rt
          where rt.release_id = r.id
        ),
        0
      ) as "trackCount"
    from releases r
    join artists a on a.id = r.artist_id
    left join users creator on creator.id = r.created_by
    ${whereClause}
    order by
      case when coalesce(nullif(r.status, ''), 'published') = 'published' then 0 else 1 end,
      coalesce(r.published_at, r.created_at, 0) desc,
      r.title asc
    limit $${values.length - 1} offset $${values.length};
    `,
    values
  );

  return result.rows.map((row) => mapAdminReleaseRow(row));
}

export async function getAdminReleasesCount({ query = "", status = "all" } = {}) {
  const { whereClause, values } = buildReleaseFilters({ query, status });
  const result = await pool.query(
    `
    select count(*)::int as count
    from releases r
    join artists a on a.id = r.artist_id
    ${whereClause};
    `,
    values
  );
  return result.rows[0]?.count || 0;
}

export async function getAdminReleaseFormOptions({ artistId = "" } = {}) {
  const normalizedArtistId = String(artistId ?? "").trim();
  const artists = await fetchArtists();
  const { rows } = await pool.query(
    `
    select
      t.id,
      t.title,
      t.cover,
      t.duration_sec as "durationSec",
      coalesce(t.created_at, 0) as "createdAt",
      coalesce(t.audio_url, '') as "audioUrl",
      coalesce(
        (
          select string_agg(a.name, ', ' order by ta.artist_order)
          from track_artists ta
          join artists a on a.id = ta.artist_id
          where ta.track_id = t.id
        ),
        ''
      ) as artists,
      coalesce(
        (
          select array_agg(ta.artist_id order by ta.artist_order)
          from track_artists ta
          where ta.track_id = t.id
        ),
        array[]::text[]
      ) as "artistIds"
    from tracks t
    where
      coalesce(t.is_hidden, false) = false
      and ($1 = '' or exists (
        select 1
        from track_artists ta
        where ta.track_id = t.id
          and ta.artist_id = $1
      ))
    order by coalesce(t.created_at, 0) desc, t.title asc;
    `,
    [normalizedArtistId]
  );

  const tracks = rows
    .filter((row) => isTrackAudioAvailable(row.id, row.audioUrl))
    .map((row) => ({
      id: row.id,
      title: row.title,
      cover: row.cover,
      artists: row.artists,
      durationSec: Number(row.durationSec ?? 0),
      createdAt: Number(row.createdAt ?? 0),
      artistIds: Array.isArray(row.artistIds) ? row.artistIds : [],
    }));

  return { artists, tracks };
}

export async function createAdminRelease(payload = {}, actorUserId = "") {
  const normalizedActorUserId = String(actorUserId ?? "").trim() || null;

  return withTransaction(async (client) => {
    const release = await validateReleasePayload(client, payload);
    const releaseId = createReleaseId();
    const createdAt = Date.now();
    const publishedAt = release.status === "published" ? createdAt : null;

    await client.query(
      `
      insert into releases (
        id,
        artist_id,
        title,
        type,
        year,
        cover,
        description,
        status,
        created_at,
        published_at,
        created_by
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
      `,
      [
        releaseId,
        release.artistId,
        release.title,
        release.type,
        release.year,
        release.cover,
        release.description || null,
        release.status,
        createdAt,
        publishedAt,
        normalizedActorUserId,
      ]
    );

    for (let index = 0; index < release.trackIds.length; index += 1) {
      await client.query(
        `
        insert into release_tracks (release_id, track_id, position)
        values ($1, $2, $3);
        `,
        [releaseId, release.trackIds[index], index + 1]
      );
    }

    return getAdminReleaseById(client, releaseId);
  });
}

export async function updateAdminRelease(releaseId, payload = {}) {
  const normalizedReleaseId = String(releaseId ?? "").trim();
  if (!normalizedReleaseId) {
    throw new HttpError(400, "Release id is required.");
  }

  return withTransaction(async (client) => {
    const existing = await getAdminReleaseById(client, normalizedReleaseId);
    if (!existing) {
      throw new HttpError(404, "Release not found.");
    }

    const release = await validateReleasePayload(client, payload);
    const publishedAt =
      release.status === "published"
        ? existing.isPublished && existing.publishedAt > 0
          ? existing.publishedAt
          : Date.now()
        : null;

    await client.query(
      `
      update releases
      set artist_id = $2,
          title = $3,
          type = $4,
          year = $5,
          cover = $6,
          description = $7,
          status = $8,
          published_at = $9
      where id = $1;
      `,
      [
        normalizedReleaseId,
        release.artistId,
        release.title,
        release.type,
        release.year,
        release.cover,
        release.description || null,
        release.status,
        publishedAt,
      ]
    );

    await client.query("delete from release_tracks where release_id = $1;", [normalizedReleaseId]);
    for (let index = 0; index < release.trackIds.length; index += 1) {
      await client.query(
        `
        insert into release_tracks (release_id, track_id, position)
        values ($1, $2, $3);
        `,
        [normalizedReleaseId, release.trackIds[index], index + 1]
      );
    }

    return getAdminReleaseById(client, normalizedReleaseId);
  });
}

export async function deleteAdminRelease(releaseId) {
  const normalizedReleaseId = String(releaseId ?? "").trim();
  if (!normalizedReleaseId) {
    throw new HttpError(400, "Release id is required.");
  }

  return withTransaction(async (client) => {
    const result = await client.query("delete from releases where id = $1;", [normalizedReleaseId]);
    if (!result.rowCount) {
      throw new HttpError(404, "Release not found.");
    }
  });
}

export async function getUsers({ limit = 20, offset = 0, query = "", status = "all" } = {}) {
  const { whereClause, values } = buildUserFilters({ query, status });
  values.push(limit, offset);
  const result = await pool.query(
    `
    select
      u.id,
      u.username as username,
      u.display_name as "displayName",
      coalesce(u.avatar_url, '') as "avatarUrl",
      ${resolveAdminRoleSql("u")} as "adminRole",
      coalesce(u.is_banned, false) as "isBanned",
      coalesce(u.ban_reason, '') as "banReason",
      coalesce(u.created_at, 0) as "createdAt",
      coalesce(track_counts.uploaded_tracks_count, 0) as uploaded_tracks_count
    from users u
    left join (
      select uploaded_by, count(*)::int as uploaded_tracks_count
      from tracks
      where uploaded_by is not null
      group by uploaded_by
    ) track_counts on track_counts.uploaded_by = u.id
    ${whereClause}
    order by u.created_at desc
    limit $${values.length - 1} offset $${values.length}
    `,
    values
  );
  return result.rows.map((row) => mapAdminUserRow(row));
}

export async function getUsersCount({ query = "", status = "all" } = {}) {
  const { whereClause, values } = buildUserFilters({ query, status });
  const result = await pool.query(
    `
    select count(*) as count
    from users u
    ${whereClause}
    `,
    values
  );
  return parseInt(result.rows[0].count, 10);
}

export async function hideTrack(trackId, adminUserId, reason) {
  await withTransaction(async (client) => {
    const result = await client.query(
      `
      update tracks
      set is_hidden = true,
          hidden_reason = $1,
          hidden_by = $2,
          hidden_at = $3
      where id = $4
      `,
      [reason || null, adminUserId, Date.now(), trackId]
    );

    if (!result.rowCount) {
      throw new HttpError(404, "Track not found.");
    }
  });
}

export async function unhideTrack(trackId) {
  await withTransaction(async (client) => {
    const result = await client.query(
      `
      update tracks
      set is_hidden = false,
          hidden_reason = null,
          hidden_by = null,
          hidden_at = null
      where id = $1
      `,
      [trackId]
    );

    if (!result.rowCount) {
      throw new HttpError(404, "Track not found.");
    }
  });
}

export async function banUser(userId, reason, adminUserId) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `
      select id, ${resolveAdminRoleSql("users")} as admin_role
      from users
      where id = $1
      limit 1;
    `,
      [userId]
    );
    const targetUser = rows[0];

    if (!targetUser) {
      throw new HttpError(404, "User not found.");
    }
    if (targetUser.id === adminUserId) {
      throw new HttpError(400, "You cannot ban your own account.");
    }
    if (isElevatedAdminRole(targetUser.admin_role)) {
      throw new HttpError(400, "Moderator and admin accounts cannot be banned.");
    }

    await client.query(
      `
      update users
      set is_banned = true,
          ban_reason = $1
      where id = $2
      `,
      [reason || null, userId]
    );

    // Invalidate all sessions for banned user
    await client.query("delete from user_sessions where user_id = $1", [userId]);
  });
}

export async function updateUserAdminRole(userId, nextRole, actorUserId) {
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedActorUserId = String(actorUserId ?? "").trim();
  const normalizedRole = normalizeAdminRole(nextRole, "");

  if (!normalizedUserId) {
    throw new HttpError(400, "User id is required.");
  }
  if (!normalizedActorUserId) {
    throw new HttpError(401, "Authentication required.");
  }
  if (!normalizedRole) {
    throw new HttpError(400, "Role must be one of: user, moderator, super_admin.");
  }

  return withTransaction(async (client) => {
    const { rows: actorRows } = await client.query(
      `
      select id, ${resolveAdminRoleSql("users")} as admin_role
      from users
      where id = $1
      limit 1;
      `,
      [normalizedActorUserId]
    );
    const actor = actorRows[0];
    if (!actor) {
      throw new HttpError(401, "Actor account not found.");
    }
    if (!isSuperAdminRole(actor.admin_role)) {
      throw new HttpError(403, "Only super admins can update user roles.");
    }

    const { rows: targetRows } = await client.query(
      `
      select
        id,
        username,
        display_name,
        created_at,
        is_admin,
        admin_role,
        is_banned,
        ban_reason
      from users
      where id = $1
      limit 1;
      `,
      [normalizedUserId]
    );
    const targetUser = targetRows[0];

    if (!targetUser) {
      throw new HttpError(404, "User not found.");
    }
    if (targetUser.id === normalizedActorUserId) {
      throw new HttpError(400, "You cannot change your own admin role.");
    }

    const currentRole = normalizeAdminRole(targetUser.admin_role, targetUser.is_admin ? "super_admin" : "user");
    if (currentRole === "super_admin" && normalizedRole !== "super_admin") {
      const { rows: countRows } = await client.query(
        `
        select count(*)::int as count
        from users
        where admin_role = 'super_admin';
        `
      );
      if (Number(countRows[0]?.count ?? 0) <= 1) {
        throw new HttpError(400, "At least one super admin must remain in the system.");
      }
    }

    const { rows: updatedRows } = await client.query(
      `
      update users
      set is_admin = $2,
          admin_role = $3
      where id = $1
      returning
        id,
        username,
        display_name,
        created_at,
        is_admin,
        admin_role,
        is_banned,
        ban_reason;
      `,
      [normalizedUserId, isElevatedAdminRole(normalizedRole), normalizedRole]
    );

    return mapAdminUserRow(updatedRows[0]);
  });
}

export async function unbanUser(userId) {
  await withTransaction(async (client) => {
    const result = await client.query(
      `
      update users
      set is_banned = false,
          ban_reason = null
      where id = $1
      `,
      [userId]
    );

    if (!result.rowCount) {
      throw new HttpError(404, "User not found.");
    }
  });
}

export async function checkUserBanned(userId) {
  const result = await pool.query("select is_banned from users where id = $1", [userId]);
  if (result.rows.length === 0) {
    return false;
  }
  return result.rows[0].is_banned;
}
