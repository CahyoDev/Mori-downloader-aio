# Changelog

All notable changes to the Mori CLI (`@coflyn/mori`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-10-18

### Added
- **TikTok `tt.site` Smart Link Support**: Recognize and resolve `tt.site` shortlinks and marketing redirect URLs automatically in CLI platform detection and scraper pipeline.

### Changed
- **Scraper Engine Update**: Synced bundled scraper runtime to `scraperVersion: 5`.

## [1.0.0] - 2026-10-16

### Added
- **Initial Release** of Mori CLI (`@coflyn/mori`).
- **16 Supported Platforms**: Universal extraction for TikTok, Instagram, YouTube, Douyin, Pinterest, RedNote (Xiaohongshu), Spotify, Pixiv, Twitter/X, Reddit, Threads, Bilibili, Facebook, Apple Music, Bandcamp, and TeraBox.
- **Dual Operating Modes**:
  - Direct execution with command-line arguments: `mori <url> [options]`.
  - Interactive terminal UI powered by `@clack/prompts` with dynamic spinners.
- **21 Built-in Slash Commands**: Complete control with `/help`, `/update`, `/batch`, `/config`, `/logs`, `/benchmark`, `/inspect`, `/history`, `/platforms`, `/about`, and short aliases.
- **Concurrent Album Downloader**: Parallel worker pool (5 concurrent downloads) for photo slide albums with single-row in-place progress tracking.
- **Zero-Dependency PDF Generator**: Pure Node.js binary JPEG parser and PDF compiler for photo slide albums and manga chapters without external native bindings.
- **Hot OTA Scraper Engine Updates**: Update scraper rules directly from GitHub OTA patches via `/update` without needing to reinstall the npm package.
- **Automatic NPM Version Checker**: Non-blocking startup registry check alerting users whenever a newer CLI release is published.
- **Smart Anti-Bot Fallbacks**: Native curl fallback and custom header spoofing to bypass Cloudflare and bot checks.
