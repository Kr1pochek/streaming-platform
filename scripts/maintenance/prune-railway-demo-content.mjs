import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFile } from "music-metadata";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "../..");
const snapshotDatabasePath = path.resolve(projectRoot, "portable-snapshot/database.json");
const publicAudioRoot = path.resolve(projectRoot, "public/audio");
const snapshotMediaRoot = path.resolve(projectRoot, "portable-snapshot/media");
const publicTracksRoot = path.resolve(publicAudioRoot, "tracks");
const snapshotTracksRoot = path.resolve(snapshotMediaRoot, "tracks");
const publicHlsRoot = path.resolve(publicAudioRoot, "hls");
const snapshotHlsRoot = path.resolve(snapshotMediaRoot, "hls");

const lazzyArtistName = "LAZZY2WICE";
const slipknotArtist = {
  id: "artist-slipknot",
  name: "Slipknot",
  followers: "0",
};
const demoUserId = "usr-679aafc2-2e9a-4135-8120-ff5581a49fd4";
const slipknotCover = "linear-gradient(135deg, #111318 0%, #8a1118 48%, #d7d2c8 100%)";
const slipknotTrackIds = [
  "515",
  "742617000027",
  "742617000027-sic",
  "a-liar-s-funeral",
  "adderall-instrumental",
  "adderall-no-intro",
  "birth-of-the-cruel",
  "critical-darling",
  "dead-memories-radio-mix-u-s-edit",
  "death-because-of-death",
  "diluted",
  "disasterpiece",
  "duality",
  "eeyore",
  "eyeless",
  "insert-coin",
  "liberate",
  "me-inside",
  "my-pain",
  "nero-forte",
  "no-life",
  "not-long-for-this-world",
  "only-one",
  "orphan",
  "people-shit",
  "prosthetics",
  "psychosocial-live",
  "pulse-of-the-maggots",
  "red-flag",
  "scissors",
  "sic",
  "solway-firth",
  "spiders",
  "spit-it-out",
  "surfacing",
  "tattered-torn",
  "the-blister-exists",
  "the-heretic-anthem",
  "three-nil",
  "unsainted",
  "wait-and-bleed",
  "what-s-next",
];
const slipknotTitleById = new Map([
  ["742617000027-sic", "742617000027 / (sic)"],
  ["a-liar-s-funeral", "A Liar's Funeral"],
  ["adderall-instrumental", "Adderall (Instrumental)"],
  ["adderall-no-intro", "Adderall (No Intro)"],
  ["birth-of-the-cruel", "Birth of the Cruel"],
  ["critical-darling", "Critical Darling"],
  ["dead-memories-radio-mix-u-s-edit", "Dead Memories (Radio Mix)"],
  ["death-because-of-death", "Death Because of Death"],
  ["duality", "Duality"],
  ["eeyore", "Eeyore"],
  ["eyeless", "Eyeless"],
  ["me-inside", "Me Inside"],
  ["my-pain", "My Pain"],
  ["nero-forte", "Nero Forte"],
  ["no-life", "No Life"],
  ["not-long-for-this-world", "Not Long for This World"],
  ["only-one", "Only One"],
  ["people-shit", "People = Shit"],
  ["psychosocial-live", "Psychosocial (Live)"],
  ["pulse-of-the-maggots", "Pulse of the Maggots"],
  ["red-flag", "Red Flag"],
  ["sic", "(sic)"],
  ["solway-firth", "Solway Firth"],
  ["spit-it-out", "Spit It Out"],
  ["tattered-torn", "Tattered & Torn"],
  ["the-blister-exists", "The Blister Exists"],
  ["the-heretic-anthem", "The Heretic Anthem"],
  ["three-nil", "Three Nil"],
  ["wait-and-bleed", "Wait and Bleed"],
  ["what-s-next", "What's Next"],
]);
const slipknotReleases = [
  {
    id: "rel-slipknot-self-titled",
    title: "Slipknot",
    type: "album",
    year: 1999,
    trackIds: [
      "742617000027",
      "742617000027-sic",
      "sic",
      "eyeless",
      "wait-and-bleed",
      "surfacing",
      "spit-it-out",
      "tattered-torn",
      "me-inside",
      "liberate",
      "diluted",
      "prosthetics",
      "no-life",
      "only-one",
      "scissors",
      "eeyore",
    ],
  },
  {
    id: "rel-slipknot-iowa",
    title: "Iowa",
    type: "ep",
    year: 2001,
    trackIds: ["515", "people-shit", "disasterpiece", "the-heretic-anthem"],
  },
  {
    id: "rel-slipknot-vol3",
    title: "Vol. 3: The Subliminal Verses",
    type: "ep",
    year: 2004,
    trackIds: ["pulse-of-the-maggots", "the-blister-exists", "three-nil", "duality"],
  },
  {
    id: "rel-slipknot-all-hope",
    title: "All Hope Is Gone",
    type: "single",
    year: 2008,
    trackIds: ["psychosocial-live", "dead-memories-radio-mix-u-s-edit"],
  },
  {
    id: "rel-slipknot-wanyk",
    title: "We Are Not Your Kind",
    type: "album",
    year: 2019,
    trackIds: [
      "insert-coin",
      "unsainted",
      "birth-of-the-cruel",
      "death-because-of-death",
      "nero-forte",
      "critical-darling",
      "a-liar-s-funeral",
      "red-flag",
      "spiders",
      "orphan",
      "my-pain",
      "not-long-for-this-world",
      "solway-firth",
    ],
  },
  {
    id: "rel-slipknot-end-so-far",
    title: "The End, So Far",
    type: "single",
    year: 2022,
    trackIds: ["adderall-no-intro", "adderall-instrumental", "what-s-next"],
  },
];

