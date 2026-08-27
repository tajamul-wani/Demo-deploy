# demo-deploy

A small Express app that shows **which version of the code is currently running** on the server.

The app is deliberately simple. The point of this project is the **deployment pipeline** around it: getting code from a laptop, through GitHub, onto a Linux server, and live — manually, with no platform doing it for you.

---

## What the app does

Two pages:

| Page | Returns |
|---|---|
| `GET /` | An HTML page: app name, version, git commit hash, hostname |
| `GET /health` | JSON: `{ "status": "ok", "uptime": 126, "version": "1.1.0" }` |

### Why those four values

The app answers one question: **"which code is running right now?"**

- **Version** — read from `package.json`. Change it, and you can watch the change land.
- **Commit hash** — read once at startup with `git rev-parse --short HEAD`. Proves exactly which commit is live.
- **Hostname** — proves the *server* answered, not a local copy.
- **Uptime** — resets to zero on restart, proving the restart actually happened.

`/health` is the machine-readable version — what a load balancer or uptime monitor would poll.

**Stack:** Node.js + Express. One dependency. No database, no build step, no templating engine.

---

## Architecture

```
   Laptop (~/demo-deploy)
        │
        │  git push
        ▼
   GitHub  ──  tajamul-wani/Demo-deploy
        │
        │  git pull          ← manual. nothing auto-deploys.
        ▼
┌────────────────────────────────────────┐
│  Ubuntu 24.04 server                   │
│                                        │
│   nginx        0.0.0.0:80              │
│      │         reverse proxy           │
│      ▼                                 │
│   Node app     127.0.0.1:3000          │
│      ▲                                 │
│   systemd      keeps it running        │
│                                        │
│   code lives in /var/www/myapp         │
└────────────────────────────────────────┘
```

### Two copies of the code, on purpose

| Path | Role |
|---|---|
| `~/demo-deploy` | Where code is written |
| `/var/www/myapp` | What is actually being served |

They are separate directories connected **only through GitHub**. If the server ran the dev folder directly, the GitHub step would be decorative.

---

## The three pieces, and why each exists

### nginx — the front door

Browsers go to port 80 by default. The app runs on port 3000. Ports below 1024 require root, and running the app as root means a compromise of the app is a compromise of the whole machine.

So nginx takes port 80, drops its root privileges immediately, and forwards every request to the app on port 3000.

The app binds to `127.0.0.1`, not `0.0.0.0` — so it is only reachable from inside the machine. **There is no route to the app that bypasses nginx.**

```nginx
proxy_pass http://127.0.0.1:3000;
```

### systemd — the supervisor

Running `node server.js` by hand fails three ways: it dies when the SSH session closes, it stays dead after a crash, and it never returns after a reboot.

The `myapp.service` unit fixes all three:

- `Restart=always` — brings it back if it crashes
- `WantedBy=multi-user.target` + `enable` — starts it at boot
- `User=tajamul-dev` — runs unprivileged, so a compromise is contained
- `ExecStart=/usr/bin/node` — **absolute path**, because systemd does not load shell profiles and nvm's node is not on its PATH

### git — the transport

GitHub is the single source of truth. The server only ever pulls from it, never has code edited directly on it. Rollback is just checking out an earlier commit.

---

## How a request travels

1. Browser requests the URL
2. **nginx** receives it on port 80
3. nginx forwards it to `127.0.0.1:3000`
4. **Node** matches the route and builds the response
5. Response goes back out through nginx

**systemd** is not in the request path — it is the reason a process is there at all.

---

## Deploying a change

```bash
# 1. On the laptop
git add . && git commit -m "..." && git push      # now on GitHub. Nothing is live yet.

# 2. On the server
ssh tajamul-dev@localhost -p 2222
cd /var/www/myapp
git pull                                          # code is on disk. Still not live.
sudo systemctl restart myapp                      # NOW it is live.

# 3. Verify
curl -s http://localhost/health
```

### Why the restart is not optional

Node reads `server.js` into memory when it starts. Changing the file on disk does nothing to the running process — it is still executing the old copy. **The restart is what makes a deploy a deploy.**

This is the most common deployment bug there is: the pull succeeded, so the deploy "worked", but nothing changed.

### Or use the script

```bash
/var/www/myapp/deploy/deploy.sh
```

It does the same steps, then polls `/health` for up to 10 seconds and exits non-zero if the app never comes back — so a broken deploy fails loudly instead of silently leaving the site down.

---

## Troubleshooting

### Find the broken layer first

```bash
curl http://127.0.0.1:3000/health    # the app directly
curl http://localhost/health          # through nginx
```

| :3000 | :80 | Means |
|---|---|---|
| ok | ok | healthy |
| ok | fail | app is fine — **nginx is the problem** |
| fail | fail | **app is down** — this is your 502 |

### Common symptoms

| Symptom | Cause | Fix |
|---|---|---|
| **502 Bad Gateway** | nginx is up but cannot reach the app | `systemctl status myapp`, then the journal |
| **Connection refused** | nothing is listening at all | check nginx is running, check the port |
| `activating (auto-restart)` | crash loop — the app dies on startup | `journalctl -u myapp -n 50` for the real error |
| `EADDRINUSE` | another process holds port 3000 | `ss -tlnp \| grep 3000`, then `kill <pid>` |
| `status=203/EXEC` | systemd cannot run the binary | `ExecStart` needs an absolute path |
| Old version still showing | pulled but not restarted | `sudo systemctl restart myapp` |
| nginx welcome page | the `default` site is still enabled | remove the symlink from `sites-enabled` |

### The commands

```bash
systemctl status myapp           # alive? since when?
journalctl -u myapp -n 50        # what did it say when it died?
journalctl -u myapp -f           # follow live
ss -tlnp                         # who is listening, on what port
sudo nginx -t                    # test nginx config before reloading
tail -f /var/log/nginx/error.log # nginx's own errors
```

### Reading the journal

Scroll to the **first line naming your own file** — that is the real error. Lines beginning `at ...` are Node's internal stack trace and can be ignored. The final `Failed with result 'exit-code'` is systemd shrugging; it looks identical for every crash.

---

## Rollback

```bash
cd /var/www/myapp
git log --oneline                 # find the last good commit
git checkout <hash>
sudo systemctl restart myapp
```

The commit hash on the page confirms which version is live.

---

## Setting this up from scratch

```bash
# Get the code
sudo mkdir -p /var/www && sudo chown "$USER" /var/www
git clone git@github.com:tajamul-wani/Demo-deploy.git /var/www/myapp
cd /var/www/myapp && npm ci --omit=dev

# Run it as a service
sudo cp deploy/myapp.service /etc/systemd/system/myapp.service
sudo systemctl daemon-reload
sudo systemctl enable --now myapp

# Put nginx in front
sudo cp deploy/nginx-myapp.conf /etc/nginx/sites-available/myapp
sudo ln -sf /etc/nginx/sites-available/myapp /etc/nginx/sites-enabled/myapp
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

The files in `deploy/` are the source of truth; the copies under `/etc/` are installs.

---

## Environment

| | |
|---|---|
| OS | Ubuntu 24.04.4 LTS |
| Node | v22.23.2 (`/usr/bin/node` — the one systemd uses) |
| nginx | 1.24.0 |
| Service | `myapp.service` |
| App directory | `/var/www/myapp` |
| App port | `127.0.0.1:3000` |
| nginx port | `0.0.0.0:80` |
