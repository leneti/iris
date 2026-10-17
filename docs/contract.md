# Iris contract

Contract version: **1**.

This document describes everything an operator can set or depend on: container labels, the two YAML config files, environment variables and the JSON endpoints. A change to any of them that is not backward compatible raises the contract version (see `AGENTS.md`).

## Which Iris version understands which labels

| Iris version | Contract version | Understands                                                                                                                  |
| ------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `v0.1.0`     | 1                | All labels, config keys, environment variables and endpoints below                                                           |
| `v0.2.0`     | 1                | Adds the optional `iris.yaml` keys `hidden` and `addresses`, and the optional `hidden` field of a service in `/api/services` |

## Container labels

Labels are read from Docker containers. Labels never hold credentials.

| Label                | Type                                                                                               | Default                                                         | Example                            |
| -------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------- |
| `iris.enable`        | `true` or `false`                                                                                  | `false`                                                         | `true`                             |
| `iris.name`          | string, up to 40 chars                                                                             | Title-cased Compose service name                                | `Radarr`                           |
| `iris.group`         | string, up to 32 chars                                                                             | `Other`                                                         | `Automation`                       |
| `iris.icon`          | slug, `local:<file>` or `lucide:<name>`                                                            | Fallback chain: slug from the service name, then a generic icon | `radarr`                           |
| `iris.url`           | absolute http(s) URL, or `none`                                                                    | Derived from the Traefik router, https                          | `https://plex.example.invalid/web` |
| `iris.router`        | Traefik router name                                                                                | Router named like the Compose service, else the only router     | `qbittorrent`                      |
| `iris.lan.port`      | integer 1-65535, or `none`                                                                         | The container's published TCP host port, if it has exactly one  | `8080`                             |
| `iris.lan.path`      | path starting with `/`                                                                             | `/`                                                             | `/web`                             |
| `iris.embed`         | `auto`, `true` or `false`                                                                          | `auto`                                                          | `false`                            |
| `iris.widget`        | `seerr`, `tautulli`, `radarr`, `sonarr`, `prowlarr`, `autobrr`, `gotify`, `qbittorrent`, or `none` | `none`                                                          | `radarr`                           |
| `iris.widget.url`    | internal http URL                                                                                  | The service's route through Traefik, as the health probe uses   | `http://tautulli:8181`             |
| `iris.widget.fields` | comma-separated field keys, up to 4                                                                | The type's default fields                                       | `wanted,missing,movies`            |
| `iris.order`         | integer                                                                                            | `100`                                                           | `10`                               |
| `iris.description`   | string, up to 80 chars                                                                             | empty                                                           | `Movies`                           |
| `iris.keywords`      | comma-separated, up to 10                                                                          | empty                                                           | `tv,series`                        |
| `iris.health.url`    | internal http URL, or `none`                                                                       | Through Traefik                                                 | `http://tautulli:8181/`            |
| `iris.health.path`   | path starting with `/`                                                                             | `/`                                                             | `/ping`                            |

Rules:

- Invalid values are ignored with a warning in `/api/services`; the entry still renders with defaults.
- `iris.url` and `iris.widget.url` must be http(s) URLs with a host name. A value whose host is an IP address (IPv4, IPv6 or a numeric form such as `0x7f.1`), or that embeds credentials (`user:password@`), or is longer than 2048 characters, is refused like any invalid value: ignored with a warning, never used and never shown.
- `iris.url=none` means the service has no public address. With no LAN port either, it is a health-only entry with no link.
- `iris.lan.port` is the host port where the app answers plain HTTP on the home network. It is used only when Iris itself is opened over plain HTTP outside the zone. No label ever holds an IP address.
- `iris.embed=false` opens the service in a new browser tab instead of an iframe tab. `true` forces an iframe even if the probe says blocked.
- The service id is the Compose service name. It keys tabs, deep links and icon lookups.

## Config files

Two YAML files in `IRIS_CONFIG_DIR` (default `/config`), both validated with zod. Both start with `version: 1`. Complete examples with placeholder data are in [`examples/iris.yaml`](../examples/iris.yaml) and [`examples/services.yaml`](../examples/services.yaml).

`iris.yaml` keys:

