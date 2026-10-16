#!/usr/bin/env bash
# Pre-push privacy scan for the public repo.
#
# Usage: scripts/privacy-scan.sh [ref]     (ref defaults to HEAD)
#
# Scans every tracked file (working tree) and the full history of the given ref
# (`git log -p`, which includes commit messages) for:
#   zone      the registrable zone, read from a running container's Traefik router rule
#   lan-ip    the first IPv4 from `hostname -I`
#   hostname  the short hostname (`hostname -s`), whole word, case-insensitive
#   ipv4      dotted quads outside 0.0.0.0, 127.0.0.0/8 and the documentation ranges
#             192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
#   ipv6      addresses outside ::, ::1 and 2001:db8::/32 (must follow start, space, quote, [, = or ,
#             so regex fragments such as "(?::00)" do not count)
#   token     32+ characters of [A-Za-z0-9_+/=-] that contain a digit and a letter,
#             minus: sha512-/sha256: integrity strings, 40-hex git SHA pins, 64-hex digests and
#             all-lowercase URL/file paths (contain "/", only [a-z0-9_-])
#   geo       latitude/longitude assigned a value whose absolute value is 1 or more; values
#             within 1 degree of 0,0 are open ocean and are allowed
#
# yarn.lock is skipped for ipv4 and token only (package versions look like quads
# and its integrity strings look like tokens); it is still scanned for zone, lan-ip,
# hostname, ipv6 and geo. Binary files are skipped.
#
# The zone, the IP and the hostname live in variables and are never printed. Output is
# category names, counts and (working tree only) file names. If the zone or the LAN IP
# cannot be determined the scan prints "zone: not found" / "lan-ip: not found" and exits 1.
# Exit 0 only when every count is 0.
# shellcheck disable=SC2329 # the x_* extractors are called indirectly
set -euo pipefail
export LC_ALL=C

cd "$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
REF=${1:-HEAD}

# ---- inputs (never echoed) -------------------------------------------------
zone=""
host_rule=$(
  # shellcheck disable=SC2016 # the backtick is part of the Traefik Host(`...`) syntax
  docker ps -q 2>/dev/null | while read -r id; do
    docker inspect --format '{{range $k,$v := .Config.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}' "$id" 2>/dev/null
  done | grep -E '^traefik\.http\.routers\.[^=]*\.rule=' | grep -oP 'Host\(`\K[^`]+' | head -n 1 || true
)
if [ -n "$host_rule" ]; then
  IFS=. read -r -a parts <<<"$host_rule"
  n=${#parts[@]}
  if [ "$n" -ge 2 ]; then
    take=2
    if [ "$n" -ge 3 ] && [ "${#parts[n - 1]}" -eq 2 ] && [[ ${parts[n - 2]} =~ ^(co|com|org|net|gov|ac)$ ]]; then take=3; fi
    zone=$(IFS=.; echo "${parts[*]: -take}")
  fi
fi
lan_ip=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}$' | head -n 1 || true)
short_host=$(hostname -s 2>/dev/null || true)

missing=0
if [ -z "$zone" ]; then echo "zone: not found"; missing=1; fi
if [ -z "$lan_ip" ]; then echo "lan-ip: not found"; missing=1; fi
if [ -z "$short_host" ]; then echo "hostname: not found"; missing=1; fi
if [ "$missing" -ne 0 ]; then exit 1; fi

# The x_* functions are called indirectly as "x_$c".
# ---- extractors: read text on stdin, write one line per hit -----------------
x_zone() { grep -oiF -e "$zone" || true; }
x_lan_ip() { grep -oF -e "$lan_ip" || true; }
x_hostname() { grep -oiwF -e "$short_host" || true; }
x_ipv4() {
  grep -oP '(?<![\w.-])(?:\d{1,3}\.){3}\d{1,3}(?![\w.-])' |
    grep -vE '^(0\.0\.0\.0|127\.[0-9]+\.[0-9]+\.[0-9]+|192\.0\.2\.[0-9]+|198\.51\.100\.[0-9]+|203\.0\.113\.[0-9]+)$' || true
}
x_ipv6() {
  grep -oiP '(?<![^\s"'"'"'\[=,])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})|[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6}::)(?![\w:])' |
    grep -viE '^(::1|2001:0?db8:.*)$' || true
}
x_token() {
  grep -oP '[A-Za-z0-9_+/=-]{32,}' |
    grep -E '[0-9]' | grep -E '[A-Za-z]' |
    grep -vE '^(sha512-|sha256-|sha1-)' |
    grep -vE '^[0-9a-f]{40}$|^[0-9a-f]{64}$' |
    grep -vE '^[a-z0-9_-]*/[a-z0-9_/-]*$' || true
}
x_geo() { grep -oiP '(?:latitude|longitude)["'"'"']?\s*[:=]\s*["'"'"']?-?0*[1-9][0-9]*' || true; }

categories=(zone lan_ip hostname ipv4 ipv6 token geo)
skip_lock=" ipv4 token " # categories that skip yarn.lock

declare -A wt_count hist_count
declare -A wt_files
for c in "${categories[@]}"; do wt_count[$c]=0; hist_count[$c]=0; wt_files[$c]=""; done

# ---- working tree ------------------------------------------------------------
while IFS= read -r -d '' f; do
  [ -f "$f" ] || continue
  grep -Iq . "$f" 2>/dev/null || continue
  for c in "${categories[@]}"; do
    if [ "$f" = yarn.lock ] && [[ $skip_lock == *" $c "* ]]; then continue; fi
    k=$("x_$c" <"$f" | wc -l)
    if [ "$k" -gt 0 ]; then
      wt_count[$c]=$((wt_count[$c] + k))
      wt_files[$c]+="$f ($k)"$'\n'
    fi
  done
done < <(git ls-files -z)

# ---- history (all of $REF, patches and commit messages) -------------------
# Only added/removed lines, context lines and commit message lines are scanned for tokens
# (commit and index lines carry SHAs, diff headers carry paths, and the Claude-Session
# trailer carries a public session id).
hist=$(mktemp)
trap 'rm -f "$hist"' EXIT
git log -p --format=fuller "$REF" >"$hist"
for c in "${categories[@]}"; do
  if [ "$c" = token ]; then
    k=$(grep -vE '^(commit |index |diff --git |--- |\+\+\+ )|^ *Claude-Session: ' "$hist" | x_token | wc -l)
  elif [ "$c" = ipv4 ]; then
    k=$(grep -vE '^(commit |index )' "$hist" | x_ipv4 | wc -l)
  else
    k=$("x_$c" <"$hist" | wc -l)
  fi
  hist_count[$c]=$k
done
# History is scanned as one stream, so yarn.lock patches count towards ipv4/token there;
# subtract nothing: any history hit must be inspected by the owner.

# ---- report ------------------------------------------------------------------
total=0
echo "privacy scan of $REF"
for c in "${categories[@]}"; do
  label=${c//_/-}
  echo "$label: working-tree ${wt_count[$c]}, history ${hist_count[$c]}"
  if [ -n "${wt_files[$c]}" ]; then printf '%s' "${wt_files[$c]}" | sed 's/^/  file: /'; fi
  total=$((total + wt_count[$c] + hist_count[$c]))
done
if [ "$total" -eq 0 ]; then echo "result: clean"; exit 0; fi
echo "result: $total hit(s)"
exit 1