function assertInside(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to touch path outside ${root}: ${target}`);
  }
  return target;
}

function table(snapshot, name) {
  const found = snapshot.tables.find((item) => item.name === name);
  if (!found) {
    throw new Error(`Snapshot table not found: ${name}`);
  }
  return found;
}

function encodedTrackUrl(trackId) {
  return `/api/media/tracks/${encodeURIComponent(`${trackId}.mp3`)}`;
}

function titleFromId(trackId) {
  return slipknotTitleById.get(trackId) ?? trackId.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

async function durationForTrack(trackId) {
  const filePath = path.join(publicTracksRoot, `${trackId}.mp3`);
  const metadata = await parseFile(filePath);
  const duration = Number(metadata?.format?.duration ?? 0);
  return Math.max(1, Math.round(duration || 180));
}

function removeOtherTrackFiles(rootPath, keepTrackIds) {
  if (!fs.existsSync(rootPath)) {
    return 0;
  }

  let removed = 0;
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".mp3")) {
      continue;
    }

    const trackId = entry.name.replace(/\.mp3$/i, "");
    if (keepTrackIds.has(trackId)) {
      continue;
    }

    const targetPath = assertInside(rootPath, path.join(rootPath, entry.name));
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    removed += 1;
  }
  return removed;
}

function removeTree(rootPath, targetPath) {
  const safeTargetPath = assertInside(rootPath, targetPath);
  if (!fs.existsSync(safeTargetPath)) {
    return;
  }

  const stats = fs.lstatSync(safeTargetPath);
  if (!stats.isDirectory()) {
    fs.unlinkSync(safeTargetPath);
    return;
  }

  for (const entry of fs.readdirSync(safeTargetPath, { withFileTypes: true })) {
    removeTree(rootPath, path.join(safeTargetPath, entry.name));
  }
  fs.rmdirSync(safeTargetPath);
}

function removeDirectoryContents(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return 0;
  }

  let removed = 0;
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    removeTree(rootPath, path.join(rootPath, entry.name));
    removed += 1;
  }
  return removed;
}

function copyKeptTracksToSnapshot(keepTrackIds) {
  fs.mkdirSync(snapshotTracksRoot, { recursive: true });
  let copied = 0;
  for (const trackId of keepTrackIds) {
    const sourcePath = path.join(publicTracksRoot, `${trackId}.mp3`);
    const destinationPath = path.join(snapshotTracksRoot, `${trackId}.mp3`);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing kept media file: ${sourcePath}`);
    }
    fs.copyFileSync(
      assertInside(publicTracksRoot, sourcePath),
      assertInside(snapshotTracksRoot, destinationPath)
    );
    copied += 1;
  }
  return copied;
}

