# demo-deploy

Express app that reports which build is running: version, git commit, hostname.

Used to verify deployments — deploy, refresh, confirm the commit hash changed.

| Route | Response |
|---|---|
| `GET /` | HTML page with app name, version, commit, hostname |
| `GET /health` | `{ "status": "ok", "uptime": 126, "version": "1.1.0" }` |

**Stack:** Node.js, Express. No database, no build step.

---

## Local development

```bash
npm install
npm start                 # http://localhost:3000
```

`PORT` overrides the default of 3000.

---

## Architecture

```
GitHub ──git pull──► /var/www/myapp
                          │
   nginx :80 ────────────►│ node 127.0.0.1:3000
                          │
                     systemd (myapp.service)
```

- **nginx** owns port 80 and proxies to the app. Ports below 1024 need root; the app should not run as root.
- **The app binds `127.0.0.1`**, so it is only reachable via nginx.
- **systemd** runs the app as `tajamul-dev`, restarts it on failure, starts it at boot.
- `~/demo-deploy` (development) and `/var/www/myapp` (deployed) are separate checkouts, synced only through GitHub.

---

## Deploy

```bash
ssh tajamul-dev@localhost -p 2222
/var/www/myapp/deploy/deploy.sh
```

The script pulls fast-forward only, runs `npm ci --omit=dev`, restarts the service, then polls `/health` for 10s and exits non-zero if the app does not come back.

Manual equivalent:

```bash
cd /var/www/myapp
git pull
sudo systemctl restart myapp
curl -s http://localhost/health
```

> The restart is required. Node loads `server.js` into memory at startup; pulling alone changes nothing.

### Rollback

```bash
cd /var/www/myapp
git log --oneline
git checkout <hash>
sudo systemctl restart myapp
```

---

## Operations

```bash
systemctl status myapp             # service state
journalctl -u myapp -n 50          # recent logs
journalctl -u myapp -f             # follow
ss -tlnp                           # listening ports and owning process
sudo nginx -t                      # validate nginx config
sudo systemctl reload nginx        # apply nginx config
tail -f /var/log/nginx/error.log   # nginx errors
```

### Isolating a failure

```bash
curl http://127.0.0.1:3000/health   # app directly
curl http://localhost/health         # via nginx
```

Both fail → app is down. Only the second fails → nginx config.

### Common failures

| Symptom | Cause |
|---|---|
| 502 Bad Gateway | App down, or listening on a different port than `proxy_pass` |
| Connection refused | nginx not running |
| `activating (auto-restart)` | App crashes on startup — check the journal |
| `EADDRINUSE` | Stale process on port 3000. `ss -tlnp \| grep 3000`, then `kill` |
| `status=203/EXEC` | `ExecStart` must be an absolute path — systemd does not load shell profiles, so nvm's node is not on its PATH |
| Old version served | Pulled without restarting |
| nginx welcome page | `default` still symlinked in `sites-enabled` |

In the journal, the first line naming `server.js` is the real error; `at ...` lines are Node's stack trace.

---

## Provisioning

```bash
sudo mkdir -p /var/www && sudo chown "$USER" /var/www
git clone git@github.com:tajamul-wani/Demo-deploy.git /var/www/myapp
cd /var/www/myapp && npm ci --omit=dev

sudo cp deploy/myapp.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now myapp

sudo cp deploy/nginx-myapp.conf /etc/nginx/sites-available/myapp
sudo ln -sf /etc/nginx/sites-available/myapp /etc/nginx/sites-enabled/myapp
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Files in `deploy/` are the source of truth; `/etc/` holds installed copies. Edit here, copy out, `daemon-reload` (systemd) or `nginx -t && reload` (nginx).

---

## Reference

| | |
|---|---|
| Repo layout | `server.js`, `package.json`, `deploy/` |
| Service | `myapp.service` |
| App directory | `/var/www/myapp` |
| App | `127.0.0.1:3000` |
| nginx | `0.0.0.0:80` |
| SSH | port 2222 |
| Node | v22.23.2 (`/usr/bin/node`) |
| OS | Ubuntu 24.04 LTS |
