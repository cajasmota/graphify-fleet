# Watcher commands

Per-repo file watchers run `graphify watch <path>` so the AST graph stays
current as you edit. They are installed by `gfleet install` and auto-load at
login via launchd (macOS) / systemd `--user` (Linux) / Scheduled Tasks
(Windows). Self-healing: launchd `KeepAlive`, systemd `Restart=always`,
Windows `RestartCount=99`. You should rarely need these commands.

- [`gfleet start`](#gfleet-start)
- [`gfleet stop`](#gfleet-stop)
- [`gfleet restart`](#gfleet-restart)

See also: [operate.md](operate.md) for `status` (which prints watcher state),
[repair.md](repair.md) for `rebuild` / `reset`.

---

## Watcher labels and files

Each watcher is registered with a stable label produced by
`watcherLabel(group, slug)` in `src/watchers.js`:

```
ai.graphify.fleet.<group>.<slug>
```

| Platform | Path | Backend |
|----------|------|---------|
| macOS | `~/Library/LaunchAgents/ai.graphify.fleet.<group>.<slug>.plist` | `launchctl` |
| Linux | `~/.config/systemd/user/ai.graphify.fleet.<group>.<slug>.service` | `systemctl --user` |
| Windows | Scheduled Task `ai.graphify.fleet.<group>.<slug>` | `Get-ScheduledTask` |

Logs (macOS only) write to `~/.cache/graphify-fleet/<group>/<slug>.log` and
`<slug>.err`.

---

## `gfleet start`

```bash
gfleet start [group]
```

Loads watchers for every repo in the group (or every registered group if no
argument). On macOS, writes `.plist` files and runs `launchctl unload` then
`launchctl load`. On Linux, writes a `.service` unit, then runs
`systemctl --user daemon-reload` and `systemctl --user enable --now`. On
Windows, runs `Register-ScheduledTask` then `Start-ScheduledTask`.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | no | (all) | Registered group name OR explicit `*.fleet.json` path. |

### Side effects

- macOS: writes `~/Library/LaunchAgents/<label>.plist`, runs `launchctl load`.
- Linux: writes `~/.config/systemd/user/<label>.service`, runs `daemon-reload` + `enable --now`.
- Windows: registers a Scheduled Task triggered `AtLogOn` for `$env:USERNAME`.
- Creates `~/.cache/graphify-fleet/<group>/` for log files.

### Examples

```bash
gfleet start
gfleet start upvate
```

See also: [`gfleet stop`](#gfleet-stop), [`gfleet status`](operate.md#gfleet-status).

---

## `gfleet stop`

```bash
gfleet stop [group]
```

Unloads watchers and removes the platform's registration. Does NOT delete the
plist / unit / Scheduled Task definition file on Linux only the disable-and-
remove path is taken; on macOS the `.plist` is unlinked; on Windows
`Unregister-ScheduledTask` is called.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | no | (all) | Registered group name OR explicit `*.fleet.json` path. |

### Side effects

- macOS: `launchctl unload` then `unlink ~/Library/LaunchAgents/<label>.plist`.
- Linux: `systemctl --user disable --now <label>.service`, removes the unit, `daemon-reload`.
- Windows: `Unregister-ScheduledTask -Confirm:$false`.

### Examples

```bash
gfleet stop
gfleet stop upvate
```

See also: [`gfleet start`](#gfleet-start), [`gfleet uninstall`](repair.md#gfleet-uninstall).

---

## `gfleet restart`

```bash
gfleet restart [group]
```

Convenience: runs [`gfleet stop`](#gfleet-stop) then [`gfleet start`](#gfleet-start)
back to back. Useful after a graphify upgrade so the watcher picks up the new
binary path.

### Args

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `group` | no | (all) | Registered group name OR explicit `*.fleet.json` path. |

### Side effects

Cumulative side effects of `stop` + `start`.

### Examples

```bash
gfleet restart
gfleet restart upvate
```

See also: [`gfleet update`](operate.md#gfleet-update) (does not restart watchers
unless `--refresh-rules` is passed).
