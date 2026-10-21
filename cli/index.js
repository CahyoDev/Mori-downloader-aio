#!/usr/bin/env node

import fs from "fs";
import os from "os";
import path from "path";
import { parseArgs } from "node:util";
import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  detectPlatform,
  PLATFORM_SERVERS,
  getPlatformServers,
  scrapeUrl,
  resolveUrl,
  sanitizeFilename,
  downloadMediaFile,
  checkForOtaUpdate,
  getActiveScraperVersion,
  getActiveScraprVersion,
  checkForScraprOtaUpdate,
  isMoriInstalled,
  isScraprInstalled,
  downloadMoriEngine,
  downloadScraprEngine,
  uninstallMoriEngine,
  uninstallScraprEngine,
  RESOLVER_LINK_PLATFORMS,
  SHORTLINK_PLATFORMS,
  writeClipboard,
  getSavedConfig,
  saveConfig,
  openDirectory,
  extractUrls,
  getHistory,
  addToHistory,
  clearHistory,
  deleteHistoryItem,
  readClipboard,
  getNonCollidingPath,
  resetMori,
  getStats,
  DEFAULT_DOWNLOAD_DIR,
  CONFIG_PATH,
  openFile,
  pingNetwork,
  compileImagesToPdf,
  CHROME_UA,
} from "./engine.js";

const APP_VERSION = "1.1.0";

function isNewerVersion(latest, current) {
  if (!latest || !current) return false;
  const l = latest.replace(/^v/, "").split(".").map(Number);
  const c = current.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const lPart = l[i] || 0;
    const cPart = c[i] || 0;
    if (lPart > cPart) return true;
    if (lPart < cPart) return false;
  }
  return false;
}

