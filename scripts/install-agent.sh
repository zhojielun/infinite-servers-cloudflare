#!/usr/bin/env bash
#
# Infinite Servers — Agent Installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/zhojielun/infinite-servers-cloudflare/master/scripts/install-agent.sh | sudo bash
#
# Or with env vars:
#   sudo AGENT_NAME="My Box" DASHBOARD_URL="https://xxx.workers.dev" \
#        AGENT_TOKEN="..." AGENT_INTERVAL=15 AGENT_REPORT_IP=y \
#        curl -fsSL ... | bash
#
set -euo pipefail

die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarn:\033[0m %s\n' "$*" >&2; }

prompt() {
    local __var="$1" __q="$2" __def="${3:-}" __ans=""
    if [ -e /dev/tty ]; then
        if [ -n "$__def" ]; then read -r -p "$__q [$__def]: " __ans </dev/tty || true
        else                       read -r -p "$__q: "        __ans </dev/tty || true
        fi
    fi
    printf -v "$__var" '%s' "${__ans:-$__def}"
}

prompt_yn() {
    local __var="$1" __q="$2" __def="${3:-y}" __ans=""
    if [ -e /dev/tty ]; then
        read -r -p "$__q [$__def]: " __ans </dev/tty || true
    fi
    __ans="${__ans:-$__def}"
    if [[ "$__ans" =~ ^[Yy] ]]; then
        printf -v "$__var" 'y'
    else
        printf -v "$__var" 'n'
    fi
}

gen_token() {
    if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24
    else tr -dc 'a-f0-9' </dev/urandom | head -c 48; echo
    fi
}

# ── prompt for config ────────────────────────────────────────────────────
NAME="${AGENT_NAME:-}"
[ -n "$NAME" ] || prompt NAME "Server name (must match dashboard config)" "$(hostname)"
NAME="${NAME//[^a-zA-Z0-9 _-]/}"

URL="${DASHBOARD_URL:-}"
[ -n "$URL" ] || prompt URL "Dashboard URL (e.g. https://infinite-servers.xxx.workers.dev)" ""
[ -n "$URL" ] || die "dashboard URL is required"

TOKEN="${AGENT_TOKEN:-}"
[ -n "$TOKEN" ] || prompt TOKEN "Token (leave blank to auto-generate)" ""
[ -n "$TOKEN" ] || TOKEN="$(gen_token)"

INTERVAL="${AGENT_INTERVAL:-}"
[ -n "$INTERVAL" ] || prompt INTERVAL "Push interval in seconds" "15"

REPORT_IP="${AGENT_REPORT_IP:-}"
[ -n "$REPORT_IP" ] || prompt_yn REPORT_IP "Report public IP address to dashboard" "y"
REPORT_IP=$(echo "$REPORT_IP" | tr '[:upper:]' '[:lower:]')

REGION="${AGENT_REGION:-}"
[ -n "$REGION" ] || prompt REGION "Region code for dashboard (e.g. CN, US, JP, leave blank to skip)" ""

LOCATION="${AGENT_LOCATION:-}"
[ -n "$LOCATION" ] || prompt LOCATION "Location name for dashboard (leave blank to skip)" "$(hostname)"

PUSH_URL="${URL%/}/push"

# ── install agent ────────────────────────────────────────────────────────
INSTALL_DIR="/opt/infinite-servers/agents"
AGENT_HOME="$INSTALL_DIR/$NAME"
mkdir -p "$AGENT_HOME"

# write agent runner script
cat > "$AGENT_HOME/agent.sh" <<'AGENTSCRIPT'
#!/usr/bin/env bash
set -uo pipefail

CONFIG="$1"
INTERVAL="${2:-15}"

read_json_field() {
    grep -oP "\"$1\"\s*:\s*\"?\K[^\"$,]+" || echo ""
}

NAME=$(read_json_field "name" < "$CONFIG")
TOKEN=$(read_json_field "token" < "$CONFIG")
URL=$(read_json_field "url" < "$CONFIG")
REPORT_IP=$(read_json_field "report_ip" < "$CONFIG")
REPORT_IP=$(echo "$REPORT_IP" | tr '[:upper:]' '[:lower:]')

# CPU usage: read /proc/stat twice with 200ms gap (same as PHP version)
calc_cpu_pct() {
    local tmp1 tmp2
    tmp1=$(mktemp)
    tmp2=$(mktemp)
    awk '/^cpu /{total=0; for(i=2;i<=NF;i++) total+=$i; print total, $5}' /proc/stat > "$tmp1" 2>/dev/null
    sleep 0.2
    awk '/^cpu /{total=0; for(i=2;i<=NF;i++) total+=$i; print total, $5}' /proc/stat > "$tmp2" 2>/dev/null
    local a_total a_idle b_total b_idle diff_total diff_idle
    read -r a_total a_idle < "$tmp1"
    read -r b_total b_idle < "$tmp2"
    rm -f "$tmp1" "$tmp2"
    diff_total=$((b_total - a_total))
    diff_idle=$((b_idle - a_idle))
    if [ "$diff_total" -gt 0 ]; then
        awk "BEGIN{printf \"%.1f\", (1 - $diff_idle/$diff_total) * 100}"
    else
        echo "0"
    fi
}

get_ipv4() {
    curl -s --max-time 5 -4 https://ifconfig.me 2>/dev/null \
    || curl -s --max-time 5 -4 https://api.ipify.org 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}' \
    || echo ""
}

get_ipv6() {
    curl -s --max-time 5 -6 https://ifconfig.me 2>/dev/null \
    || curl -s --max-time 5 -6 https://api.ipify.org 2>/dev/null \
    || ip -6 addr show scope global 2>/dev/null | awk '/inet6/{print $2}' | cut -d/ -f1 | head -1 \
    || echo ""
}

collect_info() {
    # CPU
    local cpu_model cpu_num
    cpu_model=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ //' || echo "Unknown")
    cpu_num=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 1)

    # Memory
    local mem_total mem_used mem_pct
    if command -v free >/dev/null 2>&1; then
        mem_total=$(free -b | awk '/^Mem:/{print $2}')
        mem_used=$(free -b | awk '/^Mem:/{print $3}')
        mem_pct=$(awk "BEGIN{printf \"%.1f\", ($mem_used/$mem_total)*100}")
    else
        mem_total=0; mem_used=0; mem_pct=0
    fi

    # Swap
    local swap_total swap_pct
    if command -v free >/dev/null 2>&1; then
        swap_total=$(free -b | awk '/^Swap:/{print $2}')
        swap_pct=$(free -b | awk '/^Swap:/{printf "%.1f", ($2>0)?$3/$2*100:0}')
    else
        swap_total=0; swap_pct=0
    fi

    # Disk
    local disk_total disk_pct
    disk_total=$(df -B1 / 2>/dev/null | awk 'NR==2{print $2}' || echo 0)
    disk_pct=$(df / 2>/dev/null | awk 'NR==2{gsub(/%/,""); print $5}' || echo 0)

    # Load
    local load1
    load1=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0)

    # Uptime
    local uptime_sec
    uptime_sec=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)

    # Network
    local net_rx net_tx
    local iface
    iface=$(ip route 2>/dev/null | awk '/default/{print $5; exit}')
    [ -z "$iface" ] && iface="eth0"
    if [ -f "/sys/class/net/$iface/statistics/rx_bytes" ]; then
        net_rx=$(cat "/sys/class/net/$iface/statistics/rx_bytes")
        net_tx=$(cat "/sys/class/net/$iface/statistics/tx_bytes")
    else
        net_rx=0; net_tx=0
    fi

    # OS
    local distname="Unknown"
    if [ -f /etc/os-release ]; then
        distname=$(awk -F= '/^PRETTY_NAME=/{gsub(/"/,"",$2); print $2}' /etc/os-release)
    fi

    local now
    now=$(date +%s)

    # Build form data
    local cpu_pct
    cpu_pct=$(calc_cpu_pct)
    local enc_name
    enc_name=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$NAME'))" 2>/dev/null || echo "$NAME")
    local data="name=${enc_name}&token=${TOKEN}&time=${now}"
    data+="&cpuinfo[model]=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$cpu_model'''))" 2>/dev/null || echo "$cpu_model")"
    data+="&cpuinfo[num]=${cpu_num}"
    data+="&cpu_percent=${cpu_pct}"
    data+="&meminfo[memTotal]=${mem_total}"
    data+="&meminfo[memUsedPercent]=${mem_pct}"
    data+="&meminfo[swapPercent]=${swap_pct}"
    data+="&diskinfo[diskTotal]=${disk_total}"
    data+="&diskinfo[diskPercent]=${disk_pct}"
    data+="&loadavg=${load1}"
    data+="&uptime=${uptime_sec}"
    data+="&netdev[rx]=${net_rx}"
    data+="&netdev[tx]=${net_tx}"
    data+="&netdev[ts]=$(($(date +%s%N)/1000000))"
    local ipv4 ipv6
    if [[ "$REPORT_IP" =~ ^(y|yes|true|1)$ ]]; then
        ipv4=$(get_ipv4)
        ipv6=$(get_ipv6)
    else
        ipv4=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
        ipv6=$(ip -6 addr show scope global 2>/dev/null | awk '/inet6/{print $2}' | cut -d/ -f1 | head -1 || echo "")
    fi
    [ -n "$ipv4" ] && data+="&ip4=${ipv4}"
    [ -n "$ipv6" ] && data+="&ip6=${ipv6}"
    data+="&distname=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$distname'''))" 2>/dev/null || echo "$distname")"

    echo "$data"
}

