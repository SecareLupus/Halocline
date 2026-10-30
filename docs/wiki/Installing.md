# Installing

Download Halocline from the [latest release](https://github.com/SecareLupus/Halocline/releases/latest).

## Linux

- **Ubuntu and Debian:** download the `.deb` file and install it:

  ```bash
  sudo apt install ./halocline_0.2.0_amd64.deb
  ```

  Halocline then appears in your applications menu.

- **Other distributions:** download the `.AppImage`, make it executable, and run it:

  ```bash
  chmod +x Halocline-0.2.0.AppImage
  ./Halocline-0.2.0.AppImage
  ```

## Windows

Download and run `Halocline-Setup-0.2.0.exe`. The installer isn't signed yet, so Windows SmartScreen
may warn about it: choose **More info**, then **Run anyway**.

## Updating

Install the new version over the old one. Your library, queue, settings, overlays and API tokens
are kept: they live in your user data folder, not in the app.

## Where your data lives

|         | Folder                |
| ------- | --------------------- |
| Linux   | `~/.config/Halocline` |
| Windows | `%APPDATA%\Halocline` |

In that folder:

- `halocline.db` holds the library, the queue, settings, overlays, history and API tokens.
- `artwork` holds cover art taken from your files, and images uploaded for overlays.
- `track-cache` holds recently played YouTube Music tracks (up to 1 GB), so they start quickly
  and survive network blips.
- `models` holds the audio analysis model, downloaded the first time it's needed (78 MB).

To back up Halocline, close it and copy `halocline.db` and the `artwork` folder. Overlays can also
be [exported](OBS-overlays#import-and-export) one at a time.
