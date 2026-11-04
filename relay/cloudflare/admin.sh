#!/bin/sh
# Moderate a deployed annotate relay. Needs two environment variables:
#   ANNOTATE_RELAY        https://<your-worker>.workers.dev
#   ANNOTATE_ADMIN_TOKEN  the Worker's ADMIN_TOKEN secret (keep it out of files)
#   ./admin.sh list   [room]                  threads with ids
#   ./admin.sh delete <room> <noteId> [replyId]  remove a thread or one reply, live
#   ./admin.sh reset  <room>                  wipe a room (the demo room re-seeds)
# room defaults to the demo room, halyard-revenue-dashboard.
set -eu
BASE="${ANNOTATE_RELAY:?set ANNOTATE_RELAY to your relay URL}"
TOKEN="${ANNOTATE_ADMIN_TOKEN:?set ANNOTATE_ADMIN_TOKEN}"
cmd="${1:-}"; room="${2:-halyard-revenue-dashboard}"
case "$cmd" in
  list)   curl -fsS -H "Authorization: Bearer $TOKEN" "$BASE/admin/list?room=$room" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("room:", d["room"], "|", len(d["notes"]), "threads")
for n in d["notes"]:
    flag = "  (resolved)" if n["resolved"] else ""
    print("")
    print(n["id"] + "  " + n["author"] + flag)
    print("  " + n["comment"][:120])
    for r in n["replies"]:
        print("    " + r["id"] + "  " + r["author"] + ": " + r["comment"][:100])
' ;;
  delete) [ $# -ge 3 ] || { echo "usage: admin.sh delete <room> <noteId> [replyId]"; exit 2; }
          body="{\"noteId\":\"$3\"${4:+,\"replyId\":\"$4\"}}"
          curl -fsS -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "$body" "$BASE/admin/delete?room=$room"; echo ;;
  reset)  [ $# -ge 2 ] || { echo "usage: admin.sh reset <room>"; exit 2; }
          curl -fsS -X POST -H "Authorization: Bearer $TOKEN" "$BASE/admin/reset?room=$room"; echo ;;
  *) sed -n '2,8p' "$0"; exit 2 ;;
esac
