import {
  HttpError,
  fetchCatalog,
  hasHlsManifestForTrack,
  isSystemPlaylist,
  pool,
  resolveMediaFilePath,
  validateCatalogAudioFiles,
  withTransaction,
} from "./catalogService.js";

function normalizeAdminQuery(value = "") {
  return String(value ?? "").trim().toLowerCase();
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
    conditions.push("coalesce(u.is_banned, false) = false and coalesce(u.is_admin, false) = false");
  } else if (normalizedStatus === "admin") {
    conditions.push("coalesce(u.is_admin, false) = true");
  }

  const whereClause = conditions.length ? `where ${conditions.join(" and ")}` : "";
  return { whereClause, values };
}

function compareText(left = "", right = "") {
  return String(left ?? "").localeCompare(String(right ?? ""), "ru");
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
      (select count(*) from users where is_admin = true) as admin_users,
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
        coalesce(u.is_admin, false) as "isAdmin",
        coalesce(u.is_banned, false) as "isBanned",
        count(t.id)::int as "uploadedTracksCount"
      from users u
      join tracks t on t.uploaded_by = u.id
      group by u.id, u.username, u.display_name, u.is_admin, u.is_banned
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
        coalesce(u.is_admin, false) as "isAdmin",
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
      topUploaders: topUploadersResult.rows.map((row) => ({
        ...row,
        uploadedTracksCount: Number(row.uploadedTracksCount ?? 0),
      })),
      recentUsers: recentUsersResult.rows.map((row) => ({
        ...row,
        createdAt: Number(row.createdAt ?? 0),
        uploadedTracksCount: Number(row.uploadedTracksCount ?? 0),
      })),
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
      tags: Array.isArray(row.tags) ? row.tags : [],
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

export async function getUsers({ limit = 20, offset = 0, query = "", status = "all" } = {}) {
  const { whereClause, values } = buildUserFilters({ query, status });
  values.push(limit, offset);
  const result = await pool.query(
    `
    select
      u.id,
      u.username as username,
      u.display_name as "displayName",
      coalesce(u.is_admin, false) as "isAdmin",
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
  return result.rows;
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
      select id, is_admin
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
    if (targetUser.is_admin) {
      throw new HttpError(400, "Admin accounts cannot be banned.");
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