async function checkCliUpdate() {
  try {
    const res = await fetch("https://registry.npmjs.org/@coflyn/mori/latest", {
      signal: AbortSignal.timeout(2000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.version && isNewerVersion(data.version, APP_VERSION)) {
      return data.version;
    }
  } catch (_) {}
  return null;
}

function formatRelativeTime(ms) {
  if (!ms) return "";
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function renderProgressBar(percent, width = 22) {
  const pVal = Math.max(0, Math.min(100, percent));
  const filled = Math.round((pVal / 100) * width);
  const empty = width - filled;
  return pc.white("█".repeat(filled)) + pc.dim("░".repeat(empty));
}

function formatPath(filePath) {
  if (!filePath) return "";
  const home = os.homedir();
  if (filePath.startsWith(home)) {
    return `~${filePath.slice(home.length)}`;
  }
  return filePath;
}

function truncateText(str, max = 72) {
  if (!str || typeof str !== "string") return "";
  const single = str.replace(/\r?\n|\r/g, " ").trim();
  if (single.length <= max) return single;
  return single.substring(0, max - 3) + "...";
}

function formatStreamItem(d, i, allDownloads = []) {
  const typeStr = (d.type || "").toLowerCase();
  const qualityStr = (d.quality || "").trim();

  const isAudio =
    typeStr.includes("audio") ||
    typeStr.includes("music") ||
    typeStr.includes("mp3");

  const isPhoto = typeStr.includes("photo") || typeStr.includes("image");

  if (isAudio) {
    const qual =
      qualityStr &&
      !qualityStr.toLowerCase().includes("audio") &&
      !qualityStr.toLowerCase().includes("music") &&
      !qualityStr.toLowerCase().includes("mp3")
        ? ` (${qualityStr})`
        : "";
    return {
      label: `MP3 Audio${qual}`,
      hint: "audio",
    };
  }

  if (isPhoto) {
    return {
      label: `Photo #${i + 1}`,
      hint: qualityStr || "image",
    };
  }

  // Video stream
  let resLabel = "";
  if (qualityStr && qualityStr.toLowerCase() !== "video") {
    resLabel = qualityStr;
  } else if (/^\d+p$/i.test(d.type)) {
    resLabel = d.type;
  } else if (allDownloads.length > 0) {
    const videoStreams = allDownloads.filter(
      (item) =>
        !item.type?.toLowerCase().includes("audio") &&
        !item.type?.toLowerCase().includes("music") &&
        !item.type?.toLowerCase().includes("photo"),
    );
    const vIdx = videoStreams.indexOf(d);
    if (vIdx === 0) resLabel = "HD / Best Quality";
    else if (vIdx === 1) resLabel = "Standard Quality";
    else resLabel = `Option ${vIdx + 1}`;
  } else {
    resLabel = "Video";
  }

  const mirrorTag = d.isMirror ? " [Mirror]" : "";
  return {
    label: `${resLabel} Video${mirrorTag}`,
    hint: mirrorTag ? "mirror" : "video",
  };
}

const MORI_BANNER = [
  "███╗   ███╗ ██████╗ ██████╗ ██╗",
  "████╗ ████║██╔═══██╗██╔══██╗██║",
  "██╔████╔██║██║   ██║██████╔╝██║",
  "██║╚██╔╝██║██║   ██║██╔══██╗██║",
  "██║ ╚═╝ ██║╚██████╔╝██║  ██║██║",
  "╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝",
];

function renderBanner() {
  return MORI_BANNER.map(
    (l) =>
      "  " +
      l
        .replace(/(█+)/g, pc.bold(pc.cyan("$1")))
        .replace(/([╗║╚╝═]+)/g, pc.dim(pc.cyan("$1"))),
  ).join("\n");
}

function printBanner(coreVer, scraprVer) {
  console.log("\n" + renderBanner() + "\n");
  const engines = [];
  if (coreVer) engines.push(`mori v${coreVer}`);
  if (scraprVer) engines.push(`scrapr v${scraprVer}`);
  const engineStr =
    engines.length > 0 ? engines.join(" • ") : "no engine installed";
  const brand =
    pc.bold(pc.inverse(" MORI ")) +
    " " +
    pc.bold(`v${APP_VERSION}`) +
    " " +
    pc.dim(`(${engineStr})`);
  const sub = pc.dim(
    "Save anything, from anywhere. Dual-Engine powered.",
  );
  p.intro(`${brand}\n  ${sub}`);
}

async function ensureEnginesInstalled() {
  const moriInstalled = isMoriInstalled();
  const scraprInstalled = isScraprInstalled();

  if (moriInstalled || scraprInstalled) {
    return true;
  }

  p.note(
    `Welcome to Mori CLI!\n\n` +
      `Mori is a lightweight CLI wrapper without pre-bundled scraper engines.\n` +
      `Choose which engine(s) you would like to download to get started:`,
    pc.bold("First-Time Engine Setup"),
  );

  const choice = await p.select({
    message: "Which engine would you like to install?",
    options: [
      {
        value: "both",
        label: "Both (Mori Core + Scrapr) [Recommended]",
        hint: "All 27 platforms: social media, audio, file hosts & unshorteners",
      },
      {
        value: "scrapr",
        label: "Scrapr Engine only (~2.7 MB)",
        hint: "Stand-alone engine with file host resolvers (MediaFire, Sfile, GDrive, etc.)",
      },
      {
        value: "mori",
        label: "Mori Engine only (~80 KB)",
        hint: "Ultra lightweight core scrapers (TikTok, IG, YouTube, Spotify, X, etc.)",
      },
      {
        value: "skip",
        label: "Skip for now",
        hint: "Install manually later via /engine",
      },
    ],
    initialValue: "both",
  });

  if (p.isCancel(choice) || choice === "skip") {
    p.log.warn("Setup skipped. You will need to install an engine before scraping.");
    return false;
  }

  if (choice === "both" || choice === "mori") {
    const s = p.spinner();
    s.start(pc.dim("Installing Mori Core Engine (~80 KB)..."));
    try {
      const res = await downloadMoriEngine();
      s.stop(pc.bold(`✔ Mori Core Engine installed (v${res.version}).`));
    } catch (err) {
      s.stop(pc.bold(`✕ Failed to install Mori Engine: ${err.message}`));
    }
  }

  if (choice === "both" || choice === "scrapr") {
    const s = p.spinner();
    s.start(pc.dim("Installing Scrapr Engine (~2.7 MB)..."));
    try {
      const res = await downloadScraprEngine();
      s.stop(pc.bold(`✔ Scrapr Engine installed (v${res.version}).`));
    } catch (err) {
      s.stop(pc.bold(`✕ Failed to install Scrapr Engine: ${err.message}`));
    }
  }

  const defEngine = choice === "both" ? "auto" : choice;
  saveConfig({ defaultEngine: defEngine });

  p.log.message(
    `${pc.bold("● Default engine set:")} ${pc.white(defEngine)} ${pc.dim("(change anytime with /engine)")}`,
  );

  return isMoriInstalled() || isScraprInstalled();
}

function printHelp() {
  console.log(`
${renderBanner()}

${pc.bold(pc.inverse(" MORI CLI "))} ${pc.bold(`v${APP_VERSION}`)}

${pc.bold("USAGE:")}
  ${pc.white("mori")} ${pc.dim("[URL]")} ${pc.dim("[OPTIONS]")}
  ${pc.white("npx @coflyn/mori")} ${pc.dim("[URL]")} ${pc.dim("[OPTIONS]")}

${pc.bold("OPTIONS:")}
  ${pc.white("-o, --output <dir>")}             Destination folder (default: ${pc.dim("~/Downloads/Mori")})
  ${pc.white("-e, --engine <auto|mori|scrapr>")}  Scraper engine choice (default: ${pc.dim("auto")})
  ${pc.white("-s, --server <1|2>")}              Choose scraper server (TikTok, IG, YouTube, X, Spotify)
  ${pc.white("-a, --audio")}                     Download audio-only stream (MP3/M4A)
  ${pc.white("-p, --pdf")}                       Compile photo album directly into a single PDF
  ${pc.white("-c, --clip")}                      Auto-fetch link from system clipboard
  ${pc.white("-y, --yes")}                       Download best/first available stream automatically
  ${pc.white("-i, --info")}                      Inspect and display media details only
  ${pc.white("-u, --update")}                    Check and pull latest OTA scraper patches
  ${pc.white("-h, --help")}                      Show this documentation
  ${pc.white("-v, --version")}                   Print version number

${pc.bold("SUPPORTED PLATFORMS (27 • DUAL-ENGINE):")}
  ${pc.dim("Social & Video:")}  TikTok • Instagram • YouTube • Twitter/X • Facebook • Douyin
                  Bilibili • Threads • RedNote • Reddit • Pixiv • Doodstream
  ${pc.dim("Music & Audio :")}  Spotify • SoundCloud • Apple Music • Bandcamp
  ${pc.dim("Cloud & Files :")}  TeraBox • MediaFire • Sfile • Catbox • Pixeldrain • Krakenfiles • GDrive
  ${pc.dim("Resolvers     :")}  SafeLinkU • Sub2Unlock • Rekonise • Link Unshortener

${pc.bold("EXAMPLES:")}
  ${pc.dim("# Interactive")}
  mori

  # Download link directly from clipboard
  mori --clip

  # Use Scrapr engine explicitly
  mori https://www.mediafire.com/file/... -e scrapr

  # Download audio-only (MP3)
  mori https://soundcloud.com/... -a

  # Check OTA updates for both engines
  mori --update
`);
}

async function runConcurrentPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const idx = nextIndex++;
        results[idx] = await fn(items[idx], idx);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function processDownloadItem({ item, meta, outputDir, index, total }) {
  let detectedExt = "";
  const rawFilename = item.filename || meta.filename;
  if (rawFilename && path.extname(rawFilename)) {
    detectedExt = path.extname(rawFilename).replace(/^\./, "");
  } else if (item.url) {
    try {
      const uPath = new URL(item.url).pathname;
      const uExt = path.extname(uPath).replace(/^\./, "");
      if (uExt && uExt.length <= 5 && !uExt.includes("/")) detectedExt = uExt;
    } catch (_) {}
  }

  const ext =
    detectedExt ||
    (item.type?.toLowerCase().includes("mp3") ||
    item.type?.toLowerCase().includes("audio")
      ? "mp3"
      : item.type?.toLowerCase().includes("photo") ||
          item.type?.toLowerCase().includes("image")
        ? "jpg"
        : "mp4");

  let baseTitle = rawFilename
    ? path.basename(rawFilename, path.extname(rawFilename))
    : (meta.title || "Media");
  if (total > 1) {
    baseTitle = `${baseTitle}_${index + 1}`;
  }
  const filename = sanitizeFilename(baseTitle, ext);
  const destPath = getNonCollidingPath(outputDir, filename);

  const spin = p.spinner();
  spin.start(pc.dim(`Preparing ${pc.bold(filename)}...`));

  let directUrl;
  try {
    directUrl = await resolveUrl(item.url, (msg) => {
      spin.message(pc.dim(msg));
    });
  } catch (err) {
    spin.stop(pc.bold(`✕ Resolve failed: ${err.message}`));
    return false;
  }

  spin.stop(pc.dim(`Downloading ${pc.bold(filename)}...`));

  let finalBytes = 0;
  try {
    await downloadMediaFile(directUrl, destPath, (prog) => {
      finalBytes = prog.downloadedBytes;
      const bar = renderProgressBar(prog.percent, 20);
      const pct = `${prog.percent.toFixed(0)}%`.padStart(4);
      const dl = formatBytes(prog.downloadedBytes);
      const tot = prog.totalBytes > 0 ? formatBytes(prog.totalBytes) : "?";
      const spd = `${formatBytes(prog.speedBps)}/s`;

      const line = `  ${bar} ${pc.bold(pct)} ${pc.dim(`(${dl}/${tot} • ${spd})`)}`;
      process.stdout.write(`\r${line}\x1b[K`);
    });

    process.stdout.write("\r\x1b[2K");
    p.log.message(
      `${pc.bold("● Saved:")} ${pc.bold(path.basename(destPath))} ${pc.dim(`(${formatPath(destPath)})`)}`,
    );
    addToHistory({
      url: meta.url || "",
      title: meta.title || "Media",
      platform: meta.platform || "unknown",
      filename: path.basename(destPath),
      path: destPath,
      bytes: finalBytes,
    });
    return true;
  } catch (err) {
    process.stdout.write("\r\x1b[2K");
    p.log.error(`Failed to download ${filename}: ${err.message}`);
    return false;
  }
}

async function handleScrapeAndDownload(targetUrl, options) {
  const outputDir = path.resolve(options.output || DEFAULT_DOWNLOAD_DIR);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const platform = detectPlatform(targetUrl);
  if (!platform) {
    p.log.error(`Unsupported URL: ${targetUrl}`);
    return false;
  }

  const savedConfig = getSavedConfig();
  const engineChoice = options.engine || savedConfig.defaultEngine || "auto";

  // Server Selection prompt for supported platforms based on active engine
  let serverChoice = options.server || savedConfig.defaultServer;
  const serverList = getPlatformServers(platform, engineChoice);
  const isInteractive = Boolean(process.stdin.isTTY);
  if (
    (!serverChoice || serverChoice === "auto") &&
    serverList &&
    !options.yes &&
    !options.info &&
    isInteractive
  ) {
    const chosen = await p.select({
      message: "Select Server:",
      options: serverList.map((s) => ({
        value: s.id,
        label: s.name,
      })),
      initialValue: "auto",
    });

    if (p.isCancel(chosen)) {
      p.cancel("Cancelled.");
      return false;
    }
    serverChoice = chosen;
  }

  const s = p.spinner();
  s.start(pc.dim("Analyzing link..."));

  let media;
  try {
    media = await scrapeUrl(targetUrl, serverChoice || "auto", engineChoice);
    media.url = targetUrl;
    s.stop(pc.dim("Link analyzed."));
  } catch (err) {
    s.stop(pc.bold(`✕ Extraction failed: ${err.message}`));
    return false;
  }

  const serverTag = media.server ? ` • ${media.server}` : "";
  const engineBadge =
    media.engine === "scrapr"
      ? media.fallbackFromMori
        ? pc.yellow(`[Scrapr • Fallback${serverTag}]`)
        : pc.cyan(`[Scrapr Engine${serverTag}]`)
      : pc.green(`[Mori Engine${serverTag}]`);

  // Direct Link / Resolver Platforms (catbox, pixeldrain, sfl.gl, mediafire, sfile, etc.)
  if (RESOLVER_LINK_PLATFORMS.has(media.platform)) {
    // If it's a multi-file collection (e.g. catbox collection, pixeldrain list)
    if (
      media.type === "album" &&
      Array.isArray(media.downloads) &&
      media.downloads.length > 1
    ) {
      const urls = media.downloads.map((d) => d.url).filter(Boolean);
      const urlText = urls.join("\n");
      if (urlText) {
        await writeClipboard(urlText);
      }

      const cardLines = [
        `${pc.dim("Title   :")} ${truncateText(media.title, 65) || "Collection Album"}`,
        `${pc.dim("Engine  :")} ${engineBadge}`,
        `${pc.dim("Files   :")} ${urls.length} item(s)`,
      ];
      p.note(cardLines.join("\n"), pc.bold(media.platform.toUpperCase()));

      if (urls.length) {
        p.log.success(
          `${pc.bold(`✔ ${urls.length} URLs copied to clipboard:`)}`,
        );
        urls.slice(0, 5).forEach((u, i) => {
          p.log.message(`  ${pc.dim(`[${i + 1}]`)} ${pc.cyan(u)}`);
        });
        if (urls.length > 5) {
          p.log.message(`  ${pc.dim(`... and ${urls.length - 5} more`)}`);
        }
      }

      addToHistory({
        url: targetUrl,
        title: media.title || targetUrl,
        platform: media.platform,
        filename: "",
        path: urls[0] || "",
        bytes: 0,
      });

      return true;
    }

    const directUrl =
      media.destinationUrl ||
      media.url ||
      media.downloads?.[0]?.url ||
      "";

    if (directUrl) {
      await writeClipboard(directUrl);
    }

    const cardLines = [
      `${pc.dim("Title   :")} ${truncateText(media.title || media.filename, 65) || "Direct / Resolved Link"}`,
      `${pc.dim("Engine  :")} ${engineBadge}`,
      `${pc.dim("URL     :")} ${truncateText(directUrl, 65)}`,
    ];
    if (media.size && media.size !== "Unknown") {
      cardLines.push(`${pc.dim("Size    :")} ${pc.white(media.size)}`);
    }
    p.note(cardLines.join("\n"), pc.bold(media.platform.toUpperCase()));

    if (directUrl) {
      p.log.success(
        `${pc.bold("✔ URL copied to clipboard:")} ${pc.underline(pc.cyan(directUrl))}`,
      );
    }

    addToHistory({
      url: targetUrl,
      title: media.title || media.filename || directUrl,
      platform: media.platform,
      filename: media.filename || "",
      path: directUrl,
      bytes: 0,
    });

    return true;
  }

  // Metadata card with Platform name as title (e.g. TIKTOK, INSTAGRAM)
  const infoLines = [
    `${pc.dim("Title   :")} ${truncateText(media.title, 68) || "Untitled"}`,
    `${pc.dim("Creator :")} ${truncateText(media.author, 40) || "Creator"}`,
    `${pc.dim("Engine  :")} ${engineBadge}`,
  ];
  if (media.viaResolver) {
    infoLines.push(
      `${pc.dim("Via     :")} ${pc.magenta(media.viaResolver.toUpperCase())} ${pc.dim(`(${media.originalShortUrl || ""})`)}`,
    );
  }
  infoLines.push(`${pc.dim("Streams :")} ${media.downloads?.length || 0} option(s)`);
  p.note(infoLines.join("\n"), pc.bold(media.platform.toUpperCase()));

  if (options.info) {
    if (media.downloads?.length) {
      const streamLines = media.downloads.map((d, idx) => {
        const item = formatStreamItem(d, idx, media.downloads);
        return `  ${pc.bold(`[${idx + 1}]`)} ${pc.white(item.label)}`;
      });
      p.note(streamLines.join("\n"), pc.dim("Available Streams"));
    }
    return true;
  }

  const downloads = media.downloads || [];
  if (downloads.length === 0) {
    p.log.warn("No active download streams found for this URL.");
    return false;
  }

  if (options.audio) {
    const audioItem =
      downloads.find(
        (d) =>
          d.type?.toLowerCase().includes("mp3") ||
          d.type?.toLowerCase().includes("audio") ||
          d.type?.toLowerCase().includes("music"),
      ) || downloads[0];

    p.log.message(
      `${pc.bold("● Audio Stream:")} ${pc.white(audioItem.type || "MP3")}`,
    );

    await processDownloadItem({
      item: audioItem,
      meta: media,
      outputDir,
      index: 0,
      total: 1,
    });
    return true;
  }

  if (options.yes) {
    await processDownloadItem({
      item: downloads[0],
      meta: media,
      outputDir,
      index: 0,
      total: 1,
    });
    return true;
  }

  const photoDownloads = downloads.filter(
    (d) =>
      d.type?.toLowerCase().includes("photo") ||
      d.type?.toLowerCase().includes("image") ||
      d.type?.toLowerCase().includes("page"),
  );

  const audioDownloads = downloads.filter(
    (d) =>
      d.type?.toLowerCase().includes("audio") ||
      d.type?.toLowerCase().includes("music") ||
      d.type?.toLowerCase().includes("mp3"),
  );

  const isPhotoGallery = photoDownloads.length > 1;
  const isSingleImage = photoDownloads.length === 1 && downloads.length === 1;

  if (options.pdf && isSingleImage) {
    const item = photoDownloads[0];
    const s = p.spinner();
    s.start(pc.dim("Downloading photo for PDF album..."));
    try {
      const res = await fetch(item.url, {
        headers: { "User-Agent": CHROME_UA, Accept: "*/*" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const rawPdfName = sanitizeFilename(media.title || "Photo", "pdf");
      const outPdfPath = getNonCollidingPath(outputDir, rawPdfName);
      const { bytes } = compileImagesToPdf([buf], outPdfPath);
      s.stop(
        pc.bold("✔ Compiled 1-page PDF:") +
          ` ${path.basename(outPdfPath)} (${formatBytes(bytes)})`,
      );
      p.log.step(`${pc.bold("Saved to:")} ${pc.dim(outPdfPath)}`);
      addToHistory({
        url: targetUrl || media.url || "",
        title: media.title || "Photo",
        platform: media.platform || "Photo",
        filename: path.basename(outPdfPath),
        path: outPdfPath,
        bytes,
      });
      return true;
    } catch (err) {
      s.stop(pc.bold(`✕ Failed to download photo: ${err.message}`));
      return false;
    }
  }

  if (isPhotoGallery) {
    let albumFormat = options.pdf ? "pdf" : null;
    let itemsToDownload = photoDownloads;
    let downloadAudioAlso = false;

    if (!albumFormat) {
      const albumOptions = [
        {
          value: "all",
          label: `Download All (${photoDownloads.length} individual images)`,
        },
        {
          value: "pdf",
          label: `Download as PDF Album (${photoDownloads.length} photos in 1 file)`,
        },
      ];

      if (audioDownloads.length > 0) {
        albumOptions.push({
          value: "all_plus_audio",
          label: `Download All + Audio (${photoDownloads.length} photos + MP3)`,
        });
      }

      albumOptions.push({
        value: "custom",
        label: "Select specific photos...",
      });

      if (audioDownloads.length > 0) {
        albumOptions.push({
          value: "audio_only",
          label: "Download Audio Only (MP3)",
        });
      }

      albumOptions.push({
        value: "cancel",
        label: pc.dim("Cancel"),
      });

      const choice = await p.select({
        message: `Photo album detected (${photoDownloads.length} photos${audioDownloads.length > 0 ? " + audio" : ""}):`,
        options: albumOptions,
      });

      if (p.isCancel(choice) || choice === "cancel") {
        p.cancel("Cancelled.");
        return false;
      }

      if (choice === "audio_only") {
        await processDownloadItem({
          item: audioDownloads[0],
          meta: media,
          outputDir,
          index: 0,
          total: 1,
        });
        return true;
      }

      if (choice === "all_plus_audio") {
        albumFormat = "all";
        downloadAudioAlso = true;
      } else if (choice === "pdf") {
        albumFormat = "pdf";
      } else if (choice === "custom") {
        const selectedIndices = await p.multiselect({
          message: "Select photos to download:",
          options: photoDownloads.map((d, i) => ({
            value: i,
            label: `Photo #${i + 1}`,
          })),
          required: true,
        });

        if (p.isCancel(selectedIndices)) {
          p.cancel("Cancelled.");
          return false;
        }

        itemsToDownload = selectedIndices.map((idx) => photoDownloads[idx]);

        const formatChoice = await p.select({
          message: "Save selected photos as:",
          options: [
            {
              value: "all",
              label: `Individual image files (${itemsToDownload.length} files)`,
            },
            {
              value: "pdf",
              label: `Single PDF album (${itemsToDownload.length} photos)`,
            },
          ],
        });

        if (p.isCancel(formatChoice)) {
          p.cancel("Cancelled.");
          return false;
        }
        albumFormat = formatChoice;
      } else {
        albumFormat = "all";
      }
    }

    if (albumFormat === "pdf") {
      const s = p.spinner();
      const total = itemsToDownload.length;
      let completed = 0;
      let totalBytes = 0;

      s.start(pc.dim(`[0/${total}] Fetching photos in parallel...`));

      const rawBuffers = await runConcurrentPool(
        itemsToDownload,
        5,
        async (item, i) => {
          try {
            const directUrl = await resolveUrl(item.url);
            const res = await fetch(directUrl, {
              headers: {
                "User-Agent": CHROME_UA,
                Accept: "*/*",
                ...(item.headers || {}),
              },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            completed++;
            totalBytes += buf.length;
            s.message(
              pc.dim(
                `[${completed}/${total}] Fetching photos... (${formatBytes(totalBytes)})`,
              ),
            );
            return buf;
          } catch (err) {
            completed++;
            s.message(
              pc.dim(
                `[${completed}/${total}] Fetching photos... (${formatBytes(totalBytes)})`,
              ),
            );
            return null;
          }
        },
      );

      const buffers = rawBuffers.filter(Boolean);

      if (buffers.length === 0) {
        s.stop(pc.bold("✕ Failed to download photos for PDF album."));
        return false;
      }

      s.stop(
        pc.bold(`✔ [${buffers.length}/${total}] Photos fetched`) +
          ` (${formatBytes(totalBytes)})`,
      );

      s.start(pc.dim(`Compiling ${buffers.length} photos into PDF album...`));
      const rawPdfName = sanitizeFilename(media.title || "Photo_Album", "pdf");
      const outPdfPath = getNonCollidingPath(outputDir, rawPdfName);

      const { bytes, pages } = compileImagesToPdf(buffers, outPdfPath);
      s.stop(
        pc.bold("✔ PDF Album Created:") +
          ` ${path.basename(outPdfPath)} (${pages} pages, ${formatBytes(bytes)})`,
      );

      addToHistory({
        url: targetUrl || media.url || "",
        title: media.title || "Photo Album",
        platform: media.platform || "Album",
        filename: path.basename(outPdfPath),
        path: outPdfPath,
        bytes,
      });

      p.log.step(`${pc.bold("Saved to:")} ${pc.dim(outPdfPath)}`);

      if (downloadAudioAlso && audioDownloads.length > 0) {
        await processDownloadItem({
          item: audioDownloads[0],
          meta: media,
          outputDir,
          index: 0,
          total: 1,
        });
      }

      return true;
    }

    const s = p.spinner();
    const total = itemsToDownload.length;
    let completed = 0;
    let totalBytes = 0;
    let successCount = 0;

    s.start(pc.dim(`[0/${total}] Downloading photos in parallel...`));

    await runConcurrentPool(itemsToDownload, 5, async (item, i) => {
      const ext =
        item.type?.toLowerCase().includes("mp3") ||
        item.type?.toLowerCase().includes("audio")
          ? "mp3"
          : "jpg";
      let baseTitle = media.title || "Photo";
      if (total > 1) {
        baseTitle = `${baseTitle}_${i + 1}`;
      }
      const filename = sanitizeFilename(baseTitle, ext);
      const destPath = getNonCollidingPath(outputDir, filename);

      try {
        const directUrl = await resolveUrl(item.url);
        let fileBytes = 0;
        await downloadMediaFile(directUrl, destPath, (prog) => {
          fileBytes = prog.downloadedBytes;
        });

        completed++;
        totalBytes += fileBytes;
        successCount++;
        s.message(
          pc.dim(
            `[${completed}/${total}] Downloading photos... (${formatBytes(totalBytes)})`,
          ),
        );

        addToHistory({
          url: targetUrl || media.url || "",
          title: `${media.title || "Photo"} #${i + 1}`,
          platform: media.platform || "Photo",
          filename: path.basename(destPath),
          path: destPath,
          bytes: fileBytes,
        });
      } catch (err) {
        completed++;
        s.message(
          pc.dim(
            `[${completed}/${total}] Downloading photos... (${formatBytes(totalBytes)})`,
          ),
        );
      }
    });

    s.stop(
      pc.bold(`✔ [${successCount}/${total}] Photos downloaded:`) +
        ` Saved to ${pc.dim(outputDir)} (${formatBytes(totalBytes)})`,
    );

    if (downloadAudioAlso && audioDownloads.length > 0) {
      await processDownloadItem({
        item: audioDownloads[0],
        meta: media,
        outputDir,
        index: itemsToDownload.length,
        total: itemsToDownload.length + 1,
      });
    }

    return true;
  } else {
    let selectedItem = downloads[0];

    if (downloads.length > 1) {
      const formatChoice = await p.select({
        message: "Select stream:",
        options: downloads.map((d, i) => {
          const item = formatStreamItem(d, i, downloads);
          return {
            value: i,
            label: pc.bold(item.label),
            hint: item.hint ? pc.dim(item.hint) : undefined,
          };
        }),
      });

      if (p.isCancel(formatChoice)) {
        p.cancel("Cancelled.");
        return false;
      }
      selectedItem = downloads[formatChoice];
    }

    await processDownloadItem({
      item: selectedItem,
      meta: media,
      outputDir,
      index: 0,
      total: 1,
    });
  }

  return true;
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      output: { type: "string", short: "o" },
      engine: { type: "string", short: "e" },
      server: { type: "string", short: "s" },
      audio: { type: "boolean", short: "a", default: false },
      pdf: { type: "boolean", short: "p", default: false },
      clip: { type: "boolean", short: "c", default: false },
      yes: { type: "boolean", short: "y", default: false },
      info: { type: "boolean", short: "i", default: false },
      update: { type: "boolean", short: "u", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (values.version) {
    const core = getActiveScraperVersion();
    const scrapr = getActiveScraprVersion();
    const parts = [];
    if (core) parts.push(`mori core v${core}`);
    if (scrapr) parts.push(`scrapr v${scrapr}`);
    const engStr = parts.length > 0 ? ` (${parts.join(" • ")})` : " (no engines installed)";
    console.log(`Mori CLI v${APP_VERSION}${engStr}`);
    process.exit(0);
  }

  // Handle manual OTA update flag
  if (values.update) {
    const moriInst = isMoriInstalled();
    const scraprInst = isScraprInstalled();

    if (!moriInst && !scraprInst) {
      p.log.warn("No scraper engines installed yet. Run 'mori' to set up engines.");
      process.exit(0);
    }

    const s = p.spinner();
    s.start(pc.dim("Checking remote scraper updates..."));
    try {
      const [moriRes, scraprRes] = await Promise.allSettled([
        moriInst ? checkForOtaUpdate(true) : Promise.resolve({ notInstalled: true }),
        scraprInst ? checkForScraprOtaUpdate(true) : Promise.resolve({ notInstalled: true }),
      ]);

      const moriUpdate = moriRes.status === "fulfilled" ? moriRes.value : null;
      const scraprUpdate =
        scraprRes.status === "fulfilled" ? scraprRes.value : null;

      const lines = [];
      if (moriUpdate?.updated) {
        lines.push(
          pc.bold(`✔ Mori Core updated to v${moriUpdate.newVersion}`) +
            (moriUpdate.changelog ? pc.dim(` — ${moriUpdate.changelog}`) : ""),
        );
      } else if (moriInst && moriUpdate) {
        lines.push(
          pc.dim(
            `Mori Core is up to date (v${moriUpdate.currentVersion || getActiveScraperVersion()}).`,
          ),
        );
      }

      if (scraprUpdate?.updated) {
        lines.push(
          pc.bold(`✔ Scrapr Engine updated to v${scraprUpdate.newVersion}`),
        );
      } else if (scraprInst && scraprUpdate) {
        lines.push(
          pc.dim(
            `Scrapr Engine is up to date (v${scraprUpdate.currentVersion || getActiveScraprVersion()}).`,
          ),
        );
      }

      s.stop(lines.join("\n"));
    } catch (err) {
      s.stop(pc.bold(`✕ OTA check failed: ${err.message}`));
    }
    process.exit(0);
  }

  const coreVer = getActiveScraperVersion();
  const scraprVer = getActiveScraprVersion();
  printBanner(coreVer, scraprVer);

  // Check if first-run engine setup is required
  if (!isMoriInstalled() && !isScraprInstalled()) {
    await ensureEnginesInstalled();
  }

  // Background non-blocking silent OTA check (only for installed engines)
  if (isMoriInstalled()) {
    checkForOtaUpdate(false)
      .then((ota) => {
        if (ota?.updated) {
          p.log.message(
            pc.dim(
              `● New Mori Core patch installed in background: v${ota.newVersion}`,
            ),
          );
        }
      })
      .catch(() => {});
  }

  if (isScraprInstalled()) {
    checkForScraprOtaUpdate(false)
      .then((scraprOta) => {
        if (scraprOta?.updated) {
          p.log.message(
            pc.dim(
              `● New Scrapr Engine bundle installed in background: v${scraprOta.newVersion}`,
            ),
          );
        }
      })
      .catch(() => {});
  }

  const cliUpdatePromise = checkCliUpdate();

  const savedConfig = getSavedConfig();
  const defaultDir =
    values.output || savedConfig.outputDir || DEFAULT_DOWNLOAD_DIR;
  let currentOutputDir = path.resolve(defaultDir);

  if (values.clip) {
    const s = p.spinner();
    s.start(pc.dim("Reading clipboard..."));
    const clipText = await readClipboard();
    const urls = extractUrls(clipText);
    const valid = urls.find((u) => Boolean(detectPlatform(u)));
    if (valid) {
      s.stop(
        `${pc.bold("Clipboard link:")} ${pc.inverse(` ${detectPlatform(valid)?.toUpperCase()} `)} ${pc.dim(valid)}`,
      );
      positionals[0] = valid;
    } else {
      s.stop(pc.bold("✕ No supported media URL found in clipboard."));
      process.exit(1);
    }
  }

  let targetUrl = positionals[0];
  let lastUrl = null;

  if (targetUrl) {
    const platform = detectPlatform(targetUrl);
    if (!platform) {
      p.log.error(`Unsupported URL: ${targetUrl}`);
      p.outro(pc.dim("Run with --help to view supported platforms."));
      process.exit(1);
    }

    lastUrl = targetUrl;
    await handleScrapeAndDownload(targetUrl, {
      ...values,
      output: currentOutputDir,
    });
    const newVer = await cliUpdatePromise;
    if (newVer) {
      p.log.message(
        pc.yellow(
          `● Update available: v${APP_VERSION} → v${newVer} (run: npm i -g @coflyn/mori)`,
        ),
      );
    }
    p.outro(pc.dim("Complete."));
  } else {
    const newVer = await cliUpdatePromise;
    if (newVer) {
      p.note(
        `${pc.white("New version available:")} ${pc.dim(`v${APP_VERSION}`)} → ${pc.green(`v${newVer}`)}\n` +
          `${pc.dim("Run:")} ${pc.cyan("npm i -g @coflyn/mori")} ${pc.dim("to update")}`,
        pc.yellow("Update Available"),
      );
    }

    let keepGoing = true;

    while (keepGoing) {
      const urlInput = await p.text({
        message: "Paste link:",
        placeholder: "https://... or type /help",
        validate: (val) => {
          if (!val || val.trim().length === 0)
            return "Please enter a URL or /command.";
          const clean = val.trim().toLowerCase();
          if (clean === "exit" || clean === "quit" || clean === "q")
            return undefined;
          if (clean.startsWith("/")) return undefined;
          if (!detectPlatform(val.trim())) {
            return "Platform not supported. Type /platform to view supported platforms.";
          }
          return undefined;
        },
      });

      if (p.isCancel(urlInput)) {
        p.cancel("Exited.");
        process.exit(0);
      }

      const rawInput = urlInput.trim();
      const lower = rawInput.toLowerCase();

      // Forgiving exit without leading slash
      if (lower === "exit" || lower === "quit" || lower === "q") {
        p.outro(pc.dim("Exited."));
        process.exit(0);
      }

      // Slash command interceptor
      if (rawInput.startsWith("/")) {
        const [cmd, ...args] = rawInput.slice(1).split(/\s+/);
        const command = cmd.toLowerCase();

        switch (command) {
          case "platform":
          case "platforms": {
            const platformList = [
              `${pc.bold("Social/Video:")} TikTok, Douyin, YouTube, Instagram, Facebook, Bilibili, Reddit, Threads, Twitter/X, Doodstream`,
              `${pc.bold("Music/Audio :")} Spotify, SoundCloud, Apple Music, Bandcamp`,
              `${pc.bold("Photo/Art   :")} Pinterest, Pixiv, RedNote (Xiaohongshu)`,
              `${pc.bold("Cloud/Files :")} TeraBox, MediaFire, Sfile, Catbox, Pixeldrain, Krakenfiles, Google Drive`,
              `${pc.bold("Resolvers   :")} SafeLinkU, Sub2Unlock, Rekonise, Link Unshortener`,
            ];
            p.note(platformList.join("\n"), pc.dim("Supported Platforms (27 • Dual-Engine)"));
            break;
          }

          case "play": {
            const items = getHistory(15);
            let targetItem = null;
            let targetNum = 1;

            if (args[0]) {
              const parsed = parseInt(args[0], 10);
              if (!isNaN(parsed)) {
                targetNum = parsed;
                if (targetNum < 1 || targetNum > items.length) {
                  p.log.warn(
                    `Invalid history index #${targetNum}. Available: 1 to ${items.length}.`,
                  );
                  break;
                }
                targetItem = items[targetNum - 1];
              } else {
                const customPath = path.resolve(args.join(" "));
                if (fs.existsSync(customPath)) {
                  const ext = path.extname(customPath).toLowerCase();
                  if (ext !== ".mp4" && ext !== ".mp3" && ext !== ".m4a") {
                    p.log.warn(
                      `Cannot play ${ext ? ext.toUpperCase() : "this"} file. /play is only for MP4 and MP3 (use /open to view files).`,
                    );
                    break;
                  }
                  try {
                    await openFile(customPath);
                    p.log.step(`${pc.bold("Playing:")} ${pc.dim(customPath)}`);
                  } catch (err) {
                    p.log.error(`Failed to play media: ${err.message}`);
                  }
                  break;
                }
              }
            } else {
              if (items.length > 0) {
                const playIdx = items.findIndex((it) => {
                  const ext = path
                    .extname(it.path || it.filename || "")
                    .toLowerCase();
                  return ext === ".mp4" || ext === ".mp3" || ext === ".m4a";
                });
                if (playIdx !== -1) {
                  targetItem = items[playIdx];
                  targetNum = playIdx + 1;
                } else {
                  targetItem = items[0];
                }
              }
            }

            if (!targetItem) {
              p.log.warn("No downloaded media found in history to play.");
              break;
            }

            if (!targetItem.path || !fs.existsSync(targetItem.path)) {
              p.log.error(
                `File no longer exists: ${targetItem.path || targetItem.filename}`,
              );
              break;
            }

            const fileExt = path
              .extname(targetItem.path || targetItem.filename || "")
              .toLowerCase();
            if (
              fileExt !== ".mp4" &&
              fileExt !== ".mp3" &&
              fileExt !== ".m4a"
            ) {
              p.log.warn(
                `Item #${targetNum} is a ${fileExt ? fileExt.toUpperCase() : "non-audio/video"} file. /play is only for MP4 and MP3 (type /open to view files).`,
              );
              break;
            }

            try {
              await openFile(targetItem.path);
              p.log.step(
                `${pc.bold("Playing:")} ${pc.white(`[#${targetNum}]`)} ${pc.bold(targetItem.filename || targetItem.title)} ${pc.dim(`(${targetItem.path})`)}`,
              );
            } catch (err) {
              p.log.error(`Failed to launch media player: ${err.message}`);
            }
            break;
          }

          case "delete":
          case "del":
          case "rm": {
            const items = getHistory(20);
            if (items.length === 0) {
              p.log.warn("No download history to delete.");
              break;
            }

            let targetIndex = -1;

            if (args[0]) {
              const numArg = parseInt(args[0], 10);
              if (isNaN(numArg) || numArg < 1 || numArg > items.length) {
                p.log.warn(
                  `Invalid index. Available range: 1 to ${items.length}.`,
                );
                break;
              }
              targetIndex = numArg - 1;
            } else {
              const selectChoice = await p.select({
                message: "Select item to delete:",
                options: [
                  ...items.map((it, idx) => ({
                    value: idx,
                    label: `[#${idx + 1}] ${it.filename || it.title || "Media"}`,
                    hint: it.platform || "",
                  })),
                  { value: -1, label: pc.dim("Cancel") },
                ],
              });

              if (p.isCancel(selectChoice) || selectChoice === -1) {
                break;
              }
              targetIndex = selectChoice;
            }

            const itemToDelete = items[targetIndex];
            const confirm = await p.confirm({
              message: `Delete "${itemToDelete.filename || itemToDelete.title}" from disk and history?`,
              initialValue: false,
            });

            if (p.isCancel(confirm) || !confirm) {
              p.log.step(pc.dim("Deletion cancelled."));
              break;
            }

            const res = deleteHistoryItem(targetIndex, true);
            if (res.success) {
              const fileNote = res.fileDeleted
                ? pc.dim("(deleted from disk & removed from history)")
                : pc.dim("(removed from history; file was not on disk)");
              p.log.step(
                `${pc.bold("✔ Deleted:")} ${pc.white(itemToDelete.filename || itemToDelete.title)} ${fileNote}`,
              );
            } else {
              p.log.error(`Failed to delete item: ${res.error}`);
            }
            break;
          }

          case "ping": {
            const host = args[0] || "1.1.1.1";
            const s = p.spinner();
            s.start(pc.dim(`Pinging ${host}...`));
            const res = await pingNetwork(host);

            if (!res.ok || res.avg < 0) {
              s.stop(
                pc.bold(`✕ Ping to ${host} failed`) +
                  pc.dim(` (${res.loss} loss)`),
              );
              break;
            }

            s.stop(
              `${pc.bold("Pong!")} ${pc.white(`${res.avg}ms`)} ` +
                pc.dim(
                  `(min ${res.min}ms • max ${res.max}ms • ${res.loss} loss • ${res.host})`,
                ),
            );
            break;
          }

          case "pdf": {
            let link = args.find((a) => a.startsWith("http"));
            if (!link) {
              const promptRes = await p.text({
                message: "Paste link to download as PDF album:",
                placeholder: "https://...",
                validate: (val) => {
                  if (!val || !val.trim()) return "Please enter a URL.";
                  if (!detectPlatform(val.trim()))
                    return "Platform not supported.";
                  return undefined;
                },
              });
              if (p.isCancel(promptRes)) break;
              link = promptRes.trim();
            }

            lastUrl = link;
            await handleScrapeAndDownload(link, {
              ...values,
              pdf: true,
              output: currentOutputDir,
            });
            break;
          }

          case "batch": {
            const batchInput = await p.text({
              message: "Paste multiple links (separated by space or newline):",
              placeholder: "https://... https://...",
              validate: (val) => {
                if (!val || val.trim().length === 0)
                  return "Please paste at least one link.";
                const urls = extractUrls(val);
                if (urls.length === 0) return "No valid URLs found.";
                return undefined;
              },
            });

            if (p.isCancel(batchInput)) break;

            const urls = extractUrls(batchInput);
            const supported = urls.filter((u) => Boolean(detectPlatform(u)));
            if (supported.length === 0) {
              p.log.error(
                "None of the provided links match supported platforms.",
              );
              break;
            }

            p.log.message(
              `${pc.bold("● Batch Queue:")} ${pc.white(supported.length)} link(s) queued` +
                (urls.length > supported.length
                  ? pc.dim(
                      ` (${urls.length - supported.length} unsupported skipped)`,
                    )
                  : ""),
            );

            for (let i = 0; i < supported.length; i++) {
              const u = supported[i];
              const plat = detectPlatform(u);
              p.log.step(
                `${pc.dim(`[${i + 1}/${supported.length}]`)} ${pc.inverse(` ${plat?.toUpperCase()} `)} ${pc.dim(u)}`,
              );
              await handleScrapeAndDownload(u, {
                ...values,
                yes: true,
                output: currentOutputDir,
              });
            }
            p.log.message(
              pc.bold(`✔ Batch download finished (${supported.length} items).`),
            );
            break;
          }

          case "open": {
            try {
              if (!fs.existsSync(currentOutputDir)) {
                fs.mkdirSync(currentOutputDir, { recursive: true });
              }
              await openDirectory(currentOutputDir);
              p.log.step(
                `${pc.bold("Opened folder:")} ${pc.dim(currentOutputDir)}`,
              );
            } catch (err) {
              p.log.error(`Failed to open directory: ${err.message}`);
            }
            break;
          }

          case "server": {
            const currentPref = getSavedConfig().defaultServer || "auto";
            const choice = await p.select({
              message: "Select default scraper server:",
              options: [
                {
                  value: "auto",
                  label: "Auto",
                  hint: "Best server per platform (default)",
                },
                {
                  value: "1",
                  label: "Server 1",
                  hint: "Primary (TikWM, SnapInsta, Cobalt, etc.)",
                },
                {
                  value: "2",
                  label: "Server 2",
                  hint: "Backup (LoveTik, FastDL, Viddly, etc.)",
                },
              ],
              initialValue: currentPref,
            });

            if (p.isCancel(choice)) break;

            saveConfig({ defaultServer: choice });
            p.log.message(
              `${pc.bold("● Default server set:")} ${pc.white(choice)}`,
            );
            break;
          }

          case "engine": {
            const moriInst = isMoriInstalled();
            const scraprInst = isScraprInstalled();
            const currentPref = getSavedConfig().defaultEngine || "auto";

            const options = [
              {
                value: "auto",
                label: "Auto (Recommended)",
                hint: `Cascade engines • Mori: ${moriInst ? "v" + (getActiveScraperVersion() || "installed") : "missing"} • Scrapr: ${scraprInst ? "v" + (getActiveScraprVersion() || "installed") : "missing"}`,
              },
              {
                value: "mori",
                label: "Mori Engine",
                hint: `Core browser scrapers ~80 KB • ${moriInst ? "Installed (v" + (getActiveScraperVersion() || "1.0.0") + ")" : "Not installed"}`,
              },
              {
                value: "scrapr",
                label: "Scrapr Engine",
                hint: `Resolvers & scrapers ~2.7 MB • ${scraprInst ? "Installed (v" + (getActiveScraprVersion() || "1.3.1") + ")" : "Not installed"}`,
              },
            ];

            if (!moriInst || !scraprInst) {
              options.push({
                value: "install_missing",
                label: "Install Missing Engine...",
                hint: !moriInst && !scraprInst ? "Both missing" : !moriInst ? "Install Mori" : "Install Scrapr",
              });
            }

            options.push({
              value: "manage",
              label: "Manage Engines (Reinstall / Uninstall)...",
              hint: "Re-download or remove engines",
            });

            const choice = await p.select({
              message: "Select extraction engine preference:",
              options,
              initialValue: currentPref,
            });

            if (p.isCancel(choice)) break;

            if (choice === "install_missing") {
              if (!moriInst) {
                const s = p.spinner();
                s.start(pc.dim("Installing Mori Core Engine (~80 KB)..."));
                try {
                  const res = await downloadMoriEngine();
                  s.stop(pc.bold(`✔ Mori Core Engine installed (v${res.version}).`));
                } catch (err) {
                  s.stop(pc.bold(`✕ Failed: ${err.message}`));
                }
              }
              if (!scraprInst) {
                const s = p.spinner();
                s.start(pc.dim("Installing Scrapr Engine (~2.7 MB)..."));
                try {
                  const res = await downloadScraprEngine();
                  s.stop(pc.bold(`✔ Scrapr Engine installed (v${res.version}).`));
                } catch (err) {
                  s.stop(pc.bold(`✕ Failed: ${err.message}`));
                }
              }
              break;
            }

            if (choice === "manage") {
              const mgmtChoice = await p.select({
                message: "Engine Management:",
                options: [
                  {
                    value: "reinstall_mori",
                    label: "Reinstall Mori Engine (~80 KB)",
                    hint: moriInst ? "Re-fetch latest bundle" : "Install",
                  },
                  {
                    value: "reinstall_scrapr",
                    label: "Reinstall Scrapr Engine (~2.7 MB)",
                    hint: scraprInst ? "Re-fetch latest bundle" : "Install",
                  },
                  ...(moriInst
                    ? [
                        {
                          value: "uninstall_mori",
                          label: "Uninstall Mori Engine",
                          hint: "Delete ~/.mori/scrapers-bundle.js",
                        },
                      ]
                    : []),
                  ...(scraprInst
                    ? [
                        {
                          value: "uninstall_scrapr",
                          label: "Uninstall Scrapr Engine",
                          hint: "Delete ~/.mori/scrapr/",
                        },
                      ]
                    : []),
                  { value: "cancel", label: pc.dim("Cancel") },
                ],
              });

              if (p.isCancel(mgmtChoice) || mgmtChoice === "cancel") break;

              if (mgmtChoice === "reinstall_mori") {
                const s = p.spinner();
                s.start(pc.dim("Downloading Mori Engine..."));
                try {
                  const res = await downloadMoriEngine();
                  s.stop(pc.bold(`✔ Mori Engine installed (v${res.version}).`));
                } catch (err) {
                  s.stop(pc.bold(`✕ Failed: ${err.message}`));
                }
              } else if (mgmtChoice === "reinstall_scrapr") {
                const s = p.spinner();
                s.start(pc.dim("Downloading Scrapr Engine..."));
                try {
                  const res = await downloadScraprEngine();
                  s.stop(pc.bold(`✔ Scrapr Engine installed (v${res.version}).`));
                } catch (err) {
                  s.stop(pc.bold(`✕ Failed: ${err.message}`));
                }
              } else if (mgmtChoice === "uninstall_mori") {
                uninstallMoriEngine();
                p.log.message(pc.dim("✔ Mori Engine uninstalled."));
              } else if (mgmtChoice === "uninstall_scrapr") {
                uninstallScraprEngine();
                p.log.message(pc.dim("✔ Scrapr Engine uninstalled."));
              }
              break;
            }

            // If selected mori but not installed
            if (choice === "mori" && !moriInst) {
              const confirmDl = await p.confirm({
                message: "Mori Engine is not installed. Download now (~80 KB)?",
                initialValue: true,
              });
              if (!p.isCancel(confirmDl) && confirmDl) {
                const s = p.spinner();
                s.start(pc.dim("Downloading Mori Engine..."));
                try {
                  const res = await downloadMoriEngine();
                  s.stop(pc.bold(`✔ Mori Engine installed (v${res.version}).`));
                } catch (err) {
                  s.stop(pc.bold(`✕ Failed: ${err.message}`));
                  break;
                }
              } else {
                break;
              }
            }

            // If selected scrapr but not installed
            if (choice === "scrapr" && !scraprInst) {
              const confirmDl = await p.confirm({
                message: "Scrapr Engine is not installed. Download now (~2.7 MB)?",
                initialValue: true,
              });
              if (!p.isCancel(confirmDl) && confirmDl) {
                const s = p.spinner();
                s.start(pc.dim("Downloading Scrapr Engine..."));
                try {
                  const res = await downloadScraprEngine();
                  s.stop(pc.bold(`✔ Scrapr Engine installed (v${res.version}).`));
                } catch (err) {
                  s.stop(pc.bold(`✕ Failed: ${err.message}`));
                  break;
                }
              } else {
                break;
              }
            }

            saveConfig({ defaultEngine: choice });
            p.log.message(
              `${pc.bold("● Default engine set:")} ${pc.white(choice)}`,
            );
            break;
          }

          case "clip":
          case "paste": {
            const s = p.spinner();
            s.start(pc.dim("Reading clipboard..."));
            const clipText = await readClipboard();
            if (!clipText) {
              s.stop(pc.dim("Clipboard is empty."));
              break;
            }

            const urls = extractUrls(clipText);
            const valid = urls.find((u) => Boolean(detectPlatform(u)));
            if (!valid) {
              s.stop(pc.bold("✕ No supported media URL found in clipboard."));
              break;
            }

            const plat = detectPlatform(valid);
            s.stop(
              `${pc.bold("Link from clipboard:")} ${pc.inverse(` ${plat?.toUpperCase()} `)} ${pc.dim(valid)}`,
            );

            const isAudio =
              args.includes("-a") ||
              args.includes("--audio") ||
              args.includes("audio") ||
              args.includes("mp3");

            lastUrl = valid;
            await handleScrapeAndDownload(valid, {
              ...values,
              audio: isAudio || values.audio,
              output: currentOutputDir,
            });
            break;
          }

          case "audio":
          case "mp3": {
            let link = args.find((a) => a.startsWith("http"));
            if (!link) {
              const promptRes = await p.text({
                message: "Paste link for Audio-Only (MP3):",
                placeholder: "https://...",
                validate: (val) => {
                  if (!val || !val.trim()) return "Please enter a URL.";
                  if (!detectPlatform(val.trim()))
                    return "Platform not supported.";
                  return undefined;
                },
              });
              if (p.isCancel(promptRes)) break;
              link = promptRes.trim();
            }

            await handleScrapeAndDownload(link, {
              ...values,
              audio: true,
              output: currentOutputDir,
            });
            break;
          }

          case "history": {
            if (
              args[0] === "clear" ||
              args[0] === "clean" ||
              args[0] === "reset"
            ) {
              clearHistory();
              p.log.message(pc.dim("Download history cleared."));
              break;
            }

            const items = getHistory(15);
            if (items.length === 0) {
              p.log.message(pc.dim("No download history yet."));
              break;
            }

            // Check if user specified an iteration number, e.g. /history 1
            const numArg = parseInt(args[0], 10);
            if (!isNaN(numArg)) {
              if (numArg < 1 || numArg > items.length) {
                p.log.warn(
                  `Invalid history index #${numArg}. Available: 1 to ${items.length}.`,
                );
                break;
              }
              const selected = items[numArg - 1];
              if (!selected.url) {
                p.log.warn(
                  `Item #${numArg} has no recorded source URL (downloaded prior to URL tracking).`,
                );
                break;
              }
              p.log.message(
                `${pc.bold("● Re-downloading from history:")} ${pc.inverse(` ${selected.platform?.toUpperCase()} `)} ${pc.dim(selected.url)}`,
              );
              lastUrl = selected.url;
              await handleScrapeAndDownload(selected.url, {
                ...values,
                output: currentOutputDir,
              });
              break;
            }

            const historyLines = items.map((it, idx) => {
              const num = pc.bold(`[${idx + 1}]`);
              const badge = pc.inverse(` ${it.platform.toUpperCase()} `);
              const name = pc.bold(it.filename || it.title || "Media");
              const rel = it.timestamp
                ? pc.dim(`(${formatRelativeTime(it.timestamp)})`)
                : "";
              return `${num} ${badge} ${name} ${rel}`;
            });

            p.note(
              historyLines.join("\n"),
              pc.dim(
                `Recent Downloads (${items.length}) • /history <num> to redownload • /history clear to reset`,
              ),
            );
            break;
          }

          case "config": {
            const cfg = getSavedConfig();
            const cfgLines = [
              `${pc.bold("Download Dir  :")} ${pc.white(currentOutputDir)}`,
              `${pc.bold("Default Engine:")} ${pc.white(cfg.defaultEngine || "auto")}`,
              `${pc.bold("Default Server:")} ${pc.white(cfg.defaultServer || "auto")}`,
              `${pc.bold("CLI Version   :")} ${pc.white(`v${APP_VERSION}`)}`,
              `${pc.bold("Mori Core Ver :")} ${pc.white(`v${getActiveScraperVersion()}`)}`,
              `${pc.bold("Scrapr Ver    :")} ${pc.white(`v${getActiveScraprVersion()}`)}`,
              `${pc.bold("Config Path   :")} ${pc.dim(CONFIG_PATH)}`,
            ];
            p.note(cfgLines.join("\n"), pc.dim("Active Configuration"));
            break;
          }

          case "info":
          case "inspect": {
            let link = args.find((a) => a.startsWith("http"));
            if (!link) {
              const promptRes = await p.text({
                message: "Paste link to inspect:",
                placeholder: "https://...",
                validate: (val) => {
                  if (!val || !val.trim()) return "Please enter a URL.";
                  if (!detectPlatform(val.trim()))
                    return "Platform not supported.";
                  return undefined;
                },
              });
              if (p.isCancel(promptRes)) break;
              link = promptRes.trim();
            }

            lastUrl = link;
            await handleScrapeAndDownload(link, {
              ...values,
              info: true,
              output: currentOutputDir,
            });
            break;
          }

          case "retry":
          case "again": {
            if (!lastUrl) {
              p.log.warn("No recent URL to retry.");
              break;
            }
            p.log.message(`${pc.bold("● Retrying link:")} ${pc.dim(lastUrl)}`);
            await handleScrapeAndDownload(lastUrl, {
              ...values,
              output: currentOutputDir,
            });
            break;
          }

          case "stats": {
            const stats = getStats();
            if (stats.totalDownloads === 0) {
              p.log.message(
                pc.dim("No statistics yet. Download some media first!"),
              );
              break;
            }

            const breakdown = Object.entries(stats.platformCounts)
              .map(
                ([plat, count]) =>
                  `  ${pc.bold(plat.toUpperCase().padEnd(12, " "))} : ${pc.white(count)} download(s)`,
              )
              .join("\n");

            const statLines = [
              `${pc.bold("Total Downloads :")} ${pc.white(stats.totalDownloads)} file(s)`,
              `${pc.bold("Total Storage   :")} ${pc.white(formatBytes(stats.totalBytes))}`,
              `${pc.bold("Top Platform    :")} ${pc.white(stats.topPlatform.toUpperCase())}`,
              "",
              pc.bold("Platform Breakdown:"),
              breakdown,
            ];
            p.note(statLines.join("\n"), pc.dim("Mori Download Statistics"));
            break;
          }

          case "reset": {
            const confirm = await p.confirm({
              message:
                "Reset Mori config, cached scrapers, and history to factory defaults?",
              initialValue: false,
            });
            if (p.isCancel(confirm) || !confirm) {
              p.log.message(pc.dim("Reset cancelled."));
              break;
            }

            resetMori();
            currentOutputDir = DEFAULT_DOWNLOAD_DIR;
            p.log.message(
              pc.bold(
                "✔ Mori reset to default state (config, OTA cache, history cleared).",
              ),
            );
            break;
          }

          case "update":
          case "u": {
            const s = p.spinner();
            s.start(pc.dim("Checking for updates..."));
            try {
              const cliVer = await checkCliUpdate();
              const [moriRes, scraprRes] = await Promise.allSettled([
                isMoriInstalled()
                  ? checkForOtaUpdate(true)
                  : Promise.resolve({ notInstalled: true }),
                isScraprInstalled()
                  ? checkForScraprOtaUpdate(true)
                  : Promise.resolve({ notInstalled: true }),
              ]);

              s.stop(pc.bold("Update Check:"));

              if (cliVer) {
                p.note(
                  `${pc.white("New CLI release:")} ${pc.dim(`v${APP_VERSION}`)} → ${pc.green(`v${cliVer}`)}\n` +
                    `${pc.dim("Run:")} ${pc.cyan("npm i -g @coflyn/mori")}`,
                  pc.yellow("CLI Update Available"),
                );
              } else {
                p.log.step(
                  pc.dim(`CLI package is up to date (v${APP_VERSION}).`),
                );
              }

              const moriUpdate =
                moriRes.status === "fulfilled" ? moriRes.value : null;
              const scraprUpdate =
                scraprRes.status === "fulfilled" ? scraprRes.value : null;

              if (moriUpdate?.notInstalled) {
                p.log.step(
                  pc.dim("Mori Engine: Not installed (install with /engine)."),
                );
              } else if (moriUpdate?.updated) {
                p.log.step(
                  pc.bold(`✔ Mori Core updated to v${moriUpdate.newVersion}`) +
                    (moriUpdate.changelog
                      ? pc.dim(` — ${moriUpdate.changelog}`)
                      : ""),
                );
              } else if (moriUpdate) {
                p.log.step(
                  pc.dim(
                    `Mori Core is up to date (v${moriUpdate.currentVersion || getActiveScraperVersion()}).`,
                  ),
                );
              }

              if (scraprUpdate?.notInstalled) {
                p.log.step(
                  pc.dim("Scrapr Engine: Not installed (install with /engine)."),
                );
              } else if (scraprUpdate?.updated) {
                p.log.step(
                  pc.bold(
                    `✔ Scrapr Engine updated to v${scraprUpdate.newVersion}`,
                  ),
                );
              } else if (scraprUpdate) {
                p.log.step(
                  pc.dim(
                    `Scrapr Engine is up to date (v${scraprUpdate.currentVersion || getActiveScraprVersion()}).`,
                  ),
                );
              }
            } catch (err) {
              s.stop(pc.bold(`✕ Update check failed: ${err.message}`));
            }
            break;
          }

          case "dir": {
            const targetDir = args.join(" ").trim();
            if (targetDir) {
              currentOutputDir = path.resolve(targetDir);
              if (!fs.existsSync(currentOutputDir))
                fs.mkdirSync(currentOutputDir, { recursive: true });
              saveConfig({ outputDir: currentOutputDir });
              p.log.message(
                `${pc.bold("● Saved output dir (persistent):")} ${pc.dim(currentOutputDir)}`,
              );
            } else {
              const newDir = await p.text({
                message: "Download directory (saved permanently):",
                initialValue: currentOutputDir,
              });
              if (!p.isCancel(newDir) && newDir.trim()) {
                currentOutputDir = path.resolve(newDir.trim());
                if (!fs.existsSync(currentOutputDir))
                  fs.mkdirSync(currentOutputDir, { recursive: true });
                saveConfig({ outputDir: currentOutputDir });
                p.log.message(
                  `${pc.bold("● Saved output dir (persistent):")} ${pc.dim(currentOutputDir)}`,
                );
              }
            }
            break;
          }

          case "clear":
          case "cls": {
            console.clear();
            printBanner(getActiveScraperVersion(), getActiveScraprVersion());
            break;
          }

          case "help":
          case "?": {
            const cmds = [
              `${pc.bold("/clip")}          Download link currently in clipboard`,
              `${pc.bold("/audio [url]")}   Download audio stream only (MP3/M4A)`,
              `${pc.bold("/pdf [url]")}     Download photo album compiled directly into 1 PDF`,
              `${pc.bold("/play [num]")}    Play downloaded media in default system player`,
              `${pc.bold("/ping [host]")}   Check user network latency (default: 1.1.1.1)`,
              `${pc.bold("/info [url]")}    Inspect media details without downloading`,
              `${pc.bold("/retry")}         Re-download the last link processed`,
              `${pc.bold("/batch")}         Bulk download multiple links at once`,
              `${pc.bold("/platform")}      List all 27 supported media platforms`,
              `${pc.bold("/dir")}           View or set download directory (persistent)`,
              `${pc.bold("/open")}          Open download folder in file manager`,
              `${pc.bold("/engine")}        Set default extraction engine (auto/mori/scrapr)`,
              `${pc.bold("/server")}        Set default scraper server (auto/1/2)`,
              `${pc.bold("/history [num]")}  View or redownload history item (/history 1, /history clear)`,
              `${pc.bold("/delete [num]")}   Delete downloaded file from disk and history`,
              `${pc.bold("/stats")}         View total downloads & storage statistics`,
              `${pc.bold("/config")}        Show active Mori configuration`,
              `${pc.bold("/update")}        Check and apply remote OTA scraper patches`,
              `${pc.bold("/reset")}         Factory reset Mori config, cache, & history`,
              `${pc.bold("/clear")}         Clear screen and reprint header`,
              `${pc.bold("/exit, /q")}      Exit Mori CLI`,
            ];
            p.note(cmds.join("\n"), pc.dim("Available Commands"));
            break;
          }

          case "exit":
          case "quit":
          case "q": {
            p.outro(pc.dim("Exited."));
            process.exit(0);
          }

          default:
            p.log.warn(
              `Unknown command: /${command}. Type /help for available commands.`,
            );
            break;
        }

        // Return to prompt without asking "Continue?"
        continue;
      }

      lastUrl = rawInput;
      await handleScrapeAndDownload(rawInput, {
        ...values,
        output: currentOutputDir,
      });

      const next = await p.confirm({
        message: "Continue?",
        initialValue: true,
      });

      if (p.isCancel(next) || !next) {
        keepGoing = false;
      }
    }

    p.outro(pc.dim("Complete."));
  }
}

main().catch((err) => {
  p.log.error(`Error: ${err.message}`);
  process.exit(1);
});
