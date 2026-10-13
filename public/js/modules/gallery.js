// gallery.js — scan Mori download folders into a media gallery
import {
  Filesystem,
  pauseAllMedia,
  stopAllMedia,
  showToast,
} from "../utils/index.js";
import { t } from "../i18n/index.js";
import { createVideoPlayer } from "../components/player.js";

const VIDEO_EXT = /\.(mp4|mov|mkv|webm|m4v)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|opus|flac|wav|ogg)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;
const PDF_EXT = /\.(pdf)$/i;

let galleryItems = [];
let galleryFilter = "all";
let gallerySort = "newest";
let galleryQuery = "";
let activeScanPromise = null;
let searchDebounceTimer = null;
const cardCache = new Map();
let galleryNeedsRescan = false;

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fileCategory(name) {
  if (VIDEO_EXT.test(name)) return "video";
  if (AUDIO_EXT.test(name)) return "audio";
  if (IMAGE_EXT.test(name)) return "image";
  if (PDF_EXT.test(name)) return "pdf";
  return null;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function toLocalMediaUrl(pathOrUri) {
  if (!pathOrUri) return "";
  const raw = String(pathOrUri);
  if (
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("data:") ||
    raw.startsWith("blob:") ||
    raw.startsWith("content://") ||
    raw.startsWith("capacitor://") ||
    raw.startsWith("asset://") ||
    raw.startsWith("tauri://")
  ) {
    return raw;
  }
  let p = raw;
  try {
    p = decodeURIComponent(p);
  } catch (_) {}
  if (p.includes("_capacitor_file_")) {
    p = p.substring(p.indexOf("_capacitor_file_") + 16);
  }
  p = p.replace(/^file:\/\//i, "");

  const tauriConvert =
    window.__TAURI__?.core?.convertFileSrc ||
    window.__TAURI_INTERNALS__?.convertFileSrc ||
    window.__TAURI__?.convertFileSrc;
  if (tauriConvert) {
    const cleanTauri = /^[a-zA-Z]:/i.test(p)
      ? p.replace(/^([a-zA-Z]:)[/\\]/, "$1/")
      : p.startsWith("/")
        ? p
        : "/" + p;
    return tauriConvert(cleanTauri);
  }

  const platform = window.Capacitor?.getPlatform?.();
  if (!p.startsWith("/")) {
    if (platform === "android") p = "/storage/emulated/0/" + p;
    else p = "/" + p;
  }
  return window.Capacitor?.convertFileSrc
    ? window.Capacitor.convertFileSrc("file://" + p)
    : "file://" + p;
}

export function getGalleryScanFolders() {
  const folders = [];
  const add = (path) => {
    if (path && typeof path === "string") {
      const trimmed = path.trim();
      if (trimmed && !folders.includes(trimmed)) folders.push(trimmed);
    }
  };
  add(localStorage.getItem("mori_download_path") || "Download/Mori");
  add(localStorage.getItem("mori_video_path"));
  add(localStorage.getItem("mori_music_path") || "Music/Mori");
  add("Download/Mori/Music");
  add(localStorage.getItem("mori_photo_path") || "Pictures/Mori");
  add(localStorage.getItem("mori_pdf_path") || "Documents/Mori");
  return folders;
}

export async function scanGallery(force = false) {
  if (activeScanPromise) return activeScanPromise;
  if (!force && galleryItems.length > 0) return galleryItems;

  activeScanPromise = (async () => {
    try {
      const folders = getGalleryScanFolders();
      const tauriInvoke =
        window.__TAURI__?.core?.invoke ||
        window.__TAURI_INTERNALS__?.invoke ||
        window.__TAURI__?.invoke;
      const items = [];
      const seen = new Set();

      // Recursively collect files from directories (handles nested music folders)
      async function collectRecursive(dirPath, directory) {
        try {
          const res = await Filesystem.readdir({ path: dirPath, directory });
          for (const file of res.files || []) {
            if (file.type === "directory") {
              const subPath = dirPath ? `${dirPath}/${file.name}` : file.name;
              await collectRecursive(subPath, directory);
            } else {
              const cat = fileCategory(file.name);
              if (!cat) continue;
              const relPath = (
                dirPath ? `${dirPath}/${file.name}` : file.name
              ).replace(/\/+/g, "/");
              const key = relPath.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              items.push({
                name: file.name,
                path: relPath,
                directory,
                category: cat,
                size: file.size || 0,
                mtime: file.mtime ? new Date(file.mtime).getTime() : 0,
                folder: null,
              });
            }
          }
        } catch (_) {}
      }

      if (tauriInvoke) {
        for (const folder of folders) {
          try {
            const entries = await tauriInvoke("tauri_list_dir", { folder });
            for (const entry of entries || []) {
              const name = entry.name || "";
              const cat = fileCategory(name);
              if (!cat) continue;
              const fullPath = (entry.path || `${folder}/${name}`).replace(
                /\/+/g,
                "/",
              );
              const key = fullPath.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              items.push({
                name,
                path: entry.path || fullPath,
                directory: "DESKTOP",
                category: cat,
                size: entry.size || 0,
                mtime: entry.modified ? entry.modified * 1000 : 0,
                folder: folder,
              });
            }
          } catch (_) {}
        }
      } else if (Filesystem) {
        const dirs = [
          { directory: "EXTERNAL_STORAGE" },
          { directory: "EXTERNAL" },
          { directory: "DOCUMENTS" },
        ];
        for (const folder of folders) {
          for (const dir of dirs) {
            await collectRecursive(folder, dir.directory);
          }
        }
      }

      items.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
      galleryItems = items;
      const validPaths = new Set(items.map((i) => i.path));
      for (const [cachedPath, cachedCard] of cardCache.entries()) {
        if (!validPaths.has(cachedPath)) {
          stopAllMedia(cachedCard);
          cardCache.delete(cachedPath);
        }
      }
      return items;
    } finally {
      activeScanPromise = null;
    }
  })();

  return activeScanPromise;
}

function sortItems(items) {
  const sorted = [...items];
  switch (gallerySort) {
    case "oldest":
      return sorted.sort((a, b) => a.mtime - b.mtime);
    case "name":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "largest":
      return sorted.sort((a, b) => (b.size || 0) - (a.size || 0));
    case "smallest":
      return sorted.sort((a, b) => (a.size || 0) - (b.size || 0));
    default:
      return sorted.sort((a, b) => b.mtime - a.mtime);
  }
}

function filteredItems() {
  let items = galleryItems;
  if (galleryFilter !== "all") {
    items = items.filter(
      (i) =>
        i.category === galleryFilter ||
        (galleryFilter === "pdf" && i.category === "doc"),
    );
  }
  if (galleryQuery) {
    const q = galleryQuery.toLowerCase();
    items = items.filter((i) => i.name.toLowerCase().includes(q));
  }
  return sortItems(items);
}

function galleryFallbackIcon(category) {
  const placeholder = document.createElement("div");
  placeholder.className = "gallery-media-icon";
  const icons = {
    video:
      '<path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>',
    audio:
      '<path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>',
    doc: '<path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>',
  };
  placeholder.innerHTML = `<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">${icons[category] || icons.doc}</svg>`;
  return placeholder;
}

function createVideoThumb(mediaUrl, name) {
  const video = document.createElement("video");
  video.className = "gallery-video-thumb";
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.setAttribute("playsinline", "");
  video.setAttribute("aria-label", name || "video");
  video.style.opacity = "0";
  const canFragment =
    /^(https?|file|asset|tauri):/i.test(mediaUrl) || mediaUrl.startsWith("/");
  video.src = canFragment ? `${mediaUrl}#t=1` : mediaUrl;
  const show = () => {
    video.style.opacity = "1";
  };
  video.addEventListener("loadeddata", () => {
    try {
      const mark = Math.min(1.5, (video.duration || 2) * 0.15);
      if (mark > 0.2 && video.currentTime < mark) video.currentTime = mark;
    } catch (_) {}
    show();
  });
  video.addEventListener("seeked", show);
  video.addEventListener("error", () => {
    video.remove();
  });
  return video;
}

function createPdfThumb() {
  const wrap = document.createElement("div");
  wrap.className = "gallery-pdf-thumb";
  wrap.innerHTML = `
    <div class="gallery-pdf-icon-wrap">
      <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
        <path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm12 4V9c0-.55-.45-1-1-1h-2v6h2c.55 0 1-.45 1-1v-1c0-.55-.45-1-1-1h-1v-2h1c.55 0 1-.45 1-1zm-2 1h1v1h-1v-1z"/>
      </svg>
    </div>
    <span class="gallery-pdf-badge-label">PDF</span>
  `;
  return wrap;
}

function buildItem(item) {
  const card = document.createElement("div");
  card.className = `gallery-item cat-${item.category}`;
  card.setAttribute("data-name", item.name);
  card.setAttribute("data-path", item.path);

  const mediaUrl = toLocalMediaUrl(item.path);
  const thumb = document.createElement("div");
  thumb.className = "gallery-thumb";
  const label = document.createElement("span");
  label.className = "gallery-cat-badge";
  label.textContent = item.category;

  if (item.category === "image") {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.alt = item.name;
    img.style.opacity = "0";
    img.onload = () => {
      img.style.opacity = "1";
    };
    img.onerror = () => {
      img.remove();
    };
    img.src = mediaUrl;
    if (img.complete && img.naturalWidth > 0) img.style.opacity = "1";
    thumb.appendChild(img);
  } else if (item.category === "video") {
    thumb.appendChild(createVideoThumb(mediaUrl, item.name));
    const play = document.createElement("span");
    play.className = "gallery-play-badge";
    play.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    thumb.appendChild(play);
  } else if (item.category === "pdf" || item.category === "doc") {
    thumb.appendChild(createPdfThumb());
  } else {
    thumb.appendChild(galleryFallbackIcon(item.category));
  }
  thumb.appendChild(label);

  const meta = document.createElement("div");
  meta.className = "gallery-meta";
  meta.innerHTML = `
    <h4 title="${esc(item.name)}">${esc(item.name.length > 34 ? item.name.slice(0, 31) + "..." : item.name)}</h4>
    <p>${item.mtime ? new Date(item.mtime).toLocaleDateString([], { dateStyle: "medium" }) : ""}${formatBytes(item.size) ? " · " + formatBytes(item.size) : ""}</p>
  `;
  card.appendChild(thumb);
  card.appendChild(meta);
  card.addEventListener("click", () => openGalleryViewer(item));
  return card;
}

function renderGallery() {
  const page = document.getElementById("galleryPage");
  if (!page) return;
  const empty = page.querySelector(".gallery-empty");
  const grid = page.querySelector(".gallery-grid");
  if (!grid) return;

  grid.querySelectorAll(".gallery-skeleton-card").forEach((s) => s.remove());

  const countEl = page.querySelector(".gallery-count");
  const items = filteredItems();
  if (countEl) {
    countEl.textContent = `${items.length} ${t("gallery-count-items")}`;
  }

  if (items.length === 0) {
    stopAllMedia(grid);
    grid.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");

  const itemPathSet = new Set(items.map((i) => i.path));

  // Remove cards not present in current filtered items
  grid.querySelectorAll(".gallery-item").forEach((card) => {
    const p = card.getAttribute("data-path");
    if (!itemPathSet.has(p)) {
      stopAllMedia(card);
      card.remove();
    }
  });

  // Reorder and append cards without destroying existing DOM nodes
  const frag = document.createDocumentFragment();
  items.forEach((item) => {
    let card = cardCache.get(item.path);
    if (!card) {
      card = buildItem(item);
      cardCache.set(item.path, card);
    }
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

export function renderGallerySkeleton() {
  const page = document.getElementById("galleryPage");
  const grid = page?.querySelector(".gallery-grid");
  const empty = page?.querySelector(".gallery-empty");
  if (!grid) return;
  empty?.classList.add("hidden");
  grid.innerHTML = `
    <div class="gallery-skeleton-card"><div class="gallery-skeleton-thumb"></div><div class="gallery-skeleton-meta"><div class="gallery-skeleton-line title"></div><div class="gallery-skeleton-line short"></div></div></div>
    <div class="gallery-skeleton-card"><div class="gallery-skeleton-thumb"></div><div class="gallery-skeleton-meta"><div class="gallery-skeleton-line title"></div><div class="gallery-skeleton-line short"></div></div></div>
    <div class="gallery-skeleton-card"><div class="gallery-skeleton-thumb"></div><div class="gallery-skeleton-meta"><div class="gallery-skeleton-line title"></div><div class="gallery-skeleton-line short"></div></div></div>
    <div class="gallery-skeleton-card"><div class="gallery-skeleton-thumb"></div><div class="gallery-skeleton-meta"><div class="gallery-skeleton-line title"></div><div class="gallery-skeleton-line short"></div></div></div>
    <div class="gallery-skeleton-card"><div class="gallery-skeleton-thumb"></div><div class="gallery-skeleton-meta"><div class="gallery-skeleton-line title"></div><div class="gallery-skeleton-line short"></div></div></div>
    <div class="gallery-skeleton-card"><div class="gallery-skeleton-thumb"></div><div class="gallery-skeleton-meta"><div class="gallery-skeleton-line title"></div><div class="gallery-skeleton-line short"></div></div></div>
  `;
}

export function renderGalleryToolbar() {
  const page = document.getElementById("galleryPage");
  if (!page) return;
  const chips = page.querySelectorAll(".gallery-chip");
  chips.forEach((chip) => {
    chip.classList.toggle(
      "active",
      chip.getAttribute("data-filter") === galleryFilter,
    );
  });
  const sortText = page.querySelector("#gallerySortText");
  const sortItems = page.querySelectorAll(".gallery-sort-item");
  sortItems.forEach((item) => {
    const isAct = item.getAttribute("data-value") === gallerySort;
    item.classList.toggle("active", isAct);
    if (isAct && sortText) {
      sortText.textContent = item.textContent.trim();
    }
  });
  const searchInput = page.querySelector(".gallery-search");
  if (searchInput && searchInput.value !== galleryQuery) {
    searchInput.value = galleryQuery;
  }
}

function openFileExternal(item) {
  const rawPath = item.path || "";
  // 1. Android Native Bridge
  if (window.MoriMainBridge?.openFile) {
    try {
      if (window.MoriMainBridge.openFile(rawPath)) return;
    } catch (_) {}
  }
  // 2. Desktop Tauri
  const tauriInvoke =
    window.__TAURI__?.core?.invoke ||
    window.__TAURI_INTERNALS__?.invoke ||
    window.__TAURI__?.invoke;
  if (tauriInvoke) {
    try {
      tauriInvoke("tauri_open_folder", { path: rawPath });
      return;
    } catch (_) {}
  }
  // 3. Fallback
  const url = toLocalMediaUrl(rawPath);
  if (url) {
    window.open(url, "_blank");
  }
}

async function fetchPdfBytes(item) {
  const tauriInvoke =
    window.__TAURI__?.core?.invoke ||
    window.__TAURI_INTERNALS__?.invoke ||
    window.__TAURI__?.invoke;
  if (tauriInvoke && item.path) {
    try {
      const bytes = await tauriInvoke("tauri_read_file_bytes", {
        path: item.path,
      });
      if (bytes && bytes.length > 0) return new Uint8Array(bytes);
    } catch (_) {}
  }

  const url = toLocalMediaUrl(item.path);
  if (url) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buf = await res.arrayBuffer();
        if (buf && buf.byteLength > 0) return new Uint8Array(buf);
      }
    } catch (_) {}
  }

  if (
    window.Capacitor?.isNativePlatform?.() &&
    window.Capacitor.Plugins?.Filesystem
  ) {
    const { Filesystem } = window.Capacitor.Plugins;
    let clean = item.path
      .replace(/^.*\/storage\/emulated\/0\//, "")
      .replace(/^\//, "");
    try {
      clean = decodeURIComponent(clean);
    } catch (_) {}
    const dirs = ["EXTERNAL_STORAGE", "DOCUMENTS", "EXTERNAL"];
    for (const d of dirs) {
      try {
        const res = await Filesystem.readFile({ path: clean, directory: d });
        if (res && res.data) {
          const bin = atob(res.data);
          const len = bin.length;
          const u8 = new Uint8Array(len);
          for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
          return u8;
        }
      } catch (_) {}
    }
  }

  throw new Error("Unable to read PDF file data");
}

function renderPdfInViewer(body, item, overlay, header) {
  body.classList.add("pdf-mode");

  const extBtn = document.createElement("button");
  extBtn.className = "gallery-viewer-external-btn";
  extBtn.setAttribute("type", "button");
  extBtn.setAttribute(
    "title",
    t("gallery-open-file") || "Open PDF in external app",
  );
  extBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
    </svg>
  `;
  extBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openFileExternal(item);
  });
  header.appendChild(extBtn);

  const container = document.createElement("div");
  container.className = "gallery-pdf-viewer";
  container.innerHTML = `
    <div class="gallery-pdf-loading">
      <div class="gallery-pdf-spinner"></div>
      <span>${t("gallery-pdf-loading") || "Loading PDF..."}</span>
    </div>
  `;
  body.appendChild(container);

  let isDestroyed = false;
  let pdfDoc = null;
  let observer = null;

  overlay._pdfCleanup = () => {
    isDestroyed = true;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (pdfDoc) {
      try {
        pdfDoc.destroy();
      } catch (_) {}
      pdfDoc = null;
    }
  };

  (async () => {
    try {
      if (!window.pdfjsLib) {
        throw new Error("PDF renderer not available");
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "js/vendor/pdf.worker.min.js";

      const bytes = await fetchPdfBytes(item);
      if (isDestroyed) return;

      const loadingTask = window.pdfjsLib.getDocument({
        data: bytes,
        cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/",
        cMapPacked: true,
      });

      pdfDoc = await loadingTask.promise;
      if (isDestroyed) {
        pdfDoc.destroy();
        return;
      }

      container.innerHTML = "";

      const subTitle = header.querySelector(".gallery-viewer-title p");
      if (subTitle) {
        subTitle.textContent = `${pdfDoc.numPages} ${t("gallery-pdf-pages") || "pages"} · ${formatBytes(item.size)}`;
      }

      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const wrap = document.createElement("div");
        wrap.className = "gallery-pdf-page-wrap";
        wrap.dataset.page = String(pageNum);

        const badge = document.createElement("div");
        badge.className = "gallery-pdf-page-indicator";
        badge.textContent = `${pageNum} / ${pdfDoc.numPages}`;
        wrap.appendChild(badge);

        const canvas = document.createElement("canvas");
        canvas.className = "gallery-pdf-canvas";
        wrap.appendChild(canvas);

        container.appendChild(wrap);
      }

      const renderPage = async (pageNum, canvas, wrap) => {
        if (canvas._rendered || canvas._rendering || isDestroyed) return;
        canvas._rendering = true;
        try {
          const page = await pdfDoc.getPage(pageNum);
          if (isDestroyed) return;

          const containerWidth =
            Math.min(container.clientWidth - 24, 680) || 360;
          const unscaledViewport = page.getViewport({ scale: 1 });
          const scale = containerWidth / unscaledViewport.width;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale: scale * dpr });

          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${containerWidth}px`;
          canvas.style.height = `${unscaledViewport.height * scale}px`;
          wrap.style.minHeight = `${unscaledViewport.height * scale}px`;

          const ctx = canvas.getContext("2d", { alpha: false });
          const renderContext = {
            canvasContext: ctx,
            viewport: viewport,
          };
          await page.render(renderContext).promise;
          canvas._rendered = true;
        } catch (err) {
          if (!isDestroyed) console.warn(`Render page ${pageNum} error:`, err);
        } finally {
          canvas._rendering = false;
        }
      };

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const wrap = entry.target;
              const pNum = parseInt(wrap.dataset.page, 10);
              const c = wrap.querySelector("canvas");
              if (c) renderPage(pNum, c, wrap);
            }
          });
        },
        { root: container, rootMargin: "350px 0px" },
      );

      container.querySelectorAll(".gallery-pdf-page-wrap").forEach((wrap) => {
        observer.observe(wrap);
      });
    } catch (err) {
      if (isDestroyed) return;
      console.error("PDF viewer load failed:", err);
      container.innerHTML = `
        <div class="gallery-doc-card">
          <div class="gallery-doc-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
              <path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm12 4V9c0-.55-.45-1-1-1h-2v6h2c.55 0 1-.45 1-1v-1c0-.55-.45-1-1-1h-1v-2h1c.55 0 1-.45 1-1zm-2 1h1v1h-1v-1z"/>
            </svg>
          </div>
          <h4 class="gallery-doc-title" title="${esc(item.name)}">${esc(item.name)}</h4>
          <p class="gallery-doc-size">${formatBytes(item.size)}</p>
          <button class="gallery-doc-open-btn" type="button">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
            </svg>
            <span>${t("gallery-open-file") || "Open in External App"}</span>
          </button>
        </div>
      `;
      const btn = container.querySelector(".gallery-doc-open-btn");
      btn?.addEventListener("click", () => openFileExternal(item));
    }
  })();
}

