import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { tracks } from "../src/data/musicData.js";

const allowedExtensions = new Set([".wav", ".mp3", ".ogg", ".m4a", ".flac"]);
const extensionPriority = [".wav", ".mp3", ".ogg", ".m4a", ".flac"];

function printUsage() {
  console.log("Usage:");
  console.log(
    "  npm run audio:import -- --from <source-dir> [--dry-run] [--by-order] [--titles-from-files] [--artists-from-files]"
  );
  console.log("");
  console.log("Example:");
  console.log("  npm run audio:import -- --from ./audio-import");
  console.log("  npm run audio:import -- --from ./music --by-order");
  console.log("  npm run audio:import -- --from ./music --by-order --titles-from-files");
  console.log("  npm run audio:import -- --from ./music --by-order --titles-from-files --artists-from-files");
}

function parseArgs(argv) {
  const args = { from: "", dryRun: false, byOrder: false, titlesFromFiles: false, artistsFromFiles: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--from" || token === "-f") {
      args.from = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--by-order") {
      args.byOrder = true;
      continue;
    }
    if (token === "--titles-from-files") {
      args.titlesFromFiles = true;
      continue;
    }
    if (token === "--artists-from-files") {
      args.artistsFromFiles = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function collectAudioFiles(sourceDirectory) {
  const filesByBaseName = new Map();
  const queue = [sourceDirectory];

  while (queue.length) {
    const currentDirectory = queue.shift();
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!allowedExtensions.has(extension)) {
        continue;
      }

      const baseName = path.basename(entry.name, extension);
      if (!filesByBaseName.has(baseName)) {
        filesByBaseName.set(baseName, []);
      }
      filesByBaseName.get(baseName).push(absolutePath);
    }
  }

  return filesByBaseName;
}

function collectAudioFileList(sourceDirectory) {
  const queue = [sourceDirectory];
  const files = [];

  while (queue.length) {
    const currentDirectory = queue.shift();
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!allowedExtensions.has(extension)) {
        continue;
      }

      files.push(absolutePath);
    }
  }

  return files.sort((leftPath, rightPath) => leftPath.localeCompare(rightPath, "ru"));
}

function pickPreferredFile(candidates) {
  if (!candidates?.length) {
    return null;
  }

  const sorted = [...candidates].sort((leftPath, rightPath) => {
    const leftExtension = path.extname(leftPath).toLowerCase();
    const rightExtension = path.extname(rightPath).toLowerCase();
    return extensionPriority.indexOf(leftExtension) - extensionPriority.indexOf(rightExtension);
  });
  return sorted[0];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unwrapDecorators(value) {
  let result = value.trim();
  let next = result
    .replace(/^\[[^\]]+\]\s*/u, "")
    .replace(/^\([^)]+\)\s*/u, "")
    .trim();
  while (next !== result) {
    result = next;
    next = result
      .replace(/^\[[^\]]+\]\s*/u, "")
      .replace(/^\([^)]+\)\s*/u, "")
      .trim();
  }
  return result;
}

function parseTrackMetaFromFileName(filePath) {
  const extension = path.extname(filePath);
  const baseName = path.basename(filePath, extension);
  const normalized = baseName.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

  const separatorMatch = normalized.match(/^(.*)\s-\s*(.+)$/u);
  const fallbackSeparatorIndex = normalized.lastIndexOf("-");
  const hasFallbackSeparator =
    fallbackSeparatorIndex > 0 && fallbackSeparatorIndex < normalized.length - 1;
  const hasArtistPart = Boolean(separatorMatch) || hasFallbackSeparator;
  const rawArtistPart = separatorMatch
    ? separatorMatch[1].trim()
    : hasFallbackSeparator
      ? normalized.slice(0, fallbackSeparatorIndex).trim()
      : "";
  const rawTitlePart = separatorMatch
    ? separatorMatch[2].trim()
    : hasFallbackSeparator
      ? normalized.slice(fallbackSeparatorIndex + 1).trim()
      : normalized;

  const cleanedTitle = rawTitlePart
    .replace(/^\[\d+\]\s*/u, "")
    .replace(/^\(\d+\)\s*/u, "")
    .replace(/^\d+\s+/u, "")
    .replace(/\s+/g, " ")
    .trim();

  const cleanedArtist = unwrapDecorators(rawArtistPart).replace(/\s+/g, " ").trim();

  return {
    title: cleanedTitle || unwrapDecorators(normalized) || "Unknown Track",
    artist: cleanedArtist || "",
  };
}