function filterUserState(row, keepTrackIds, keepArtistIds, keepPlaylistIds) {
  const filterIds = (values, keepIds) => (Array.isArray(values) ? values.filter((id) => keepIds.has(id)) : []);
  const queueTrackIds = filterIds(row.queue_track_ids, keepTrackIds);
  return {
    ...row,
    liked_track_ids: filterIds(row.liked_track_ids, keepTrackIds),
    followed_artist_ids: filterIds(row.followed_artist_ids, keepArtistIds),
    history_track_ids: filterIds(row.history_track_ids, keepTrackIds),
    queue_track_ids: queueTrackIds,
    queue_current_index: queueTrackIds.length ? Math.min(Number(row.queue_current_index ?? 0), queueTrackIds.length - 1) : 0,
    queue_progress_sec: queueTrackIds.length ? Number(row.queue_progress_sec ?? 0) : 0,
    queue_is_playing: false,
    saved_playlist_ids: filterIds(row.saved_playlist_ids, keepPlaylistIds),
  };
}

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(snapshotDatabasePath, "utf8"));
  const artistsTable = table(snapshot, "artists");
  const tracksTable = table(snapshot, "tracks");
  const releasesTable = table(snapshot, "releases");
  const playlistsTable = table(snapshot, "playlists");
  const userStatesTable = table(snapshot, "user_states");
  const trackArtistsTable = table(snapshot, "track_artists");
  const trackTagsTable = table(snapshot, "track_tags");
  const playlistTracksTable = table(snapshot, "playlist_tracks");
  const releaseTracksTable = table(snapshot, "release_tracks");

  const lazzyArtist = artistsTable.rows.find((artist) => artist.name.toLowerCase() === lazzyArtistName.toLowerCase());
  if (!lazzyArtist) {
    throw new Error(`Required artist not found in snapshot: ${lazzyArtistName}`);
  }

  const lazzyTrackIds = new Set(
    trackArtistsTable.rows
      .filter((row) => row.artist_id === lazzyArtist.id)
      .map((row) => row.track_id)
  );
  const keepTrackIds = new Set([...lazzyTrackIds, ...slipknotTrackIds]);
  const keepArtistIds = new Set([lazzyArtist.id, slipknotArtist.id]);

  const existingTracksById = new Map(tracksTable.rows.map((row) => [row.id, row]));
  const createdAt = Date.now();
  const slipknotTracks = [];
  for (const trackId of slipknotTrackIds) {
    const existing = existingTracksById.get(trackId);
    slipknotTracks.push({
      id: trackId,
      title: existing?.title ?? titleFromId(trackId),
      duration_sec: existing?.duration_sec ?? (await durationForTrack(trackId)),
      explicit: true,
      cover: existing?.cover ?? slipknotCover,
      audio_url: encodedTrackUrl(trackId),
      is_hidden: false,
      hidden_reason: null,
      hidden_by: null,
      hidden_at: null,
      created_at: existing?.created_at ?? String(createdAt),
      uploaded_by: existing?.uploaded_by ?? demoUserId,
    });
  }

  const lazzyTracks = tracksTable.rows.filter((track) => lazzyTrackIds.has(track.id));
  tracksTable.rows = [...lazzyTracks, ...slipknotTracks].sort((left, right) => left.id.localeCompare(right.id, "ru"));
  artistsTable.rows = [lazzyArtist, slipknotArtist].sort((left, right) => left.name.localeCompare(right.name, "ru"));

  trackArtistsTable.rows = [
    ...trackArtistsTable.rows.filter((row) => lazzyTrackIds.has(row.track_id) && row.artist_id === lazzyArtist.id),
    ...slipknotTrackIds.map((trackId) => ({
      track_id: trackId,
      artist_id: slipknotArtist.id,
      artist_order: 1,
    })),
  ];
  trackTagsTable.rows = [
    ...trackTagsTable.rows.filter((row) => lazzyTrackIds.has(row.track_id)),
    ...slipknotTrackIds.flatMap((trackId) => [
      { track_id: trackId, tag: "metal" },
      { track_id: trackId, tag: "hard rock" },
      { track_id: trackId, tag: "industrial metal" },
    ]),
  ];

  const keptLazzyReleaseIds = new Set(
    releasesTable.rows
      .filter((release) => release.artist_id === lazzyArtist.id)
      .map((release) => release.id)
  );
  const slipknotReleaseRows = slipknotReleases.map((release) => ({
    id: release.id,
    artist_id: slipknotArtist.id,
    title: release.title,
    type: release.type,
    year: release.year,
    cover: slipknotCover,
    description: null,
    status: "published",
    created_at: String(createdAt),
    published_at: String(createdAt),
    created_by: demoUserId,
  }));
  releasesTable.rows = [
    ...releasesTable.rows.filter((release) => release.artist_id === lazzyArtist.id),
    ...slipknotReleaseRows,
  ];
  releaseTracksTable.rows = [
    ...releaseTracksTable.rows.filter((row) => keptLazzyReleaseIds.has(row.release_id) && lazzyTrackIds.has(row.track_id)),
    ...slipknotReleases.flatMap((release) =>
      release.trackIds
        .filter((trackId) => keepTrackIds.has(trackId))
        .map((trackId, index) => ({
          release_id: release.id,
          track_id: trackId,
          position: index + 1,
        }))
    ),
  ];

  const playlistIdsWithKeptTracks = new Set(
    playlistTracksTable.rows
      .filter((row) => keepTrackIds.has(row.track_id))
      .map((row) => row.playlist_id)
  );
  playlistsTable.rows = playlistsTable.rows.filter((playlist) => playlistIdsWithKeptTracks.has(playlist.id));
  playlistTracksTable.rows = playlistTracksTable.rows.filter(
    (row) => playlistIdsWithKeptTracks.has(row.playlist_id) && keepTrackIds.has(row.track_id)
  );
  const keepPlaylistIds = new Set(playlistsTable.rows.map((playlist) => playlist.id));
  userStatesTable.rows = userStatesTable.rows.map((row) => filterUserState(row, keepTrackIds, keepArtistIds, keepPlaylistIds));

  fs.writeFileSync(snapshotDatabasePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const copiedTracks = copyKeptTracksToSnapshot(keepTrackIds);
  const removedPublicTracks = removeOtherTrackFiles(publicTracksRoot, keepTrackIds);
  const removedSnapshotTracks = removeOtherTrackFiles(snapshotTracksRoot, keepTrackIds);
  const removedPublicHls = removeDirectoryContents(publicHlsRoot);
  const removedSnapshotHls = removeDirectoryContents(snapshotHlsRoot);

  console.log(`Kept artists: ${artistsTable.rows.map((artist) => artist.name).join(", ")}`);
  console.log(`Kept tracks: ${keepTrackIds.size}`);
  console.log(`Copied kept tracks into snapshot: ${copiedTracks}`);
  console.log(`Removed public track files: ${removedPublicTracks}`);
  console.log(`Removed snapshot track files: ${removedSnapshotTracks}`);
  console.log(`Removed public HLS directories: ${removedPublicHls}`);
  console.log(`Removed snapshot HLS directories: ${removedSnapshotHls}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