| Key                               | Purpose                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`, `defaultGroup`, `groups` | Page title, group for entries without one, and the ordered groups with their icons                                                                                                                         |
| `cron`                            | `timezone`, `staleAfterMinutes`, `graceMinutes`, and optional per-job overrides in `jobs` (`match`, `schedule`, `label`, `graceMinutes`)                                                                   |
| `maintenance`                     | Fallback schedules for the backup and updater rows (`id`, `name`, `schedule`, `label`, `graceMinutes`)                                                                                                     |
| `system`                          | Glances `url`, `interface`, `sensor`, `disks` (mount and label) and `thresholds` (`warn`, `bad`)                                                                                                           |
| `streams`                         | Tautulli `url` and `showUsers`                                                                                                                                                                             |
| `phone`                           | `maxLiveFrames` (3; 8 on wider screens)                                                                                                                                                                    |
| `weather`                         | Open-Meteo `label`, `latitude`, `longitude`, `timezone`, `units`, `refreshMinutes`. Coordinates stay on the server. Leave the block out for no weather                                                     |
| `links`                           | Bookmarks (`name`, `abbr`, `url`), http or https only. `{zone}` is replaced from `IRIS_ZONE`                                                                                                               |
| `hidden`                          | Service ids left off the Overview, the sidebar and the Services list. They stay in search, and their health still counts and raises alerts. An unknown id gives a `HIDDEN_UNKNOWN` warning. Since `v0.2.0` |
| `addresses`                       | `auto` (default): opened outside the zone, Iris frames services at their LAN port. `public`: it uses the public address whenever a service has one, and the LAN port only otherwise. Since `v0.2.0`        |
| `widgets`                         | `refreshSeconds` per integration, and `standalone` tiles that belong to no container (for example a `coinmarketcap` tile)                                                                                  |

`services.yaml` is a fallback for services that cannot carry labels: a list of `services`, each with `id`, `name`, `group`, `icon`, optional `description`, `container` (health from Docker), `url` (or `none`), `embed` and `widget: { type }`. `{zone}` is replaced from `IRIS_ZONE`.

## Environment variables

| Variable                                                                                                             | Meaning                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IRIS_ALLOWED_HOSTS`                                                                                                 | Comma-separated `host[:port]` values Iris answers. **Required**: when unset or empty every request gets 400                                                             |
| `IRIS_ZONE`                                                                                                          | DNS zone used to fill `{zone}` and to derive addresses                                                                                                                  |
| `IRIS_DOCKER_URL`                                                                                                    | Docker API base (a read-only socket proxy)                                                                                                                              |
| `IRIS_DOCKER_API_VERSION`                                                                                            | Docker API version, default `1.52`                                                                                                                                      |
| `IRIS_TRAEFIK_URL`                                                                                                   | Traefik base used for probes and router lookup                                                                                                                          |
| `IRIS_CRON_STATUS_URL`                                                                                               | Cron status endpoint                                                                                                                                                    |
| `IRIS_HOST_STATUS_FILE`                                                                                              | Path of the host status JSON file                                                                                                                                       |
| `IRIS_ICONS_BASE`                                                                                                    | Base URL of the dashboard-icons set, pinned to a commit, for example `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@f1d048d9885b97a7319e0a51e508217459f212df` |
| `IRIS_CONFIG_DIR`                                                                                                    | Config folder, default `/config`                                                                                                                                        |
| `IRIS_CACHE_DIR`                                                                                                     | Cache folder, default `/cache`                                                                                                                                          |
| `IRIS_SEERR_KEY`, `IRIS_TAUTULLI_KEY`, `IRIS_RADARR_KEY`, `IRIS_SONARR_KEY`, `IRIS_PROWLARR_KEY`, `IRIS_AUTOBRR_KEY` | API keys for the integrations                                                                                                                                           |
| `IRIS_QBITTORRENT_USERNAME`, `IRIS_QBITTORRENT_PASSWORD`                                                             | qBittorrent sign-in                                                                                                                                                     |
| `IRIS_CLOUDFLARE_ACCOUNT_ID`, `IRIS_CLOUDFLARE_TUNNEL_ID`, `IRIS_CLOUDFLARE_TOKEN`                                   | Cloudflare tunnel status                                                                                                                                                |
| `IRIS_COINMARKETCAP_KEY`                                                                                             | CoinMarketCap key                                                                                                                                                       |
| `IRIS_GOTIFY_TOKEN`                                                                                                  | Gotify token                                                                                                                                                            |

An empty credential means "not configured": that integration is off. Credentials are sent upstream in headers only and never appear in a URL, a log line or a response.

## Endpoints

All endpoints are `GET` only and return JSON. [`lib/shared/contract.ts`](../lib/shared/contract.ts) holds the zod schemas and types and is the source of truth for every field; this section only summarises.

| Endpoint                                          | Returns                                                                                                                                                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/healthz`                                    | `{ "ok": true }`, for container health checks                                                                                                                                                                                                       |
| `/api/services`                                   | `generatedAt`, `sources`, `groups` (each with its `services`: id, name, group, description, keywords, order, `icon`, `url`, `urlSource`, `lan`, `embed`, `container`, `discovery`, and `hidden: true` when listed in `hidden`), `links`, `warnings` |
| `/api/status`                                     | `generatedAt`, `docker` (`ok` or `unreachable`), `services` keyed by id (`status`, `docker`, `http`, `changedAt`), `summary` counts                                                                                                                 |
| `/api/cron`                                       | `generatedAt`, `timezone`, `sources`, `jobs` (id, name, kind, `schedule`, `lastRun`, `result`, `summary`, `link`, `previousDue`, `nextDue`, `flag`), `summary` counts                                                                               |
| `/api/system`                                     | `generatedAt`, `source`, `cpu`, `memory`, `disks`, `network`, `temperature`, `uptimeSeconds`                                                                                                                                                        |
| `/api/streams`                                    | `generatedAt`, `source`, `streamCount`, `transcodeCount`, `totalBitsPerSec`, `sessions`                                                                                                                                                             |
| `/api/widgets`                                    | `generatedAt`, `services` keyed by id, `standalone` tiles, `weather`                                                                                                                                                                                |
| `/api/icons/di/<slug>`, `/api/icons/local/<file>` | An icon image (proxied and cached); `src` values in `/api/services` point here. A `di` slug is served only while the current service list references it; any other slug is a 404, with no outbound request                                          |

Status values are `healthy`, `starting`, `degraded`, `unhealthy`, `stopped` and `unknown`. Cron flags are `ok`, `warning`, `overdue`, `failed` and `unknown`.

The browser never receives raw labels, mounts, commands, environment, container ids or addresses, credentials, or upstream free text.

### Host status file

`IRIS_HOST_STATUS_FILE` points at a JSON file with `version: 1`, `generatedAt`, `timezone`, `userJobs`, `unmatchedCrontabLines`, `backup` and `updater` (see `HostStatusFile` in `lib/shared/contract.ts`). `backup.nextRun` and `updater.nextRun` may be `null`; Iris then computes the next due time from the schedule. Iris ignores the file when `generatedAt` is older than 15 minutes. The file is produced by `host/media-status-export.ts`, run by a systemd user timer (units in `host/`).
