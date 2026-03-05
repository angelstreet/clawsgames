#!/usr/bin/env bash
set -euo pipefail

API="${CLAWSGAMES_API:-https://clawsgames.angelstreet.io/api}"
ROC_CONFIG="${HOME}/.openclaw/workspace/skills/ranking-of-claws/config.json"

if [ ! -f "$ROC_CONFIG" ]; then
  echo "clawsgames: missing ranking-of-claws registration config:"
  echo "  $ROC_CONFIG"
  echo "Run: clawhub install ranking-of-claws"
  exit 1
fi

AGENT_NAME_DEFAULT="$(python3 - <<PY
import json
print(json.load(open("$ROC_CONFIG")).get("agent_name","Agent"))
PY
)"
GATEWAY_ID_DEFAULT="$(python3 - <<PY
import json
print(json.load(open("$ROC_CONFIG")).get("gateway_id","unknown"))
PY
)"

AUTH="Authorization: Bearer ${OPENCLAW_GATEWAY_ID:-$GATEWAY_ID_DEFAULT}"
AGENT_NAME="${OPENCLAW_AGENT_NAME:-$AGENT_NAME_DEFAULT}"

CMD="${1:-help}"
GAME="${2:-tictactoe}"

case "$CMD" in
  models)
    curl -s "$API/solo/models" -H "$AUTH" | python3 -c "
import sys,json
for m in json.load(sys.stdin)['models']:
    print(f'{m[\"id\"]:50} {m[\"name\"]:20} ({m[\"tier\"]})')
"
    ;;

  solo)
    if [[ "$GAME" == "pokemon" ]]; then
      MATCH=$(curl -s -X POST "$API/pokemon/solo" \
        -H "Content-Type: application/json" -H "$AUTH" \
        -d "{\"agent_name\":\"$AGENT_NAME\"}")
      MID=$(echo "$MATCH" | python3 -c "import sys,json;print(json.load(sys.stdin)['match_id'])")
      OPP=$(echo "$MATCH" | python3 -c "import sys,json;print(json.load(sys.stdin)['opponent'])")
      echo "Playing $GAME vs $OPP (match: $MID)"
      echo "$MATCH" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('instructions','')); lim=d.get('limits') or {}; mt=lim.get('max_turns'); tt=lim.get('turn_timeout_sec'); tr=lim.get('turns_remaining'); print(f'Limits: max_turns={mt}, turn_timeout={tt}s, turns_remaining={tr}' if mt else ''); print(''); print(d.get('battle_view',''))"
      echo "Tip: next move with: ./play.sh move $MID \"move 1\""
      echo "Tip: or switch with: ./play.sh move $MID \"switch 2\""
      echo "Next: ./play.sh status $MID"
      echo "Then: ./play.sh move $MID "move 1""
      echo "MATCH_ID=$MID"
    else
      MODEL_ARG=""
      if [[ "${3:-}" == "--model" ]]; then MODEL_ARG=",\"model\":\"$4\""; fi
      
      MATCH=$(curl -s -X POST "$API/games/$GAME/solo" \
        -H "Content-Type: application/json" -H "$AUTH" \
        -d "{\"agent_name\":\"$AGENT_NAME\"$MODEL_ARG}")
      MID=$(echo "$MATCH" | python3 -c "import sys,json;print(json.load(sys.stdin)['match_id'])")
      OPP=$(echo "$MATCH" | python3 -c "import sys,json;print(json.load(sys.stdin)['opponent'])")
      echo "Playing $GAME vs $OPP (match: $MID)"
      echo "$MATCH" | python3 -c "import sys,json;print(json.load(sys.stdin)['board_display'])"
      echo "Next: ./play.sh status $MID"
      echo "Then: ./play.sh move $MID <choice>"
      echo "MATCH_ID=$MID"
    fi
    ;;


  status)
    # play.sh status <match_id>
    MID="$2"
    GAME_ID=$(curl -s "$API/matches/$MID" -H "$AUTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('game_id',''))" 2>/dev/null || true)
    if [[ "$GAME_ID" == "pokemon" ]]; then
      RESP=$(curl -s "$API/pokemon/$MID" -H "$AUTH")
      RESP_JSON="$RESP" python3 - <<'PY'
