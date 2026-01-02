#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root: sudo $0"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/soundstream-flirc-roon-volume"
ENV_FILE="/etc/soundstream-flirc-roon-volume.env"
SERVICE_FILE="/etc/systemd/system/soundstream-flirc-roon-volume.service"
UDEV_RULE="/etc/udev/rules.d/99-flirc-soundstream.rules"

echo "[install] Installing apt deps..."
apt-get update -y
apt-get install -y python3 python3-pip python3-venv

echo "[install] Creating ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"
install -m 0755 "${ROOT_DIR}/flirc_roon_volume.py" "${INSTALL_DIR}/flirc_roon_volume.py"
install -m 0644 "${ROOT_DIR}/requirements.txt" "${INSTALL_DIR}/requirements.txt"

echo "[install] Installing python deps..."
if [[ ! -d "${INSTALL_DIR}/venv" ]]; then
  python3 -m venv "${INSTALL_DIR}/venv"
fi
"${INSTALL_DIR}/venv/bin/python" -m pip install --upgrade pip >/dev/null
"${INSTALL_DIR}/venv/bin/python" -m pip install -r "${INSTALL_DIR}/requirements.txt"

echo "[install] Installing udev rule..."
install -m 0644 "${ROOT_DIR}/99-flirc-soundstream.rules" "${UDEV_RULE}"
udevadm control --reload-rules || true
udevadm trigger || true

echo "[install] Writing env file (${ENV_FILE}) if missing..."
if [[ ! -f "${ENV_FILE}" ]]; then
  cat > "${ENV_FILE}" <<'ENV'
# SoundStream server (on .21)
SOUNDSTREAM_API_URL=http://192.168.0.21:3000

# Volume step per press
ROON_STEP=1

# Hold ramp cadence (seconds)
ROON_REPEAT_S=0.06

# FLIRC input device path (udev symlink to the keyboard event device)
FLIRC_DEVICE=/dev/input/flirc-kbd

# If you don't want to "grab" the keyboard device, set to 0
FLIRC_GRAB=1

# Key codes (Linux input key codes). Defaults: F10 up / F9 down.
# FLIRC_KEY_UP=68
# FLIRC_KEY_DOWN=67

# HTTP timeout
HTTP_TIMEOUT_S=1.5

# Set to 1 to log each API call response line
# ROON_LOG_API=0
ENV
  chmod 0644 "${ENV_FILE}"
fi

# If env exists but points to an old/unstable path, try to upgrade it.
if grep -q '^FLIRC_DEVICE=/dev/input/flirc$' "${ENV_FILE}" 2>/dev/null; then
  sed -i 's#^FLIRC_DEVICE=/dev/input/flirc$#FLIRC_DEVICE=/dev/input/flirc-kbd#' "${ENV_FILE}" || true
fi

# If the stable udev symlink exists, prefer it (even if env was previously set to a by-id path).
if [[ -e /dev/input/flirc-kbd ]]; then
  if grep -q '^FLIRC_DEVICE=' "${ENV_FILE}" 2>/dev/null; then
    sed -i 's#^FLIRC_DEVICE=.*#FLIRC_DEVICE=/dev/input/flirc-kbd#' "${ENV_FILE}" || true
  fi
fi

echo "[install] Installing systemd service..."
install -m 0644 "${ROOT_DIR}/soundstream-flirc-roon-volume.service" "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable --now soundstream-flirc-roon-volume

echo
echo "[install] Done."
echo "Check status:"
echo "  sudo systemctl status soundstream-flirc-roon-volume --no-pager"
echo "View logs:"
echo "  sudo journalctl -u soundstream-flirc-roon-volume -n 200 --no-pager"
echo
echo "If /dev/input/flirc does not exist, run:"
echo "  ls -l /dev/input/by-id/"
echo "  cat /proc/bus/input/devices | sed -n '1,200p'"


