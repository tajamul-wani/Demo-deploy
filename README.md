# demo-deploy

A minimal Express app whose only job is to prove **which commit is running**.

- `GET /` — app name, version, short git commit hash, hostname
- `GET /health` — `{ status, uptime, version }`

Bump the version, push, deploy, refresh: the page changes. That is the whole
point — the page is a live receipt for the pipeline.

## The chain

```
Claude Code (~/demo-deploy)
    │  git push
    ▼
GitHub: tajamul-wani/Demo-deploy
    │  git pull
    ▼
Ubuntu 24.04 (WSL2, HP-Apexure-01)
    Cloudflare Tunnel  →  public HTTPS
        ↓
    nginx 1.24  0.0.0.0:80   reverse proxy
        ↓
    systemd  myapp.service   (Restart=always, unprivileged)
        ↓
    node  127.0.0.1:3000     /var/www/myapp
```

The dev copy (`~/demo-deploy`) and the deployed copy (`/var/www/myapp`) are
separate directories on the same machine, connected **only through GitHub**.

## Why each piece

| Piece | Problem it solves | Without it |
|---|---|---|
| systemd | keeps the process alive across logout, crash, reboot | `node server.js` dies with the SSH session |
| nginx | binds privileged port 80 so Node doesn't have to | Node runs as root, or the app is unreachable on 80 |
| loopback bind | no route to Node that bypasses nginx | TLS/rate-limiting/auth at the proxy can be skipped |
| Cloudflare Tunnel | public URL without a public IP or port forwarding | unreachable from outside the LAN |
| `/health` | machine-checkable liveness | deploys "succeed" while serving nothing |

## Deploy

```bash
ssh tajamul-dev@localhost -p 2222
/var/www/myapp/deploy/deploy.sh
```

Pulls fast-forward only, runs `npm ci --omit=dev`, restarts the service, then
polls `/health` for up to 10s. Exits non-zero and dumps the journal on failure.

## Install (fresh server)

```bash
sudo mkdir -p /var/www && sudo chown "$USER" /var/www
git clone git@github.com:tajamul-wani/Demo-deploy.git /var/www/myapp
cd /var/www/myapp && npm ci --omit=dev

sudo cp deploy/myapp.service /etc/systemd/system/myapp.service
sudo systemctl daemon-reload && sudo systemctl enable --now myapp

sudo cp deploy/nginx-myapp.conf /etc/nginx/sites-available/myapp
sudo ln -sf /etc/nginx/sites-available/myapp /etc/nginx/sites-enabled/myapp
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

cloudflared tunnel --url http://localhost:80
```

Repo copies under `deploy/` are the source of truth; `/etc/` copies are installs.

## Troubleshooting

| Symptom | First move |
|---|---|
| 502 Bad Gateway | `systemctl status myapp` → app dead or on the wrong port |
| `status=203/EXEC` | `ExecStart` isn't an absolute path (nvm is not on systemd's PATH) |
| `EADDRINUSE` | `ss -tlnp \| grep 3000` — find and kill the stale pid |
| Unit edit had no effect | `sudo systemctl daemon-reload` |
| Still seeing nginx welcome page | `default` still symlinked in `sites-enabled` |
| Page shows the old commit | the pull worked but the service wasn't restarted |

```bash
journalctl -u myapp -f          # live app logs
tail -f /var/log/nginx/error.log
ss -tlnp                        # what's listening, which pid
sudo nginx -t                   # ALWAYS before reload
```