import os,sys,json
raw=os.environ.get('RESP_JSON','')
if not raw:
    print('Error: empty response')
    sys.exit(1)
m=json.loads(raw)
if m.get('error'):
    print(f"Error: {m['error']}")
    sys.exit(1)
mid=m.get('id',m.get('match_id','?'))
print(f"Match: {mid}  Game: pokemon  Status: {m.get('status','?')}")
lim=m.get('limits') or {}
if lim.get('max_turns') is not None:
    print(f"Limits: max_turns={lim.get('max_turns')}, timeout={lim.get('turn_timeout_sec')}s, turns_remaining={lim.get('turns_remaining')}")
if m.get('battle_view'):
    print("\n=== Current options ===")
    print(m.get('battle_view',''))
else:
    battle=m.get('battle') or {}
    team=battle.get('p1_pokemon') or []
    active=next((p for p in team if p.get('active')), None)
    print("\n=== Current options ===")
    if active:
      for i,mv in enumerate(active.get('moves') or [], start=1):
          print(f"  move {i}: {mv}")
    bench=[p for p in team if (not p.get('active')) and str(p.get('condition','')) != '0 fnt']
    for i,pkm in enumerate(bench, start=2):
      print(f"  switch {i}: {pkm.get('details',pkm.get('ident','?'))}")
if m.get('battle_log'):
    print("\n=== Last battle log ===")
    print(m.get('battle_log',''))
if m.get('result'):
    print(f"\nResult: {m.get('result')} ({m.get('reason','')})")
else:
    print(f'\nNext: ./play.sh move {mid} "move 1"  # or switch N shown above')
PY
    else
      RESP=$(curl -s "$API/matches/$MID" -H "$AUTH")
      RESP_JSON="$RESP" python3 - <<'PY'
import os,sys,json
raw=os.environ.get('RESP_JSON','')
if not raw:
    print('Error: empty response')
    sys.exit(1)
m=json.loads(raw)
if m.get('error'):
    print(f"Error: {m['error']}")
    sys.exit(1)
mid=m.get('id',m.get('match_id','?'))
print(f"Match: {mid}  Game: {m.get('game_id','?')}  Status: {m.get('status','?')}")
if m.get('board_display'):
    print(m.get('board_display',''))
if m.get('result'):
    print(f"Result: {m.get('result')} ({m.get('reason','')})")
else:
    print(f"Next: ./play.sh move {mid} <choice>")
PY
    fi
    ;;


  move)
    # play.sh move <match_id> <move>
    MID="$2"
    MOVE="$3"
    # Auto-route Pokemon matches to pokemon API for full battle view/options
    GAME_ID=$(curl -s "$API/matches/$MID" -H "$AUTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('game_id',''))" 2>/dev/null || true)
    if [[ "$GAME_ID" == "pokemon" ]]; then
      RESP=$(curl -s -X POST "$API/pokemon/$MID/move" \
        -H "Content-Type: application/json" -H "$AUTH" \
        -d "{\"move\":\"$MOVE\"}")

      # If server requires forced switch, auto-pick first valid switch slot to avoid timeout.
      FORCE_ERR=$(echo "$RESP" | python3 - <<'PY'
import sys,json
try:
  d=json.load(sys.stdin)
  print(d.get('error',''))
except Exception:
  print('')
PY
)
      if echo "$FORCE_ERR" | grep -qi "switch"; then
        AUTO_SWITCH=$(curl -s "$API/pokemon/$MID" -H "$AUTH" | python3 - <<'PY'
import sys,json
try:
  d=json.load(sys.stdin)
  p1=((d.get('battle') or {}).get('p1_pokemon') or [])
  for idx,p in enumerate(p1, start=1):
    cond=str(p.get('condition',''))
    if (not p.get('active')) and cond != '0 fnt':
      print(f'switch {idx}')
      break
  else:
    print('switch 2')
except Exception:
  print('switch 2')
PY
)
        RESP=$(curl -s -X POST "$API/pokemon/$MID/move" \
          -H "Content-Type: application/json" -H "$AUTH" \
          -d "{\"move\":\"$AUTO_SWITCH\"}")
      fi

      echo "$RESP" | python3 -c "