function openGalleryViewer(item) {
  pauseAllMedia(document);
  const overlay = document.createElement("div");
  overlay.className = "gallery-viewer";

  const header = document.createElement("div");
  header.className = "gallery-viewer-header";
  header.innerHTML = `
    <button class="gallery-viewer-back" aria-label="Back">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
    </button>
    <div class="gallery-viewer-title">
      <h3 title="${esc(item.name)}">${esc(item.name)}</h3>
      <p>${esc(item.path)}</p>
    </div>
  `;

  const body = document.createElement("div");
  body.className = "gallery-viewer-body";

  const mediaUrl = toLocalMediaUrl(item.path);

  if (item.category === "image") {
    const img = document.createElement("img");
    img.src = mediaUrl;
    img.referrerPolicy = "no-referrer";
    body.appendChild(img);
  } else if (item.category === "pdf" || item.category === "doc") {
    renderPdfInViewer(body, item, overlay, header);
  } else {
    if (item.category === "audio") {
      body.classList.add("audio-mode");
    }
    const player = createVideoPlayer(
      {
        url: mediaUrl,
        rawUri: item.path,
        rawPath: item.path,
        type: item.category === "audio" ? "AUDIO" : "VIDEO",
        isLocal: true,
        filename: item.name,
        title: item.name,
      },
      0,
      null,
    );
    player.style.maxHeight = "100%";
    player.style.height = "100%";
    player.style.width = "100%";
    body.appendChild(player);
    const autoPlay = localStorage.getItem("mori_autoplay") !== "false";
    if (autoPlay && typeof player._tryAutoPlay === "function") {
      player._tryAutoPlay();
    }
  }

  const info = document.createElement("div");
  info.className = "gallery-viewer-info";
  info.innerHTML = `
    <span>${item.mtime ? new Date(item.mtime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""}</span>
    ${formatBytes(item.size) ? `<span>${formatBytes(item.size)}</span>` : ""}
  `;

  overlay.appendChild(header);
  overlay.appendChild(body);
  overlay.appendChild(info);
  document.body.appendChild(overlay);

  const close = () => {
    overlay._pdfCleanup?.();
    pauseAllMedia(overlay);
    const player = overlay.querySelector(".mori-player-container");
    if (player && typeof player._cleanup === "function") player._cleanup();
    overlay.querySelectorAll("video, audio").forEach((el) => {
      try {
        el._isStopped = true;
        el.pause();
        if (el.src && el.src.startsWith("blob:")) URL.revokeObjectURL(el.src);
        el.removeAttribute("src");
        el.load();
      } catch (_) {}
    });
    overlay.remove();
  };

  overlay._close = close;
  header.querySelector(".gallery-viewer-back").addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  overlay._onKeyRemove = () => document.removeEventListener("keydown", onKey);
  const origRemove = overlay.remove.bind(overlay);
  overlay.remove = () => {
    overlay._pdfCleanup?.();
    overlay._onKeyRemove?.();
    origRemove();
  };
}

function areItemsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].path !== b[i].path ||
      a[i].size !== b[i].size ||
      a[i].mtime !== b[i].mtime
    ) {
      return false;
    }
  }
  return true;
}

export function invalidateGalleryCache() {
  cardCache.clear();
  galleryItems = [];
  galleryNeedsRescan = true;
  const page = document.getElementById("galleryPage");
  const grid = page?.querySelector(".gallery-grid");
  if (grid) {
    stopAllMedia(grid);
    grid.innerHTML = "";
  }
}

export function initGallery() {
  const page = document.getElementById("galleryPage");
  if (!page || page._galleryInit) return;
  page._galleryInit = true;

  page.querySelector(".gallery-rescan")?.addEventListener("click", async () => {
    if (activeScanPromise) return;
    const btn = page.querySelector(".gallery-rescan");
    if (btn) btn.classList.add("scanning");
    try {
      cardCache.clear();
      await scanGallery(true);
      galleryNeedsRescan = false;
      renderGallery();
      showToast(t("gallery-rescan-done"));
    } finally {
      if (btn) btn.classList.remove("scanning");
    }
  });

  // Auto-refresh when download completes without wiping UI into skeletons
  const handleDownloadUpdate = () => {
    galleryNeedsRescan = true;
    const p = document.getElementById("galleryPage");
    if (p && !p.classList.contains("hidden")) {
      const prev = [...galleryItems];
      scanGallery(true).then((items) => {
        galleryNeedsRescan = false;
        if (!areItemsEqual(prev, items)) renderGallery();
      });
    }
  };

  window.addEventListener("mori_download_ended", handleDownloadUpdate);
  window.addEventListener("mori_file_saved", handleDownloadUpdate);
  window.addEventListener("mori_app_resumed", handleDownloadUpdate);

  page.querySelectorAll(".gallery-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      galleryFilter = chip.getAttribute("data-filter") || "all";
      renderGalleryToolbar();
      renderGallery();
    });
  });

  const sortSelect = page.querySelector("#gallerySortSelect");
  const sortMenu = page.querySelector("#gallerySortMenu");

  sortSelect?.addEventListener("click", (e) => {
    e.stopPropagation();
    sortMenu?.classList.toggle("hidden");
    sortSelect.classList.toggle(
      "active",
      !sortMenu?.classList.contains("hidden"),
    );
  });

  page.querySelectorAll(".gallery-sort-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      gallerySort = item.getAttribute("data-value") || "newest";
      sortMenu?.classList.add("hidden");
      sortSelect?.classList.remove("active");
      renderGalleryToolbar();
      renderGallery();
    });
  });

  document.addEventListener("click", () => {
    if (sortMenu && !sortMenu.classList.contains("hidden")) {
      sortMenu.classList.add("hidden");
      sortSelect?.classList.remove("active");
    }
  });

  const searchInput = page.querySelector(".gallery-search");
  searchInput?.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      galleryQuery = searchInput.value.trim();
      renderGallery();
    }, 150);
  });
}

export function refreshGalleryPage() {
  initGallery();
  renderGalleryToolbar();
  const page = document.getElementById("galleryPage");
  const grid = page?.querySelector(".gallery-grid");
  const hasRealCards = grid && grid.querySelector(".gallery-item");

  if (galleryItems.length === 0 && !hasRealCards) {
    renderGallerySkeleton();
    scanGallery(true).then(() => {
      galleryNeedsRescan = false;
      renderGallery();
    });
  } else {
    if (!hasRealCards) {
      renderGallery();
    }
    const prev = [...galleryItems];
    scanGallery(true).then((items) => {
      galleryNeedsRescan = false;
      if (!areItemsEqual(prev, items)) {
        renderGallery();
      }
    });
  }
}
