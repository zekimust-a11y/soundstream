# SoundStream: FLIRC → Roon Volume Listener (Raspberry Pi)

This package runs on a Raspberry Pi and converts FLIRC remote keypresses into SoundStream Roon volume API calls on your `.21` server.

## What you need

- A Raspberry Pi (any Pi that can run Raspberry Pi OS)
- FLIRC USB dongle plugged into the Pi
- Network access to your SoundStream server on `.21` (`192.168.0.21:3000`)

## Install (copy/paste)

1. Copy this folder to the Pi (example uses scp from your Mac):

```bash
scp -r "/Users/zeki/My Drive/Personal/APPS/Soundstream/soundstream/pi-flirc-roon-volume" pi@YOUR_PI_IP:/home/pi/
```

2. SSH into the Pi and run the installer:

```bash
cd ~/pi-flirc-roon-volume
sudo ./install.sh
```

## Verify it works

```bash
sudo systemctl status soundstream-flirc-roon-volume --no-pager
sudo journalctl -u soundstream-flirc-roon-volume -n 200 --no-pager
```

Press volume up/down on the remote. You should see log lines like:

- `KeyDown F10 -> volume up`
- `KeyDown F9 -> volume down`

## Configuration

The installer writes `/etc/soundstream-flirc-roon-volume.env`.

Edit it any time:

```bash
sudo nano /etc/soundstream-flirc-roon-volume.env
sudo systemctl restart soundstream-flirc-roon-volume
```

Key settings:

- `SOUNDSTREAM_API_URL`: default `http://192.168.0.21:3000`
- `ROON_STEP`: default `1`
- `ROON_REPEAT_S`: default `0.06` (hold ramp speed)
- `FLIRC_DEVICE`: default `/dev/input/flirc` (stable symlink created by udev rule)

## Notes / Troubleshooting

- If the service says it cannot open the device, run:
  - `ls -l /dev/input/by-id/`
  - `sudo udevadm info -a -n /dev/input/eventX | head`
  and we’ll adjust the udev rule.