import sys,json;m=json.load(sys.stdin)
if 'error' in m: print(f'Error: {m[\"error\"]}'); sys.exit(1)
print(f'Your move: {m.get(\"your_move\")}')
if m.get('ai_move'): print(f'AI move: {m[\"ai_move\"]}')
if m.get('battle_log'): print(m.get('battle_log',''))
lim=m.get('limits') or {}
if lim.get('max_turns') is not None:
    print(f'Limits: max_turns={lim.get(\"max_turns\")}, timeout={lim.get(\"turn_timeout_sec\")}s, turns_remaining={lim.get(\"turns_remaining\")}')
if m.get('battle_view'):
    print('\\n=== Your options ===')
    print(m.get('battle_view',''))
else:
    print(m.get('board_display',''))
print(f'Status: {m[\"status\"]}')
if m.get('result'):
    print(f'Result: {m[\"result\"]} ({m.get(\"reason\",\"\")})')
else:
    print('Next: ./play.sh status $MID')
"
    else
      curl -s -X POST "$API/solo/$MID/move" \
        -H "Content-Type: application/json" -H "$AUTH" \
        -d "{\"move\":\"$MOVE\"}" | python3 -c "
import sys,json;m=json.load(sys.stdin)
if 'error' in m: print(f'Error: {m[\"error\"]}'); sys.exit(1)
print(f'Your move: {m.get(\"your_move\")}')
if m.get('ai_move'): print(f'AI move: {m[\"ai_move\"]} (model: {m.get(\"model_used\",\"?\")})')
print(m.get('board_display',''))
print(f'Status: {m[\"status\"]}')
if m.get('result'):
    print(f'Result: {m[\"result\"]} ({m.get(\"reason\",\"\")})')
else:
    print('Next: ./play.sh status $MID')
"
    fi
    ;;

  queue)
    curl -s -X POST "$API/games/$GAME/queue" \
      -H "Content-Type: application/json" -H "$AUTH" \
      -d "{\"agent_name\":\"$AGENT_NAME\"}" | python3 -m json.tool
    ;;

  challenge)
    curl -s -X POST "$API/games/$GAME/challenge" \
      -H "Content-Type: application/json" -H "$AUTH" \
      -d "{\"agent_name\":\"$AGENT_NAME\"}" | python3 -m json.tool
    ;;

  join)
    SID="$3"
    curl -s -X POST "$API/games/$GAME/join/$SID" \
      -H "Content-Type: application/json" -H "$AUTH" \
      -d "{\"agent_name\":\"$AGENT_NAME\"}" | python3 -m json.tool
    ;;

  leaderboard)
    curl -s "$API/leaderboard/$GAME" -H "$AUTH" | python3 -c "
import sys,json
for i,r in enumerate(json.load(sys.stdin)['rankings']):
    t = r['wins']+r['losses']+r['draws']
    print(f'#{i+1} {r[\"agent_name\"]:20} ELO={r[\"elo\"]:4} {r[\"wins\"]}W/{r[\"losses\"]}L/{r[\"draws\"]}D ({t}g)')
"
    ;;

  *)
    echo "Usage: play.sh <command> [game] [args]"
    echo "Commands: solo, status, move, models, queue, challenge, join, leaderboard"
    echo "Games: tictactoe, chess, pokemon"
    ;;
esac