push_status() {
    local data resp
    data=$(collect_info)
    resp=$(curl -s --max-time 10 -X POST "$URL" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "$data" 2>&1) || true
    if echo "$resp" | grep -q '"ok"'; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] push ok"
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] push failed: $resp" >&2
    fi
}

push_info() {
    local cpu_model cpu_num mem_total disk_total distname
    cpu_model=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ //' || echo "Unknown")
    cpu_num=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 1)
    mem_total=$(free -b 2>/dev/null | awk '/^Mem:/{print $2}' || echo 0)
    disk_total=$(df -B1 2>/dev/null | awk 'NR==2{print $2}' || echo 0)
    if [ -f /etc/os-release ]; then
        distname=$(awk -F= '/^PRETTY_NAME=/{gsub(/"/,"",$2); print $2}' /etc/os-release)
    else
        distname="Unknown"
    fi

    local enc_name
    enc_name=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$NAME'))" 2>/dev/null || echo "$NAME")
    local data="name=${enc_name}&token=${TOKEN}"
    data+="&cpuinfo[model]=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$cpu_model'''))" 2>/dev/null || echo "$cpu_model")"
    data+="&cpuinfo[num]=${cpu_num}"
    data+="&meminfo[memTotal]=${mem_total}"
    data+="&diskinfo[diskTotal]=${disk_total}"
    local ipv4 ipv6
    if [[ "$REPORT_IP" =~ ^(y|yes|true|1)$ ]]; then
        ipv4=$(get_ipv4)
        ipv6=$(get_ipv6)
    else
        ipv4=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
        ipv6=$(ip -6 addr show scope global 2>/dev/null | awk '/inet6/{print $2}' | cut -d/ -f1 | head -1 || echo "")
    fi
    [ -n "$ipv4" ] && data+="&ip4=${ipv4}"
    [ -n "$ipv6" ] && data+="&ip6=${ipv6}"
    data+="&distname=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$distname'''))" 2>/dev/null || echo "$distname")"

    local resp
    resp=$(curl -s --max-time 10 -X POST "$URL" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "$data" 2>&1) || true
    if echo "$resp" | grep -q '"ok"'; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] info push ok"
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] info push failed: $resp" >&2
    fi
}

