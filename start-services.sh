#!/bin/bash

# SoundStream Services Manager
# Monitors and restarts backend and web services

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/tmp/soundstream_services.log"
PID_FILE="/tmp/soundstream_services.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $*" | tee -a "$LOG_FILE"
}

check_service() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"

    if curl -s -o /dev/null -w "%{http_code}" "$url" | grep -q "^$expected_status$"; then
        echo -e "${GREEN}✓${NC} $name OK"
        return 0
    else
        echo -e "${RED}✗${NC} $name DOWN"
        return 1
    fi
}

start_backend() {
    log "Starting backend server..."
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm use 20 >/dev/null 2>&1

    cd "$SCRIPT_DIR"
    /usr/local/bin/node server/simple-server.js >> "$LOG_FILE" 2>&1 &
    echo $! > /tmp/soundstream_backend.pid
    sleep 3
}

start_web() {
    log "Starting web server..."
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm use 20 >/dev/null 2>&1

    cd "$SCRIPT_DIR"
    EXPO_PUBLIC_DOMAIN=192.168.0.21:3000 /usr/local/bin/node ./node_modules/expo/bin/cli start --web --port 8081 --host lan --clear >> "$LOG_FILE" 2>&1 &
    echo $! > /tmp/soundstream_web.pid
    sleep 5
}

stop_services() {
    log "Stopping services..."
    if [ -f /tmp/soundstream_backend.pid ]; then
        kill $(cat /tmp/soundstream_backend.pid) 2>/dev/null
        rm -f /tmp/soundstream_backend.pid
    fi
    if [ -f /tmp/soundstream_web.pid ]; then
        kill $(cat /tmp/soundstream_web.pid) 2>/dev/null
        rm -f /tmp/soundstream_web.pid
    fi
    pkill -f 'expo\|simple-server' 2>/dev/null
}

monitor_services() {
    local backend_down=0
    local web_down=0

    while true; do
        local backend_ok=0
        local web_ok=0

        if check_service "Backend" "http://localhost:3000/api/health"; then
            backend_ok=1
        else
            backend_down=$((backend_down + 1))
            if [ $backend_down -ge 3 ]; then
                log "Backend failed 3 times, restarting..."
                start_backend
                backend_down=0
            fi
        fi

        if check_service "Web" "http://localhost:8081"; then
            web_ok=1
        else
            web_down=$((web_down + 1))
            if [ $web_down -ge 3 ]; then
                log "Web server failed 3 times, restarting..."
                start_web
                web_down=0
            fi
        fi

        # Reset counters if services are back up
        if [ $backend_ok -eq 1 ]; then
            backend_down=0
        fi
        if [ $web_ok -eq 1 ]; then
            web_down=0
        fi

        sleep 30
    done
}

case "$1" in
    start)
        log "Starting SoundStream services..."
        stop_services
        start_backend
        start_web
        log "Services started. Monitoring..."
        monitor_services &
        echo $! > "$PID_FILE"
        ;;
    stop)
        log "Stopping SoundStream services..."
        stop_services
        if [ -f "$PID_FILE" ]; then
            kill $(cat "$PID_FILE") 2>/dev/null
            rm -f "$PID_FILE"
        fi
        ;;
    restart)
        $0 stop
        sleep 2
        $0 start
        ;;
    status)
        echo -e "${BLUE}Service Status:${NC}"
        check_service "Backend" "http://localhost:3000/api/health"
        check_service "Web" "http://localhost:8081"
        check_service "Roon" "http://localhost:3000/api/roon/status" "200"
        ;;
    logs)
        tail -50 "$LOG_FILE"
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        echo "  start   - Start services with monitoring"
        echo "  stop    - Stop all services"
        echo "  restart - Restart all services"
        echo "  status  - Check service status"
        echo "  logs    - Show recent logs"
        exit 1
        ;;
esac