function escapeStringLiteral(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function updateTrackAudioUrls(dataFilePath, replacements, dryRun) {
  const content = fs.readFileSync(dataFilePath, "utf8");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  let updatedContent = content;

  for (const replacement of replacements) {
    const idPattern = escapeRegExp(replacement.id);
    const audioLinePattern = new RegExp(
      `(id:\\s*"${idPattern}",\\s*\\r?\\n\\s*audioUrl:\\s*")[^"]*(")`,
      "m"
    );
    if (audioLinePattern.test(updatedContent)) {
      updatedContent = updatedContent.replace(audioLinePattern, `$1${replacement.audioUrl}$2`);
    } else {
      const insertPattern = new RegExp(`(id:\\s*"${idPattern}",\\s*\\r?\\n)(\\s*title:)`, "m");
      updatedContent = updatedContent.replace(
        insertPattern,
        `$1    audioUrl: "${replacement.audioUrl}",${eol}$2`
      );
    }

    if (replacement.title) {
      const titlePattern = new RegExp(`(id:\\s*"${idPattern}",[\\s\\S]*?\\n\\s*title:\\s*")[^"]*(")`, "m");
      if (titlePattern.test(updatedContent)) {
        updatedContent = updatedContent.replace(titlePattern, `$1${escapeStringLiteral(replacement.title)}$2`);
      }
    }

    if (replacement.artist) {
      const artistPattern = new RegExp(`(id:\\s*"${idPattern}",[\\s\\S]*?\\n\\s*artist:\\s*")[^"]*(")`, "m");
      if (artistPattern.test(updatedContent)) {
        updatedContent = updatedContent.replace(artistPattern, `$1${escapeStringLiteral(replacement.artist)}$2`);
      }
    }
  }

  if (!dryRun && updatedContent !== content) {
    fs.writeFileSync(dataFilePath, updatedContent, "utf8");
  }

  return updatedContent !== content;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.from) {
    printUsage();
    process.exit(1);
  }

  const rootDirectory = process.cwd();
  const sourceDirectory = path.resolve(rootDirectory, args.from);
  const destinationDirectory = path.resolve(rootDirectory, "public/audio/tracks");
  const dataFilePath = path.resolve(rootDirectory, "src/data/musicData.js");

  if (!fs.existsSync(sourceDirectory) || !fs.statSync(sourceDirectory).isDirectory()) {
    console.error(`Source directory not found: ${sourceDirectory}`);
    process.exit(1);
  }

  const filesByBaseName = args.byOrder ? null : collectAudioFiles(sourceDirectory);
  const orderedFiles = args.byOrder ? collectAudioFileList(sourceDirectory) : [];
  const replacements = [];
  const missingTrackFiles = [];
  const copiedFiles = [];
  let titlesUpdatedCount = 0;
  let artistsUpdatedCount = 0;

  if (!args.dryRun) {
    fs.mkdirSync(destinationDirectory, { recursive: true });
  }

  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    const trackId = String(track.id ?? "").trim();
    if (!trackId) {
      continue;
    }

    const selectedFile = args.byOrder
      ? orderedFiles[index] ?? null
      : pickPreferredFile(filesByBaseName.get(trackId) ?? []);
    if (!selectedFile) {
      missingTrackFiles.push(trackId);
      continue;
    }

    const extension = path.extname(selectedFile).toLowerCase();
    const targetFileName = `${trackId}${extension}`;
    const targetAbsolutePath = path.join(destinationDirectory, targetFileName);
    const audioUrl = `/api/media/tracks/${targetFileName}`;

    if (!args.dryRun) {
      const sourcePath = path.resolve(selectedFile);
      const destinationPath = path.resolve(targetAbsolutePath);
      if (sourcePath !== destinationPath) {
        fs.copyFileSync(sourcePath, destinationPath);
      }
    }

    copiedFiles.push(targetFileName);
    const replacement = { id: trackId, audioUrl };
    if (args.titlesFromFiles || args.artistsFromFiles) {
      const parsedMeta = parseTrackMetaFromFileName(selectedFile);
      if (args.titlesFromFiles) {
        replacement.title = parsedMeta.title;
        titlesUpdatedCount += 1;
      }
      if (args.artistsFromFiles && parsedMeta.artist) {
        replacement.artist = parsedMeta.artist;
        artistsUpdatedCount += 1;
      }
    }
    replacements.push(replacement);
  }

  const updated = updateTrackAudioUrls(dataFilePath, replacements, args.dryRun);

  console.log(`tracks total: ${tracks.length}`);
  console.log(`audio files copied: ${copiedFiles.length}${args.dryRun ? " (dry-run)" : ""}`);
  if (args.titlesFromFiles) {
    console.log(`track titles updated: ${titlesUpdatedCount}${args.dryRun ? " (dry-run)" : ""}`);
  }
  if (args.artistsFromFiles) {
    console.log(`track artists updated: ${artistsUpdatedCount}${args.dryRun ? " (dry-run)" : ""}`);
  }
  console.log(`musicData updated: ${updated ? "yes" : "no changes"}`);
  if (missingTrackFiles.length) {
    console.log(`missing track files: ${missingTrackFiles.join(", ")}`);
    process.exitCode = 2;
  }
}

main();