# push static info first
push_info

# main loop
while true; do
    push_status
    sleep "$INTERVAL"
done
AGENTSCRIPT
chmod +x "$AGENT_HOME/agent.sh"

# write config
umask 077
cat > "$AGENT_HOME/agent.json" <<JSON
{
    "name": "$NAME",
    "token": "$TOKEN",
    "url": "$PUSH_URL",
    "interval": $INTERVAL,
    "report_ip": "$REPORT_IP"
}
JSON

info "config written to $AGENT_HOME/agent.json"

# ── test push ────────────────────────────────────────────────────────────
info "testing push to $PUSH_URL ..."
TEST_IP=""
[[ "$REPORT_IP" =~ ^(y|yes|true|1)$ ]] && TEST_IP="&ip4=127.0.0.1"
TEST_DATA="name=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$NAME'))" 2>/dev/null || echo "$NAME")&token=${TOKEN}&time=$(date +%s)&cpuinfo[num]=1&meminfo[memTotal]=0&meminfo[memUsedPercent]=0&diskinfo[diskTotal]=0&diskinfo[diskPercent]=0&loadavg=0&uptime=0&netdev[rx]=0&netdev[tx]=0&netdev[ts]=$(($(date +%s%N)/1000000))${TEST_IP}&distname=test"
RESULT=$(curl -s --max-time 10 -X POST "$PUSH_URL" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "$TEST_DATA" 2>&1) || warn "test push failed"
if echo "$RESULT" | grep -q '"ok"'; then
    info "test push successful"
else
    warn "test push returned: $RESULT"
fi

# ── setup systemd service ────────────────────────────────────────────────
SERVICE_NAME="infinite-agent-${NAME// /-}"
if command -v systemctl >/dev/null 2>&1; then
    cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Infinite Servers Agent — ${NAME}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/bin/bash "${AGENT_HOME}/agent.sh" "${AGENT_HOME}/agent.json" ${INTERVAL}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable --now ${SERVICE_NAME}
    info "systemd service created and started"
else
    warn "systemd not found, skipping service setup"
    info "run manually: bash ${AGENT_HOME}/agent.sh ${AGENT_HOME}/agent.json ${INTERVAL}"
fi

# ── build KV config hint ────────────────────────────────────────────────
KV_HINT="\"token\": \"$TOKEN\""
[ -n "$REGION" ] && KV_HINT="$KV_HINT,\n        \"region\": \"$REGION\""
[ -n "$LOCATION" ] && KV_HINT="$KV_HINT,\n        \"location\": \"$LOCATION\""

cat <<DONE

$(info "Agent deployed successfully!")

  Server   : $NAME
  Config   : $AGENT_HOME/agent.json
  Pushing  : $PUSH_URL every ${INTERVAL}s
  Report IP: $REPORT_IP
  Token    : $TOKEN
  Service  : ${SERVICE_NAME}

  Add this server to your dashboard's KV config (servers.json):

    "$NAME": {
        $(echo -e "$KV_HINT")
    }

  Manage service:
    sudo systemctl status ${SERVICE_NAME}
    sudo systemctl restart ${SERVICE_NAME}
    sudo journalctl -u ${SERVICE_NAME} -f

DONE
