#!/usr/bin/env bash
# Reproducible full-clip GIF export. This does not generate or redraw artwork.
# Usage: ./export-gif.sh INPUT.mp4 OUTPUT.gif [SQUARE_SIZE=1024] [FPS=20]
# A source that is not already seamless remains non-seamless: no trim, reverse,
# crossfade, artificial end hold, or first-frame replacement is introduced.
set -euo pipefail

usage() {
  printf 'Usage: %s INPUT.mp4 OUTPUT.gif [SQUARE_SIZE=1024] [FPS=20]\n' "$0" >&2
}

if (( $# < 2 || $# > 4 )); then usage; exit 64; fi
input=$1
output=$2
size=${3:-1024}
fps=${4:-20}
max_bytes=12582912 # Existing application's 12 MiB image ceiling.

if [[ ! "$size" =~ ^[0-9]+$ ]] || (( size < 128 || size > 4096 )); then
  printf 'SQUARE_SIZE must be an integer between 128 and 4096.\n' >&2
  exit 64
fi
if [[ ! "$fps" =~ ^[0-9]+$ ]] || (( fps < 1 || fps > 50 )); then
  printf 'FPS must be an integer between 1 and 50. GIF timing uses centiseconds; 20 or 25 gives exact frame delays.\n' >&2
  exit 64
fi
if [[ ! -f "$input" ]]; then printf 'Input file does not exist: %s\n' "$input" >&2; exit 66; fi
if [[ -e "$output" ]]; then printf 'Output already exists; choose a new filename: %s\n' "$output" >&2; exit 73; fi
if [[ ! -d "$(dirname -- "$output")" ]]; then printf 'Output directory does not exist.\n' >&2; exit 73; fi
for tool in ffmpeg ffprobe; do
  if ! command -v "$tool" >/dev/null 2>&1; then printf 'Required local tool is unavailable: %s\n' "$tool" >&2; exit 69; fi
done

temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/launchacard-gif.XXXXXX")
trap 'rm -rf -- "$temp_dir"' EXIT

# Contain the entire video inside the square, rather than cropping card edges.
# One global palette avoids per-frame color flicker. Ordered dithering retains
# detail without the moving noise often introduced by error-diffusion dithers.
# No duration is specified: the complete original clip, starting at its first
# frame, is sampled. Frame-difference/offset encoding optimizes unchanged matte.
filter="[0:v:0]setpts=PTS-STARTPTS,scale=${size}:${size}:force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd+full_chroma_int,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0xf5efe2,setsar=1,fps=fps=${fps}:start_time=0:round=near,format=rgb24,split[colors][frames];[colors]palettegen=max_colors=256:reserve_transparent=false:stats_mode=full[palette];[frames][palette]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle[gif]"
ffmpeg -hide_banner -loglevel warning -nostdin -i "$input" \
  -filter_complex "$filter" -map '[gif]' -an -sn -dn \
  -fps_mode passthrough -gifflags +offsetting+transdiff -global_palette 1 \
  -loop 0 -final_delay -1 -y "$temp_dir/export.gif"

bytes=$(wc -c < "$temp_dir/export.gif")
bytes=${bytes//[[:space:]]/}
mv -- "$temp_dir/export.gif" "$output"
printf 'Saved %s (%s bytes).\n' "$output" "$bytes"
ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,nb_frames,duration \
  -of default=noprint_wrappers=1 "$output"
printf 'Inspect the first/last frames and both card faces before use. Export preserves source motion; it cannot repair a source seam.\n'
if (( bytes > max_bytes )); then
  printf 'OVER BUDGET: %s bytes exceeds the application ceiling of %s bytes. File retained for inspection; export a smaller size or lower FPS before upload.\n' "$bytes" "$max_bytes" >&2
  exit 2
fi
