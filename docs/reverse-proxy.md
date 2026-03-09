# Running Comparr behind a reverse proxy

Many people choose to run services behind a reverse proxy. This page aims to provide some documentation to spare duplicated effort.

> When using a reverse proxy that sets client forwarding headers, set `TRUST_PROXY=true` in Comparr.
> If you use host allowlisting, set `ALLOWED_ORIGINS` to your public host/origin values.

## Nginx

### Behind a subdomain (HTTPS)

```nginx.conf
server {
  listen 80;
  server_name comparr.example.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name comparr.example.com;

  ssl_certificate /etc/letsencrypt/live/comparr.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/comparr.example.com/privkey.pem;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;

  location / {
    proxy_pass http://localhost:8000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

### Behind a subpath

Run Comparr with `ROOT_PATH=/comparr` and proxy that subpath:

```nginx.conf
location ^~ /comparr/ {
  proxy_pass http://localhost:8000/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

## HAProxy

```haproxy.cfg
frontend https
  mode http
  bind 0.0.0.0:443 name bind_1 crt /etc/haproxy/certs ssl alpn h2,http/1.1
  http-request set-header X-Forwarded-Proto https if { ssl_fc }
  use_backend comparr-http if { req.hdr(host),field(1,:) -i comparr.example.com } { path_beg / }

backend comparr-http
  mode http
  balance roundrobin
  option forwardfor
  server localhost:8000
```

## Apache2

Enable required modules first:

```bash
a2enmod mod_proxy mod_proxy_wstunnel mod_rewrite
```

```xml
<VirtualHost *:80>
  ServerName comparr.example.com
  ServerAlias comparr.example.com
  ProxyPass / http://localhost:8000/
  RewriteEngine on
  RewriteCond %{HTTP:Upgrade} websocket [NC]
  RewriteCond %{HTTP:Connection} upgrade [NC]
  RewriteRule ^/?(.*) "ws://localhost:8000/$1" [P,L]
</VirtualHost>
```
